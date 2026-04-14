import registry from "./term-registry.json";
import type { AppPreferences, CustomTermEntry, MeetingSummary, StructuredActionItem } from "./types";

export interface TermEntry {
  canonical: string;
  aliases: string[];
}

const BUILT_IN_TERMS = registry as TermEntry[];
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

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTermEntry(entry: Pick<CustomTermEntry, "canonical" | "aliases" | "enabled">): TermEntry | null {
  const canonical = String(entry.canonical ?? "").trim();
  if (!canonical) {
    return null;
  }

  const aliases = new Set<string>();
  aliases.add(canonical);
  for (const alias of entry.aliases ?? []) {
    const normalized = String(alias ?? "").trim();
    if (normalized) {
      aliases.add(normalized);
    }
  }

  return {
    canonical,
    aliases: [...aliases]
  };
}

export function sanitizeCustomTerms(entries: CustomTermEntry[] | undefined | null): CustomTermEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry, index) => {
      const canonical = String(entry.canonical ?? "").trim();
      if (!canonical) {
        return null;
      }

      const aliases = [...new Set((Array.isArray(entry.aliases) ? entry.aliases : [])
        .map((alias) => String(alias ?? "").trim())
        .filter(Boolean)
        .filter((alias) => alias.toLowerCase() !== canonical.toLowerCase()))];

      return {
        id: String(entry.id ?? `custom-term-${index + 1}`),
        canonical,
        aliases,
        enabled: entry.enabled !== false
      } satisfies CustomTermEntry;
    })
    .filter((entry): entry is CustomTermEntry => !!entry);
}

export function resolveTermEntries(preferences?: Pick<AppPreferences, "customTermLibraryEnabled" | "customTerms"> | null): TermEntry[] {
  const customEntries =
    preferences?.customTermLibraryEnabled === false
      ? []
      : sanitizeCustomTerms(preferences?.customTerms ?? []).filter((entry) => entry.enabled !== false);

  return [
    ...BUILT_IN_TERMS,
    ...customEntries
      .map((entry) => normalizeTermEntry(entry))
      .filter((entry): entry is TermEntry => !!entry)
  ];
}

export function normalizeWithTermLibrary(
  input: string,
  preferences?: Pick<AppPreferences, "customTermLibraryEnabled" | "customTerms"> | null
): string {
  return resolveTermEntries(preferences).reduce((text, entry) => {
    return entry.aliases.reduce((current, alias) => {
      return current.replace(new RegExp(`\\b${escapeRegExp(alias)}\\b`, "gi"), entry.canonical);
    }, text);
  }, input);
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

function actionItemSources(items: StructuredActionItem[]): string[] {
  return items.flatMap((item) => [item.text, item.owner ?? "", item.due ?? ""]);
}

export function buildMeetingTerms(input: {
  title: string;
  transcriptText: string;
  summary: Pick<MeetingSummary, "overview" | "actionItems" | "decisions" | "issues"> | null;
  preferences?: Pick<AppPreferences, "customTermLibraryEnabled" | "customTerms"> | null;
}): string[] {
  const source = [
    input.title,
    input.transcriptText,
    input.summary?.overview ?? "",
    ...(input.summary?.decisions ?? []),
    ...(input.summary?.issues ?? []),
    ...actionItemSources(input.summary?.actionItems ?? [])
  ]
    .join("\n")
    .trim();

  if (!source) {
    return [];
  }

  const knownTerms = resolveTermEntries(input.preferences).map((item) => item.canonical);
  const candidates = [...knownTerms, ...collectDynamicTerms(source)];
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

