import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const termRegistry = JSON.parse(await readFile(join(projectRoot, "src/shared/term-registry.json"), "utf8"));

function parseArgs(argv) {
  const args = { manifestPath: "", mode: "offline" };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) continue;
    if (!args.manifestPath && !token.startsWith("--")) {
      args.manifestPath = token;
      continue;
    }
    if (token === "--mode") {
      args.mode = argv[index + 1] ?? "offline";
      index += 1;
    }
  }
  return args;
}

function levenshtein(a, b) {
  const rows = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
    }
  }
  return rows[a.length][b.length];
}

function normalizeText(input) {
  return String(input ?? "").trim().replace(/\s+/g, " ");
}

function normalizeForCompare(input) {
  return normalizeText(input).replace(/[，。！？!?、,.:：；;\s]/g, "").toLowerCase();
}

function normalizeWithRegistry(input) {
  return termRegistry.reduce((text, entry) => {
    return entry.aliases.reduce((current, alias) => {
      return current.replace(new RegExp(`\\b${escapeRegExp(alias)}\\b`, "gi"), entry.canonical);
    }, text);
  }, input);
}

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cer(reference, hypothesis) {
  const ref = normalizeText(reference).replace(/\s+/g, "");
  const hyp = normalizeText(hypothesis).replace(/\s+/g, "");
  return ref.length === 0 ? 0 : levenshtein(ref, hyp) / ref.length;
}

function wer(reference, hypothesis) {
  const ref = normalizeText(reference).split(" ").filter(Boolean);
  const hyp = normalizeText(hypothesis).split(" ").filter(Boolean);
  return ref.length === 0 ? 0 : levenshtein(ref, hyp) / ref.length;
}

function average(items) {
  return items.length === 0 ? 0 : items.reduce((sum, item) => sum + item, 0) / items.length;
}

function percentile(items, p) {
  if (items.length === 0) return 0;
  const sorted = [...items].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function pcm16ToFloat32(chunk) {
  const samples = new Float32Array(Math.floor(chunk.length / 2));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = chunk.readInt16LE(index * 2) / 32768;
  }
  return samples;
}

function float32ToPcm16(samples) {
  const chunk = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    chunk.writeInt16LE(Math.round(clamped * 32767), index * 2);
  }
  return chunk;
}

function analyzeSamples(samples) {
  if (samples.length === 0) {
    return { rms: 0, peak: 0, zeroCrossingRate: 0, clippingRatio: 0 };
  }

  let sum = 0;
  let peak = 0;
  let crossings = 0;
  let clipping = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const current = samples[index] ?? 0;
    const absolute = Math.abs(current);
    sum += current * current;
    peak = Math.max(peak, absolute);
    if (absolute >= 0.985) clipping += 1;
    if (index > 0) {
      const previous = samples[index - 1] ?? 0;
      if ((current >= 0 && previous < 0) || (current < 0 && previous >= 0)) crossings += 1;
    }
  }

  return {
    rms: Math.sqrt(sum / samples.length),
    peak,
    zeroCrossingRate: crossings / Math.max(1, samples.length - 1),
    clippingRatio: clipping / samples.length
  };
}

function removeDcOffset(samples) {
  if (samples.length === 0) return;
  let sum = 0;
  for (const sample of samples) sum += sample;
  const mean = sum / samples.length;
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] -= mean;
  }
}

function applyHighPassFilter(samples) {
  let previousInput = 0;
  let previousOutput = 0;
  const alpha = 0.985;
  for (let index = 0; index < samples.length; index += 1) {
    const current = samples[index] ?? 0;
    const next = current - previousInput + alpha * previousOutput;
    previousInput = current;
    previousOutput = next;
    samples[index] = next;
  }
}

function applySoftClipProtection(samples) {
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.tanh((samples[index] ?? 0) * 1.08);
  }
}

function applyEchoAttenuation(samples) {
  const delay = 160;
  for (let index = delay; index < samples.length; index += 1) {
    const delayed = samples[index - delay] ?? 0;
    samples[index] = samples[index] - delayed * 0.18;
  }
}

