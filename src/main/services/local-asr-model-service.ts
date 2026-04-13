import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LocalAsrStatus } from "@shared/types";

const execFileAsync = promisify(execFile);

const MODEL_ID = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09";
const MANIFEST_FILE = "manifest.json";
const DOWNLOAD_TIMEOUT_MS = 20000;
const MAX_RETRIES = 2;

const ARCHIVE_SOURCES = [
  {
    label: "GitHub Releases",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2"
  }
] as const;

const FILE_SOURCES = [
  {
    label: "Hugging Face",
    baseUrl: "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09/resolve/main"
  }
] as const;

type LocalManifest = {
  modelId: string;
  downloadedAt: string;
  storagePath: string;
};

export class LocalAsrModelService {
  private readonly rootDir: string;
  private readonly archiveDir: string;
  private readonly modelRootDir: string;
  private readonly manifestPath: string;
  private downloadTask: Promise<LocalAsrStatus> | null = null;
  private volatileState: LocalAsrStatus = {
    modelId: MODEL_ID,
    state: "not-downloaded",
    progress: null,
    storagePath: null,
    errorMessage: null
  };
  private listeners = new Set<(state: LocalAsrStatus) => void>();

  constructor(userDataPath: string) {
    this.rootDir = join(userDataPath, "models", "sensevoice");
    this.archiveDir = join(this.rootDir, "downloads");
    this.modelRootDir = join(this.rootDir, MODEL_ID);
    this.manifestPath = join(this.rootDir, MANIFEST_FILE);
  }

  getModelId(): string {
    return MODEL_ID;
  }

  subscribe(listener: (state: LocalAsrStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getState(): Promise<LocalAsrStatus> {
    if (this.volatileState.state === "downloading") {
      return this.volatileState;
    }

    const manifest = await this.readManifest();
    const resolvedPath = manifest ? await this.resolveModelDirectory(manifest.storagePath) : await this.resolveModelDirectory(this.modelRootDir);
    const ready = resolvedPath ? await this.isModelReady(resolvedPath) : false;

    const nextState: LocalAsrStatus = ready
      ? {
          modelId: MODEL_ID,
          state: "ready",
          progress: 100,
          storagePath: resolvedPath,
          errorMessage: null
        }
      : {
          modelId: MODEL_ID,
          state: this.volatileState.state === "error" ? "error" : "not-downloaded",
          progress: null,
          storagePath: null,
          errorMessage: this.volatileState.state === "error" ? this.volatileState.errorMessage : null
        };

    this.volatileState = nextState;
    return nextState;
  }

  async downloadModel(): Promise<LocalAsrStatus> {
    const current = await this.getState();
    if (current.state === "ready") {
      return current;
    }
    if (this.downloadTask) {
      return this.downloadTask;
    }

    this.downloadTask = this.performDownload();
    try {
      return await this.downloadTask;
    } finally {
      this.downloadTask = null;
    }
  }

  async deleteModel(): Promise<LocalAsrStatus> {
    if (this.downloadTask) {
      throw new Error("模型正在下载，暂时不能删除。");
    }

    await rm(this.modelRootDir, { recursive: true, force: true });
    await rm(join(this.archiveDir, `${MODEL_ID}.tar.bz2`), { force: true });
    await unlink(this.manifestPath).catch(() => undefined);

    const nextState: LocalAsrStatus = {
      modelId: MODEL_ID,
      state: "not-downloaded",
      progress: null,
      storagePath: null,
      errorMessage: null
    };
    this.setState(nextState);
    return nextState;
  }

  async importModelDirectory(sourceDir: string): Promise<LocalAsrStatus> {
    if (this.downloadTask) {
      throw new Error("模型正在下载，暂时不能导入。");
    }

    const resolvedSource = await this.resolveModelDirectory(sourceDir);
    if (!resolvedSource || !(await this.isModelReady(resolvedSource))) {
      throw new Error("所选目录不包含 model.int8.onnx 和 tokens.txt");
    }

    await rm(this.modelRootDir, { recursive: true, force: true });
    await mkdir(this.modelRootDir, { recursive: true });
    await copyFile(join(resolvedSource, "model.int8.onnx"), join(this.modelRootDir, "model.int8.onnx"));
    await copyFile(join(resolvedSource, "tokens.txt"), join(this.modelRootDir, "tokens.txt"));
    await writeFile(
      this.manifestPath,
      JSON.stringify(
        {
          modelId: MODEL_ID,
          downloadedAt: new Date().toISOString(),
          storagePath: this.modelRootDir
        } satisfies LocalManifest,
        null,
        2
      ),
      "utf8"
    );

    const nextState: LocalAsrStatus = {
      modelId: MODEL_ID,
      state: "ready",
      progress: 100,
      storagePath: this.modelRootDir,
      errorMessage: null
    };
    this.setState(nextState);
    return nextState;
  }

  private async performDownload(): Promise<LocalAsrStatus> {
    await mkdir(this.archiveDir, { recursive: true });
    const archivePath = join(this.archiveDir, `${MODEL_ID}.tar.bz2`);
    const tempExtractDir = join(this.rootDir, `${MODEL_ID}.tmp`);
    const tempModelDir = join(tempExtractDir, MODEL_ID);

    await rm(tempExtractDir, { recursive: true, force: true });
    await rm(this.modelRootDir, { recursive: true, force: true });

    this.setState({
      modelId: MODEL_ID,
      state: "downloading",
      progress: 0,
      storagePath: null,
      errorMessage: null
    });

    try {
      await mkdir(tempExtractDir, { recursive: true });
      await mkdir(tempModelDir, { recursive: true });

      const archiveError = await this.tryDownloadArchive(archivePath, tempExtractDir);
      if (archiveError) {
        await this.downloadModelFiles(tempModelDir);
      }

      const resolvedPath = (await this.resolveModelDirectory(tempModelDir)) ?? (await this.resolveModelDirectory(tempExtractDir));
      if (!resolvedPath || !(await this.isModelReady(resolvedPath))) {
        throw new Error("模型文件不完整，缺少 model.int8.onnx 或 tokens.txt");
      }

      await rm(this.modelRootDir, { recursive: true, force: true });
      await mkdir(this.rootDir, { recursive: true });
      await rename(resolvedPath, this.modelRootDir);
      await rm(tempExtractDir, { recursive: true, force: true });
      await writeFile(
        this.manifestPath,
        JSON.stringify(
          {
            modelId: MODEL_ID,
            downloadedAt: new Date().toISOString(),
            storagePath: this.modelRootDir
          } satisfies LocalManifest,
          null,
          2
        ),
        "utf8"
      );

      const nextState: LocalAsrStatus = {
        modelId: MODEL_ID,
        state: "ready",
        progress: 100,
        storagePath: this.modelRootDir,
        errorMessage: null
      };
      this.setState(nextState);
      return nextState;
    } catch (error) {
      await rm(tempExtractDir, { recursive: true, force: true }).catch(() => undefined);
      await rm(archivePath, { force: true }).catch(() => undefined);
      const nextState: LocalAsrStatus = {
        modelId: MODEL_ID,
        state: "error",
        progress: null,
        storagePath: null,
        errorMessage: error instanceof Error ? error.message : String(error)
      };
      this.setState(nextState);
      throw error;
    }
  }

  private async tryDownloadArchive(archivePath: string, tempExtractDir: string): Promise<Error | null> {
    let lastError: Error | null = null;
    for (const source of ARCHIVE_SOURCES) {
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
        try {
          await this.downloadToFile({
            label: `${source.label} 压缩包`,
            url: source.url,
            destinationPath: archivePath
          });
          await execFileAsync("tar", ["-xjf", archivePath, "-C", tempExtractDir]);
          return null;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (!this.isRetryableError(lastError) || attempt === MAX_RETRIES) {
            break;
          }
        }
      }
    }
    return lastError;
  }

  private async downloadModelFiles(targetDir: string): Promise<void> {
    let lastError: Error | null = null;

    for (const source of FILE_SOURCES) {
      try {
        await this.downloadToFile({
          label: `${source.label} model.int8.onnx`,
          url: `${source.baseUrl}/model.int8.onnx`,
          destinationPath: join(targetDir, "model.int8.onnx")
        });
        await this.downloadToFile({
          label: `${source.label} tokens.txt`,
          url: `${source.baseUrl}/tokens.txt`,
          destinationPath: join(targetDir, "tokens.txt")
        });
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw new Error(`模型下载失败：${lastError?.message ?? "所有下载源都不可用"}`);
  }

  private async downloadToFile(input: {
    label: string;
    url: string;
    destinationPath: string;
  }): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        await this.downloadOnce(input.url, input.destinationPath);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (!this.isRetryableError(lastError) || attempt === MAX_RETRIES) {
          break;
        }
      }
    }

    throw new Error(`${input.label} 不可用：${lastError?.message ?? "未知错误"}`);
  }

