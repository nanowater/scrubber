<script lang="ts">
	import { onMount } from 'svelte';

	type Segment = {
		text: string;
		label: string | null;
		score: number | null;
	};

	type Span = {
		start: number;
		end: number;
		label?: string;
		entity_group?: string;
		score?: number;
	};

	type WorkerMessageData =
		| { type: 'status'; message?: string }
		| { type: 'progress'; progress?: number }
		| { type: 'ready'; device?: string }
		| { type: 'result'; spans?: Span[]; entities?: unknown[] }
		| { type: 'error'; message?: string };

	type WorkerRequest = { type: 'load' } | { type: 'classify'; text: string };

	let inputText = $state('');
	let resultSegments = $state<Segment[]>([]);
	let statusMessage = $state('Initializing model...');
	let progress = $state(0);
	let isModelReady = $state(false);
	let isModelLoading = $state(true);
	let isSubmitting = $state(false);
	let runtimeDevice = $state('');
	let submittedText = $state('');

	let worker: Worker | undefined;

	function getHighlightClass(label: string | null | undefined): string {
		const key = String(label ?? '').toLowerCase();
		if (key.includes('email')) return 'bg-emerald-200/80 text-emerald-950 ring-emerald-300';
		if (key.includes('phone')) return 'bg-sky-200/80 text-sky-950 ring-sky-300';
		if (key.includes('person')) return 'bg-violet-200/80 text-violet-950 ring-violet-300';
		if (key.includes('address')) return 'bg-amber-200/80 text-amber-950 ring-amber-300';
		if (key.includes('date')) return 'bg-lime-200/80 text-lime-950 ring-lime-300';
		if (key.includes('url')) return 'bg-cyan-200/80 text-cyan-950 ring-cyan-300';
		if (key.includes('account')) return 'bg-fuchsia-200/80 text-fuchsia-950 ring-fuchsia-300';
		if (key.includes('secret')) return 'bg-rose-200/80 text-rose-950 ring-rose-300';
		return 'bg-slate-200 text-slate-950 ring-slate-300';
	}

	function getSegmentTitle(
		label: string | null | undefined,
		score: number | null | undefined
	): string {
		const category = String(label ?? 'private');
		const percentage = Number.isFinite(score ?? 0) ? `${(score! * 100).toFixed(1)}%` : 'N/A';
		return `${category} (${percentage})`;
	}

	// Convert span positions into renderable plain/highlighted text chunks.
	function buildLabeledSegments(text: string, detectedSpans: Span[]): Segment[] {
		if (!text) return [];
		if (!Array.isArray(detectedSpans) || detectedSpans.length === 0) {
			return [{ text, label: null, score: null }];
		}

		const spans = detectedSpans
			.filter((entity) => Number.isInteger(entity.start) && Number.isInteger(entity.end))
			.map((entity) => ({
				start: Number(entity.start),
				end: Number(entity.end),
				label: String(entity.label ?? entity.entity_group ?? 'private'),
				score: Number.isFinite(entity.score) ? Number(entity.score) : null
			}))
			.sort((a, b) => a.start - b.start);

		if (spans.length === 0) return [{ text, label: null, score: null }];

		const segments = [];
		let cursor = 0;

		for (const span of spans) {
			if (span.start > cursor) {
				segments.push({ text: text.slice(cursor, span.start), label: null, score: null });
			}
			if (span.end > span.start) {
				segments.push({
					text: text.slice(span.start, span.end),
					label: span.label,
					score: span.score
				});
			}
			cursor = Math.max(cursor, span.end);
		}

		if (cursor < text.length) {
			segments.push({ text: text.slice(cursor), label: null, score: null });
		}

		return segments.filter((segment) => segment.text.length > 0);
	}

	// Centralized worker event handling keeps onMount concise.
	function handleWorkerMessage(data: WorkerMessageData): void {
		if (data.type === 'status') {
			const raw = String(data.message ?? '');
			if (raw.includes('WebGPU')) {
				statusMessage = 'WebGPU unavailable. Loading fallback runtime...';
			} else {
				statusMessage = 'Downloading model...';
			}
		} else if (data.type === 'progress') {
			progress = Math.max(0, Math.min(100, Math.round(data.progress ?? 0)));
		} else if (data.type === 'ready') {
			isModelReady = true;
			isModelLoading = false;
			runtimeDevice = data.device ?? '';
			statusMessage = `Model ready${runtimeDevice ? ` (${runtimeDevice})` : ''}`;
		} else if (data.type === 'result') {
			resultSegments = buildLabeledSegments(submittedText, data.spans ?? []);
			isSubmitting = false;
			statusMessage = `Detection complete: ${(data.entities ?? []).length} item(s) found`;
		} else if (data.type === 'error') {
			isModelLoading = false;
			statusMessage = `Error: ${data.message ?? 'Unknown error'}`;
			isSubmitting = false;
		}
	}

	onMount(() => {
		// Run model loading/inference in a worker to keep UI responsive.
		worker = new Worker(new URL('$lib/worker.ts', import.meta.url), {
			type: 'module',
			name: 'scrubber-worker'
		});

		worker.onmessage = (event: MessageEvent<WorkerMessageData>) => {
			handleWorkerMessage(event.data);
		};

		const loadMessage: WorkerRequest = { type: 'load' };
		worker.postMessage(loadMessage);

		return () => {
			worker?.terminate();
		};
	});

	function handleSubmit(): void {
		const normalized = inputText.trim();
		if (!normalized) {
			resultSegments = [];
			statusMessage = 'Please enter text before submitting.';
			return;
		}

		if (!isModelReady) {
			statusMessage = 'Model is still loading. Please try again in a moment.';
			return;
		}

		isSubmitting = true;
		statusMessage = 'Processing request...';
		submittedText = normalized;
		const classifyMessage: WorkerRequest = { type: 'classify', text: normalized };
		worker?.postMessage(classifyMessage);
	}