function applyNoiseGate(samples, threshold) {
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    if (Math.abs(sample) < threshold) samples[index] = 0;
  }
}

function applyAutoGain(samples, metrics) {
  if (metrics.rms <= 0.0001) return;
  const targetRms = 0.08;
  const gain = Math.max(0.85, Math.min(3.2, targetRms / metrics.rms));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] *= gain;
  }
}

function detectAudioIssues(metrics) {
  const issues = [];
  if (metrics.rms < 0.009) issues.push("low-level");
  if (metrics.zeroCrossingRate > 0.22 && metrics.rms < 0.05) issues.push("noise");
  if (metrics.clippingRatio > 0.01 || metrics.peak > 0.985) issues.push("clipping");
  if (metrics.rms > 0.03 && metrics.zeroCrossingRate > 0.16 && metrics.peak < 0.65) issues.push("echo");
  return issues;
}

function detectOverlap(metrics, issues, enabled) {
  if (!enabled) return false;
  return metrics.rms > 0.035 && metrics.zeroCrossingRate > 0.135 && !issues.includes("clipping");
}

function prepareAudioChunk(chunk, config) {
  const samples = pcm16ToFloat32(chunk);
  removeDcOffset(samples);
  const rawMetrics = analyzeSamples(samples);

  applyHighPassFilter(samples);
  applySoftClipProtection(samples);
  if (config.aecMode !== "off") {
    applyEchoAttenuation(samples);
  }
  if (config.noiseSuppressionMode !== "off") {
    applyNoiseGate(samples, Math.max(0.004, rawMetrics.rms * 0.22));
  }
  if (config.autoGainMode !== "off") {
    applyAutoGain(samples, rawMetrics);
  }

  const metrics = analyzeSamples(samples);
  const audioIssues = detectAudioIssues(metrics);
  return {
    pcm: float32ToPcm16(samples),
    rawMetrics,
    metrics,
    audioIssues,
    overlapDetected: detectOverlap(metrics, audioIssues, config.overlapDetectionEnabled)
  };
}

class VadSegmenter {
  constructor(config) {
    this.config = config;
    this.bytesPerFrame = Math.max(320, Math.floor((config.frameMs / 1000) * config.sampleRate * 2));
    this.preRollFrames = Math.max(1, Math.round(config.preRollMs / config.frameMs));
    this.postRollFrames = Math.max(1, Math.round(config.postRollMs / config.frameMs));
    this.minSpeechFrames = Math.max(1, Math.round(config.minSpeechMs / config.frameMs));
    this.maxSpeechFrames = Math.max(this.minSpeechFrames, Math.round(config.maxSpeechMs / config.frameMs));
    this.buffer = Buffer.alloc(0);
    this.history = [];
    this.activeFrames = [];
    this.speaking = false;
    this.silenceFrames = 0;
    this.nextFrameStartMs = 0;
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const segments = [];
    while (this.buffer.length >= this.bytesPerFrame) {
      const frame = this.buffer.subarray(0, this.bytesPerFrame);
      this.buffer = this.buffer.subarray(this.bytesPerFrame);
      const packet = this.buildFrame(frame);
      const nextSegment = this.consumeFrame(packet);
      if (nextSegment) segments.push(nextSegment);
    }
    return segments;
  }

  flush() {
    if (this.buffer.length > 0) {
      const frame = Buffer.alloc(this.bytesPerFrame);
      this.buffer.copy(frame);
      this.buffer = Buffer.alloc(0);
      const packet = this.buildFrame(frame);
      const nextSegment = this.consumeFrame(packet);
      if (nextSegment) return [nextSegment];
    }
    if (this.speaking && this.activeFrames.length > 0) {
      const pending = this.finalizeActiveFrames(true);
      if (pending) return [pending];
    }
    return [];
  }

  buildFrame(frame) {
    const startMs = this.nextFrameStartMs;
    const endMs = startMs + this.config.frameMs;
    this.nextFrameStartMs = endMs;
    const rms = analyzeSamples(pcm16ToFloat32(frame)).rms;
    return { pcm: frame, startMs, endMs, rms };
  }

