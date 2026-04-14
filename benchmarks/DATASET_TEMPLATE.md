# Benchmark 数据集模板

这份模板用于约束内部样本集如何整理，不要求把音频文件提交到仓库。

## 目录建议

```text
benchmarks/
  manifests/
    regression-v0.4.6.json
  audio/
    mic-quiet/
    echo/
    noise/
    overlap/
    low-level/
    long-pause/
    terms/
  references/
    mic-quiet/
    echo/
    noise/
    overlap/
    low-level/
    long-pause/
    terms/
  results/
    v0.4.5.json
    v0.4.6.json
```

## 每条样本最少字段

- `id`
- `audioPath`
- `scenario`
- `deviceType`
- `noiseLevel`
- `reference`
- `expectedTerms`

## 推荐场景

- `mic-quiet`
- `speaker-echo`
- `background-noise`
- `overlap-short`
- `low-level`
- `long-pause-recovery`
- `terms-names-abbr`

## 标注要求

- `reference` 只写最终人工确认转写，不写解释
- `expectedTerms` 只放确实应该命中的术语、人名、项目名、缩写
- 回声/重叠场景必须补 `echoReference` 或 `overlapReference`
- 若样本存在已知异常，可在 manifest 的自定义 metadata 中注明，但不要破坏冻结结构
