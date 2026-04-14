# AI Meeting v0.4.5

macOS 桌面会议副驾：默认麦克风优先，强调会中 2-5 秒内可用的实时字幕、质量提示与结构化纪要；支持本地 SenseVoice 转写，也支持可选云端 ASR；AI 纪要支持会中手动生成，不需要暂停录制。

## 技术栈

- Electron + React + TypeScript
- SQLite：`better-sqlite3`
- 音频采集：Swift helper + AVFoundation，读取 BlackHole 这类虚拟输入设备
- ASR：
  - Gemini/OpenAI-compatible 云端转写
  - 本地 SenseVoice（sherpa-onnx 运行时，含 VAD 分段、质量标记、重叠检测）
- LLM：
  - Gemini/OpenAI-compatible 云端纪要
  - Ollama 本地纪要与问答

## 本地启动

```bash
pnpm install
pnpm approve-builds
pnpm run swift:build
pnpm dev
```

如果 helper 未就绪，引导页会提示执行：

```bash
pnpm run swift:build
```

## 采集模式

- 默认推荐：麦克风模式。适合线上/线下会议，强调会中实时可用；线上会议建议佩戴耳机。
- 兼容模式：系统音频模式。适合回采系统音频，需要先配置 BlackHole。

## BlackHole 配置

1. 安装 BlackHole 2ch。
2. 打开 macOS“音频 MIDI 设置”。
3. 创建“多输出设备”，勾选当前扬声器和 BlackHole。
4. 将系统输出切到该多输出设备。
5. 在应用里选择 BlackHole 作为输入设备并开始录制。

应用只读取选定的虚拟输入设备，不自动修改系统输出路由。

## 本地 SenseVoice

- 在设置页切换到“本地 SenseVoice”后，可直接下载模型到应用数据目录。
- 本地 ASR 默认支持：自动、普通话、粤语、英语、日语、韩语。
- 转写在本机完成；`v0.4.5` 新增麦克风模式下的系统级 Voice Processing，并保留启发式前处理作为 fallback。
- 会中可看到低置信、重叠、回声/噪声/低音量等质量提示。
- 新增实时文本后处理增强：更稳的尾段收尾、重复/重叠压制、术语标准化。
- 历史会议支持双击改名，默认麦克风会议标题为日期+时间。
- 实时字幕、会议纪要和会议问答支持术语高亮；设置页可维护自定义术语/热词库。
- benchmark 支持更完整的 manifest 字段与回放模式，可对 `v0.4.3` 基线做场景化对比。
- 本地 ASR 设置页现在支持 `自动 / 系统 Voice Processing / 启发式 APM / 关闭`。
- 系统后端只在 `麦克风模式` 下启用；若不可用，会自动回退到 `heuristic-apm`。
- 会议纪要和会议问答仍使用你配置的 LLM。
- 如果模型不存在，开始录制前需要先完成下载。

## 本地 Ollama

- 设置页可切换到 `Ollama 本地`，默认地址为 `http://127.0.0.1:11434`。
- 默认模型为 `qwen3.5:4b`，会中纪要、会后纪要和会议问答都可走本地模型。
- 当 ASR 选择 `本地 SenseVoice`、LLM 选择 `Ollama 本地` 时，可实现转写、纪要、问答全链路本地化。

## 数据与隐私

- 会议、转写、纪要和配置默认保存在本机 SQLite。
- 没有云同步。
- 使用云端 ASR/LLM 时，音频片段或转写文本会发送到用户配置的第三方服务。
- 使用本地 SenseVoice + Ollama 时，音频片段和转写文本都不会离开本机。

## 验证

```bash
pnpm run typecheck
pnpm test
pnpm benchmark:asr -- benchmarks/manifest.example.json
pnpm run build
pnpm run swift:build
swift/SystemAudioCaptureHelper/.build/release/SystemAudioCaptureHelper devices
```
