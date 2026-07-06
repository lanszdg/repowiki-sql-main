#!/usr/bin/env node
"use strict";

// repowiki-run.cjs — 顶层确定性编排器（0626 基线）
//
// 把 SKILL.md 的"LLM 按 7 步串脚本"下沉为 Node.js 状态机串脚本。
// 纯外壳: execFileSync 现有 .cjs + spawn progress.cjs 解析判定 + 写 run-summary.json。
// 不 require lib、不重写判定、不生成正文、不碰 L3 worker 语义。
//
// 契约见同目录 repowiki-run-设计文档.md（A 段 20 条逐条复刻）。
// 用法: node repowiki-run.cjs <repo> [--from <stage>] [--verbose]
//   默认从 <repo>/.repowiki/run-summary.json 的 currentStage 续; --from 覆盖。
//   被 opencode bash 超时 kill 后, 重跑同命令从 currentStage 续（与 codegraph-init 接续同构）。

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const skillDir = __dirname;
const packageRoot = path.resolve(skillDir, "..", "..", "..");
const argv = process.argv.slice(2);

function usage() {
  console.error("usage: node repowiki-run.cjs <repo> [--from <stage>] [--verbose] [--source-facts-golden <file>] [--source-facts-gate-only]");
  console.error("  stage: l1|list|l2|merge|l3sched|l3disp|done");
  console.error("  默认从 .repowiki/run-summary.json 的 currentStage 续; --from 覆盖");
  process.exit(2);
}

if (!argv[0] || argv[0].startsWith("-")) usage();
const repo = path.resolve(argv[0]);
const verbose = argv.includes("--verbose") || argv.includes("-v");
const sourceFactsGateOnly = argv.includes("--source-facts-gate-only");
let fromStage = "";
{ const i = argv.indexOf("--from"); if (i > -1) fromStage = argv[i + 1] || ""; }
function argValue(name, fallback = "") {
  const i = argv.indexOf(name);
  return i > -1 ? (argv[i + 1] || fallback) : fallback;
}
const sourceFactsGoldenArg = argValue("--source-facts-golden", "");

const repowikiDir = path.join(repo, ".repowiki");
const logsDir = path.join(repowikiDir, "logs");
const runSummaryFile = path.join(repowikiDir, "run-summary.json");

// A1/A6/A10/A12/A14/A17: 逐字复刻 SKILL.md 的命令与参数
const STEPS = {
  l1:      { script: "repowiki-codegraph-init.cjs", args: [repo, "--interval", "30"] }, // A1
  list:    { script: "list-services.cjs",          args: [repo, "--profile", "auto"] }, // A6
  l2:      { script: "repowiki-l2.cjs",            args: [repo, "--all"] },             // A10
  merge:   { script: "merge-knowledge.cjs",        args: [path.join(repowikiDir, "knowledge")] }, // A12
  l3sched: { script: "repowiki-l3-scheduler.cjs",  args: [repo, "--concurrency", "20"] }, // A14 (显式 20, 覆盖代码默认 8)
  l3disp:  { script: "repowiki-l3-dispatcher.cjs", args: [repo] },                      // A17
};
const VALID_STAGES = ["l1", "list", "l2", "merge", "l3sched", "l3disp", "done"];
if (fromStage && !VALID_STAGES.includes(fromStage)) { console.error(`unknown --from stage: ${fromStage}`); usage(); }

function nowIso() { return new Date().toISOString(); }
function readJson(file, fb) {
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")); }
  catch { return fb; }
}
function ensureDirs() {
  fs.mkdirSync(repowikiDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
}
function loadSummary() {
  const s = readJson(runSummaryFile, null);
  if (s && s.currentStage && VALID_STAGES.includes(s.currentStage)) return s;
  return { schemaVersion: 1, repo, currentStage: "l1", history: [] };
}
function saveSummary(s) {
  s.updatedAt = nowIso();
  fs.writeFileSync(runSummaryFile, JSON.stringify(s, null, 2), "utf8");
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}
function fileExists(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }

// 同步跑一个 stage 的 .cjs; stdout/stderr 全写日志, 控制台只打摘要
function spawnStep(stage) {
  const step = STEPS[stage];
  const script = path.join(skillDir, step.script);
  if (!fileExists(script)) { console.error(`[run] script not found: ${script}`); process.exit(2); }
  const startedAt = nowIso();
  const logFile = path.join(logsDir, `repowiki-run-${stage}.log`);
  const logStream = fs.createWriteStream(logFile, { flags: "a" });
  logStream.write(`\n[run] stage=${stage} script=${step.script} args=${JSON.stringify(step.args)} started=${startedAt}\n`);
  console.log(`[run] stage=${stage} -> ${step.script}`);
  const r = childProcess.spawnSync(process.execPath, [script, ...step.args], {
    cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "inherit", "inherit"],
  });
  logStream.write(`[run] stage=${stage} status=${r.status} signal=${r.signal || "-"} ended=${nowIso()}\n`);
  logStream.end();
  console.log(`[run] ${stage} status=${r.status} signal=${r.signal || "-"}`);
  return { stage, status: r.status, signal: r.signal, stdout: r.stdout || "", stderr: r.stderr || "", startedAt, endedAt: nowIso() };
}

