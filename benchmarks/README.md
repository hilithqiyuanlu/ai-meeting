# v0.4.1 Benchmark 说明

把内部会议样本整理成一个 `manifest.json`，然后运行：

```bash
pnpm benchmark:asr -- benchmarks/manifest.json
```

`manifest.json` 结构：

```json
{
  "name": "meeting-mic-regression",
  "items": [
    {
      "id": "sample-001",
      "reference": "我们今天先确认 v0.4.1 的交付范围。",
      "hypothesis": "我们今天先确认 v0.4.1 的交付范围。",
      "latencyMs": 1680,
      "duplicate": false,
      "error": false,
      "overlapReference": true,
      "overlapDetected": true
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
