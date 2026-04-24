<script lang="ts">
	import { getSensitiveFillStyle } from '$lib/sensitiveHighlightStyle';
	import type { PdfTextFragmentHighlight } from '$lib/pdfTextLayout';
	import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';
	import type { TextContent } from 'pdfjs-dist/types/src/display/api';
	import { onDestroy, tick } from 'svelte';

	type PdfTextLayer = {
		cancel: () => void;
		div?: HTMLElement;
		textDivs?: HTMLElement[];
		render: () => Promise<unknown>;
	};

	type PdfRenderTask = {
		cancel: () => void;
		promise: Promise<unknown>;
	};

	function isRenderCancelledError(error: unknown): boolean {
		if (!error || typeof error !== 'object') return false;
		const candidate = error as { name?: string; message?: string };
		return (
			candidate.name === 'RenderingCancelledException' ||
			String(candidate.message ?? '').includes('Rendering cancelled')
		);
	}

function getCachedTextContent(pdfPage: PDFPageProxy): Promise<TextContent> {
		let cached = textContentCache.get(pdfPage);
		if (!cached) {
			cached = pdfPage.getTextContent({
				includeMarkedContent: true,
				disableNormalization: true
			});
			textContentCache.set(pdfPage, cached);
		}
		return cached;
	}

	function clearHighlightApplyTimer() {
		if (!applyHighlightsTimer) return;
		clearTimeout(applyHighlightsTimer);
		applyHighlightsTimer = null;
	}

	interface Props {
		page: PDFPageProxy;
		viewport: PageViewport;
		/** Text fragments to mark; indices match TextLayer `textDivs` and local offsets are per run. */
		itemHighlights: PdfTextFragmentHighlight[];
	}
	let { page, viewport, itemHighlights }: Props = $props();

	let layerHost = $state<HTMLDivElement | undefined>();
	let textLayerContainer = $state<HTMLDivElement | undefined>();
	let canvas = $state<HTMLCanvasElement | undefined>();

	/** Monotonic token to ignore stale async render work. */
	let runId = 0;

	let textLayer: PdfTextLayer | null = null;
	let canvasRenderTask: PdfRenderTask | null = null;
	let lastPageForLayer: PDFPageProxy | null = null;
	let lastVKey = '';
	let textLayerContainerVersion = $state(0);
	let applyHighlightsTimer: ReturnType<typeof setTimeout> | null = null;

	const HIGHLIGHT_APPLY_DEBOUNCE_MS = 24;
