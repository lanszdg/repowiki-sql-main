#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const args = process.argv.slice(2);
const repo = path.resolve(args[0] || ".");
let intervalSec = 30;
let verbose = false;

for (let i = 1; i < args.length; i++) {
  const a = args[i];
  if (a === "--interval") intervalSec = Number(args[++i] || intervalSec);
  else if (a.startsWith("--interval=")) intervalSec = Number(a.slice("--interval=".length));
  else if (a === "--verbose") verbose = true;
  else {
    console.error(`unknown argument: ${a}`);
    process.exit(2);
  }
}

if (!args[0]) {
  console.error("usage: node repowiki-codegraph-init.cjs <repo> [--interval 30] [--verbose]");
  process.exit(2);
}

const lingxiRoot = path.resolve(__dirname, "..", "..", "..");
const cgNode = path.join(lingxiRoot, "config", "bin", "codegraph", "node.exe");
const cgJs = path.join(lingxiRoot, "config", "bin", "codegraph", "dist", "bin", "codegraph.js");
const repowikiDir = path.join(repo, ".repowiki");
const logsDir = path.join(repowikiDir, "logs");
const stateFile = path.join(repowikiDir, "codegraph-init.json");
const parsersDir = path.join(lingxiRoot, "parsers");
const codegraphDb = path.join(repo, ".codegraph", "codegraph.db");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function readTail(file, bytes = 256 * 1024) {
  if (!fs.existsSync(file)) return "";
  const stat = fs.statSync(file);
  const size = Math.min(stat.size, bytes);
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, Math.max(0, stat.size - size));
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function parseProgress(text) {
  const clean = String(text || "").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
  const lines = clean.split(/[\r\n]+/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  let progress = null;
  let phase = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const m = line.match(/\b(Scanning files|Parsing code|Resolving refs|Storing data|Indexing files|Indexed files)\b.*?\b(\d{1,3})%/i)
      || line.match(/\b(\d{1,3})%\b.*?\b(Scanning files|Parsing code|Resolving refs|Storing data|Indexing files|Indexed files)\b/i);
    if (!m) continue;
    const firstIsPercent = /^\d/.test(m[1]);
    progress = Number(firstIsPercent ? m[1] : m[2]);
    phase = firstIsPercent ? m[2] : m[1];
    break;
  }
  return { progress, phase, tail: lines.slice(-8) };
}

function summarize(logFile) {
  return parseProgress(readTail(logFile));
}

function hasExplicitDoneText(text) {
  return /(\[OK\]\s+Index is up to date|Already up to date|Indexed\s+[\d,]+\s+files|CodeGraph\s+(init|index).*(complete|done))/i.test(text || "");
}

function hasDoneMarker(summary) {
  return hasExplicitDoneText(summary.tail.join("\n"));
}

function codegraphInitialized() {
  return fs.existsSync(codegraphDb);
}

function statusJson() {
  if (!fs.existsSync(cgNode) || !fs.existsSync(cgJs) || !codegraphInitialized()) return null;
  const r = cp.spawnSync(cgNode, [cgJs, "status", repo, "--json"], {
    cwd: repo,
    env: { ...process.env, OPENCODE_PARSERS_DIR: parsersDir },
    encoding: "utf8",
    shell: false,
    maxBuffer: 16 * 1024 * 1024,
  });
  const out = String(r.stdout || "") || `${r.stdout || ""}\n${r.stderr || ""}`;
  const i = out.indexOf("{");
  const j = out.lastIndexOf("}");
  if (i < 0 || j < i) return null;
  try {
    return JSON.parse(out.slice(i, j + 1));
  } catch (_) {
    return null;
  }
}

if (!fs.existsSync(cgNode) || !fs.existsSync(cgJs)) {
  console.error(`[codegraph-init] codegraph runtime not found under ${lingxiRoot}`);
  process.exit(2);
}

fs.mkdirSync(logsDir, { recursive: true });
const env = { ...process.env, OPENCODE_PARSERS_DIR: parsersDir };
const intervalMs = Math.max(5, intervalSec || 30) * 1000;
const progressStep = verbose ? 1 : 2;
const heartbeatMs = verbose ? intervalMs : 60 * 1000;

