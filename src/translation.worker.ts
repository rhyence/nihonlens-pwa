import { env, pipeline, type TranslationPipeline } from '@huggingface/transformers';
import { packPath } from './pack-info';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.localModelPath = self.location.origin + packPath;
const wasm = env.backends.onnx.wasm!;
wasm.numThreads = 1;
wasm.proxy = false;
wasm.initTimeout = 20000;
wasm.wasmPaths = self.location.origin + packPath + 'runtime/';

let translator: Promise<TranslationPipeline> | undefined;
self.onmessage = async ({ data }: MessageEvent<{ id: number; text: string; lowMemory: boolean }>) => {
  try {
    translator ??= pipeline<'translation'>('translation', 'marian', {
      device: 'wasm', dtype: 'q8', local_files_only: true,
      session_options: data.lowMemory
        ? { graphOptimizationLevel: 'basic', enableCpuMemArena: false, enableMemPattern: false }
        : undefined,
    });
    const pipe = await translator;
    const result = await pipe(data.text, { max_new_tokens: 48, num_beams: 1 } as Parameters<TranslationPipeline>[1]);
    if (Array.isArray(result[0])) throw new Error('Unexpected translation result.');
    self.postMessage({ id: data.id, value: result[0].translation_text });
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error) });
  }
};
