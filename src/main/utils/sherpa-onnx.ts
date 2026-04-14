import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

type SherpaOfflineRecognizer = {
  createStream(): {
    acceptWaveform(sampleRate: number, samples: Float32Array): void;
    free(): void;
  };
  decode(stream: unknown): void;
  getResult(stream: unknown): {
    text?: string;
  };
  free(): void;
};

export function createSenseVoiceRecognizer(config: {
  modelPath: string;
  tokensPath: string;
  language: string;
  useInverseTextNormalization: boolean;
}): SherpaOfflineRecognizer {
  const vendorDir = resolveSherpaVendorDir();
  const require = createRequire(import.meta.url);
  const createModule = require(join(vendorDir, "sherpa-onnx-wasm-nodejs.js"));
  const asrModule = require(join(vendorDir, "sherpa-onnx-asr.js"));
  const wasmModule = createModule();

  return new asrModule.OfflineRecognizer(
    {
      featConfig: {
        sampleRate: 16000,
        featureDim: 80
      },
      modelConfig: {
        tokens: config.tokensPath,
        debug: 0,
        numThreads: 1,
        provider: "cpu",
        senseVoice: {
          model: config.modelPath,
          language: config.language === "auto" ? "" : config.language,
          useInverseTextNormalization: config.useInverseTextNormalization ? 1 : 0
        }
      }
    },
    wasmModule
  ) as SherpaOfflineRecognizer;
}

function resolveSherpaVendorDir(): string {
  const currentDir = fileURLToPath(new URL(".", import.meta.url));
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "vendor", "sherpa-onnx"), join(currentDir, "../vendor/sherpa-onnx")]
    : [join(process.cwd(), "vendor", "sherpa-onnx"), join(currentDir, "../../vendor/sherpa-onnx")];

  const matched = candidates.find((candidate) => existsSync(join(candidate, "sherpa-onnx-wasm-nodejs.wasm")));
  if (!matched) {
    throw new Error("本地 ASR 运行时缺失，请确认 vendor/sherpa-onnx 已被打包。");
  }
  return matched;
}
