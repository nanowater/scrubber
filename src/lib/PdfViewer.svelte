<script lang="ts">
	import { browser } from '$app/environment';
	import PdfPageView from '$lib/PdfPageView.svelte';
	import type { ModelSpan, PdfTextFragmentHighlight, PdfTextLayout } from '$lib/pdfTextLayout';
	import type { PageViewport, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
	import { onMount } from 'svelte';

	interface Props {
		pdf: PDFDocumentProxy;
		layout: PdfTextLayout;
		spans: ModelSpan[];
	}
	let { pdf, layout, spans }: Props = $props();

	let root = $state<HTMLDivElement | undefined>();
	let containerWidth = $state(560);
	let pageViewports = $state<PageViewport[]>([]);
	let pages = $state<PDFPageProxy[]>([]);
	let itemHighlightsByPage = $state<PdfTextFragmentHighlight[][]>([]);

	function measure() {
		if (root) {
			const w = root.clientWidth;
			if (w > 0) containerWidth = w;
		}
	}

	/** Viewports and page handles only; keeps stable page proxies so TextLayer is not redone on every filter run. */
	async function loadPages(targetWidth: number, numPages: number) {
		if (!browser || !pdf || !layout) return;
		const w = Math.max(280, targetWidth);
		const vps: PageViewport[] = [];
		const pgs: PDFPageProxy[] = [];
		for (let i = 0; i < numPages; i++) {
			const page = await pdf.getPage(i + 1);
			pgs.push(page);
			const base = page.getViewport({ scale: 1, rotation: 0 });
			const fitScale = (w - 4) / base.width;
			const scale = Math.max(0.4, Math.min(2.5, fitScale));
			vps.push(page.getViewport({ scale, rotation: 0 }));
		}
		pages = pgs;
		pageViewports = vps;
	}

	function assignHighlights(nextSpans: ModelSpan[], viewportCount: number, numPages: number) {
		if (!layout) return;
		if (viewportCount === 0) return;
		const all = layout.getFragmentHighlights(nextSpans);
		const by: PdfTextFragmentHighlight[][] = Array.from({ length: numPages }, () => []);
		for (const h of all) {
			by[h.pageIndex]!.push(h);
		}
		itemHighlightsByPage = by;
	}

	$effect(() => {
		if (!browser || !pdf || !layout) return;
		const width = containerWidth;
		const numPages = layout.numPages;
		void loadPages(width, numPages);
	});

	$effect(() => {
		if (!browser || !layout) return;
		assignHighlights(spans, pageViewports.length, layout.numPages);
	});

	let ro: ResizeObserver | undefined;
	onMount(() => {
		measure();
		if (root) {
			ro = new ResizeObserver(() => {
				measure();
				if (!layout) return;
				void loadPages(containerWidth, layout.numPages);
			});
			ro.observe(root);
		}
		return () => ro?.disconnect();
	});
</script>

<div
	bind:this={root}
	class="h-full min-h-0 w-full min-w-0 overflow-auto bg-slate-100/60 px-1 py-1"
	role="document"
	aria-label="PDF preview"
>
	<div class="pdfViewer mx-auto flex max-w-full flex-col gap-2">
		{#if pageViewports.length === 0}
			<p class="px-2 py-6 text-center text-sm text-slate-500">Rendering PDF…</p>
		{:else}
			{#each pageViewports as vp, pIdx (pIdx)}
				<PdfPageView
					page={pages[pIdx]!}
					viewport={vp}
					itemHighlights={itemHighlightsByPage[pIdx] ?? []}
				/>
			{/each}
		{/if}
	</div>
</div>