  consumeFrame(frame) {
    const isSpeech = frame.rms >= this.config.threshold;
    if (!this.speaking) {
      this.history.push(frame);
      if (this.history.length > this.preRollFrames) this.history.shift();
      if (!isSpeech) return null;
      this.speaking = true;
      this.silenceFrames = 0;
      this.activeFrames = [...this.history];
      this.history = [];
      return null;
    }
    this.activeFrames.push(frame);
    this.silenceFrames = isSpeech ? 0 : this.silenceFrames + 1;
    if (this.activeFrames.length >= this.maxSpeechFrames || this.silenceFrames >= this.postRollFrames) {
      return this.finalizeActiveFrames(false);
    }
    return null;
  }

  finalizeActiveFrames(allowShortTail) {
    const frames = [...this.activeFrames];
    this.activeFrames = [];
    this.speaking = false;
    this.silenceFrames = 0;
    this.history = frames.slice(-this.preRollFrames);

    const averageRms = frames.length > 0 ? frames.reduce((sum, frame) => sum + frame.rms, 0) / frames.length : 0;
    const shortTailAccepted =
      allowShortTail &&
      frames.length >= Math.max(1, Math.floor(this.minSpeechFrames / 2)) &&
      averageRms >= this.config.threshold * 1.15;

    if (frames.length < this.minSpeechFrames && !shortTailAccepted) return null;

    return {
      pcm: Buffer.concat(frames.map((frame) => frame.pcm)),
      startMs: frames[0]?.startMs ?? 0,
      endMs: frames.at(-1)?.endMs ?? 0,
      inputLevel: averageRms
    };
  }
}

function trimOverlappedTranscript(previous, current) {
  const prev = normalizeText(previous);
  const next = normalizeText(current);
  if (!prev || !next) return { text: next, overlapChars: 0 };
  const maxLength = Math.min(prev.length, next.length, 48);
  for (let length = maxLength; length >= 6; length -= 1) {
    if (prev.slice(-length) === next.slice(0, length)) {
      return { text: next.slice(length).trimStart(), overlapChars: length };
    }
  }
  return { text: next, overlapChars: 0 };
}

function collapseRepeatingClauses(input) {
  const clauses = input.split(/(?<=[，。！？!?])/).map((item) => item.trim()).filter(Boolean);
  if (clauses.length < 2) return input;
  const deduped = [];
  for (const clause of clauses) {
    if (deduped.at(-1) !== clause) deduped.push(clause);
  }
  return deduped.join("");
}

function normalizeTranscriptText(input) {
  return collapseRepeatingClauses(
    normalizeWithRegistry(
      normalizeText(input)
        .replace(/[，。！？,.!?]{2,}/g, "。")
        .replace(/^\s*[嗯啊呃]+\s*/g, "")
        .replace(/\b([A-Za-z]+)(\s+\1\b)+/gi, "$1")
    )
  );
}

function stitchTranscript(previous, current) {
  const normalized = normalizeTranscriptText(current);
  const previousNormalized = normalizeTranscriptText(previous);
  if (!normalized) return { text: "", overlapChars: 0 };
  const prevCompare = normalizeForCompare(previousNormalized);
  const currentCompare = normalizeForCompare(normalized);
  if (prevCompare && (prevCompare === currentCompare || prevCompare.endsWith(currentCompare))) {
    return { text: "", overlapChars: normalized.length };
  }
  const stitched = trimOverlappedTranscript(previousNormalized, normalized);
  const stitchedCompare = normalizeForCompare(stitched.text);
  if (prevCompare && stitchedCompare && prevCompare.endsWith(stitchedCompare)) {
    return { text: "", overlapChars: stitched.overlapChars || stitched.text.length };
  }
  return stitched;
}

