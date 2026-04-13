import type { TranscriptSegmentKind } from "@shared/types";

export interface AsrProviderCallbacks {
  onPartialText: (text: string) => void;
  onFinalText: (payload: {
    text: string;
    startMs: number;
    endMs: number;
    kind: TranscriptSegmentKind;
    note: string | null;
    inputLevel: number;
    overlapChars: number;
  }) => Promise<void>;
  onStatus: (status: string) => void;
  onError: (error: Error) => void;
}

export interface AsrProvider {
  start(): Promise<void>;
  sendAudio(chunk: Buffer): Promise<void>;
  stop(): Promise<void>;
}
