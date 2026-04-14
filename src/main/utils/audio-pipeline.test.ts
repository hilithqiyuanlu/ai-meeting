import { describe, expect, it } from "vitest";
import { classifyTranscriptQuality, detectOverlap, prepareAudioChunk, selectAudioProcessingBackend } from "./audio-pipeline";

function createPcmChunk(values: number[]): Buffer {
  const chunk = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => {
    chunk.writeInt16LE(Math.round(value * 32767), index * 2);
  });
  return chunk;
}

describe("prepareAudioChunk", () => {
  it("marks low-level audio as issue", () => {
    const chunk = createPcmChunk(Array.from({ length: 3200 }, () => 0.002));
    const prepared = prepareAudioChunk(chunk, {
      aecMode: "auto",
      audioProcessingBackend: "heuristic-apm",
      noiseSuppressionMode: "auto",
      autoGainMode: "auto",
      overlapDetectionEnabled: true
    });

    expect(prepared.audioIssues).toContain("low-level");
  });

  it("can detect overlap-like energy pattern", () => {
    const chunk = createPcmChunk(
      Array.from({ length: 3200 }, (_, index) => Math.sin(index / 3) * 0.06 + Math.sin(index / 13) * 0.05)
    );
    const prepared = prepareAudioChunk(chunk, {
      aecMode: "auto",
      audioProcessingBackend: "heuristic-apm",
      noiseSuppressionMode: "auto",
      autoGainMode: "off",
      overlapDetectionEnabled: true
    });

    expect(detectOverlap(prepared.metrics, prepared.audioIssues, true)).toBeTypeOf("boolean");
  });
});

describe("classifyTranscriptQuality", () => {
  it("returns high for clean speech", () => {
    expect(
      classifyTranscriptQuality({
        text: "今天确认本周上线时间。",
        kind: "speech",
        processingMs: 600,
        latencyMs: 1400,
        inputLevel: 0.03,
        overlapDetected: false,
        audioIssues: []
      })
    ).toBe("high");
  });

  it("returns low for overlap speech", () => {
    expect(
      classifyTranscriptQuality({
        text: "这个部分我们回头再确认。",
        kind: "speech",
        processingMs: 1200,
        latencyMs: 2300,
        inputLevel: 0.03,
        overlapDetected: true,
        audioIssues: []
      })
    ).toBe("low");
  });
});

describe("selectAudioProcessingBackend", () => {
  it("returns none when all processing is off", () => {
    expect(
      selectAudioProcessingBackend({
        aecMode: "off",
        noiseSuppressionMode: "off",
        autoGainMode: "off",
        audioProcessingBackend: "none"
      })
    ).toBe("none");
  });

  it("prefers heuristic backend when processing is enabled", () => {
    expect(
      selectAudioProcessingBackend({
        aecMode: "auto",
        noiseSuppressionMode: "auto",
        autoGainMode: "auto",
        audioProcessingBackend: "heuristic-apm"
      })
    ).toBe("heuristic-apm");
  });
});
