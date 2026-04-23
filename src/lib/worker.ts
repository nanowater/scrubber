import { pipeline, env } from '@huggingface/transformers';

// Cache model assets in IndexedDB to avoid re-downloading.
env.useBrowserCache = true;

let classifier: any = null;

function buildSpansFromEntities(text: string, entities: any[]) {
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

self.onmessage = async (e) => {
	const { type, text } = e.data;

	if (type === 'load') {
		try {
			self.postMessage({ type: 'status', message: 'Downloading model...' });
			classifier = await pipeline('token-classification', 'openai/privacy-filter', {
				device: 'webgpu',
				dtype: 'q4',
				progress_callback: (p) => {
					// Stream download progress to the UI.
					if (p.status === 'progress') {
						self.postMessage({ type: 'progress', progress: p.progress });
					}
				}
			});
			self.postMessage({ type: 'ready', device: 'webgpu' });
		} catch (_webgpuError) {
			// Fall back when WebGPU is not available.
			try {
				self.postMessage({
					type: 'status',
					message: 'WebGPU unavailable, loading fallback runtime...'
				});
				classifier = await pipeline('token-classification', 'openai/privacy-filter', {
					device: 'wasm',
					dtype: 'q8',
					progress_callback: (p) => {
						if (p.status === 'progress') {
							self.postMessage({ type: 'progress', progress: p.progress });
						}
					}
				});
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
			const entities = await classifier(text, {
				aggregation_strategy: 'simple'
			});
			const spans = buildSpansFromEntities(text, entities);
			const maskedText = maskTextFromSpans(text, spans);
			self.postMessage({ type: 'result', entities, maskedText, spans });
		} catch (error) {
			self.postMessage({
				type: 'error',
				message: error instanceof Error ? error.message : 'Classification failed'
			});
		}
	}
};
