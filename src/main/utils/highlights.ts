import type { HighlightKind } from "@shared/types";

export interface HighlightCandidate {
  kind: HighlightKind;
  text: string;
}

const keywordMap: Array<{ kind: HighlightKind; pattern: RegExp }> = [
  { kind: "decision", pattern: /(决定|确定|结论|统一|拍板|就这么定|确认采用)/ },
  { kind: "action", pattern: /(负责|跟进|安排|推进|今天内|本周内|下周|输出|提交|同步给)/ },
  { kind: "risk", pattern: /(风险|问题|阻塞|卡住|延期|来不及|故障|不稳定)/ },
  { kind: "follow-up", pattern: /(待确认|再确认|补充|回头|稍后|需要确认|再看一下)/ }
];

function normalizeForComparison(input: string): string {
  return input.replace(/\s+/g, "").replace(/[，。！？,.!?：:；;]/g, "");
}

export function extractHighlightCandidates(text: string, existingTexts: string[]): HighlightCandidate[] {
  const source = text.trim();
  if (source.length < 10) {
    return [];
  }

  const dedupePool = new Set(existingTexts.map(normalizeForComparison));
  const matches = keywordMap
    .filter((item) => item.pattern.test(source))
    .slice(0, 2)
    .map((item) => ({
      kind: item.kind,
      text: source.length > 72 ? `${source.slice(0, 72).trim()}…` : source
    }))
    .filter((item) => !dedupePool.has(normalizeForComparison(item.text)));

  return matches;
}
