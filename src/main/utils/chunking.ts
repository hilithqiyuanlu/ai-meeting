export function chunkTextByLength(input: string, maxChars: number): string[] {
  if (input.length <= maxChars) {
    return [input];
  }

  const paragraphs = input.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
      continue;
    }

    if ((current + "\n\n" + paragraph).length <= maxChars) {
      current += `\n\n${paragraph}`;
      continue;
    }

    chunks.push(current);
    current = paragraph;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

export function sanitizeFileName(input: string): string {
  return input.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim() || "meeting";
}
