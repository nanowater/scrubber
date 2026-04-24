// Browser-only. Maps model char offsets ↔ per-page text run index (PDF.js TextLayer textDivs order).

import type { PDFDocumentProxy } from 'pdfjs-dist';

let pdfWorkerSrc: string | null = null;

export type ModelSpan = {
	start: number;
	end: number;
	label: string;
	score: number | null;
};

export type PdfTextItem = {
	start: number;
	end: number;
	str: string;
	pageIndex: number;
	/** 0,1,… on that page; matches rendered text spans order (non-empty runs). */
	itemIndexOnPage: number;
};

export type PdfTextFragmentHighlight = {
	pageIndex: number;
	itemIndexOnPage: number;
	label: string;
	score: number | null;
};

export type PdfTextLayout = {
	fullText: string;
	numPages: number;
	items: PdfTextItem[];
	/** Loaded document; destroy when discarding. */
	pdf: PDFDocumentProxy;
	/** Spans (char offsets) → text run fragments to mark, using the same indexing as TextLayer. */
	getFragmentHighlights: (spans: ModelSpan[]) => PdfTextFragmentHighlight[];
};

/**
 * Builds the same string as extractTextFromPdf (pages joined with \n\n, items with spaces).
 * Must be the only source for classify() when using PDF.
 */
export async function buildPdfTextLayout(arrayBuffer: ArrayBuffer): Promise<PdfTextLayout> {
	const [{ getDocument, GlobalWorkerOptions }, workerMod] = await Promise.all([
		import('pdfjs-dist'),
		import('pdfjs-dist/build/pdf.worker.mjs?url')
	]);
	const src = (workerMod as { default: string }).default;
	if (pdfWorkerSrc === null) {
		pdfWorkerSrc = src;
		GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
	}

	const data = new Uint8Array(arrayBuffer);
	const pdf = await getDocument({ data }).promise;
	const numPages = pdf.numPages;
	const items: PdfTextItem[] = [];
	let fullText = '';

	for (let p = 1; p <= numPages; p++) {
		if (p > 1) {
			fullText += '\n\n';
		}
		const page = await pdf.getPage(p);
		const textContent = await page.getTextContent({
			includeMarkedContent: true,
			disableNormalization: true
		});
		let firstOnPage = true;
		let itemIndexOnPage = 0;
		for (const raw of textContent.items) {
			// Must match TextLayer.#processItems: marked content has str === undefined, no textDiv.
			if (!('str' in raw) || (raw as { str?: string }).str === undefined) {
				continue;
			}
			const s = (raw as { str: string }).str;
			if (!s) continue;
			if (!firstOnPage) {
				fullText += ' ';
			}
			const start = fullText.length;
			fullText += s;
			const end = fullText.length;
			firstOnPage = false;
			items.push({
				start,
				end,
				str: s,
				pageIndex: p - 1,
				itemIndexOnPage
			});
			itemIndexOnPage += 1;
		}
	}

	function getFragmentHighlights(spans: ModelSpan[]): PdfTextFragmentHighlight[] {
		const sorted = [...spans]
			.filter((s) => Number.isInteger(s.start) && Number.isInteger(s.end) && s.end > s.start)
			.sort((a, b) => a.start - b.start);
		/** de-dupe by (page, run); keep higher score if labels conflict */
		const best = new Map<string, PdfTextFragmentHighlight>();
		for (const span of sorted) {
			const a = Math.max(0, span.start);
			const b = Math.min(fullText.length, span.end);
			if (a >= b) continue;
			for (const it of items) {
				if (it.end <= a || it.start >= b) continue;
				const key = `${it.pageIndex}\0${it.itemIndexOnPage}`;
				const next: PdfTextFragmentHighlight = {
					pageIndex: it.pageIndex,
					itemIndexOnPage: it.itemIndexOnPage,
					label: span.label,
					score: span.score
				};
				const prev = best.get(key);
				if (!prev) {
					best.set(key, next);
					continue;
				}
				const ps = prev.score;
				const ns = next.score;
				if (ns != null && (ps == null || ns > ps)) {
					best.set(key, next);
				}
			}
		}
		return [...best.values()];
	}

	return {
		fullText,
		numPages,
		items,
		pdf,
		getFragmentHighlights
	};
}
