<script lang="ts">
	import icon from '$lib/assets/icon.svg';
	import { resolve } from '$app/paths';
	import DocsInputPanel from '$lib/DocsInputPanel.svelte';
	import { extractTextFromFile, isPdfFile } from '$lib/extractDocumentText';
	import PdfViewer from '$lib/PdfViewer.svelte';
	import { buildPdfTextLayout, type ModelSpan, type PdfTextLayout } from '$lib/pdfTextLayout';
	import TextInputPanel from '$lib/TextInputPanel.svelte';
	import { getSensitiveLabelClass } from '$lib/sensitiveHighlightStyle';
	import {
		model,
		ensureScrubberWorker,
		postClassifyText,
		registerInferenceHandler,
		type WorkerInferenceMessage
	} from '$lib/scrubberModel.svelte';
	import { onMount } from 'svelte';

	interface Props {
		activeTab: 'text' | 'docs';
	}
	let { activeTab }: Props = $props();

	const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
	const DOCUMENT_ACCEPT = '.pdf,.txt,application/pdf,text/plain';

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

	let inputText = $state('');
	let resultSegments = $state<Segment[]>([]);
	/** User-facing line; when null, the shared model line is shown. */
	let activityMessage = $state<string | null>(null);
	let isSubmitting = $state(false);
	let isExtracting = $state(false);
	let submittedText = $state('');

	let pdfLayout = $state<PdfTextLayout | null>(null);
	let pdfDetectionSpans = $state<ModelSpan[]>([]);
	let isPdfInputMode = $state(false);

	const statusMessage = $derived(activityMessage ?? model.modelStatusLine);

	const isDocs = $derived(activeTab === 'docs');

	function discardPdf(): void {
		try {
			pdfLayout?.pdf?.destroy();
		} catch {
			// ignore
		}
		pdfLayout = null;
		pdfDetectionSpans = [];
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

	function handleInferenceMessage(data: WorkerInferenceMessage): void {
		if (data.type === 'result') {
			const raw = (data.spans ?? []) as Span[];
			resultSegments = buildLabeledSegments(submittedText, raw);
			if (pdfLayout) {
				pdfDetectionSpans = raw
					.filter((s) => Number.isInteger(s.start) && Number.isInteger(s.end) && s.end! > s.start!)
					.map((s) => ({
						start: Number(s.start),
						end: Number(s.end),
						label: String(s.label ?? s.entity_group ?? 'private'),
						score: Number.isFinite(s.score) ? Number(s.score) : null
					}));
			} else {
				pdfDetectionSpans = [];
			}
			isSubmitting = false;
			activityMessage = `Detection complete: ${(data.entities ?? []).length} item(s) found`;
		} else {
			isSubmitting = false;
			activityMessage = `Error: ${data.message ?? 'Unknown error'}`;
		}
	}

	onMount(() => {
		ensureScrubberWorker();
		registerInferenceHandler(handleInferenceMessage);
		return () => {
			registerInferenceHandler(undefined);
		};
	});

	function textForClassify(): string {
		// PDF layout text must not be trim()'d: offsets in the worker must match buildPdfTextLayout.
		if (pdfLayout) {
			return pdfLayout.fullText;
		}
		return inputText.trim();
	}

	function handleSubmit(): void {
		const normalized = textForClassify();
		if (!normalized) {
			resultSegments = [];
			activityMessage = 'Please enter text before submitting.';
			return;
		}

		if (!model.isModelReady) {
			activityMessage = 'Model is still loading. Please try again in a moment.';
			return;
		}

		isSubmitting = true;
		activityMessage = 'Processing request...';
		submittedText = normalized;
		postClassifyText(normalized);
	}

	function onDocumentDragOver(event: DragEvent): void {
		event.preventDefault();
	}

	function onDocumentDrop(event: DragEvent): void {
		event.preventDefault();
		const file = event.dataTransfer?.files?.[0];
		if (file) void loadDocumentFile(file);
	}

	function onFileInputChange(event: Event): void {
		const target = event.currentTarget as HTMLInputElement;
		const file = target.files?.[0];
		target.value = '';
		if (file) void loadDocumentFile(file);
	}

	async function loadDocumentFile(file: File): Promise<void> {
		if (file.size > MAX_DOCUMENT_BYTES) {
			activityMessage = 'File is too large (max 50 MB).';
			return;
		}
		const incomingIsPdf = isPdfFile(file);
		isPdfInputMode = incomingIsPdf;
		isExtracting = true;
		resultSegments = [];
		pdfDetectionSpans = [];
		discardPdf();
		activityMessage = 'Extracting text from file...';
		try {
			if (incomingIsPdf) {
				const buf = await file.arrayBuffer();
				const layout = await buildPdfTextLayout(buf);
				if (!layout.fullText) {
					activityMessage =
						'No text could be extracted. The PDF may be image-only (scanned) or the document is empty.';
					layout.pdf.destroy();
					return;
				}
				pdfLayout = layout;
				activityMessage = 'PDF loaded. Run Filter to highlight sensitive spans on the page.';
			} else {
				const text = await extractTextFromFile(file);
				if (!text) {
					activityMessage = 'No text could be extracted, or the document is empty.';
					return;
				}
				inputText = text;
				activityMessage = 'Text loaded. You can edit it, then tap Filter.';
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			activityMessage = `Could not read file: ${msg}`;
		} finally {
			isExtracting = false;
		}
	}

	const tabPillBase =
		'inline-flex items-center justify-center rounded-full border px-4 py-1 text-sm font-medium no-underline transition';
	const tabPillActive = 'border-emerald-400 bg-emerald-50 text-emerald-700';
	const tabPillIdle =
		'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50';
</script>

<main class="box-border flex min-h-dvh flex-col bg-[#f5f7f8] text-slate-900">
	<div
		class="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-y-auto px-4 py-5 sm:px-6 sm:py-6"
	>
		<header class="mb-4 flex shrink-0 items-center justify-between border-b border-slate-200 pb-3">
			<div class="flex items-center gap-2">
				<a href={resolve('/')} class="flex items-center gap-2 no-underline">
					<img src={icon} alt="Scrubber" class="h-7 w-7" />
					<h1 class="m-0 text-lg font-semibold text-slate-800">Scrubber</h1>
				</a>
			</div>
		</header>

		<div class="mb-4 flex shrink-0 items-center gap-3 text-sm">
			<nav class="flex flex-wrap items-center gap-2" aria-label="Input mode">
				<a
					href={resolve('/')}
					class="{tabPillBase} {activeTab === 'text' ? tabPillActive : tabPillIdle}"
					data-sveltekit-preload-data="hover"
				>
					Text
				</a>
				<a
					href={resolve('/docs')}
					class="{tabPillBase} {activeTab === 'docs' ? tabPillActive : tabPillIdle}"
					data-sveltekit-preload-data="hover"
				>
					Docs
				</a>
			</nav>
			<p class="m-0 ml-auto text-xs text-slate-500" aria-live="polite">{statusMessage}</p>
		</div>

		<div
			class="grid min-h-0 w-full min-w-0 flex-1 grid-cols-1 items-stretch gap-3 overflow-hidden lg:max-h-[min(640px,calc(100dvh-10rem))] lg:grid-cols-2"
		>
			{#if isDocs}
				<DocsInputPanel
					bind:inputText
					pdfLoaded={Boolean(pdfLayout)}
					showPdfNotice={isPdfInputMode || Boolean(pdfLayout)}
					{isExtracting}
					{isSubmitting}
					isModelReady={model.isModelReady}
					documentAccept={DOCUMENT_ACCEPT}
					onSubmit={handleSubmit}
					{onDocumentDragOver}
					{onDocumentDrop}
					{onFileInputChange}
				/>
			{:else}
				<TextInputPanel
					bind:inputText
					{isSubmitting}
					isModelReady={model.isModelReady}
					onSubmit={handleSubmit}
				/>
			{/if}

			<section
				class="flex min-h-48 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white lg:h-full lg:min-h-0"
			>
				<div class="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
					<h2 class="m-0 text-sm font-semibold text-slate-700">Result</h2>
					<span class="text-xs text-slate-400">
						{#if isDocs && pdfLayout}
							{pdfDetectionSpans.length > 0
								? `${pdfDetectionSpans.length} span(s) on PDF`
								: 'Run Filter to highlight in PDF'}
						{:else}
							Sensitive data detection
						{/if}
					</span>
				</div>
				<div
					aria-label="Detection result"
					class="relative min-h-0 flex-1 overflow-x-auto overflow-y-auto text-[15px] leading-7 text-slate-700"
				>
					{#if isDocs && pdfLayout}
						<div class="relative h-full min-h-0 min-w-0">
							<div class="h-full min-h-48 min-w-0">
								<PdfViewer pdf={pdfLayout.pdf} layout={pdfLayout} spans={pdfDetectionSpans} />
							</div>
							{#if isSubmitting}
								<div
									class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white/55 px-4 backdrop-blur-[1px]"
									role="status"
									aria-live="polite"
									aria-label="Analyzing"
								>
									<div
										class="h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-500"
									></div>
									<p class="m-0 text-sm text-slate-600">Analyzing text…</p>
								</div>
							{/if}
						</div>
					{:else if isSubmitting}
						<div
							class="flex min-h-48 flex-col items-center justify-center gap-2 px-4 py-8 text-slate-500"
						>
							<div
								class="h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-500"
							></div>
							<p class="m-0 text-sm">Analyzing text…</p>
						</div>
					{:else if resultSegments.length === 0}
						<div class="px-4 py-4">
							<p class="m-0 text-slate-400">Results appear here after you run the filter.</p>
						</div>
					{:else}
						<div class="px-4 py-4">
							<p class="m-0 wrap-break-word whitespace-pre-wrap">
								{#each resultSegments as segment, idx (`${idx}-${segment.label ?? 'plain'}-${segment.text}`)}
									{#if segment.label}
										<span
											class={`mx-px inline rounded px-1 py-0.5 font-medium ring-1 ring-inset ${getSensitiveLabelClass(segment.label)}`}
											title={getSegmentTitle(segment.label, segment.score)}
										>
											{segment.text}
										</span>
									{:else}
										<span>{segment.text}</span>
									{/if}
								{/each}
							</p>
						</div>
					{/if}
				</div>
			</section>
		</div>
	</div>

	{#if model.isModelLoading}
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
					Download progress: {model.loadProgress}%
				</p>
			</div>
		</div>
	{/if}
	<footer
		class="mx-auto mt-auto w-full max-w-6xl shrink-0 border-t border-slate-200 px-4 pt-4 pb-4 text-xs leading-5 text-slate-500 sm:px-6"
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
