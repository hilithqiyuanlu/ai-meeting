import { describe, expect, it } from "vitest";
import { extractSummaryJsonObject, fallbackSummaryPayload, summaryToQaContext } from "./summary-parser";

describe("extractSummaryJsonObject", () => {
  it("parses structured action items", () => {
    const parsed = extractSummaryJsonObject(`{
      "overview": "本次会议确认排期。",
      "actionItems": [
        { "text": "张三整理发布清单", "owner": "张三", "due": "本周五" },
        { "text": "李四补接口文档", "owner": null, "due": null }
      ],
      "decisions": ["本周先灰度发布"],
      "issues": ["接口限流阈值待确认"]
    }`);

    expect(parsed).toEqual({
      overview: "本次会议确认排期。",
      actionItems: [
        { text: "张三整理发布清单", owner: "张三", due: "本周五" },
        { text: "李四补接口文档", owner: null, due: null }
      ],
      decisions: ["本周先灰度发布"],
      issues: ["接口限流阈值待确认"]
    });
  });

  it("accepts string action items as fallback", () => {
    const parsed = extractSummaryJsonObject(`{
      "overview": "会议完成初版梳理。",
      "actionItems": ["整理文档"],
      "decisions": [],
      "issues": []
    }`);

    expect(parsed?.actionItems).toEqual([{ text: "整理文档", owner: null, due: null }]);
  });
});

describe("summaryToQaContext", () => {
  it("serializes the new summary structure", () => {
    expect(
      summaryToQaContext({
        overview: "确认范围。",
        actionItems: [{ text: "张三补文档", owner: "张三", due: null }],
        decisions: ["按 v0.4.4.1 收口"],
        issues: ["截止时间待确认"],
        rawResponse: "{}",
        sourceSegmentSeq: 8,
        sourceTranscriptChars: 1200,
        generatedWhileStatus: "completed"
      })
    ).toContain("行动项：张三补文档（负责人：张三，截止时间：未明确）");
  });

  it("returns fallback when summary is absent", () => {
    expect(summaryToQaContext(null)).toBe("暂无会议纪要");
    expect(fallbackSummaryPayload().issues).toEqual([]);
  });
});