function classifyTranscriptQuality(input) {
  if (input.kind !== "speech" || !normalizeText(input.text)) return "low";
  const severeIssues = input.audioIssues.filter((issue) => issue === "echo" || issue === "clipping").length;
  if (input.overlapDetected || severeIssues > 0 || input.latencyMs > 5000) return "low";
  if (input.audioIssues.length > 0 || input.processingMs > 2500 || input.inputLevel < 0.015) return "medium";
  return "high";
}

function parseWavPcm16(fileBuffer) {
  if (fileBuffer.toString("ascii", 0, 4) !== "RIFF" || fileBuffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("仅支持 WAV 文件");
  }

  let offset = 12;
  let sampleRate = 16000;
  let channels = 1;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataLength = 0;

  while (offset + 8 <= fileBuffer.length) {
    const chunkId = fileBuffer.toString("ascii", offset, offset + 4);
    const chunkSize = fileBuffer.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;
    if (chunkId === "fmt ") {
      channels = fileBuffer.readUInt16LE(chunkDataOffset + 2);
      sampleRate = fileBuffer.readUInt32LE(chunkDataOffset + 4);
      bitsPerSample = fileBuffer.readUInt16LE(chunkDataOffset + 14);
    } else if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataLength = chunkSize;
      break;
    }
    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0) throw new Error("WAV 文件缺少 data chunk");
  if (channels !== 1 || bitsPerSample !== 16 || sampleRate !== 16000) {
    throw new Error("当前 replay 模式仅支持 16kHz / 16-bit / mono WAV");
  }

  return fileBuffer.subarray(dataOffset, dataOffset + dataLength);
}

function createSenseVoiceRecognizer(modelDir, language) {
  const vendorDir = join(projectRoot, "vendor", "sherpa-onnx");
  const createModule = require(join(vendorDir, "sherpa-onnx-wasm-nodejs.js"));
  const asrModule = require(join(vendorDir, "sherpa-onnx-asr.js"));
  const wasmModule = createModule();
  return new asrModule.OfflineRecognizer(
    {
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        tokens: join(modelDir, "tokens.txt"),
        debug: 0,
        numThreads: 1,
        provider: "cpu",
        senseVoice: {
          model: join(modelDir, "model.int8.onnx"),
          language: language === "auto" ? "" : language,
          useInverseTextNormalization: 1
        }
      }
    },
    wasmModule
  );
}

function deriveExpectedTermHitRate(expectedTerms, hypothesis) {
  if (!expectedTerms || expectedTerms.length === 0) return 0;
  const normalizedHypothesis = normalizeForCompare(normalizeWithRegistry(hypothesis));
  const hits = expectedTerms.filter((term) => normalizedHypothesis.includes(normalizeForCompare(term))).length;
  return hits / expectedTerms.length;
}

