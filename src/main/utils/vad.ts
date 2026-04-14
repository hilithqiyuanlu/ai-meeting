import { analyzeSamples, pcm16ToFloat32 } from "./audio-pipeline";

export interface VadSegment {
  pcm: Buffer;
  startMs: number;
  endMs: number;
  inputLevel: number;
}

export interface VadConfig {
  sampleRate: number;
  frameMs: number;
  threshold: number;
  preRollMs: number;
  postRollMs: number;
  minSpeechMs: number;
  maxSpeechMs: number;
}

type FramePacket = {
  pcm: Buffer;
  startMs: number;
  endMs: number;
  rms: number;
};

export class VadSegmenter {
  private readonly bytesPerFrame: number;
  private readonly preRollFrames: number;
  private readonly postRollFrames: number;
  private readonly minSpeechFrames: number;
  private readonly maxSpeechFrames: number;
  private buffer = Buffer.alloc(0);
  private history: FramePacket[] = [];
  private activeFrames: FramePacket[] = [];
  private speaking = false;
  private silenceFrames = 0;
  private nextFrameStartMs = 0;

  constructor(private readonly config: VadConfig) {
    this.bytesPerFrame = Math.max(320, Math.floor((config.frameMs / 1000) * config.sampleRate * 2));
    this.preRollFrames = Math.max(1, Math.round(config.preRollMs / config.frameMs));
    this.postRollFrames = Math.max(1, Math.round(config.postRollMs / config.frameMs));
    this.minSpeechFrames = Math.max(1, Math.round(config.minSpeechMs / config.frameMs));
    this.maxSpeechFrames = Math.max(this.minSpeechFrames, Math.round(config.maxSpeechMs / config.frameMs));
  }

  push(chunk: Buffer): VadSegment[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const segments: VadSegment[] = [];

    while (this.buffer.length >= this.bytesPerFrame) {
      const frame = this.buffer.subarray(0, this.bytesPerFrame);
      this.buffer = this.buffer.subarray(this.bytesPerFrame);
      const packet = this.buildFrame(frame);
      const nextSegment = this.consumeFrame(packet);
      if (nextSegment) {
        segments.push(nextSegment);
      }
    }

    return segments;
  }

  flush(): VadSegment[] {
    if (this.buffer.length > 0) {
      const frame = Buffer.alloc(this.bytesPerFrame);
      this.buffer.copy(frame);
      this.buffer = Buffer.alloc(0);
      const packet = this.buildFrame(frame);
      const nextSegment = this.consumeFrame(packet);
      if (nextSegment) {
        return [nextSegment];
      }
    }

    if (this.speaking && this.activeFrames.length > 0) {
      const pending = this.finalizeActiveFrames(true);
      if (pending) {
        return [pending];
      }
    }

    return [];
  }

  private buildFrame(frame: Buffer): FramePacket {
    const startMs = this.nextFrameStartMs;
    const endMs = startMs + this.config.frameMs;
    this.nextFrameStartMs = endMs;
    const rms = analyzeSamples(pcm16ToFloat32(frame)).rms;

    return {
      pcm: frame,
      startMs,
      endMs,
      rms
    };
  }

  private consumeFrame(frame: FramePacket): VadSegment | null {
    const isSpeech = frame.rms >= this.config.threshold;

    if (!this.speaking) {
      this.history.push(frame);
      if (this.history.length > this.preRollFrames) {
        this.history.shift();
      }

      if (!isSpeech) {
        return null;
      }

      this.speaking = true;
      this.silenceFrames = 0;
      this.activeFrames = [...this.history];
      this.history = [];
      return null;
    }

    this.activeFrames.push(frame);

    if (isSpeech) {
      this.silenceFrames = 0;
    } else {
      this.silenceFrames += 1;
    }

    if (this.activeFrames.length >= this.maxSpeechFrames || this.silenceFrames >= this.postRollFrames) {
      return this.finalizeActiveFrames();
    }

    return null;
  }

  private finalizeActiveFrames(allowShortTail = false): VadSegment | null {
    const frames = [...this.activeFrames];
    this.activeFrames = [];
    this.speaking = false;
    this.silenceFrames = 0;
    this.history = frames.slice(-this.preRollFrames);

    const averageRms = frames.length > 0 ? frames.reduce((sum, frame) => sum + frame.rms, 0) / frames.length : 0;
    const shortTailAccepted =
      allowShortTail &&
      frames.length >= Math.max(1, Math.floor(this.minSpeechFrames / 2)) &&
      averageRms >= this.config.threshold * 1.15;

    if (frames.length < this.minSpeechFrames && !shortTailAccepted) {
      return null;
    }

    const pcm = Buffer.concat(frames.map((frame) => frame.pcm));
    const startMs = frames[0]?.startMs ?? 0;
    const endMs = frames.at(-1)?.endMs ?? startMs;
    const inputLevel = averageRms;

    return {
      pcm,
      startMs,
      endMs,
      inputLevel
    };
  }
}
