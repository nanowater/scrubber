# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-04-23

- Initial public release
- Browser-only privacy filtering UI using `openai/privacy-filter`
- SvelteKit (Svelte 5) + Tailwind UI
- WebGPU with WASM fallback in worker runtime

## [0.2.0] - 2026-04-24

- Added document mode PDF preview with in-page sensitive highlight rendering
- Improved PDF highlight alignment/stability across resize and zoom
- Added worker-side text chunking to avoid ONNX overflow on long inputs
- Limited document ingestion support to PDF and plain text (`.txt`) only
