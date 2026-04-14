import { normalizeWithTermRegistry } from "./term-registry";

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

function normalizeTerminology(input: string): string {
  return normalizeWithTermRegistry(input);
}

function collapseRepeatingPhrases(input: string): string {
  const words = input.split(/\s+/).filter(Boolean);
  if (words.length < 4) {
    return input;
  }

  const collapsed: string[] = [];
  for (const word of words) {
    if (collapsed.length >= 2 && collapsed.at(-1) === word && collapsed.at(-2) === word) {
      continue;
    }
    collapsed.push(word);
  }
  return collapsed.join(" ");
}

function collapseRepeatingClauses(input: string): string {
  const clauses = input.split(/(?<=[，。！？!?])/).map((item) => item.trim()).filter(Boolean);
  if (clauses.length < 2) {
    return input;
  }

  const deduped: string[] = [];
  for (const clause of clauses) {
    if (deduped.at(-1) === clause) {
      continue;
    }
    deduped.push(clause);
  }
  return deduped.join("");
}

function normalizeForCompare(input: string): string {
  return input.replace(/\s+/g, "").replace(/[，。！？!?、,.:：；;]/g, "").toLowerCase();
}

export function normalizeTranscriptText(input: string): string {
  return collapseRepeatingClauses(
    collapseRepeatingPhrases(
      normalizeTerminology(
        input
          .replace(/\s+/g, " ")
          .replace(/[，。！？,.!?]{2,}/g, "。")
          .replace(/^\s*[嗯啊呃]+\s*/g, "")
          .replace(/\b([A-Za-z]+)(\s+\1\b)+/gi, "$1")
          .trim()
      )
    )
  );
}

export function stitchTranscript(previous: string, current: string): { text: string; overlapChars: number } {
  const normalized = normalizeTranscriptText(current);
  const previousNormalized = normalizeTranscriptText(previous);

  if (!normalized) {
    return { text: "", overlapChars: 0 };
  }

  const previousCompare = normalizeForCompare(previousNormalized);
  const currentCompare = normalizeForCompare(normalized);

  if (previousCompare && (previousCompare === currentCompare || previousCompare.endsWith(currentCompare))) {
    return { text: "", overlapChars: normalized.length };
  }

  const stitched = trimOverlappedTranscript(previousNormalized, normalized);
  const stitchedCompare = normalizeForCompare(stitched.text);
  if (previousCompare && stitchedCompare && previousCompare.endsWith(stitchedCompare)) {
    return { text: "", overlapChars: stitched.overlapChars || stitched.text.length };
  }

  return stitched;
}
