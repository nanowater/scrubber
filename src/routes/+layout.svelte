<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import shareImage from '$lib/assets/icon.svg';
	import { page } from '$app/state';

	let { children } = $props();

	const ogImageUrl = $derived(
		shareImage.startsWith('http') ? shareImage : new URL(shareImage, page.url).href
	);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta property="og:image" content={ogImageUrl} />
	<meta name="twitter:image" content={ogImageUrl} />
</svelte:head>
{@render children()}
