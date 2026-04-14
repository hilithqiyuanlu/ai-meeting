import { describe, expect, it } from "vitest";
import { normalizeTranscriptText, stitchTranscript } from "./transcript";

describe("normalizeTranscriptText", () => {
  it("normalizes meeting terminology", () => {
    expect(normalizeTranscriptText("sense voice 接 ollama 和 ai meeting 的 vad")).toBe(
      "SenseVoice 接 Ollama 和 AI Meeting 的 VAD"
    );
  });

  it("collapses repeated clauses", () => {
    expect(normalizeTranscriptText("我们今天先过需求。我们今天先过需求。")).toBe("我们今天先过需求。");
  });

  it("applies custom term normalization when enabled", () => {
    expect(
      normalizeTranscriptText("今天继续讲 aimeeting 和 coze 的接入", {
        customTermLibraryEnabled: true,
        customTerms: [
          {
            id: "coze",
            canonical: "Coze",
            aliases: ["coze"],
            enabled: true
          }
        ]
      })
    ).toBe("今天继续讲 AI Meeting 和 Coze 的接入");
  });
});

describe("stitchTranscript", () => {
  it("drops duplicated chunk content", () => {
    expect(stitchTranscript("今天确认上线时间", "今天确认上线时间").text).toBe("");
  });

  it("removes overlap prefix from next chunk", () => {
    const stitched = stitchTranscript("我们今天先确认 v0.4.2", "确认 v0.4.2 的上线时间");
    expect(stitched.text).toBe("的上线时间");
  });
});
