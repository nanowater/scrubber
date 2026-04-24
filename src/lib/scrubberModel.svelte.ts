import { browser } from '$app/environment';
import ScrubberWorker from './worker.ts?worker';

/** Shared model + load UI state (single worker for the whole SPA session). */
export const model = $state({
	isModelLoading: true,
	isModelReady: false,
	loadProgress: 0,
	modelStatusLine: 'Initializing model...',
	runtimeDevice: ''
});

type Span = {
	start: number;
	end: number;
	label?: string;
	entity_group?: string;
	score?: number;
};

export type WorkerResultMessage = {
	type: 'result';
	spans?: Span[];
	entities?: unknown[];
};

export type WorkerErrorMessage = {
	type: 'error';
	message?: string;
};

export type WorkerInferenceMessage = WorkerResultMessage | WorkerErrorMessage;

type WorkerMessageData =
	| { type: 'status'; message?: string }
	| { type: 'progress'; progress?: number }
	| { type: 'ready'; device?: string }
	| WorkerResultMessage
	| WorkerErrorMessage;

type InferenceHandler = (data: WorkerInferenceMessage) => void;

let worker: Worker | undefined;
let workerStarted = false;
let inferenceHandler: InferenceHandler | undefined;

function routeMessage(data: WorkerMessageData) {
	if (data.type === 'status') {
		const raw = String(data.message ?? '');
		model.modelStatusLine = raw.includes('WebGPU')
			? 'WebGPU unavailable. Loading fallback runtime...'
			: 'Downloading model...';
	} else if (data.type === 'progress') {
		model.loadProgress = Math.max(0, Math.min(100, Math.round(data.progress ?? 0)));
	} else if (data.type === 'ready') {
		model.isModelReady = true;
		model.isModelLoading = false;
		model.runtimeDevice = data.device ?? '';
		model.modelStatusLine = `Model ready${model.runtimeDevice ? ` (${model.runtimeDevice})` : ''}`;
	} else if (data.type === 'error') {
		if (!model.isModelReady) {
			model.isModelLoading = false;
			model.modelStatusLine = `Error: ${data.message ?? 'Unknown error'}`;
		} else {
			inferenceHandler?.(data);
		}
	} else if (data.type === 'result') {
		inferenceHandler?.(data);
	}
}

/**
 * Spawns the worker and starts model load at most once for the app session.
 */
export function ensureScrubberWorker() {
	if (!browser || workerStarted) return;
	workerStarted = true;

	worker = new ScrubberWorker({
		name: 'scrubber-worker'
	});

	worker.onmessage = (event: MessageEvent<WorkerMessageData>) => {
		routeMessage(event.data);
	};

	worker.postMessage({ type: 'load' });
}

export function registerInferenceHandler(handler: InferenceHandler | undefined) {
	inferenceHandler = handler;
}

export function postClassifyText(text: string) {
	worker?.postMessage({ type: 'classify', text });
}
