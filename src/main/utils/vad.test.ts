import { describe, expect, it } from "vitest";
import { VadSegmenter } from "./vad";

function createPcmChunk(values: number[]): Buffer {
  const chunk = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => {
    chunk.writeInt16LE(Math.round(value * 32767), index * 2);
  });
  return chunk;
}

describe("VadSegmenter", () => {
  it("merges adjacent speech frames into one segment", () => {
    const segmenter = new VadSegmenter({
      sampleRate: 16000,
      frameMs: 30,
      threshold: 0.01,
      preRollMs: 60,
      postRollMs: 90,
      minSpeechMs: 120,
      maxSpeechMs: 1200
    });

    const silence = createPcmChunk(Array.from({ length: 480 }, () => 0));
    const speech = createPcmChunk(Array.from({ length: 480 }, (_, index) => Math.sin(index / 10) * 0.08));

    segmenter.push(Buffer.concat([silence, silence]));
    const partial = segmenter.push(Buffer.concat([speech, speech, speech, speech, silence]));
    const flushed = segmenter.flush();

    expect(partial.length + flushed.length).toBeGreaterThan(0);
    const segment = [...partial, ...flushed][0];
    expect(segment.startMs).toBeLessThan(segment.endMs);
  });

  it("drops segments shorter than minimum speech window", () => {
    const segmenter = new VadSegmenter({
      sampleRate: 16000,
      frameMs: 30,
      threshold: 0.01,
      preRollMs: 30,
      postRollMs: 60,
      minSpeechMs: 300,
      maxSpeechMs: 1200
    });

    const speech = createPcmChunk(Array.from({ length: 480 }, (_, index) => Math.sin(index / 6) * 0.08));
    const segments = segmenter.push(speech);
    const flushed = segmenter.flush();

    expect([...segments, ...flushed]).toHaveLength(0);
  });

  it("keeps short tail speech on flush", () => {
    const segmenter = new VadSegmenter({
      sampleRate: 16000,
      frameMs: 30,
      threshold: 0.01,
      preRollMs: 30,
      postRollMs: 60,
      minSpeechMs: 300,
      maxSpeechMs: 1200
    });

    const speech = createPcmChunk(Array.from({ length: 480 * 6 }, (_, index) => Math.sin(index / 6) * 0.08));
    const segments = segmenter.push(speech);
    const flushed = segmenter.flush();

    expect(segments).toHaveLength(0);
    expect(flushed).toHaveLength(1);
  });
});