function updateState(base, status, extra = {}) {
  const logFile = base.logFile || "";
  const s = summarize(logFile);
  const tail = s.tail.length ? s.tail : (base.tail || []);
  const statusInfo = status === "done" ? statusJson() : null;
  const progress = status === "done" ? 100 : (s.progress !== null ? s.progress : (base.progress ?? null));
  const phase = status === "done" ? "Done" : (s.phase || base.phase || "");
  const next = {
    status,
    repo,
    pid: base.pid || 0,
    command: base.command || [],
    logFile,
    progress,
    phase,
    tail,
    started_at: base.started_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    fileCount: statusInfo ? statusInfo.fileCount : (base.fileCount || 0),
    nodeCount: statusInfo ? statusInfo.nodeCount : (base.nodeCount || 0),
    pendingChanges: statusInfo ? statusInfo.pendingChanges : (base.pendingChanges || {}),
    ...extra,
  };
  writeJson(stateFile, next);
  return next;
}

function progressText(state) {
  const pct = state.progress === null || state.progress === undefined ? "?" : state.progress;
  const bar = pct === "?"
    ? "[--------------------]"
    : `[${"#".repeat(Math.round(Number(pct) / 5))}${"-".repeat(20 - Math.round(Number(pct) / 5))}]`;
  return `${bar} ${pct}% ${state.phase || "unknown"}`;
}

function printStart(prefix, state) {
  console.log(`[codegraph-init] ${prefix} pid=${state.pid || "-"} log=${path.basename(state.logFile || "-")}`);
  console.log(`[codegraph-init] progress prints on phase change, +${progressStep}%, or heartbeat. Use repowiki-progress.cjs for a snapshot.`);
}

function printState(prefix, state) {
  console.log(`[codegraph-init] ${prefix} ${progressText(state)}`);
  if (prefix === "done") {
    console.log(`NEXT: L1 建图完成。禁止输出 text-only response 停下，必须立即运行 L2 枚举模块：`);
    console.log(`  node "${path.join(__dirname, "list-services.cjs")}" "${repo}" --profile auto`);
  }
}

function shouldPrint(last, state, force = false) {
  if (force || !last) return true;
  const progress = state.progress === null || state.progress === undefined ? null : Number(state.progress);
  const lastProgress = last.progress === null || last.progress === undefined ? null : Number(last.progress);
  if ((state.phase || "") !== (last.phase || "")) return true;
  if (progress !== null && lastProgress !== null && Math.abs(progress - lastProgress) >= progressStep) return true;
  if (progress !== null && lastProgress === null) return true;
  return Date.now() - last.printedAt >= heartbeatMs;
}

function rememberPrinted(state) {
  return {
    progress: state.progress,
    phase: state.phase,
    printedAt: Date.now(),
  };
}

function commandArgs() {
  if (codegraphInitialized()) {
    return [cgJs, "index", repo];
  }
  return [cgJs, "init", repo, "--index"];
}

function finishDone(base, reason) {
  return updateState(base, "done", reason ? { reason } : {});
}

function startBackground(resumeReason = "") {
  const logFile = path.join(logsDir, `codegraph-init-${stamp()}.log`);
  const outFd = fs.openSync(logFile, "a");
  const cmdArgs = commandArgs();
  const command = [cgNode, ...cmdArgs];
  const child = cp.spawn(cgNode, cmdArgs, {
    cwd: repo,
    env,
    detached: true,
    stdio: ["ignore", outFd, outFd],
    windowsHide: true,
  });
  child.unref();

  const startedAt = new Date().toISOString();
  const state = updateState({
    repo,
    pid: child.pid,
    command,
    logFile,
    progress: null,
    phase: "",
    tail: [],
    started_at: startedAt,
  }, "running", resumeReason ? { resumeReason } : {});
  fs.closeSync(outFd);

  const startLabel = cmdArgs[1] === "index" ? "index-started" : "init-started";
  printStart(startLabel, state);
  return state;
}

