# Scrubber

Browser-first privacy filtering app built on top of [openai/privacy-filter](https://huggingface.co/openai/privacy-filter), using Svelte 5 + Vite + Transformers.js.

## Features

- Runs entirely in the browser (no server-side inference)
- Loads `openai/privacy-filter` with WebGPU, falls back to WASM automatically
- Highlights detected sensitive spans in text
- Shows category + confidence on hover

## Privacy

- Input text is processed locally in your browser
- This project does not send user text to a backend server

## Local Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Deploy (GitHub Pages)

This repository includes a GitHub Actions workflow to deploy `dist/` to GitHub Pages on pushes to `main`.

## Model and Runtime

- Model: [openai/privacy-filter](https://huggingface.co/openai/privacy-filter)
- Runtime: [Transformers.js](https://github.com/huggingface/transformers.js)

## Security / Bug Reports

Security concerns and bugs are handled through public GitHub issues for this project.

## Pull Requests

Pull requests are welcome, especially for bug fixes and small documentation improvements.

For larger feature changes, please open an issue first to discuss scope and direction.

As this is a personally maintained project, review and merge timing is best-effort and not guaranteed.

## License

- Project license: Apache-2.0 (`LICENSE`)
- Third-party attribution: `NOTICE`