async function runReplayItem(item, settings, recognizerFactory) {
  const audioBuffer = await readFile(resolve(projectRoot, item.audioPath));
  const pcm = parseWavPcm16(audioBuffer);
  const vad = new VadSegmenter({
    sampleRate: 16000,
    frameMs: 30,
    threshold: settings.vadThreshold ?? 0.014,
    preRollMs: settings.vadPreRollMs ?? 240,
    postRollMs: settings.vadPostRollMs ?? 420,
    minSpeechMs: settings.minSpeechMs ?? 600,
    maxSpeechMs: settings.maxSpeechMs ?? 5200
  });
  const recognizer = recognizerFactory();
  const bytesPerFeed = 1600 * 2;
  const segments = [];
  let lastText = "";
  let stitchSuppressedSegments = 0;

  for (let offset = 0; offset < pcm.length; offset += bytesPerFeed) {
    const chunk = pcm.subarray(offset, Math.min(pcm.length, offset + bytesPerFeed));
    for (const segment of vad.push(chunk)) {
      const prepared = prepareAudioChunk(segment.pcm, {
        aecMode: settings.aecMode ?? "auto",
        noiseSuppressionMode: settings.noiseSuppressionMode ?? "auto",
        autoGainMode: settings.autoGainMode ?? "auto",
        overlapDetectionEnabled: settings.overlapDetectionEnabled ?? true,
        audioProcessingBackend: settings.audioProcessingBackend ?? "heuristic-apm"
      });

      const startedAt = Date.now();
      const stream = recognizer.createStream();
      stream.acceptWaveform(16000, pcm16ToFloat32(prepared.pcm));
      recognizer.decode(stream);
      const rawText = normalizeText(recognizer.getResult(stream).text ?? "");
      stream.free();

      const stitched = stitchTranscript(lastText, rawText);
      if (rawText && !stitched.text) {
        stitchSuppressedSegments += 1;
      }
      const text = stitched.text;
      if (text) lastText = text;
      const kind = text ? "speech" : segment.inputLevel >= (settings.vadThreshold ?? 0.014) ? "unclear" : "silence";
      const processingMs = Date.now() - startedAt;
      const latencyMs = processingMs + (settings.vadPostRollMs ?? 420);
      const quality = classifyTranscriptQuality({
        text,
        kind,
        processingMs,
        latencyMs,
        inputLevel: segment.inputLevel,
        overlapDetected: prepared.overlapDetected,
        audioIssues: prepared.audioIssues
      });

      segments.push({
        text,
        kind,
        processingMs,
        latencyMs,
        quality,
        overlapDetected: prepared.overlapDetected,
        audioIssues: prepared.audioIssues
      });
    }
  }

  for (const segment of vad.flush()) {
    const prepared = prepareAudioChunk(segment.pcm, {
      aecMode: settings.aecMode ?? "auto",
      noiseSuppressionMode: settings.noiseSuppressionMode ?? "auto",
      autoGainMode: settings.autoGainMode ?? "auto",
      overlapDetectionEnabled: settings.overlapDetectionEnabled ?? true,
      audioProcessingBackend: settings.audioProcessingBackend ?? "heuristic-apm"
    });
    const startedAt = Date.now();
    const stream = recognizer.createStream();
    stream.acceptWaveform(16000, pcm16ToFloat32(prepared.pcm));
    recognizer.decode(stream);
    const rawText = normalizeText(recognizer.getResult(stream).text ?? "");
    stream.free();

    const stitched = stitchTranscript(lastText, rawText);
    if (rawText && !stitched.text) stitchSuppressedSegments += 1;
    const text = stitched.text;
    if (text) lastText = text;
    const kind = text ? "speech" : segment.inputLevel >= (settings.vadThreshold ?? 0.014) ? "unclear" : "silence";
    const processingMs = Date.now() - startedAt;
    const latencyMs = processingMs + (settings.vadPostRollMs ?? 420);
    const quality = classifyTranscriptQuality({
      text,
      kind,
      processingMs,
      latencyMs,
      inputLevel: segment.inputLevel,
      overlapDetected: prepared.overlapDetected,
      audioIssues: prepared.audioIssues
    });
    segments.push({
      text,
      kind,
      processingMs,
      latencyMs,
      quality,
      overlapDetected: prepared.overlapDetected,
      audioIssues: prepared.audioIssues
    });
  }

  recognizer.free();

  const speechSegments = segments.filter((segment) => segment.kind === "speech" && segment.text);
  const hypothesis = speechSegments.map((segment) => segment.text).join("\n");
  return {
    id: item.id,
    scenario: item.scenario ?? "unspecified",
    deviceType: item.deviceType ?? "microphone",
    noiseLevel: item.noiseLevel ?? "unknown",
    reference: item.reference ?? "",
    hypothesis,
    latencyMs: percentile(speechSegments.map((segment) => segment.latencyMs), 95),
    duplicate: stitchSuppressedSegments > 0,
    duplicateSegments: stitchSuppressedSegments,
    error: segments.some((segment) => segment.kind === "error"),
    overlapReference: !!item.overlapReference || !!item.echoReference,
    overlapDetected: segments.some((segment) => segment.overlapDetected),
    lowQualitySegments: segments.filter((segment) => segment.quality === "low").length,
    segmentCount: segments.length,
    unclearSegments: segments.filter((segment) => segment.kind === "unclear").length,
    silenceSegments: segments.filter((segment) => segment.kind === "silence").length,
    expectedTerms: item.expectedTerms ?? [],
    expectedTermHitRate: deriveExpectedTermHitRate(item.expectedTerms ?? [], hypothesis)
  };
}