function monitorUntilDone(initialState) {
  let state = initialState;
  let lastPrinted = rememberPrinted(state);

  while (true) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, intervalMs);

    const latest = readJson(stateFile, state) || state;
    const summary = summarize(latest.logFile || "");
    const hydrated = {
      ...latest,
      progress: summary.progress !== null ? summary.progress : latest.progress,
      phase: summary.phase || latest.phase || "",
      tail: summary.tail.length ? summary.tail : (latest.tail || []),
      updated_at: new Date().toISOString(),
    };

    if (hydrated.status === "done") {
      const done = finishDone(hydrated, "state already done");
      if (shouldPrint(lastPrinted, done, true)) printState("done", done);
      process.exit(0);
    }

    if (hydrated.status === "failed") {
      const failed = updateState(hydrated, "failed");
      printState("failed", failed);
      process.exit(1);
    }

    if (hydrated.status === "running" && isAlive(hydrated.pid)) {
      state = updateState(hydrated, "running");
      if (shouldPrint(lastPrinted, state)) {
        printState("running", state);
        lastPrinted = rememberPrinted(state);
      }
      continue;
    }

    const s = summarize(hydrated.logFile || "");
    if (hasDoneMarker(s)) {
      const done = finishDone(hydrated, "process exited after completion marker");
      printState("done", done);
      process.exit(0);
    }

    state = startBackground("previous running process is gone without completion marker; continuing index automatically");
    lastPrinted = rememberPrinted(state);
  }
}

// PL/SQL repo 检测：codegraph 不支持 PL/SQL，跳过 codegraph，运行 plsql-l1-producer
function isPlsqlOnlyRepo() {
  let plsql = 0, java = 0, go = 0;
  function scan(dir) {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) scan(p);
      else if (/\.(pks|pkb|sql)$/i.test(e.name)) plsql++;
      else if (/\.java$/i.test(e.name)) java++;
      else if (/\.go$/i.test(e.name)) go++;
    }
  }
  scan(repo);
  return plsql > 0 && java === 0 && go === 0;
}

function runPlsqlL1Producer() {
  const producerScript = path.join(__dirname, "lib", "plsql-l1-producer.cjs");
  if (!fs.existsSync(producerScript)) {
    console.error(`[codegraph-init] PL/SQL repo detected but plsql-l1-producer.cjs not found: ${producerScript}`);
    process.exit(2);
  }
  console.log("[codegraph-init] PL/SQL repo detected, running plsql-l1-producer instead of codegraph");
  const r = cp.spawnSync(process.execPath, [producerScript, repo], {
    cwd: repo,
    encoding: "utf8",
    shell: false,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) {
    console.error(`[codegraph-init] plsql-l1-producer failed (exit ${r.status})`);
    console.error(r.stderr || "");
    process.exit(1);
  }
  console.log(r.stdout || "");
  // 写 state done
  const producer = require(producerScript);
  const data = producer.produce(repo);
  writeJson(stateFile, {
    status: "done",
    repo,
    pid: 0,
    command: [process.execPath, producerScript, repo],
    logFile: "",
    progress: 100,
    phase: "Done (plsql-l1-producer)",
    tail: [],
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    fileCount: data.counts.files,
    nodeCount: data.counts.nodes,
    pendingChanges: {},
    backend: "plsql-l1-producer",
  });
  console.log("[codegraph-init] plsql-l1.json generated, status=done");
  console.log(`NEXT: L1 建图完成。禁止输出 text-only response 停下，必须立即运行 L2 枚举模块：`);
  console.log(`  node "${path.join(__dirname, "list-services.cjs")}" "${repo}" --profile auto`);
  process.exit(0);
}

(function main() {
  // PL/SQL repo 快捷路径
  if (isPlsqlOnlyRepo()) {
    runPlsqlL1Producer();
    return;
  }

  const previous = readJson(stateFile, null);
  if (previous) {
    const summary = summarize(previous.logFile || "");
    const hydrated = {
      ...previous,
      progress: summary.progress !== null ? summary.progress : previous.progress,
      phase: summary.phase || previous.phase || "",
      tail: summary.tail.length ? summary.tail : (previous.tail || []),
      updated_at: new Date().toISOString(),
    };

    if (previous.status === "running" && isAlive(previous.pid)) {
      const running = updateState(hydrated, "running");
      printStart("attached", running);
      monitorUntilDone(running);
      return;
    }

    if (previous.status === "running" && !isAlive(previous.pid)) {
      monitorUntilDone(startBackground("previous running process is gone; continuing index automatically"));
      return;
    }
  }

  monitorUntilDone(startBackground(""));
})();
