import { readFile } from "node:fs/promises";

function levenshtein(a, b) {
  const rows = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
    }
  }

  return rows[a.length][b.length];
}

function normalizeText(input) {
  return String(input ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function cer(reference, hypothesis) {
  const ref = normalizeText(reference).replace(/\s+/g, "");
  const hyp = normalizeText(hypothesis).replace(/\s+/g, "");
  return ref.length === 0 ? 0 : levenshtein(ref, hyp) / ref.length;
}

function wer(reference, hypothesis) {
  const ref = normalizeText(reference).split(" ").filter(Boolean);
  const hyp = normalizeText(hypothesis).split(" ").filter(Boolean);
  return ref.length === 0 ? 0 : levenshtein(ref, hyp) / ref.length;
}

function average(items) {
  if (items.length === 0) return 0;
  return items.reduce((sum, item) => sum + item, 0) / items.length;
}

function percentile(items, p) {
  if (items.length === 0) return 0;
  const sorted = [...items].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    console.error("用法: pnpm benchmark:asr -- <manifest.json>");
    process.exit(1);
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const items = Array.isArray(manifest.items) ? manifest.items : [];
  if (items.length === 0) {
    console.error("manifest.items 不能为空");
    process.exit(1);
  }

  const result = {
    suite: manifest.name ?? "unnamed-benchmark",
    sampleCount: items.length,
    cer: average(items.map((item) => cer(item.reference, item.hypothesis))),
    wer: average(items.map((item) => wer(item.reference, item.hypothesis))),
    avgLatencyMs: average(items.map((item) => Number(item.latencyMs ?? 0))),
    p95LatencyMs: percentile(items.map((item) => Number(item.latencyMs ?? 0)), 95),
    emptyRate: average(items.map((item) => (normalizeText(item.hypothesis) ? 0 : 1))),
    duplicateRate: average(items.map((item) => (item.duplicate ? 1 : 0))),
    errorRate: average(items.map((item) => (item.error ? 1 : 0))),
    overlapRecall: (() => {
      const overlapItems = items.filter((item) => item.overlapReference);
      if (overlapItems.length === 0) return 0;
      return average(overlapItems.map((item) => (item.overlapDetected ? 1 : 0)));
    })()
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