</script>

<main class="box-border min-h-screen bg-[#f5f7f8] px-4 py-5 text-slate-900 sm:px-6 sm:py-6">
	<div class="mx-auto flex w-full max-w-6xl flex-col">
		<header class="mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
			<div class="flex items-center gap-2">
				<img src="/icon.svg" alt="Scrubber" class="h-7 w-7" />
				<h1 class="m-0 text-lg font-semibold text-slate-800">Scrubber</h1>
			</div>
		</header>

		<div class="mb-4 flex items-center gap-3 text-sm">
			<button
				type="button"
				class="rounded-full border border-emerald-400 bg-emerald-50 px-4 py-1 font-medium text-emerald-700"
				>Text</button
			>
			<p class="m-0 ml-auto text-xs text-slate-500" aria-live="polite">{statusMessage}</p>
		</div>

		<div class="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-stretch">
			<section
				class="flex min-h-[480px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white"
			>
				<div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
					<h2 class="m-0 text-sm font-semibold text-slate-700">Input text</h2>
				</div>
				<div class="relative flex-1">
					<textarea
						bind:value={inputText}
						placeholder="Enter text to analyze"
						aria-label="Input text"
						class="h-full min-h-[360px] w-full resize-none bg-transparent px-4 py-4 pb-14 text-[15px] leading-7 text-slate-700 outline-none"
					></textarea>
				</div>
				<div class="flex h-16 border-t border-slate-200">
					<button
						type="button"
						onclick={handleSubmit}
						aria-label="Submit text for privacy filtering"
						class="ml-auto inline-flex w-44 items-center justify-center bg-emerald-500 text-base font-semibold text-white transition hover:bg-emerald-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-400"
						disabled={!isModelReady || isSubmitting}
					>
						{#if isSubmitting}
							<span class="inline-flex items-center gap-2">
								<span
									class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
								></span>
								Processing
							</span>
						{:else}
							Filter
						{/if}
					</button>
				</div>
			</section>

			<section
				class="flex min-h-[480px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white"
			>
				<div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
					<h2 class="m-0 text-sm font-semibold text-slate-700">Result</h2>
					<span class="text-xs text-slate-400">Sensitive data detection</span>
				</div>
				<div
					aria-label="Detection result"
					class="min-h-0 flex-1 overflow-auto px-4 py-4 text-[15px] leading-7 text-slate-700"
				>
					{#if isSubmitting}
						<div class="flex min-h-full flex-col items-center justify-center text-slate-500">
							<div
								class="h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-500"
							></div>
							<p class="m-0 mt-3 text-sm">Analyzing text...</p>
						</div>
					{:else if resultSegments.length === 0}
						<p class="m-0 text-slate-400">Results appear here after you run the filter.</p>
					{:else}
						<p class="m-0 wrap-break-word whitespace-pre-wrap">
							{#each resultSegments as segment, idx (`${idx}-${segment.label ?? 'plain'}-${segment.text}`)}
								{#if segment.label}
									<span
										class={`mx-px inline rounded px-1 py-0.5 font-medium ring-1 ring-inset ${getHighlightClass(segment.label)}`}
										title={getSegmentTitle(segment.label, segment.score)}
									>
										{segment.text}
									</span>
								{:else}
									<span>{segment.text}</span>
								{/if}
							{/each}
						</p>
					{/if}
				</div>
				<div class="flex h-16 border-t border-slate-200"></div>
			</section>
		</div>
	</div>

	{#if isModelLoading}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]"
			role="status"
			aria-live="polite"
			aria-label="Loading model"
		>
			<div class="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
				<div
					class="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600"
				></div>
				<p class="mt-4 text-center text-sm font-medium text-slate-800">Loading model...</p>
				<p class="mt-1 text-center text-xs text-slate-500">
					Download progress: {progress}%
				</p>
			</div>
		</div>
	{/if}
	<footer
		class="mx-auto mt-8 w-full max-w-6xl border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500"
	>
		<p class="m-0">This app runs entirely in your browser. No data is sent to any server.</p>
		<p>
			Powered by
			<a href="https://huggingface.co/openai/privacy-filter" target="_blank" rel="noopener">
				OpenAI Privacy Filter
			</a>
			·
			<a href="https://github.com/huggingface/transformers.js" target="_blank" rel="noopener">
				Transformers.js
			</a>
			— both licensed under
			<a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank" rel="noopener">
				Apache 2.0
			</a>
		</p>
		<p class="m-0">© 2026 Ryusei · Licensed under Apache 2.0</p>
	</footer>
</main>
