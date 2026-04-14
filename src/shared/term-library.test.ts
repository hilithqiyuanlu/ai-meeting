import { describe, expect, it } from "vitest";
import { buildMeetingTerms, normalizeWithTermLibrary, sanitizeCustomTerms } from "./term-library";

describe("sanitizeCustomTerms", () => {
  it("drops empty entries and trims aliases", () => {
    expect(
      sanitizeCustomTerms([
        {
          id: "1",
          canonical: "  Coze ",
          aliases: [" coze ", "", "Coze"],
          enabled: true
        },
        {
          id: "2",
          canonical: "   ",
          aliases: ["noop"],
          enabled: true
        }
      ])
    ).toEqual([
      {
        id: "1",
        canonical: "Coze",
        aliases: [],
        enabled: true
      }
    ]);
  });
});

describe("normalizeWithTermLibrary", () => {
  it("uses built-in and custom terms together", () => {
    expect(
      normalizeWithTermLibrary("sense voice 接 coze", {
        customTermLibraryEnabled: true,
        customTerms: [
          {
            id: "1",
            canonical: "Coze",
            aliases: ["coze"],
            enabled: true
          }
        ]
      })
    ).toBe("SenseVoice 接 Coze");
  });
});

describe("buildMeetingTerms", () => {
  it("recalls built-in, custom and dynamic terms from title/transcript/summary", () => {
    const terms = buildMeetingTerms({
      title: "Coze 接入评审",
      transcriptText: "今天先过 AI Meeting 的 Coze 接入方案。Coze 这块要下周确认。",
      summary: {
        overview: "会议主要确认 Coze 接入边界。",
        actionItems: [
          {
            text: "张三整理 Coze 接入清单",
            owner: "张三",
            due: null
          }
        ],
        decisions: ["先接 AI Meeting 到 Coze"],
        issues: ["Coze API 限额待确认"]
      },
      preferences: {
        customTermLibraryEnabled: true,
        customTerms: [
          {
            id: "1",
            canonical: "Coze",
            aliases: ["coze"],
            enabled: true
          }
        ]
      }
    });

    expect(terms).toContain("AI Meeting");
    expect(terms).toContain("Coze");
    expect(terms).toContain("API");
  });
});
