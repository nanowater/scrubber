<script lang="ts">
	interface Props {
		inputText: string;
		pdfLoaded: boolean;
		showPdfNotice: boolean;
		isExtracting: boolean;
		isSubmitting: boolean;
		isModelReady: boolean;
		documentAccept: string;
		onSubmit: () => void;
		onDocumentDragOver: (event: DragEvent) => void;
		onDocumentDrop: (event: DragEvent) => void;
		onFileInputChange: (event: Event) => void;
	}

	let {
		inputText = $bindable(),
		pdfLoaded,
		showPdfNotice,
		isExtracting,
		isSubmitting,
		isModelReady,
		documentAccept,
		onSubmit,
		onDocumentDragOver,
		onDocumentDrop,
		onFileInputChange
	}: Props = $props();

	let fileInput = $state<HTMLInputElement | undefined>();

	function openFilePicker(): void {
		fileInput?.click();
	}
</script>

<div
	class="flex min-h-48 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white lg:min-h-0 lg:h-full"
	role="group"
	aria-label="Document drop area and text"
	ondragover={onDocumentDragOver}
	ondrop={onDocumentDrop}
>
	<div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
		<h2 class="m-0 text-sm font-semibold text-slate-700">Input from document</h2>
	</div>
	<div class="relative flex min-h-0 flex-1 flex-col">
		<input
			bind:this={fileInput}
			type="file"
			class="sr-only"
			accept={documentAccept}
			aria-label="Load text from a document file"
			onchange={onFileInputChange}
		/>
		<div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
			{#if showPdfNotice}
				<p class="m-0 text-sm leading-6 text-slate-600">
					{#if isExtracting && !pdfLoaded}
						Parsing PDF... the extracted text is used internally for detection.
					{:else}
						PDF is loaded. The preview and highlights are shown in
						<strong>Result</strong> →. Press <strong>Filter</strong> to detect sensitive
						data.
					{/if}
				</p>
			{:else}
				<textarea
					bind:value={inputText}
					placeholder="Drop a PDF or .txt file here, or use Upload file below, then edit if needed"
					aria-label="Extracted or pasted text from document"
					class="h-full min-h-[220px] w-full flex-1 resize-y bg-transparent text-[15px] leading-7 text-slate-700 outline-none"
				></textarea>
			{/if}
		</div>
		<div class="mt-auto flex shrink-0 items-center border-t border-slate-100 bg-slate-50/90 px-3 py-2">
			<button
				type="button"
				class="text-sm font-medium text-emerald-700 underline decoration-emerald-300 underline-offset-2 hover:text-emerald-800"
				onclick={openFilePicker}
				disabled={isExtracting}
			>
				Upload file
			</button>
			<span class="ml-2 text-xs text-slate-500">PDF or .txt</span>
		</div>
	</div>
	<div class="flex h-16 shrink-0 border-t border-slate-200">
		<button
			type="button"
			onclick={onSubmit}
			aria-label="Submit text for privacy filtering"
			class="ml-auto inline-flex w-44 items-center justify-center bg-emerald-500 text-base font-semibold text-white transition hover:bg-emerald-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-400"
			disabled={!isModelReady || isSubmitting || isExtracting}
		>
			{#if isSubmitting}
				<span class="inline-flex items-center gap-2">
					<span class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
					Processing
				</span>
			{:else}
				Filter
			{/if}
		</button>
	</div>
</div>
