<script lang="ts">
	interface Props {
		inputText: string;
		isSubmitting: boolean;
		isModelReady: boolean;
		onSubmit: () => void;
	}

	let { inputText = $bindable(), isSubmitting, isModelReady, onSubmit }: Props = $props();
</script>

<div class="flex min-h-48 max-h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white lg:min-h-0 lg:h-full">
	<div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
		<h2 class="m-0 text-sm font-semibold text-slate-700">Input text</h2>
	</div>
	<div class="relative min-h-0 flex-1">
		<textarea
			bind:value={inputText}
			placeholder="Enter text to analyze"
			aria-label="Input text"
			class="h-full min-h-[220px] w-full min-w-0 resize-y bg-transparent px-4 py-4 pb-14 text-[15px] leading-7 text-slate-700 outline-none"
		></textarea>
	</div>
	<div class="flex h-16 shrink-0 border-t border-slate-200">
		<button
			type="button"
			onclick={onSubmit}
			aria-label="Submit text for privacy filtering"
			class="ml-auto inline-flex w-44 items-center justify-center bg-emerald-500 text-base font-semibold text-white transition hover:bg-emerald-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-400"
			disabled={!isModelReady || isSubmitting}
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