  private async downloadOnce(url: string, destinationPath: string): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        redirect: "follow"
      });
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`请求超时（>${DOWNLOAD_TIMEOUT_MS / 1000}s）`);
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
    clearTimeout(timer);

    if (!response.ok || !response.body) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const total = Number(response.headers.get("content-length") ?? "0");
    let received = 0;
    const stream = createWriteStream(destinationPath);
    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        if (!value) {
          continue;
        }

        received += value.byteLength;
        const progress = total > 0 ? Math.min(99, Math.round((received / total) * 100)) : null;
        this.setState({
          ...this.volatileState,
          state: "downloading",
          progress,
          errorMessage: null
        });

        await new Promise<void>((resolve, reject) => {
          stream.write(Buffer.from(value), (error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }
    } finally {
      await new Promise<void>((resolve) => stream.end(() => resolve()));
      reader.releaseLock();
    }
  }

  private isRetryableError(error: Error): boolean {
    return /\b(408|425|429|500|502|503|504)\b/.test(error.message) || /超时|timeout|network|fetch failed/i.test(error.message);
  }

  private async readManifest(): Promise<LocalManifest | null> {
    try {
      const raw = await readFile(this.manifestPath, "utf8");
      return JSON.parse(raw) as LocalManifest;
    } catch {
      return null;
    }
  }

  private async resolveModelDirectory(basePath: string): Promise<string | null> {
    const directReady = await this.isModelReady(basePath);
    if (directReady) {
      return basePath;
    }

    try {
      const children = await readdir(basePath, { withFileTypes: true });
      for (const child of children) {
        if (!child.isDirectory()) {
          continue;
        }
        const childPath = join(basePath, child.name);
        if (await this.isModelReady(childPath)) {
          return childPath;
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  private async isModelReady(path: string): Promise<boolean> {
    try {
      const modelStat = await stat(join(path, "model.int8.onnx"));
      const tokensStat = await stat(join(path, "tokens.txt"));
      return modelStat.isFile() && tokensStat.isFile();
    } catch {
      return false;
    }
  }

  private setState(state: LocalAsrStatus): void {
    this.volatileState = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