function aggregateResults(items) {
  const scenarios = new Map();
  for (const item of items) {
    const bucket = scenarios.get(item.scenario) ?? [];
    bucket.push(item);
    scenarios.set(item.scenario, bucket);
  }

  const summarize = (entries) => ({
    sampleCount: entries.length,
    cer: average(entries.map((item) => cer(item.reference, item.hypothesis))),
    wer: average(entries.map((item) => wer(item.reference, item.hypothesis))),
    avgLatencyMs: average(entries.map((item) => Number(item.latencyMs ?? 0))),
    p95LatencyMs: percentile(entries.map((item) => Number(item.latencyMs ?? 0)), 95),
    emptyRate: average(entries.map((item) => (normalizeText(item.hypothesis) ? 0 : 1))),
    duplicateRate: average(entries.map((item) => (item.duplicate ? 1 : 0))),
    errorRate: average(entries.map((item) => (item.error ? 1 : 0))),
    lowQualityRate: average(entries.map((item) => {
      const total = Number(item.segmentCount ?? 0);
      const low = Number(item.lowQualitySegments ?? 0);
      return total > 0 ? low / total : 0;
    })),
    overlapRecall: (() => {
      const overlapItems = entries.filter((item) => item.overlapReference);
      return overlapItems.length === 0 ? 0 : average(overlapItems.map((item) => (item.overlapDetected ? 1 : 0)));
    })(),
    expectedTermHitRate: average(entries.map((item) => Number(item.expectedTermHitRate ?? deriveExpectedTermHitRate(item.expectedTerms ?? [], item.hypothesis))))
  });

  const byScenario = Object.fromEntries([...scenarios.entries()].map(([scenario, entries]) => [scenario, summarize(entries)]));
  return {
    overall: summarize(items),
    byScenario
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifestPath) {
    console.error("用法: pnpm benchmark:asr -- <manifest.json> [--mode offline|replay]");
    process.exit(1);
  }

  const manifest = JSON.parse(await readFile(resolve(projectRoot, args.manifestPath), "utf8"));
  const items = Array.isArray(manifest.items) ? manifest.items : [];
  if (items.length === 0) {
    console.error("manifest.items 不能为空");
    process.exit(1);
  }

  const mode = args.mode || manifest.mode || "offline";
  let evaluatedItems = items;

  if (mode === "replay") {
    const modelDir = manifest.settings?.modelDir || process.env.SENSEVOICE_MODEL_DIR;
    if (!modelDir) {
      throw new Error("replay 模式需要 manifest.settings.modelDir 或环境变量 SENSEVOICE_MODEL_DIR");
    }
    const recognizerFactory = () => createSenseVoiceRecognizer(resolve(projectRoot, modelDir), manifest.settings?.language ?? "auto");
    evaluatedItems = [];
    for (const item of items) {
      evaluatedItems.push(await runReplayItem(item, manifest.settings?.asr ?? {}, recognizerFactory));
    }
  } else {
    evaluatedItems = items.map((item) => ({
      ...item,
      scenario: item.scenario ?? "unspecified",
      deviceType: item.deviceType ?? "microphone",
      noiseLevel: item.noiseLevel ?? "unknown",
      expectedTermHitRate: Number(item.expectedTermHitRate ?? deriveExpectedTermHitRate(item.expectedTerms ?? [], item.hypothesis)),
      segmentCount: Number(item.segmentCount ?? 0),
      lowQualitySegments: Number(item.lowQualitySegments ?? 0)
    }));
  }

  console.log(
    JSON.stringify(
      {
        suite: manifest.name ?? "unnamed-benchmark",
        mode,
        baseline: manifest.baseline ?? "v0.4.3",
        ...aggregateResults(evaluatedItems),
        items: evaluatedItems
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
