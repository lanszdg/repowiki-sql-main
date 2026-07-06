#!/usr/bin/env node
"use strict";

// repowiki-stats.cjs — 统计每 stage 耗时 + L3 token 消耗
// 用法: node repowiki-stats.cjs <仓根>
//   耗时: 从 .repowiki/run-summary.json 的 history[].at 算相邻差
//   token: spawn `opencode stats --days 1` 解析 (今天近似, 含今天所有 opencode session)
//   L1/list/l2/merge/l3sched 是确定性 .cjs, 0 LLM token; 只有 l3disp 的 worker 调 glm-5.2 消耗 token

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const repo = path.resolve(process.argv[2] || ".");
const skillDir = __dirname;
const packageRoot = path.resolve(skillDir, "..", "..", "..");
const repowikiDir = path.join(repo, ".repowiki");
const runSummaryFile = path.join(repowikiDir, "run-summary.json");

function readJson(f, fb) {
  try { return JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "")); } catch { return fb; }
}
function fmtMs(ms) {
  if (ms == null) return "?";
  if (ms < 1000) return ms + "ms";
  if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
  return (ms / 60000).toFixed(2) + "min";
}
function fmtTok(n) {
  if (n == null) return "?";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

// ── 1. 每 stage 耗时 (from run-summary) ──
const s = readJson(runSummaryFile, null);
if (!s) { console.error("[stats] run-summary.json not found: " + runSummaryFile); process.exit(1); }

console.log("=== 每 stage 耗时 ===");
const hist = s.history || [];
let prevAt = null;
const stages = [];
for (const h of hist) {
  const at = new Date(h.at).getTime();
  const dur = prevAt != null ? (at - prevAt) : 0;
  stages.push({ stage: h.stage, dur });
  console.log(`  ${h.stage.padEnd(8)} ${fmtMs(dur).padStart(10)}  (${h.result})`);
  prevAt = at;
}
if (s.lastStep) {
  const ls = s.lastStep;
  let dur = null;
  if (ls.endedAt) dur = new Date(ls.endedAt).getTime() - new Date(ls.startedAt).getTime();
  else if (prevAt) dur = Date.now() - new Date(ls.startedAt).getTime();
  stages.push({ stage: ls.stage, dur });
  console.log(`  ${ls.stage.padEnd(8)} ${fmtMs(dur).padStart(10)}  (${ls.result})`);
}
const totalMs = stages.reduce((n, x) => n + (x.dur || 0), 0);
console.log(`  ${"TOTAL".padEnd(8)} ${fmtMs(totalMs).padStart(10)}`);

// ── 2. L3 token (opencode stats --days 1, 今天近似) ──
console.log("\n=== L3 token (opencode stats --days 1, 今天近似) ===");
console.log("  注: 含今天所有 opencode session (不只本次 run.cjs); L1-list-l2-merge-sched=0 LLM token");
const ocexe = path.join(packageRoot, "bin", process.platform === "win32" ? "opencode.exe" : "opencode");
const env = {
  ...process.env,
  OPENCODE_PARSERS_DIR: path.join(packageRoot, "parsers"),
  OPENCODE_CONFIG_DIR: path.join(packageRoot, "config"),
  OPENCODE_DISABLE_AUTOUPDATE: "true",
  OPENCODE_DISABLE_MODELS_FETCH: "true",
};
try {
  const r = childProcess.spawnSync(ocexe, ["stats", "--days", "1"], {
    cwd: packageRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"], env, timeout: 30000,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  if (process.env.REPOWIKI_STATS_DEBUG) console.log("  [debug] stats stdout (900 chars):\n" + (r.stdout || "").slice(0, 900));
  function pick(label) {
    const re = new RegExp(label + ":?\\s+\\$?([\\d.]+)\\s*([MK]?)", "i");
    const m = out.match(re);
    if (!m) return null;
    let n = parseFloat(m[1]);
    if (m[2] === "M") n *= 1e6;
    else if (m[2] === "K") n *= 1e3;
    return n;
  }
  const sessions = pick("Sessions");
  const ti = pick("Input");
  const to = pick("Output");
  const tcr = pick("Cache Read");
  const tcw = pick("Cache Write");
  const cost = pick("Total Cost");
  console.log(`  sessions(今天): ${sessions != null ? sessions.toLocaleString() : "?"}`);
  console.log(`  tokens_input:   ${fmtTok(ti)}`);
  console.log(`  tokens_output:  ${fmtTok(to)}`);
  console.log(`  cache_read:     ${fmtTok(tcr)}`);
  console.log(`  cache_write:    ${fmtTok(tcw)}`);
  console.log(`  cost:           $${cost != null ? cost.toFixed(4) : "?"}`);
  const total = (ti || 0) + (to || 0) + (tcr || 0) + (tcw || 0);
  console.log(`  total tokens:   ${fmtTok(total)}`);
} catch (e) {
  console.error("  [opencode stats] failed:", e.message);
}
