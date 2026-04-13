# AI Meeting v0.3.1

macOS 桌面会议记录工具：支持麦克风或系统音频采集，分段实时转写，本地保存全文；可选云端 ASR，也可使用本地 SenseVoice；AI 纪要支持会中手动生成，不需要暂停录制。

## 技术栈

- Electron + React + TypeScript
- SQLite：`better-sqlite3`
- 音频采集：Swift helper + AVFoundation，读取 BlackHole 这类虚拟输入设备
- ASR：
  - Gemini/OpenAI-compatible 云端转写
  - 本地 SenseVoice（sherpa-onnx 运行时）
- LLM：OpenAI 兼容 `/chat/completions` 生成会议概览、关键结论、待办事项、风险与未决问题

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
- 转写在本机完成；会议纪要和会议问答仍使用你配置的 LLM。
- 如果模型不存在，开始录制前需要先完成下载。

## 数据与隐私

- 会议、转写、纪要和配置默认保存在本机 SQLite。
- 没有云同步。
- 使用云端 ASR/LLM 时，音频片段或转写文本会发送到用户配置的第三方服务。
- 使用本地 SenseVoice 时，音频片段不会离开本机；只有生成纪要或问答时才会发送转写文本到你配置的 LLM。

## 验证

```bash
pnpm run typecheck
pnpm test
pnpm run build
pnpm run swift:build
swift/SystemAudioCaptureHelper/.build/release/SystemAudioCaptureHelper devices
```
