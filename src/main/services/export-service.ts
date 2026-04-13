import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppPreferences, ExportFormat, MeetingDetail } from "@shared/types";
import { sanitizeFileName } from "@main/utils/chunking";

export class ExportService {
  async exportMeeting(detail: MeetingDetail, format: ExportFormat, preferences: AppPreferences, baseDirectory: string): Promise<string> {
    const exportRoot = preferences.exportDirectory || baseDirectory;
    await mkdir(exportRoot, { recursive: true });
    const safeName = sanitizeFileName(`${detail.session.title}-${detail.session.startedAt.slice(0, 10)}`);
    const filePath = join(exportRoot, `${safeName}.${format === "markdown" ? "md" : "txt"}`);

    const content = format === "markdown" ? this.toMarkdown(detail) : this.toText(detail, preferences.exportIncludePlaceholders);
    await writeFile(filePath, content, "utf8");
    return filePath;
  }

  private toMarkdown(detail: MeetingDetail): string {
    const lines = [
      `# ${detail.session.title}`,
      "",
      `- 开始时间：${detail.session.startedAt}`,
      `- 结束时间：${detail.session.endedAt ?? "进行中"}`,
      `- 音频设备：${detail.session.audioDeviceName}`,
      ""
    ];

    if (detail.summary) {
      lines.push("## AI 纪要", "", detail.summary.overview, "");
      lines.push("### 关键结论", ...detail.summary.bulletPoints.map((item) => `- ${item}`), "");
      lines.push("### 待办事项", ...detail.summary.actionItems.map((item) => `- ${item}`), "");
      lines.push("### 风险与未决问题", ...detail.summary.risks.map((item) => `- ${item}`), "");
    }

    lines.push("## 全文转写", "");
    for (const segment of detail.transcriptSegments) {
      lines.push(`- [${segment.startMs}ms - ${segment.endMs}ms] ${this.formatSegment(segment, true)}`);
    }

    return lines.join("\n");
  }

  private toText(detail: MeetingDetail, includePlaceholders: boolean): string {
    return detail.transcriptSegments
      .map((segment) => this.formatSegment(segment, includePlaceholders))
      .filter(Boolean)
      .join("\n");
  }

  private formatSegment(detailSegment: MeetingDetail["transcriptSegments"][number], includePlaceholders: boolean): string {
    if (detailSegment.kind === "speech") {
      return detailSegment.text;
    }

    if (!includePlaceholders) {
      return "";
    }

    if (detailSegment.kind === "silence") {
      return "[此处接近静音，未检测到可识别人声]";
    }

    if (detailSegment.kind === "unclear") {
      return "[此处有音频活动，但没有识别出稳定文字]";
    }

    return `[此处转写失败：${detailSegment.note ?? "未知错误"}]`;
  }
}
