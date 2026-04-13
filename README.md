# AI Meeting

macOS 桌面会议记录工具 V1：收听系统音频输出，分段实时转写，本地保存全文，会后手动生成 AI 纪要。

## 技术栈

- Electron + React + TypeScript
- SQLite：`better-sqlite3`
- 音频采集：Swift helper + AVFoundation，读取 BlackHole 这类虚拟输入设备
- ASR：OpenAI 兼容 `/audio/transcriptions` 分段转写
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

## 数据与隐私

- 会议、转写、纪要和配置默认保存在本机 SQLite。
- 没有云同步。
- 只有配置并触发 ASR/LLM 调用时，音频片段或转写文本才会发送到用户配置的第三方服务。

## 验证

```bash
pnpm run typecheck
pnpm test
pnpm run build
pnpm run swift:build
swift/SystemAudioCaptureHelper/.build/release/SystemAudioCaptureHelper devices
```
