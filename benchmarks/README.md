# v0.4.6 Benchmark 说明

把内部会议样本整理成一个 `manifest.json`，然后运行：

```bash
pnpm benchmark:asr -- benchmarks/manifest.json
```

仓库内只提供 `benchmarks/manifest.example.json` 作为字段示例，不附带内部音频样本集。

如需和上一次已保存的 benchmark 结果做对比：

```bash
pnpm benchmark:asr -- benchmarks/manifest.json --compare benchmarks/results/v0.4.5.json
```

如果要直接从本地 `16kHz / 16-bit / mono WAV` 回放进入当前 `VAD + 本地 SenseVoice + stitch` 管线：

```bash
SENSEVOICE_MODEL_DIR=/absolute/model-dir pnpm benchmark:asr -- benchmarks/manifest.json --mode replay
```

`manifest.json` 结构：

```json
{
  "name": "meeting-mic-regression",
  "baseline": "v0.4.3",
  "mode": "offline",
  "thresholds": {
    "maxCer": 0.18,
    "maxWer": 0.3,
    "maxLatencyMs": 5000,
    "maxLowQualityRate": 0.35,
    "minExpectedTermHitRate": 0.6
  },
  "settings": {
    "modelDir": "/absolute/path/to/model",
    "language": "auto",
    "asr": {
      "vadThreshold": 0.014,
      "vadPreRollMs": 240,
      "vadPostRollMs": 420,
      "minSpeechMs": 600,
      "maxSpeechMs": 5200,
      "aecMode": "auto",
      "noiseSuppressionMode": "auto",
      "autoGainMode": "auto",
      "overlapDetectionEnabled": true,
      "audioProcessingBackend": "system-voice-processing"
    }
  },
  "items": [
    {
      "id": "sample-001",
      "audioPath": "benchmarks/audio/sample-001.wav",
      "scenario": "mic-quiet",
      "deviceType": "microphone",
      "noiseLevel": "low",
      "reference": "我们今天先确认 v0.4.4 的交付范围。",
      "hypothesis": "我们今天先确认 v0.4.4 的交付范围。",
      "latencyMs": 1680,
      "duplicate": false,
      "error": false,
      "overlapReference": true,
      "echoReference": false,
      "overlapDetected": true,
      "segmentCount": 6,
      "lowQualitySegments": 1,
      "expectedTerms": ["AI Meeting", "SenseVoice"]
    }
  ]
}
```

建议覆盖：

- 线上会议麦克风输入
- 扬声器回放导致的回声
- 双人重叠说话
- 低音量、突发噪声、削波
- 长停顿后恢复说话
- 业务术语、人名、项目名

建议至少跟踪：

- CER / WER
- avg / p95 latency
- duplicateRate
- emptyRate
- errorRate
- lowQualityRate
- overlapRecall
- expectedTermHitRate

说明：

- `baseline` 仍是版本标签；若需要自动 diff，请显式传 `--compare saved-result.json`。
- `audioProcessingBackend` 在 `v0.4.5` 支持 `none / heuristic-apm / system-voice-processing`。
- `system-voice-processing` 的效果需要通过真实麦克风录制验证；`replay` 模式不会模拟系统级处理收益。
- 输出结构从 `v0.4.6` 开始冻结，包含：
  - `schemaVersion`
  - `thresholds`
  - `overall`
  - `byScenario`
  - `failures`
  - `items`
  - `comparison`

附加模板：

- `benchmarks/DATASET_TEMPLATE.md`
- `benchmarks/manual-regression-template.md`
