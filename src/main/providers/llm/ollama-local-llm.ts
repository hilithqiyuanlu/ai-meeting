import { QA_SYSTEM_PROMPT, SUMMARY_SYSTEM_PROMPT } from "@shared/prompts";
import type { MeetingQaItem, MeetingSummary, ProviderConfig } from "@shared/types";
import { chunkTextByLength } from "@main/utils/chunking";
import {
  extractSummaryJsonObject,
  fallbackSummaryPayload,
  sanitizePlainAnswer,
  summaryToQaContext,
  stripCodeFence
} from "@main/utils/summary-parser";

type OllamaChatResponse = {
  message?: {
    content?: string;
    thinking?: string;
  };
};

export class OllamaLocalLlmProvider {
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
      actionItems: final.actionItems,
      decisions: final.decisions,
      issues: final.issues,
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
    const transcriptChunks = chunkTextByLength(input.transcript, 8000);
    const transcriptContext = transcriptChunks.slice(0, 3).join("\n\n");
    const historyText =
      input.history.length === 0
        ? "暂无历史问答"
        : input.history
            .slice(-6)
            .map((item, index) => `第${index + 1}轮问答\n问：${item.question}\n答：${item.answer}`)
            .join("\n\n");
    const summaryText = summaryToQaContext(input.summary);

    const response = await this.requestTextCompletion({
      systemPrompt: QA_SYSTEM_PROMPT,
      content: `会议标题：${input.title}\n\n会议纪要：\n${summaryText}\n\n会议全文（节选）：\n${transcriptContext}\n\n历史问答：\n${historyText}\n\n当前问题：${input.question}`
    });

    return sanitizePlainAnswer(response);
  }

  private async requestSummary(content: string) {
    const contentText = stripCodeFence(
      await this.requestTextCompletion({
        systemPrompt: SUMMARY_SYSTEM_PROMPT,
        content,
        format: "json"
      })
    );
    const parsed = extractSummaryJsonObject(contentText);

    if (parsed) {
      return parsed;
    }

    const repairedText = await this.requestTextCompletion({
      systemPrompt:
        "你是结构化输出修复助手。把用户提供的会议纪要内容重写为严格 JSON，字段只能是 overview, actionItems, decisions, issues。不要输出任何解释，不要使用代码块。",
      content: contentText,
      format: "json"
    });
    const repaired = extractSummaryJsonObject(repairedText);

    if (repaired) {
      return repaired;
    }

    return fallbackSummaryPayload();
  }

  private async requestTextCompletion(input: {
    systemPrompt: string;
    content: string;
    format?: "json";
  }): Promise<string> {
    const baseUrl = this.config.baseUrl.replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.config.model,
        stream: false,
        think: false,
        format: input.format,
        options: {
          temperature: this.config.temperature,
          num_predict: this.config.maxTokens
        },
        messages: [
          {
            role: "system",
            content: input.systemPrompt
          },
          {
            role: "user",
            content: input.content
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama 请求失败: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as OllamaChatResponse;
    return payload.message?.content ?? "";
  }
}
