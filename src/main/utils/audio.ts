export function computePcmRms(chunk: Buffer): number {
  if (chunk.length < 2) {
    return 0;
  }

  let sum = 0;
  let count = 0;

  for (let index = 0; index + 1 < chunk.length; index += 2) {
    const sample = chunk.readInt16LE(index) / 32768;
    sum += sample * sample;
    count += 1;
  }

  if (count === 0) {
    return 0;
  }

  return Math.sqrt(sum / count);
}

export function getAudioState(inputLevel: number, lastAudioAt: string | null): "capturing" | "near-silence" | "no-signal" {
  if (inputLevel >= 0.0015) {
    return "capturing";
  }

  if (!lastAudioAt) {
    return "no-signal";
  }

  const idleMs = Date.now() - new Date(lastAudioAt).getTime();
  return idleMs > 8_000 ? "no-signal" : "near-silence";
}
