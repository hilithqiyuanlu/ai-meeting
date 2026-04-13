export function trimOverlappedTranscript(previous: string, current: string): { text: string; overlapChars: number } {
  const prev = previous.trim();
  const next = current.trim();

  if (!prev || !next) {
    return { text: next, overlapChars: 0 };
  }

  const maxLength = Math.min(prev.length, next.length, 48);
  for (let length = maxLength; length >= 6; length -= 1) {
    const suffix = prev.slice(-length);
    const prefix = next.slice(0, length);
    if (suffix === prefix) {
      return {
        text: next.slice(length).trimStart(),
        overlapChars: length
      };
    }
  }

  return { text: next, overlapChars: 0 };
}
