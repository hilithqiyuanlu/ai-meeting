import type { ReactNode } from "react";
import { buildMeetingTerms } from "@shared/term-library";
import type { AppPreferences, MeetingDetail } from "@shared/types";

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function detectMeetingTerms(detail: MeetingDetail | null, preferences: AppPreferences): string[] {
  if (!detail) {
    return [];
  }

  return buildMeetingTerms({
    title: detail.session.title,
    transcriptText: detail.session.transcriptText,
    summary: detail.summary
      ? {
          overview: detail.summary.overview,
          actionItems: detail.summary.actionItems,
          decisions: detail.summary.decisions,
          issues: detail.summary.issues
        }
      : null,
    preferences
  });
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