// A3/A11/A19/A20: 判定委托 progress.cjs, 不重写
function progressOut(phase, line) {
  const script = path.join(skillDir, "repowiki-progress.cjs");
  const pa = [script, repo];
  if (phase) pa.push(phase);
  if (line) pa.push("--line");
  const r = childProcess.spawnSync(process.execPath, pa, {
    cwd: repo, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });
  return ((r.stdout || "") + (r.stderr ? "\n" + r.stderr : "")).trim();
}
function stageDone(phase) {
  const out = progressOut(phase, phase === "l3"); // l3 用 --line 拿 PROGRESS 行(含 status=ALL_DONE + fakeDone)
  let done, fakeDone = 0;
  if (phase === "l3") {
    done = out.includes("status=ALL_DONE") || out.includes("ALL_DONE l3");
    const m = out.match(/fakeDone=(\d+)/);
    fakeDone = Number((m && m[1]) || 0);
  } else {
    done = out.includes(`ALL_DONE ${phase}`);
  }
  return { done, fakeDone, out };
}
function profileMismatch() { return fs.existsSync(path.join(repowikiDir, "profile-mismatch.json")); }

function runStage(stage, s) {
  s.currentStage = stage;                       // 先写 currentStage, 被 kill 后重跑续
  s.lastStep = { stage, startedAt: nowIso(), result: "running" };
  saveSummary(s);
  const r = spawnStep(stage);
  const result = (r.status === 0) ? "done" : (r.signal ? "killed" : "failed");
  s.lastStep = { stage, startedAt: r.startedAt, endedAt: r.endedAt, exitCode: r.status, signal: r.signal || "", result };
  s.history.push({ stage, result, exitCode: r.status, signal: r.signal || "", at: r.endedAt });
  saveSummary(s);
  return r;
}

function stop(msg, s, code) {
  console.log(`[run] STOP: ${msg}`);
  s.lastStep = Object.assign({}, s.lastStep || {}, { result: "gate", detail: msg });
  saveSummary(s);
  process.exit(code == null ? 1 : code);
}

function sourceFactsGoldenFile() {
  if (sourceFactsGoldenArg) return path.resolve(sourceFactsGoldenArg);
  const defaultGolden = path.join(repowikiDir, "source-facts-golden.json");
  return fileExists(defaultGolden) ? defaultGolden : "";
}

