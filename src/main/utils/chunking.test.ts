import { describe, expect, it } from "vitest";
import { chunkTextByLength, sanitizeFileName } from "./chunking";

describe("chunkTextByLength", () => {
  it("keeps short text unchanged", () => {
    expect(chunkTextByLength("短会议内容", 100)).toEqual(["短会议内容"]);
  });

  it("splits long text by paragraphs", () => {
    const chunks = chunkTextByLength("第一段内容\n\n第二段内容\n\n第三段内容", 12);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("\n\n")).toBe("第一段内容\n\n第二段内容\n\n第三段内容");
  });
});

describe("sanitizeFileName", () => {
  it("removes file-system unsafe characters", () => {
    expect(sanitizeFileName("会议:/记录*?<>|")).toBe("会议--记录-----");
  });
});
