// pdfjs is loaded only in the browser via dynamic import so SSR/SSG does not evaluate PDF.js (uses DOMMatrix, etc.).

let pdfWorkerSrc: string | null = null;

export function isPdfFile(file: File): boolean {
	return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function isTextFile(file: File): boolean {
	return file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');
}

async function extractTextFromPdf(arrayBuffer: ArrayBuffer): Promise<string> {
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
	const pageTexts: string[] = [];
	for (let i = 1; i <= pdf.numPages; i++) {
		const page = await pdf.getPage(i);
		const textContent = await page.getTextContent();
		const line = textContent.items
			.map((item) => ('str' in item ? (item as { str: string }).str : ''))
			.filter((s) => s.length > 0)
			.join(' ');
		pageTexts.push(line);
	}
	return pageTexts.join('\n\n');
}

export async function extractTextFromFile(file: File): Promise<string> {
	const buf = await file.arrayBuffer();

	if (isPdfFile(file)) {
		return (await extractTextFromPdf(buf)).trim();
	}
	if (isTextFile(file)) {
		return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf)).trim();
	}
	throw new Error('Unsupported file type. Use PDF or plain text (.txt).');
}
