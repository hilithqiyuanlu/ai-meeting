import type { ReactNode } from "react";
import type { MeetingDetail } from "@shared/types";

const KNOWN_TERMS = [
  "AI Meeting",
  "SenseVoice",
  "Ollama",
  "BlackHole",
  "Codex",
  "GPT",
  "Qwen",
  "Gemini",
  "OpenAI",
  "VAD",
  "AEC",
  "ASR",
  "API",
  "Full",
  "Design Proctor"
];

const TOKEN_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "from",
  "into",
  "http",
  "https",
  "audio",
  "summary",
  "question",
  "ready",
  "recording",
  "meeting"
]);

type HighlightGroup = {
  kind: MeetingDetail["highlights"][number]["kind"];
  items: Array<MeetingDetail["highlights"][number] & { startMs: number | null }>;
};

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectDynamicTerms(source: string): string[] {
  const tokens = source.match(/\b[A-Za-z][A-Za-z0-9.+-]{2,}\b/g) ?? [];
  const counts = new Map<string, { count: number; sample: string }>();

  for (const token of tokens) {
    const normalized = token.toLowerCase();
    if (TOKEN_STOPWORDS.has(normalized)) {
      continue;
    }
    const current = counts.get(normalized);
    if (current) {
      current.count += 1;
    } else {
      counts.set(normalized, {
        count: 1,
        sample: token
      });
    }
  }

  return [...counts.values()]
    .filter((item) => item.count >= 2 || /[A-Z0-9]/.test(item.sample.slice(1)))
    .map((item) => item.sample)
    .slice(0, 8);
}

export function detectMeetingTerms(detail: MeetingDetail | null): string[] {
  if (!detail) {
    return [];
  }

  const source = [
    detail.session.title,
    detail.session.transcriptText,
    detail.summary?.overview ?? "",
    ...(detail.summary?.bulletPoints ?? []),
    ...(detail.summary?.actionItems ?? []),
    ...(detail.summary?.risks ?? []),
    ...detail.highlights.map((item) => item.text)
  ]
    .join("\n")
    .trim();

  if (!source) {
    return [];
  }

  const candidates = [...KNOWN_TERMS, ...collectDynamicTerms(source)];
  const unique = new Set<string>();

  for (const term of candidates) {
    if (!term) {
      continue;
    }
    if (new RegExp(escapeRegExp(term), "i").test(source)) {
      unique.add(term);
    }
    if (unique.size >= 10) {
      break;
    }
  }

  return [...unique];
}

export function highlightText(text: string, terms: string[]): ReactNode {
  if (!terms.length || !text.trim()) {
    return text;
  }

  const sortedTerms = [...terms].sort((a, b) => b.length - a.length);
  const regex = new RegExp(`(${sortedTerms.map(escapeRegExp).join("|")})`, "gi");
  const parts = text.split(regex);

  return parts.map((part, index) =>
    sortedTerms.some((term) => term.toLowerCase() === part.toLowerCase()) ? (
      <mark key={`${part}-${index}`} className="term-highlight">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export function groupMeetingHighlights(detail: MeetingDetail | null): HighlightGroup[] {
  if (!detail) {
    return [];
  }

  const segmentMap = new Map(detail.transcriptSegments.map((segment) => [segment.id, segment]));
  const kindOrder: HighlightGroup["kind"][] = ["risk", "action", "decision", "follow-up"];

  return kindOrder
    .map((kind) => ({
      kind,
      items: detail.highlights
        .filter((item) => item.kind === kind)
        .map((item) => ({
          ...item,
          startMs: segmentMap.get(item.segmentId)?.startMs ?? null
        }))
    }))
    .filter((group) => group.items.length > 0);
}
