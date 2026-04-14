import type { MeetingSummary, StructuredActionItem } from "@shared/types";

export interface SummaryPayload {
  overview: string;
  actionItems: StructuredActionItem[];
  decisions: string[];
  issues: string[];
}

export function stripCodeFence(input: string): string {
  return input.replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1").trim();
}

export function sanitizePlainAnswer(input: string): string {
  return stripCodeFence(input)
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeSummaryField(input: string): string {
  return sanitizePlainAnswer(input)
    .replace(/^\{\s*"overview"\s*:\s*/i, "")
    .replace(/^\s*"overview"\s*:\s*/i, "")
    .replace(/^"+|"+$/g, "")
    .trim();
}

function sanitizeActionItem(input: unknown): StructuredActionItem | null {
  if (typeof input === "string") {
    const text = sanitizeSummaryField(input);
    return text
      ? {
          text,
          owner: null,
          due: null
        }
      : null;
  }

  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Partial<Record<"text" | "owner" | "due", unknown>>;
  const text = sanitizeSummaryField(String(candidate.text ?? ""));
  if (!text) {
    return null;
  }

  const owner = sanitizeSummaryField(String(candidate.owner ?? "")).trim();
  const due = sanitizeSummaryField(String(candidate.due ?? "")).trim();

  return {
    text,
    owner: owner || null,
    due: due || null
  };
}

export function extractSummaryJsonObject(input: string): SummaryPayload | null {
  const normalized = stripCodeFence(input);
  const match = normalized.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[0]) as Partial<Record<"overview" | "actionItems" | "decisions" | "issues", unknown>>;
    return {
      overview: sanitizeSummaryField(String(parsed.overview ?? "")),
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.map(sanitizeActionItem).filter((item): item is StructuredActionItem => !!item) : [],
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions.map((item) => sanitizeSummaryField(String(item))).filter(Boolean) : [],
      issues: Array.isArray(parsed.issues) ? parsed.issues.map((item) => sanitizeSummaryField(String(item))).filter(Boolean) : []
    };
  } catch {
    return null;
  }
}

export function fallbackSummaryPayload(): SummaryPayload {
  return {
    overview: "摘要格式异常，请重新生成。",
    actionItems: [],
    decisions: [],
    issues: []
  };
}

export function summaryToQaContext(
  summary: Omit<MeetingSummary, "sessionId" | "createdAt" | "updatedAt"> | null
): string {
  if (!summary) {
    return "暂无会议纪要";
  }

  const actionText =
    summary.actionItems.length === 0
      ? "无"
      : summary.actionItems
          .map((item) => {
            const meta = [`负责人：${item.owner ?? "未明确"}`, `截止时间：${item.due ?? "未明确"}`].join("，");
            return `${item.text}（${meta}）`;
          })
          .join("；");

  return [
    `会议概览：${summary.overview}`,
    `行动项：${actionText}`,
    `决策：${summary.decisions.join("；") || "无"}`,
    `问题：${summary.issues.join("；") || "无"}`
  ].join("\n");
}