const textContentCache = new WeakMap<PDFPageProxy, Promise<TextContent>>();

	const HIGHLIGHT_STYLE_KEYS = ['background', 'mix-blend-mode', 'border-radius', 'cursor'] as const;

	function getHighlightTitle(
		label: string | null | undefined,
		score: number | null | undefined
	): string {
		const category = String(label ?? 'private');
		const percentage = Number.isFinite(score ?? null)
			? `${((score ?? 0) * 100).toFixed(1)}%`
			: 'N/A';
		return `${category} (${percentage})`;
	}

	function clearHighlightStyle(div: HTMLElement) {
		for (const key of HIGHLIGHT_STYLE_KEYS) {
			div.style.removeProperty(key);
		}
		div.removeAttribute('title');
		div.removeAttribute('aria-label');
	}

	function getRenderedTextDivs(tl: PdfTextLayer): HTMLElement[] {
		try {
			// Keep mapping aligned with pdfTextLayout items: only non-empty rendered text runs.
			const textDivs = tl?.textDivs?.filter((el) => (el.textContent?.length ?? 0) > 0);
			if (textDivs && textDivs.length > 0) return textDivs;
			const root = tl?.div ?? textLayerContainer;
			if (!(root instanceof Element)) return [];
			return Array.from(root.querySelectorAll<HTMLElement>("span[role='presentation']")).filter(
				(el) => (el.textContent?.length ?? 0) > 0
			);
		} catch (error) {
			void error;
			return [];
		}
	}

	function clearHighlightStyles(tl: PdfTextLayer) {
		for (const div of getRenderedTextDivs(tl)) {
			clearHighlightStyle(div);
		}
	}

	function applyHighlightStyle(div: HTMLElement, highlight: PdfTextFragmentHighlight) {
		div.style.setProperty('background', getSensitiveFillStyle(highlight.label), 'important');
		div.style.setProperty('mix-blend-mode', 'multiply');
		div.style.setProperty('border-radius', '2px');
		div.style.setProperty('cursor', 'help');

		const title = getHighlightTitle(highlight.label, highlight.score);
		div.title = title;
		div.setAttribute('aria-label', title);
	}

	function applyHighlights(tl: PdfTextLayer, highlights: PdfTextFragmentHighlight[]) {
		clearHighlightStyles(tl);
		const textDivs = getRenderedTextDivs(tl);
		const seen = new Array<boolean>(textDivs.length).fill(false);
		for (const h of highlights) {
			if (seen[h.itemIndexOnPage]) continue;
			seen[h.itemIndexOnPage] = true;
			const div = textDivs[h.itemIndexOnPage];
			if (!div) continue;
			applyHighlightStyle(div, h);
		}
	}

	function scheduleHighlightApply(tl: PdfTextLayer, highlights: PdfTextFragmentHighlight[]) {
		clearHighlightApplyTimer();
		applyHighlightsTimer = setTimeout(() => {
			applyHighlights(tl, highlights);
		}, HIGHLIGHT_APPLY_DEBOUNCE_MS);
	}

	/** Stable key for canvas/text-layer geometry; highlight changes should not change this key. */
	function getViewportKey(currentPage: PDFPageProxy, currentViewport: PageViewport): string {
		return `${currentPage.pageNumber}-${Math.floor(currentViewport.width)}-${Math.floor(currentViewport.height)}`;
	}

	async function cancelCanvasRenderTask() {
		if (!canvasRenderTask) return;
		const task = canvasRenderTask;
		canvasRenderTask = null;
		task.cancel();
		try {
			await task.promise;
		} catch {
			// Expected when cancelled.
		}
	}

	async function fullRender(
		myRun: number,
		currentPage: PDFPageProxy,
		currentViewport: PageViewport,
		highlights: PdfTextFragmentHighlight[]
	) {
		if (myRun !== runId) return;
		if (!canvas || !layerHost) return;
		await cancelCanvasRenderTask();
		if (myRun !== runId) return;

		canvas.width = Math.floor(currentViewport.width);
		canvas.height = Math.floor(currentViewport.height);
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const renderTask = currentPage.render({
			canvasContext: ctx,
			canvas,
			viewport: currentViewport,
			intent: 'display'
		});
		canvasRenderTask = renderTask;
		try {
			await renderTask.promise;
		} catch (error) {
			// This is expected when a newer render invalidates the previous one.
			if (!isRenderCancelledError(error)) {
				throw error;
			}
			return;
		} finally {
			if (canvasRenderTask === renderTask) {
				canvasRenderTask = null;
			}
		}
		if (myRun !== runId) return;

		textLayer?.cancel();
		textLayer = null;

		// Recreate only the inner text container (host node stays stable).
		textLayerContainerVersion += 1;
		await tick();
		if (myRun !== runId) return;
		if (!textLayerContainer) return;

		const { TextLayer } = await import('pdfjs-dist');
		const textContent = await getCachedTextContent(currentPage);
		if (myRun !== runId) return;
		if (!textLayerContainer) return;

		const tl = new TextLayer({
			textContentSource: textContent,
			container: textLayerContainer,
			viewport: currentViewport
		}) as unknown as PdfTextLayer;
		textLayer = tl;
		await tl.render();
		if (myRun !== runId) {
			tl.cancel();
			return;
		}

		scheduleHighlightApply(tl, highlights);
		if (myRun !== runId) return;
		lastPageForLayer = currentPage;
		lastVKey = getViewportKey(currentPage, currentViewport);
	}

	$effect(() => {
		if (!page || !canvas || !layerHost || !viewport) return;

		// Snapshot tracked dependencies explicitly so rerun triggers are obvious.
		const currentPage = page;
		const currentViewport = viewport;
		const highlights = itemHighlights;

		const vKey = getViewportKey(currentPage, currentViewport);
		if (textLayer && lastPageForLayer === currentPage && lastVKey === vKey) {
			scheduleHighlightApply(textLayer, highlights);
			return;
		}

		// Each run gets a token; async work checks it before mutating DOM/state.
		const myRun = ++runId;
		void (async () => {
			await fullRender(myRun, currentPage, currentViewport, highlights);
		})();

		// Bump runId to drop in-flight work; do not tear down textLayer (fast re-runs use it).
		return () => {
			runId += 1;
			void cancelCanvasRenderTask();
			clearHighlightApplyTimer();
		};
	});

	onDestroy(() => {
		void cancelCanvasRenderTask();
		clearHighlightApplyTimer();
		textLayer?.cancel();
		textLayer = null;
		lastPageForLayer = null;
		lastVKey = '';
	});
