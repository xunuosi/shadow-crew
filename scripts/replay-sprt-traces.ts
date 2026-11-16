/**
 * SPRT 真实流量 trace 离线回放 CLI
 *
 * 用法：
 *   npx tsx scripts/replay-sprt-traces.ts <traces.json> [--thresholds <overrides.json>] [--out <report.md>]
 *
 * <traces.json> 来自 Dev 运行期 `__SHADOW_CREW_SPRT__.downloadTraces()`
 * 导出的 `{ schemaVersion, exportedAt, traces }` 载荷。
 *
 * 无 --thresholds 时按 trace 记录的历史生效阈值回放，用于验证决策可复现性；
 * 指定 --thresholds 时注入候选阈值做 what-if 标定（仅影响本次回放，不写回应用配置）。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import {
  replaySprtTraces,
  formatSprtReplayReport,
} from '../src/services/cogno/sprtTraceAnalyzer';
import type { SprtThresholdOverrides } from '../src/services/cogno/sprtThresholdConfig';
import { parseSprtThresholdOverrides } from '../src/services/cogno/sprtThresholdConfig';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

const tracePath = process.argv[2];
if (!tracePath || tracePath.startsWith('--')) {
  console.error(
    'Usage: npx tsx scripts/replay-sprt-traces.ts <traces.json> [--thresholds <overrides.json>] [--out <report.md>]'
  );
  process.exit(2);
}

let payload: unknown;
try {
  payload = JSON.parse(readFileSync(tracePath, 'utf8'));
} catch (err) {
  console.error(`Failed to read trace file '${tracePath}':`, err);
  process.exit(2);
}

let overrides: SprtThresholdOverrides = {};
const thresholdsPath = argValue('--thresholds');
if (thresholdsPath) {
  try {
    // 候选阈值同样走严格校验：非法字段被剔除并显式告警。
    overrides = parseSprtThresholdOverrides(JSON.parse(readFileSync(thresholdsPath, 'utf8')));
  } catch (err) {
    console.error(`Failed to read thresholds file '${thresholdsPath}':`, err);
    process.exit(2);
  }
}

const summary = replaySprtTraces(payload, overrides);
const report = formatSprtReplayReport(summary, overrides);
console.log(report);

const outPath = argValue('--out');
if (outPath) {
  writeFileSync(outPath, report, 'utf8');
  console.log(`\nReport written to ${outPath}`);
}

// 回放出现非法 trace 或决策不一致时以非零码退出，便于 CI/脚本断点。
if (summary.errors > 0 || summary.decisionMismatches > 0) {
  process.exit(1);
}
