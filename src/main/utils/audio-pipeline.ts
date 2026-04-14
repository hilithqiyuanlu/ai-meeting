import type { AudioIssue, ProviderConfig, TranscriptQuality } from "@shared/types";

export interface AudioMetrics {
  rms: number;
  peak: number;
  zeroCrossingRate: number;
  clippingRatio: number;
}

export interface PreparedAudioChunk {
  pcm: Buffer;
  metrics: AudioMetrics;
  audioIssues: AudioIssue[];
  overlapDetected: boolean;
}

export function pcm16ToFloat32(chunk: Buffer): Float32Array {
  const samples = new Float32Array(Math.floor(chunk.length / 2));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = chunk.readInt16LE(index * 2) / 32768;
  }
  return samples;
}

export function float32ToPcm16(samples: Float32Array): Buffer {
  const chunk = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    chunk.writeInt16LE(Math.round(clamped * 32767), index * 2);
  }
  return chunk;
}

export function analyzeSamples(samples: Float32Array): AudioMetrics {
  if (samples.length === 0) {
    return {
      rms: 0,
      peak: 0,
      zeroCrossingRate: 0,
      clippingRatio: 0
    };
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
    if (absolute >= 0.985) {
      clipping += 1;
    }
    if (index > 0) {
      const previous = samples[index - 1] ?? 0;
      if ((current >= 0 && previous < 0) || (current < 0 && previous >= 0)) {
        crossings += 1;
      }
    }
  }

  return {
    rms: Math.sqrt(sum / samples.length),
    peak,
    zeroCrossingRate: crossings / Math.max(1, samples.length - 1),
    clippingRatio: clipping / samples.length
  };
}

function removeDcOffset(samples: Float32Array): void {
  if (samples.length === 0) {
    return;
  }

  let sum = 0;
  for (const sample of samples) {
    sum += sample;
  }
  const mean = sum / samples.length;
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] -= mean;
  }
}

function applyNoiseGate(samples: Float32Array, threshold: number): void {
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    if (Math.abs(sample) < threshold) {
      samples[index] = 0;
    }
  }
}

function applyAutoGain(samples: Float32Array, metrics: AudioMetrics): void {
  if (metrics.rms <= 0.0001) {
    return;
  }

  const targetRms = 0.08;
  const gain = Math.max(0.85, Math.min(3.2, targetRms / metrics.rms));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] *= gain;
  }
}

function detectAudioIssues(metrics: AudioMetrics): AudioIssue[] {
  const issues: AudioIssue[] = [];

  if (metrics.rms < 0.009) {
    issues.push("low-level");
  }
  if (metrics.zeroCrossingRate > 0.22 && metrics.rms < 0.05) {
    issues.push("noise");
  }
  if (metrics.clippingRatio > 0.01 || metrics.peak > 0.985) {
    issues.push("clipping");
  }
  if (metrics.rms > 0.03 && metrics.zeroCrossingRate > 0.16 && metrics.peak < 0.65) {
    issues.push("echo");
  }

  return issues;
}

export function detectOverlap(metrics: AudioMetrics, issues: AudioIssue[], overlapDetectionEnabled: boolean): boolean {
  if (!overlapDetectionEnabled) {
    return false;
  }

  return (
    metrics.rms > 0.035 &&
    metrics.zeroCrossingRate > 0.135 &&
    !issues.includes("clipping")
  );
}

export function prepareAudioChunk(
  chunk: Buffer,
  processingConfig: Pick<
    ProviderConfig["asr"],
    "noiseSuppressionMode" | "autoGainMode" | "overlapDetectionEnabled"
  >
): PreparedAudioChunk {
  const samples = pcm16ToFloat32(chunk);
  removeDcOffset(samples);
  const rawMetrics = analyzeSamples(samples);

  if (processingConfig.noiseSuppressionMode !== "off") {
    const gate = Math.max(0.004, rawMetrics.rms * 0.22);
    applyNoiseGate(samples, gate);
  }
  if (processingConfig.autoGainMode !== "off") {
    applyAutoGain(samples, rawMetrics);
  }

  const metrics = analyzeSamples(samples);
  const audioIssues = detectAudioIssues(metrics);
  const overlapDetected = detectOverlap(metrics, audioIssues, processingConfig.overlapDetectionEnabled);

  return {
    pcm: float32ToPcm16(samples),
    metrics,
    audioIssues,
    overlapDetected
  };
}

export function classifyTranscriptQuality(input: {
  text: string;
  kind: "speech" | "silence" | "unclear" | "error";
  processingMs: number;
  latencyMs: number;
  inputLevel: number;
  overlapDetected: boolean;
  audioIssues: AudioIssue[];
}): TranscriptQuality {
  if (input.kind !== "speech" || !input.text.trim()) {
    return "low";
  }

  const severeIssues = input.audioIssues.filter((issue) => issue === "echo" || issue === "clipping").length;
  if (input.overlapDetected || severeIssues > 0 || input.latencyMs > 5000) {
    return "low";
  }

  if (input.audioIssues.length > 0 || input.processingMs > 2500 || input.inputLevel < 0.015) {
    return "medium";
  }

  return "high";
}