</script>

<div
	class="pdfjsPage relative inline-block max-w-none overflow-visible ring-1 ring-slate-200/80"
	style:width="{Math.floor(viewport.width)}px"
	style:height="{Math.floor(viewport.height)}px"
	style:--scale-factor={viewport.scale}
>
	<canvas
		bind:this={canvas}
		class="absolute top-0 left-0 m-0 block bg-white"
		style:width="{Math.floor(viewport.width)}px"
		style:height="{Math.floor(viewport.height)}px"
	></canvas>
	<div
		bind:this={layerHost}
		class="textLayerHost absolute top-0 left-0 m-0"
		aria-hidden="true"
		role="presentation"
		style:width="100%"
		style:height="100%"
		style:line-height="1"
		style:opacity="1"
		style:overflow="hidden"
		style:z-index="2"
	>
		{#key textLayerContainerVersion}
			<div bind:this={textLayerContainer} class="textLayer absolute inset-0"></div>
		{/key}
	</div>
</div>

<style>
	:global(.pdfViewer) {
		--scale-factor: 1;
		--hcm-highlight-filter: none;
		--hcm-highlight-selected-filter: none;
	}

	:global(.pdfjsPage) {
		--user-unit: 1;
		--total-scale-factor: calc(var(--scale-factor) * var(--user-unit));
		position: relative;
		direction: ltr;
	}

	:global(.textLayer) {
		/* Match PDF.js viewer scaling variables so text metrics align with canvas glyphs. */
		color-scheme: only light;
		text-align: initial;
		--min-font-size: 1;
		--text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
		--min-font-size-inv: calc(1 / var(--min-font-size));

		position: absolute;
		inset: 0;
		overflow: clip;
		line-height: 1;
		-webkit-text-size-adjust: none;
		-moz-text-size-adjust: none;
		text-size-adjust: none;
		forced-color-adjust: none;
		transform-origin: 0 0;
		caret-color: CanvasText;
		text-rendering: optimizeLegibility;
		font-kerning: normal;
		font-variant-ligatures: common-ligatures contextual;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		color: transparent;
	}
	:global(.textLayerHost) {
		position: absolute;
		inset: 0;
		overflow: hidden;
	}
	:global(.textLayer span),
	:global(.textLayer br) {
		position: absolute;
		white-space: pre;
		cursor: text;
		transform-origin: 0 0;
	}
	:global(.textLayer > :not(.markedContent)),
	:global(.textLayer .markedContent span:not(.markedContent)) {
		/* Core PDF.js text metrics: these drive precise width/rotation from --font-height/--scale-x. */
		z-index: 1;
		--font-height: 0;
		--scale-x: 1;
		--rotate: 0deg;
		font-size: calc(var(--text-scale-factor) * var(--font-height));
		transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));

		/* PDF.js sets transform; keep text invisible, show only our backgrounds */
		color: transparent !important;
		-webkit-text-fill-color: transparent;
	}
	:global(.textLayer .markedContent) {
		display: contents;
	}
	:global(.textLayer ::selection) {
		background: rgb(0 0 255 / 0.2);
	}
</style>
