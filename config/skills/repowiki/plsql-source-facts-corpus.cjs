"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const childProcess = require("child_process");
const https = require("https");

const REPORT_NAME = "source-facts-corpus-report.json";
const ROOT = __dirname;
const L1_CLI = path.join(ROOT, "lib", "plsql-l1-producer.cjs");
const L2_CLI = path.join(ROOT, "repowiki-l2.cjs");
const EVAL_CLI = path.join(ROOT, "plsql-source-facts-eval.cjs");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (key === "strict") {
      args.strict = true;
    } else {
      args[key] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isGithubUrl(value) {
  return /^https:\/\/(?:github\.com|raw\.githubusercontent\.com)\//i.test(clean(value));
}

function toRawGithubUrl(url) {
  const value = clean(url);
  const blob = value.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i);
  if (blob) {
    return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}/${blob[4]}`;
  }
  return value;
}

function resolveMaybeRelative(baseDir, file) {
  const value = clean(file);
  if (!value) return "";
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

function commandLine(script, args) {
  return [process.execPath, script, ...args].map((part) => String(part).includes(" ") ? `"${part}"` : String(part)).join(" ");
}

function runNode(script, args, cwd) {
  const result = childProcess.spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    command: commandLine(script, args),
    status: result.status == null ? 1 : result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function downloadText(url) {
  return new Promise((resolve, reject) => {
    https.get(toRawGithubUrl(url), (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadText(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} ${url}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.setEncoding("utf8");
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(chunks.join("")));
    }).on("error", reject);
  });
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      copyRecursive(path.join(src, entry.name), path.join(dest, entry.name));
    }
  } else {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
  }
}

async function materializeSourceFile(fileSpec, sourceDir, manifestDir) {
  const targetPath = clean(fileSpec.targetPath || path.basename(clean(fileSpec.localPath || fileSpec.sourceUrl || "")));
  if (!targetPath || targetPath.includes("..")) {
    throw new Error(`invalid targetPath: ${targetPath}`);
  }
  const dest = path.join(sourceDir, targetPath);
  ensureDir(path.dirname(dest));
  if (fileSpec.localPath) {
    const src = resolveMaybeRelative(manifestDir, fileSpec.localPath);
    if (!fs.existsSync(src)) throw new Error(`localPath not found: ${src}`);
    copyRecursive(src, dest);
    return { targetPath, sourceUrl: fileSpec.sourceUrl || "", mode: "local-copy" };
  }
  if (!fileSpec.sourceUrl) throw new Error(`sourceUrl or localPath is required for ${targetPath}`);
  fs.writeFileSync(dest, await downloadText(fileSpec.sourceUrl), "utf8");
  return { targetPath, sourceUrl: fileSpec.sourceUrl, mode: "github-download" };
}

function validationFailure(caseId, code, message, pathValue) {
  return {
    case_id: caseId || "corpus",
    error_code: code,
    path: pathValue || "",
    message,
  };
}

function validateCase(caseRow, manifestDir) {
  const failures = [];
  const caseId = clean(caseRow.id);
  if (!caseId) failures.push(validationFailure(caseId, "CASE_ID_MISSING", "case.id is required", "cases[].id"));
  if (!isGithubUrl(caseRow.repo)) {
    failures.push(validationFailure(caseId, "PROVENANCE_MISSING", "case.repo must be a public GitHub URL", `cases.${caseId}.repo`));
  }
  if (!clean(caseRow.license)) {
    failures.push(validationFailure(caseId, "PROVENANCE_MISSING", "case.license is required", `cases.${caseId}.license`));
  }
  if (asArray(caseRow.coverageTags).length === 0) {
    failures.push(validationFailure(caseId, "PROVENANCE_MISSING", "coverageTags are required", `cases.${caseId}.coverageTags`));
  }
  const sourceFiles = asArray(caseRow.sourceFiles);
  if (sourceFiles.length === 0) {
    failures.push(validationFailure(caseId, "SOURCE_MISSING", "sourceFiles are required", `cases.${caseId}.sourceFiles`));
  }
  for (const [index, sourceFile] of sourceFiles.entries()) {
    if (!isGithubUrl(sourceFile.sourceUrl)) {
      failures.push(validationFailure(caseId, "PROVENANCE_MISSING", "each source file must keep a GitHub sourceUrl", `cases.${caseId}.sourceFiles.${index}.sourceUrl`));
    }
    if (!sourceFile.localPath && !sourceFile.sourceUrl) {
      failures.push(validationFailure(caseId, "SOURCE_MISSING", "sourceUrl or localPath is required", `cases.${caseId}.sourceFiles.${index}`));
    }
  }
  const goldenFile = resolveMaybeRelative(manifestDir, caseRow.golden);
  if (!caseRow.golden || !fs.existsSync(goldenFile)) {
    failures.push(validationFailure(caseId, "GOLDEN_MISSING", "manual golden file is required", `cases.${caseId}.golden`));
  } else {
    try {
      const golden = readJson(goldenFile);
      if (golden.generatedFromActual === true || golden.generated === true) {
        failures.push(validationFailure(caseId, "GOLDEN_GENERATED_FROM_ACTUAL", "golden must be manual, not generated from actual", `cases.${caseId}.golden`));
      }
      if (!golden.expected || typeof golden.expected !== "object") {
        failures.push(validationFailure(caseId, "GOLDEN_MISSING", "golden.expected is required", `cases.${caseId}.golden.expected`));
      }
    } catch (err) {
      failures.push(validationFailure(caseId, "GOLDEN_INVALID", err.message, `cases.${caseId}.golden`));
    }
  }
  return failures;
}

function buildEmptyReport(args, manifest, failures) {
  const ok = failures.length === 0;
  return {
    schemaVersion: 1,
    reportType: "source-facts-github-corpus",
    corpusId: manifest && manifest.corpusId ? manifest.corpusId : "unknown",
    status: ok ? "PASS" : "FAIL",
    ok,
    strict: Boolean(args.strict),
    generatedAt: new Date().toISOString(),
    command: [process.execPath, ...process.argv.slice(1)].join(" "),
    cwd: process.cwd(),
    inputs: {
      manifest: args.manifest || "",
      out: args.out || "",
    },
    metrics: {
      casesTotal: 0,
      casesPassed: 0,
      casesFailed: failures.length ? 1 : 0,
    },
    aggregate: {
      expectedTotal: 0,
      actualTotal: 0,
      matchedTotal: 0,
      recall: 0,
      precision: 0,
    },
    cases: [],
    failures,
  };
}

function aggregateEvalReports(cases) {
  const passed = cases.filter((row) => row.status === "PASS").length;
  const totals = cases.reduce((acc, row) => {
    const metrics = row.evalReport && row.evalReport.metrics ? row.evalReport.metrics : {};
    acc.expectedTotal += Number(metrics.expectedTotal || 0);
    acc.actualTotal += Number(metrics.actualTotal || 0);
    acc.matchedTotal += Number(metrics.matchedTotal || 0);
    return acc;
  }, { expectedTotal: 0, actualTotal: 0, matchedTotal: 0 });
  return {
    metrics: {
      casesTotal: cases.length,
      casesPassed: passed,
      casesFailed: cases.length - passed,
    },
    aggregate: {
      ...totals,
      recall: totals.expectedTotal === 0 ? 1 : totals.matchedTotal / totals.expectedTotal,
      precision: totals.actualTotal === 0 ? 1 : totals.matchedTotal / totals.actualTotal,
    },
  };
}

async function runCase(caseRow, manifestDir, outDir) {
  const caseId = clean(caseRow.id);
  const caseOut = path.join(outDir, "cases", caseId);
  const runDir = path.join(caseOut, "run");
  const sourceDir = path.join(runDir, "src");
  ensureDir(sourceDir);
  const commands = [];
  const failures = [];
  const materialized = [];

  try {
    for (const sourceFile of asArray(caseRow.sourceFiles)) {
      materialized.push(await materializeSourceFile(sourceFile, sourceDir, manifestDir));
    }
  } catch (err) {
    failures.push(validationFailure(caseId, "SOURCE_FETCH_FAILED", err.message, `cases.${caseId}.sourceFiles`));
  }

  const artifacts = {
    sourceDir,
    "plsql-l1": path.join(sourceDir, ".repowiki", "plsql-l1.json"),
    functions: path.join(sourceDir, ".repowiki", "knowledge", "parts", `functions.part-${caseId}.json`),
    evalReport: path.join(caseOut, "source-facts-report.json"),
  };

  if (failures.length === 0) {
    const l1 = runNode(L1_CLI, [sourceDir], ROOT);
    commands.push(l1.command);
    if (l1.status !== 0 || !fs.existsSync(artifacts["plsql-l1"])) {
      failures.push(validationFailure(caseId, "L1_RUN_FAILED", l1.stderr || l1.stdout || "plsql-l1-producer failed", "plsql-l1"));
    }
  }

  if (failures.length === 0) {
    const l2 = runNode(L2_CLI, [sourceDir, sourceDir, caseId, "--profile", "oracle-sp"], ROOT);
    commands.push(l2.command);
    if (l2.status !== 0 || !fs.existsSync(artifacts.functions)) {
      failures.push(validationFailure(caseId, "L2_RUN_FAILED", l2.stderr || l2.stdout || "repowiki-l2 oracle-sp failed", "functions"));
    }
  }

  let evalReport = null;
  if (failures.length === 0) {
    const goldenFile = resolveMaybeRelative(manifestDir, caseRow.golden);
    const evalRun = runNode(EVAL_CLI, [
      "--source", sourceDir,
      "--golden", goldenFile,
      "--plsql-l1", artifacts["plsql-l1"],
      "--functions", artifacts.functions,
      "--out", caseOut,
      "--strict",
    ], ROOT);
    commands.push(evalRun.command);
    if (fs.existsSync(artifacts.evalReport)) {
      evalReport = readJson(artifacts.evalReport);
    }
    if (evalRun.status !== 0 || !evalReport || evalReport.status !== "PASS") {
      failures.push(validationFailure(caseId, "CASE_FAILED", evalRun.stderr || (evalReport && evalReport.failures && evalReport.failures[0] && evalReport.failures[0].message) || "source-to-facts eval failed", "eval"));
    }
  }

  const status = failures.length === 0 ? "PASS" : "FAIL";
  const realRun = fs.existsSync(artifacts["plsql-l1"]) &&
    fs.existsSync(artifacts.functions) &&
    commands.some((cmd) => cmd.includes("plsql-l1-producer.cjs")) &&
    commands.some((cmd) => cmd.includes("repowiki-l2.cjs"));
  const result = {
    id: caseId,
    repo: caseRow.repo,
    license: caseRow.license,
    sampleMode: caseRow.sampleMode || "",
    coverageTags: asArray(caseRow.coverageTags),
    status,
    ok: status === "PASS",
    realRun,
    commands,
    artifacts,
    materializedSourceFiles: materialized,
    evalReport,
    failures,
  };
  writeJson(path.join(caseOut, "case-run-report.json"), result);
  return result;
}

async function runCorpus(args) {
  const failures = [];
  const manifestPath = args.manifest ? path.resolve(args.manifest) : "";
  const outDir = path.resolve(args.out || path.join(".repowiki", "diagnostics", "source-facts-github-corpus"));
  ensureDir(outDir);

  let manifest = null;
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    failures.push(validationFailure("corpus", "MANIFEST_MISSING", "--manifest is required and must exist", "manifest"));
    const report = buildEmptyReport(args, manifest, failures);
    writeJson(path.join(outDir, REPORT_NAME), report);
    return report;
  }

  const manifestDir = path.dirname(manifestPath);
  try {
    manifest = readJson(manifestPath);
  } catch (err) {
    failures.push(validationFailure("corpus", "MANIFEST_INVALID", err.message, "manifest"));
    const report = buildEmptyReport(args, manifest, failures);
    writeJson(path.join(outDir, REPORT_NAME), report);
    return report;
  }

  const cases = asArray(manifest.cases);
  if (cases.length === 0) failures.push(validationFailure("corpus", "MANIFEST_INVALID", "manifest.cases must not be empty", "manifest.cases"));
  for (const caseRow of cases) failures.push(...validateCase(caseRow, manifestDir));

  const caseReports = [];
  if (failures.length === 0) {
    for (const caseRow of cases) {
      caseReports.push(await runCase(caseRow, manifestDir, outDir));
    }
    for (const caseReport of caseReports) {
      if (caseReport.status !== "PASS") {
        failures.push(validationFailure(caseReport.id, "CASE_FAILED", "case did not meet source-to-facts thresholds", `cases.${caseReport.id}`));
      }
    }
  }

  const totals = aggregateEvalReports(caseReports);
  const ok = failures.length === 0 && caseReports.every((row) => row.status === "PASS");
  const report = {
    schemaVersion: 1,
    reportType: "source-facts-github-corpus",
    corpusId: manifest.corpusId || "github-plsql-corpus",
    status: ok ? "PASS" : "FAIL",
    ok,
    strict: Boolean(args.strict),
    generatedAt: new Date().toISOString(),
    command: [process.execPath, ...process.argv.slice(1)].join(" "),
    cwd: process.cwd(),
    inputs: {
      manifest: manifestPath,
      out: outDir,
    },
    metrics: totals.metrics,
    aggregate: totals.aggregate,
    cases: caseReports,
    failures,
  };
  writeJson(path.join(outDir, REPORT_NAME), report);
  return report;
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2));
  const report = await runCorpus(args);
  if (args.strict && !report.ok) process.exitCode = 20;
  return report;
}

if (require.main === module) {
  runCli().catch((err) => {
    const args = parseArgs(process.argv.slice(2));
    const outDir = path.resolve(args.out || path.join(".repowiki", "diagnostics", "source-facts-github-corpus"));
    const report = buildEmptyReport(args, null, [validationFailure("corpus", "CORPUS_RUN_FAILED", err.stack || err.message, "corpus")]);
    writeJson(path.join(outDir, REPORT_NAME), report);
    process.exitCode = 20;
  });
}

module.exports = {
  parseArgs,
  runCorpus,
  validateCase,
  aggregateEvalReports,
  toRawGithubUrl,
};