function runSourceFactsGate(s) {
  const gateDir = path.join(repowikiDir, "diagnostics", "source-facts");
  const gateFile = path.join(gateDir, "source-facts-gate.json");
  const reportFile = path.join(gateDir, "source-facts-report.json");
  const repairTicketsFile = path.join(gateDir, "repair-tickets.json");
  const goldenFile = sourceFactsGoldenFile();
  if (!goldenFile) {
    const gate = {
      schemaVersion: 1,
      reportType: "source-facts-run-gate",
      status: "SKIP",
      ok: true,
      generatedAt: nowIso(),
      skipReason: "source-facts golden not configured",
      inputs: {
        defaultGolden: path.relative(repo, path.join(repowikiDir, "source-facts-golden.json")),
      },
    };
    writeJson(gateFile, gate);
    console.log(`[run] source-facts gate SKIP: ${gate.skipReason}`);
    return { ok: true, skipped: true, gateFile };
  }

  const plsqlL1 = path.join(repowikiDir, "plsql-l1.json");
  const functions = path.join(repowikiDir, "knowledge", "functions.json");
  const repairs = path.join(repowikiDir, "knowledge", "source-facts-repairs.json");
  const script = path.join(skillDir, "plsql-source-facts-eval.cjs");
  const args = [
    script,
    "--source", repo,
    "--golden", goldenFile,
    "--plsql-l1", plsqlL1,
    "--functions", functions,
    "--out", gateDir,
    "--strict",
  ];
  if (fs.existsSync(repairs)) args.splice(args.length - 1, 0, "--repairs", repairs);
  const r = childProcess.spawnSync(process.execPath, args, {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ok = r.status === 0;
  const gate = {
    schemaVersion: 1,
    reportType: "source-facts-run-gate",
    status: ok ? "PASS" : "FAIL",
    ok,
    generatedAt: nowIso(),
    command: [process.execPath, ...args].join(" "),
    cwd: repo,
    exitCode: r.status,
    signal: r.signal || "",
    inputs: {
      golden: goldenFile,
      plsqlL1,
      functions,
      reportFile,
      repairTicketsFile,
    },
  };
  writeJson(gateFile, gate);
  if (ok) {
    console.log(`[run] source-facts gate PASS report=${reportFile}`);
  } else {
    console.log(`[run] source-facts gate failed report=${reportFile} repairTickets=${repairTicketsFile}`);
    if (verbose && (r.stdout || r.stderr)) console.log(`${r.stdout || ""}${r.stderr || ""}`);
  }
  if (s) {
    s.sourceFactsGate = {
      status: gate.status,
      reportFile,
      repairTicketsFile,
      at: gate.generatedAt,
    };
    saveSummary(s);
  }
  return { ok, skipped: false, gateFile, reportFile, repairTicketsFile, exitCode: r.status };
}

// ── main: 状态机复刻 A 段 20 条 ──
ensureDirs();
let s = loadSummary();
if (fromStage) s.currentStage = fromStage;
console.log(`[run] repo=${repo} startStage=${s.currentStage} ${s.updatedAt ? "resume@" + s.updatedAt : "fresh"}`);

if (sourceFactsGateOnly) {
  const gate = runSourceFactsGate(s);
  process.exit(gate.ok ? 0 : 20);
}

let stage = s.currentStage;
while (stage !== "done") {
  switch (stage) {
    case "l1": {                                   // A1-A5
      runStage("l1", s);
      const d = stageDone("l1");                   // A3
      if (d.done) { stage = "list"; break; }       // A5
      stop(`L1 未完成. 看 .repowiki/codegraph-init.json status; 若超时被 kill, 重跑 node repowiki-run.cjs <repo> 续`, s); // A4
    }
    case "list": {                                 // A6-A9
      runStage("list", s);
      if (profileMismatch()) stop(`profile-mismatch.json 存在: 补 L2 profile/adapter 后从 --from list 重跑`, s); // A8
      if (!fileExists(path.join(repowikiDir, "modules.json"))) stop(`modules.json 未生成`, s);
      stage = "l2"; break;                         // A9
    }
    case "l2": {                                   // A10-A11
      const r = runStage("l2", s);
      if (r.status !== 0) stop(`L2 抽取异常 exit=${r.status} signal=${r.signal || "-"}`, s);
      // L2 完成判定: l2 --all 跑完 + parts 有产物。不查 progress l2 ALL_DONE:
      // l2-completeness/l2-schema-report 由 merge 写(merge:461/555), merge 前不存在, progress 会判 missing 非 ALL_DONE
      let partsCount = 0;
      try { partsCount = fs.readdirSync(path.join(repowikiDir, "knowledge", "parts")).filter(f => f.endsWith(".json")).length; } catch {}
      if (partsCount === 0) stop(`L2 未产出 parts (knowledge/parts/*.json)`, s);
      stage = "merge"; break;                     // A11
    }
    case "merge": {                                // A12
      const r = runStage("merge", s);
      if (r.status !== 0) stop(`merge 异常 exit=${r.status} signal=${r.signal || "-"}`, s);
      // merge 完成判定: services.json/functions.json 产出。与 SKILL.md 一致, 不在 merge 后卡 L2 completeness
      if (!fileExists(path.join(repowikiDir, "knowledge", "services.json")) ||
          !fileExists(path.join(repowikiDir, "knowledge", "functions.json")))
        stop(`merge 未产出 services.json/functions.json`, s);
      stage = "l3sched"; break;
    }
    case "l3sched": {                              // A13-A16
      const sourceGate = runSourceFactsGate(s);
      if (!sourceGate.ok) stop(`source-facts gate failed: repairTickets=${sourceGate.repairTicketsFile}`, s, 20);
      console.log(progressOut(""));                // A13: 打印阶段状态
      runStage("l3sched", s);                      // A14, A15(不传 --l3-skill)
      if (!fileExists(path.join(repowikiDir, "l3-scheduler", "tasks.json")) ||
          !fileExists(path.join(repowikiDir, "l3-scheduler", "state.json")))
        stop(`scheduler 未生成 tasks/state`, s);
      stage = "l3disp"; break;                     // A16
    }
    case "l3disp": {                               // A17-A20
      runStage("l3disp", s);                       // A17 (dispatcher 自管并发 A18)
      const d = stageDone("l3");
      if (d.done && d.fakeDone === 0) { stage = "done"; break; } // A19
      if (d.fakeDone > 0) stop(`fakeDone=${d.fakeDone}: state 标完成但产物缺失, 需 L3 子 Agent 重新领取(worker 加厚后处理)`, s); // A20
      stop(`L3 未完成(failed 堆积或 ALL_DONE 未达). 看 .repowiki/l3-scheduler/state.json`, s);
    }
    default:
      stop(`unknown stage: ${stage}`, s);
  }
}

// done: 完整性校验 (A19)
console.log("[run] 完整性校验");
console.log(progressOut(""));
const l3 = stageDone("l3");
if (!l3.done || l3.fakeDone > 0) stop(`最终 ALL_DONE l3 未达`, s);
s.currentStage = "done";
s.lastStep = { stage: "done", result: "done", endedAt: nowIso() };
saveSummary(s);
console.log(`[run] ALL_DONE. run-summary: ${runSummaryFile}`);
// 自动统计: 耗时 + token (repowiki-stats.cjs)
try {
  const statsScript = path.join(skillDir, "repowiki-stats.cjs");
  console.log("\n[run] === 统计 ===");
  childProcess.spawnSync(process.execPath, [statsScript, repo], { cwd: packageRoot, stdio: "inherit" });
} catch (e) { console.error("[run] stats failed:", e.message); }
process.exit(0);
