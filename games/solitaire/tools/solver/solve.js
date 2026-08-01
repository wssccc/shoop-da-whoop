#!/usr/bin/env node
// CLI: solve a Solitaire layout and print the solution.
//
// Usage:
//   node solve.js [--input <file>] [--json] [--verify] [--no-compress] [--quiet]
//
// Default input: layout.txt next to this script.
// The raw search path is post-processed by compress.js (state-level cycle
// removal + "park then fetch" compaction, every rewrite re-verified) so the
// printed solution has no wasted moves.
// `--verify` re-simulates the printed solution from scratch and asserts the
// final board satisfies isWin — the solver only ever emits legal moves, so this
// is a safety net against a porting mistake in the search/format layer.
//
// Run from repo root:  node games/solitaire/tools/solver/solve.js

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compressSteps } from './compress.js';
import { formatSteps, keyStepIndices, replay } from './format.js';
import { parseLayout } from './parse.js';
import * as Rules from './rules.js';
import { solve } from './search.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function args(argv) {
  const o = { input: null, json: false, verify: false, quiet: false, compress: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') o.input = argv[++i];
    else if (a === '--json') o.json = true;
    else if (a === '--verify') o.verify = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--no-compress') o.compress = false;
    else if (!o.input && !a.startsWith('--')) o.input = a;
  }
  return o;
}

async function main() {
  const opts = args(process.argv);
  const file = opts.input || join(__dirname, 'layout.txt');
  const text = readFileSync(file, 'utf8');

  const initial = parseLayout(text);

  if (!opts.quiet && !opts.json) {
    console.log(`初始状态已解析（${file}）`);
    console.log('开始求解…（beam 8 → 24 → 全量 → 随机重启 ×2；节点上限 27M / 约 11 分钟）\n');
  }

  const t0 = Date.now();
  const res = solve(initial, {
    onAttempt: (i, total, beam, nodes, elapsed) => {
      if (!opts.quiet && !opts.json) {
        console.log(`  第 ${i}/${total} 档（beam ${beam}）：${nodes} 节点 / ${elapsed} ms`);
      }
    },
  });
  const elapsed = Date.now() - t0;

  if (!opts.quiet && !opts.json) {
    console.log(`搜索耗时：${elapsed} ms，访问节点：${res.nodes}${res.ok ? '' : `，最大进展：${res.bestProgress}/68`}`);
  }

  if (!res.ok) {
    console.error(`\n✗ 未能找到解（${res.reason === 'budget' ? '超出预算' : '确认无可行解'}）。`);
    process.exit(2);
  }

  // Post-process: state-level dedup / compaction of wasted moves.
  let steps = res.steps;
  if (opts.compress) {
    const comp = compressSteps(initial, res.steps);
    if (!comp.win) {
      console.error('\n✗ 压缩后重放校验失败，已回退原始解。');
      process.exit(3);
    }
    steps = comp.steps;
    if (!opts.quiet && !opts.json) {
      console.log(
        `压缩去重：${comp.before} → ${comp.after} 步（减少 ${comp.before - comp.after} 步）｜残留可逆步：${comp.reversibleLeft}`,
      );
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({ ok: true, steps, nodes: res.nodes, keySize: res.keySize, elapsedMs: elapsed }));
    return;
  }

  // Build per-step snapshots so friendly labels show the real receiving card,
  // and mark irreversible key steps (★) in the printed lines.
  const rep = replay(initial, steps, { commit: Rules });
  const keySet = keyStepIndices(initial, steps, { commit: Rules });
  const lines = formatSteps(steps, rep.snapshots, keySet);
  for (const l of lines) console.log(l.text);

  console.log(`\n共 ${lines.filter((l) => l.kind !== 'auto' && l.kind !== 'auto-lead').length} 步玩家操作（另有自动归位 ${steps.reduce((n, s) => n + s.auto.length, 0)} 步）。`);
  console.log(`重放校验：${rep.win ? '✓ 最终棋盘满足胜利条件' : '✗ 未达到胜利'}`);

  if (opts.verify && !rep.win) process.exit(3);
}

main().catch((e) => {
  console.error('solve failed:', e.stack || e.message);
  process.exit(1);
});
