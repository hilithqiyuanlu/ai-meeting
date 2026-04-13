import { QA_SYSTEM_PROMPT, SUMMARY_SYSTEM_PROMPT } from "@shared/prompts";
import type { MeetingQaItem, MeetingSummary, ProviderConfig } from "@shared/types";
import { chunkTextByLength } from "@main/utils/chunking";

interface SummaryPayload {
  overview: string;
  bulletPoints: string[];
  actionItems: string[];
  risks: string[];
}

function stripCodeFence(input: string): string {
  return input.replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1").trim();
}

function sanitizePlainAnswer(input: string): string {
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

function extractJsonObject(input: string): SummaryPayload | null {
  const normalized = stripCodeFence(input);
  const match = normalized.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[0]) as Partial<SummaryPayload>;
    return {
      overview: parsed.overview ?? "",
      bulletPoints: Array.isArray(parsed.bulletPoints) ? parsed.bulletPoints.filter(Boolean) : [],
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.filter(Boolean) : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks.filter(Boolean) : []
    };
  } catch {
    return null;
  }
}

export class OpenAICompatibleLlmProvider {
  constructor(private readonly config: ProviderConfig["llm"]) {}

  async generateSummary(
    transcript: string,
    title: string
  ): Promise<
    Omit<
      MeetingSummary,
      "sessionId" | "createdAt" | "updatedAt" | "sourceSegmentSeq" | "sourceTranscriptChars" | "generatedWhileStatus"
    >
  > {
    if (!this.config.apiKey) {
      throw new Error("LLM API Key 未配置");
    }

    const chunks = chunkTextByLength(transcript, 9000);
    let source = transcript;

    if (chunks.length > 1) {
      const partials: string[] = [];
      for (const [index, chunk] of chunks.entries()) {
        const partial = await this.requestSummary(
          `这是长会议转写的第 ${index + 1}/${chunks.length} 段，请先提炼该分段纪要。会议标题：${title}\n\n${chunk}`
        );
        partials.push(JSON.stringify(partial, null, 2));
      }
      source = partials.join("\n\n");
    }

    const final = await this.requestSummary(`请基于以下材料生成最终会议纪要。会议标题：${title}\n\n${source}`);
    return {
      overview: final.overview,
      bulletPoints: final.bulletPoints,
      actionItems: final.actionItems,
      risks: final.risks,
      rawResponse: JSON.stringify(final, null, 2)
    };
  }

  async answerQuestion(input: {
    transcript: string;
    title: string;
    summary: Omit<MeetingSummary, "sessionId" | "createdAt" | "updatedAt"> | null;
    history: Pick<MeetingQaItem, "question" | "answer">[];
    question: string;
  }): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error("LLM API Key 未配置");
    }

    const transcriptChunks = chunkTextByLength(input.transcript, 8000);
    const transcriptContext = transcriptChunks.slice(0, 3).join("\n\n");
    const historyText =
      input.history.length === 0
        ? "暂无历史问答"
        : input.history
            .slice(-6)
            .map((item, index) => `第${index + 1}轮问答\n问：${item.question}\n答：${item.answer}`)
            .join("\n\n");
    const summaryText = input.summary
      ? `会议概览：${input.summary.overview}\n关键结论：${input.summary.bulletPoints.join("；")}\n待办事项：${input.summary.actionItems.join("；")}\n风险与未决问题：${input.summary.risks.join("；")}`
      : "暂无会议纪要";

    const response = await this.requestTextCompletion(
      QA_SYSTEM_PROMPT,
      `会议标题：${input.title}\n\n会议纪要：\n${summaryText}\n\n会议全文（节选）：\n${transcriptContext}\n\n历史问答：\n${historyText}\n\n当前问题：${input.question}`
    );

    return sanitizePlainAnswer(response);
  }

  private async requestSummary(content: string): Promise<SummaryPayload> {
    const contentText = stripCodeFence(await this.requestTextCompletion(SUMMARY_SYSTEM_PROMPT, content));
    const parsed = extractJsonObject(contentText);

    if (parsed) {
      return {
        overview: sanitizeSummaryField(parsed.overview),
        bulletPoints: parsed.bulletPoints.map(sanitizeSummaryField).filter(Boolean),
        actionItems: parsed.actionItems.map(sanitizeSummaryField).filter(Boolean),
        risks: parsed.risks.map(sanitizeSummaryField).filter(Boolean)
      };
    }

    const repairedText = await this.requestTextCompletion(
      "你是结构化输出修复助手。把用户提供的会议纪要内容重写为严格 JSON，字段只能是 overview, bulletPoints, actionItems, risks。不要输出任何解释，不要使用代码块。",
      contentText
    );
    const repaired = extractJsonObject(repairedText);

    if (repaired) {
      return {
        overview: sanitizeSummaryField(repaired.overview),
        bulletPoints: repaired.bulletPoints.map(sanitizeSummaryField).filter(Boolean),
        actionItems: repaired.actionItems.map(sanitizeSummaryField).filter(Boolean),
        risks: repaired.risks.map(sanitizeSummaryField).filter(Boolean)
      };
    }

    return {
      overview: "摘要格式异常，请重新生成。",
      bulletPoints: [],
      actionItems: [],
      risks: []
    };
  }

  private async requestTextCompletion(systemPrompt: string, content: string): Promise<string> {
    const baseUrl = this.config.baseUrl.replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`LLM 请求失败: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return payload.choices?.[0]?.message?.content ?? "";
  }
}
