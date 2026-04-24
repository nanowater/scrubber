import { pipeline, env } from '@huggingface/transformers';

// Cache model assets in IndexedDB to avoid re-downloading.
env.useBrowserCache = true;

type EntityLike = {
	start?: number;
	end?: number;
	entity_group?: string;
	label?: string;
	score?: number;
	word?: string;
};

type TokenClassifier = (
	text: string,
	options: { aggregation_strategy: 'simple' }
) => Promise<EntityLike[]>;

let classifier: TokenClassifier | null = null;
const CHUNK_CHAR_LIMIT = 3200;
const CHUNK_OVERLAP = 240;

function buildSpansFromEntities(text: string, entities: EntityLike[]) {
	if (!Array.isArray(entities) || entities.length === 0) return [];

	const spans: { start: number; end: number; label: string; score: number | null }[] = [];
	let searchCursor = 0;

	for (const entity of entities) {
		const label = String(entity.entity_group ?? 'private').toUpperCase();
		const score = typeof entity.score === 'number' ? entity.score : null;

		if (Number.isInteger(entity.start) && Number.isInteger(entity.end)) {
			const start = Number(entity.start);
			const end = Number(entity.end);
			if (end > start) {
				spans.push({ start, end, label, score });
				searchCursor = Math.max(searchCursor, end);
			}
			continue;
		}

		const word = String(entity.word ?? '').trim();
		if (!word) continue;

		// Prefer forward search first so repeated tokens map in order.
		let start = text.indexOf(word, searchCursor);
		if (start === -1) {
			start = text.indexOf(word);
		}
		if (start === -1) continue;

		const end = start + word.length;
		spans.push({ start, end, label, score });
		searchCursor = end;
	}

	spans.sort((a, b) => a.start - b.start);

	const normalized: { start: number; end: number; label: string; score: number | null }[] = [];
	for (const span of spans) {
		const prev = normalized.at(-1);
		if (!prev || span.start >= prev.end) {
			normalized.push(span);
			continue;
		}
		if (span.end > prev.end) {
			prev.end = span.end;
		}
		if (span.score != null) {
			prev.score = prev.score == null ? span.score : Math.max(prev.score, span.score);
		}
		if (prev.label !== span.label) {
			prev.label = 'PRIVATE';
		}
	}

	return normalized;
}

function maskTextFromSpans(text: string, spans: { start: number; end: number; label: string }[]) {
	if (spans.length === 0) return text;

	let cursor = 0;
	let masked = '';

	for (const span of spans) {
		masked += text.slice(cursor, span.start);
		masked += `[${span.label}]`;
		cursor = span.end;
	}
	masked += text.slice(cursor);

	return masked;
}

type TextChunk = {
	text: string;
	start: number;
	end: number;
};

function splitTextIntoChunks(text: string, maxChars: number, overlap: number): TextChunk[] {
	if (text.length <= maxChars) {
		return [{ text, start: 0, end: text.length }];
	}

	const chunks: TextChunk[] = [];
	let start = 0;
	while (start < text.length) {
		let end = Math.min(start + maxChars, text.length);
		if (end < text.length) {
			// Prefer breaking on whitespace to avoid cutting entities in half.
			const breakPos = text.lastIndexOf(' ', end);
			if (breakPos > start + Math.floor(maxChars * 0.6)) {
				end = breakPos;
			}
		}
		chunks.push({ text: text.slice(start, end), start, end });
		if (end >= text.length) break;
		start = Math.max(end - overlap, start + 1);
	}
	return chunks;
}

function mergeSpans(
	spans: { start: number; end: number; label: string; score: number | null }[]
): { start: number; end: number; label: string; score: number | null }[] {
	if (spans.length <= 1) return spans;
	const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
	const merged: { start: number; end: number; label: string; score: number | null }[] = [];
	for (const current of sorted) {
		const prev = merged.at(-1);
		if (!prev || current.start > prev.end) {
			merged.push({ ...current });
			continue;
		}
		prev.end = Math.max(prev.end, current.end);
		if (current.score != null) {
			prev.score = prev.score == null ? current.score : Math.max(prev.score, current.score);
		}
		if (prev.label !== current.label) {
			prev.label = 'PRIVATE';
		}
	}
	return merged;
}

self.onmessage = async (e) => {
	const { type, text } = e.data;

	if (type === 'load') {
		try {
			self.postMessage({ type: 'status', message: 'Downloading model...' });
			classifier = (await pipeline('token-classification', 'openai/privacy-filter', {
				device: 'webgpu',
				dtype: 'q4',
				progress_callback: (p) => {
					// Stream download progress to the UI.
					if (p.status === 'progress') {
						self.postMessage({ type: 'progress', progress: p.progress });
					}
				}
			})) as unknown as TokenClassifier;
			self.postMessage({ type: 'ready', device: 'webgpu' });
		} catch {
			// Fall back when WebGPU is not available.
			try {
				self.postMessage({
					type: 'status',
					message: 'WebGPU unavailable, loading fallback runtime...'
				});
				classifier = (await pipeline('token-classification', 'openai/privacy-filter', {
					device: 'wasm',
					dtype: 'q8',
					progress_callback: (p) => {
						if (p.status === 'progress') {
							self.postMessage({ type: 'progress', progress: p.progress });
						}
					}
				})) as unknown as TokenClassifier;
				self.postMessage({ type: 'ready', device: 'wasm' });
			} catch (error) {
				self.postMessage({
					type: 'error',
					message: error instanceof Error ? error.message : 'Failed to load model'
				});
			}
		}
	}

	if (type === 'classify') {
		if (!classifier) {
			self.postMessage({ type: 'error', message: 'Model is not ready yet.' });
			return;
		}
		try {
			const chunks = splitTextIntoChunks(String(text ?? ''), CHUNK_CHAR_LIMIT, CHUNK_OVERLAP);
			const allEntities: EntityLike[] = [];
			const allSpans: { start: number; end: number; label: string; score: number | null }[] = [];

			for (const chunk of chunks) {
				const entities = await classifier(chunk.text, {
					aggregation_strategy: 'simple'
				});
				allEntities.push(...entities);
				const spans = buildSpansFromEntities(chunk.text, entities);
				for (const span of spans) {
					allSpans.push({
						start: span.start + chunk.start,
						end: span.end + chunk.start,
						label: span.label,
						score: span.score
					});
				}
			}

			const spans = mergeSpans(allSpans);
			const maskedText = maskTextFromSpans(text, spans);
			self.postMessage({ type: 'result', entities: allEntities, maskedText, spans });
		} catch (error) {
			self.postMessage({
				type: 'error',
				message: error instanceof Error ? error.message : 'Classification failed'
			});
		}
	}
};
