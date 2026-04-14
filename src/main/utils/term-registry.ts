import registry from "@shared/term-registry.json";

export interface TermEntry {
  canonical: string;
  aliases: string[];
}

export const TERM_REGISTRY = registry as TermEntry[];

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeWithTermRegistry(input: string): string {
  return TERM_REGISTRY.reduce((text, entry) => {
    return entry.aliases.reduce((current, alias) => {
      return current.replace(new RegExp(`\\b${escapeRegExp(alias)}\\b`, "gi"), entry.canonical);
    }, text);
  }, input);
}

export function listCanonicalTerms(): string[] {
  return TERM_REGISTRY.map((entry) => entry.canonical);
}
