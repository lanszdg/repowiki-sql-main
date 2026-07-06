"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");

const node = process.execPath;
const scriptDir = __dirname;
const projectRoot = path.resolve(scriptDir, "..", "..", "..");
const taskScript = path.join(scriptDir, "repowiki-l3-task.cjs");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (key === "strict") args.strict = true;
    else {
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
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function runNode(args, cwd = process.cwd()) {
  return childProcess.spawnSync(node, args, { cwd, encoding: "utf8" });
}

function addFailure(failures, code, message, extra = {}) {
  failures.push({ error_code: code, message, ...extra });
}

function replayFields(reportType, ok, args, inputs, summary = {}) {
  return {
    schemaVersion: 1,
    reportType,
    status: ok ? "PASS" : "FAIL",
    strict: Boolean(args.strict),
    command: [process.execPath, ...process.argv.slice(1)].join(" "),
    cwd: process.cwd(),
    inputs,
    summary,
  };
}

function countJsonl(file) {
  if (!fs.existsSync(file)) return 0;
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .length;
}

function countJsonFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) total += countJsonFiles(child);
    else if (entry.name.toLowerCase().endsWith(".json")) total++;
  }
  return total;
}

function writeCorpusReport(outDir, evalRoot, args) {
  const thresholds = {
    localPositive: 12,
    githubPositive: 30,
    negative: 15,
    pollution: 15,
    ab: 1,
  };
  const seeds = {
    localPositive: countJsonl(path.join(evalRoot, "manifests", "local-main.jsonl")),
    githubPositive: countJsonl(path.join(evalRoot, "manifests", "github-augment.jsonl")),
    negative: countJsonl(path.join(evalRoot, "manifests", "negative.jsonl")),
    pollution: countJsonFiles(path.join(evalRoot, "fixtures", "pollution")),
    ab: countJsonl(path.join(evalRoot, "manifests", "ab-samples.jsonl")),
  };
  const effective = { ...seeds };
  const ok = Object.keys(thresholds).every((key) => effective[key] >= thresholds[key]);
  const report = {
    ...replayFields("corpus-scale", ok, args, {
      evalRoot,
      manifestsDir: path.join(evalRoot, "manifests"),
      fixturesDir: path.join(evalRoot, "fixtures"),
    }, {
      thresholds,
      effective,
    }),
    generatedAt: new Date().toISOString(),
    mode: "actual-fixture-counts",
    thresholds,
    seeds,
    effective,
    ok,
  };
  writeJson(path.join(outDir, "diagnostics", "corpus", "fsd-corpus-report.json"), report);
  return report;
}

function reviewVerdict(file) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.trim()) return { ok: false, verdict: "", reason: "review archive is empty" };
  const match = text.match(/(?:Verdict|Conclusion)\s*:\s*(PASS|FAIL|PARTIAL|UNVERIFIED)\b/i);
  if (!match) return { ok: false, verdict: "", reason: "review archive missing Verdict/Conclusion PASS" };
  const verdict = match[1].toUpperCase();
  if (verdict !== "PASS") return { ok: false, verdict, reason: `review verdict is ${verdict}` };
  return { ok: true, verdict, reason: "" };
}

function copyRequiredReviews(outDir, failures, cases, args) {
  const reviewsRoot = path.resolve(args["reviews-dir"] || path.join(projectRoot, "docs", "fsd-implementation", "reviews"));
  const reviews = [
    ["review:test-engineer", "round-p6-test-report.md"],
    ["review:final-architect", "round-p6-final-architect.md"],
    ["review:final-product", "round-p6-final-product.md"],
  ];
  for (const [caseId, name] of reviews) {
    const src = path.join(reviewsRoot, name);
    const dest = path.join(outDir, "reviews", name);
    const exists = fs.existsSync(src);
    let verdict = { ok: false, verdict: "", reason: "" };
    if (exists) verdict = reviewVerdict(src);
    const ok = exists && verdict.ok;
    cases.push({ case_id: caseId, ok, source: path.relative(projectRoot, src), verdict: verdict.verdict || "" });
    if (exists) copyFile(src, dest);
    else addFailure(failures, "ACCEPTANCE_REVIEW_MISSING", `missing review archive ${name}`);
    if (exists && !verdict.ok) addFailure(failures, "ACCEPTANCE_REVIEW_NOT_PASS", `${name}: ${verdict.reason}`, { review: name, verdict: verdict.verdict || "" });
  }
}

function setupRepo(workRepo, facts) {
  const scheduler = path.join(workRepo, ".repowiki", "l3-scheduler");
  const knowledge = path.join(workRepo, ".repowiki", "knowledge");
  const fn = {
    module: "oracle",
    impl_qn: facts.identity.packageName,
    method: facts.identity.subprogramName,
    signature: facts.signature.raw,
    procedure_type: facts.identity.kind,
    source_file: facts.sourceTrace[0] && facts.sourceTrace[0].file,
    oracle_params: facts.signature.params.map((row) => ({
      name: row.name,
      direction: row.direction,
      oracle_type: row.oracleType,
      java_type: row.javaType,
    })),
    table_facts: facts.tableMappings.map((row, index) => ({
      table: row.tableName,
      operation: row.operations[0] || "SELECT",
      columns: row.columns,
      sourceTrace: row.sourceTrace || [`table_facts[${index}]`],
    })),
    special_syntax: facts.specialSyntax.map((row) => ({
      id: row.id,
      type: row.type,
      risk: row.risk,
      sourceTrace: row.sourceTrace || [],
    })),
  };
  const task = {
    id: "acceptance-doc",
    kind: "function-doc",
    l3Skill: "wiki-l3-oracle-sp",
    module: "oracle",
    relPath: fn.source_file || "acceptance.sql",
    function: fn,
  };
  writeJson(path.join(scheduler, "tasks.json"), [task]);
  writeJson(path.join(scheduler, "state.json"), {
    l3Skill: "wiki-l3-oracle-sp",
    concurrency: 1,
    tasks: {
      "acceptance-doc": {
        id: "acceptance-doc",
        kind: "function-doc",
        status: "pending",
        l3Skill: "wiki-l3-oracle-sp",
      },
    },
  });
  writeJson(path.join(workRepo, ".repowiki", "modules.json"), [{ slug: "oracle", relPath: task.relPath }]);
  writeJson(path.join(knowledge, "functions.json"), [fn]);
  writeJson(path.join(knowledge, "services.json"), []);
  writeJson(path.join(knowledge, "downstream.json"), []);
  writeJson(path.join(knowledge, "models.json"), []);
  writeJson(path.join(knowledge, "tables.json"), []);
  writeJson(path.join(knowledge, "callgraph.json"), { callees: {}, callers: {} });
  writeJson(path.join(knowledge, "entities.json"), []);
  writeJson(path.join(knowledge, "relations.json"), []);
  writeJson(path.join(knowledge, "expected-functions.json"), []);
  writeJson(path.join(knowledge, "topology.json"), {});
}

function runEvalCommands(outDir, failures, cases) {
  const evalRoot = path.join(scriptDir, "eval", "fsd");
  const reportSchema = path.join(evalRoot, "schemas", "reports.json");
  const commands = [
    {
      id: "local-aggregate",
      expect: 0,
      args: [path.join(scriptDir, "fsd-facts-eval.cjs"), "--input", path.join(evalRoot, "fixtures", "local"), "--manifest", path.join(evalRoot, "manifests", "local-main.jsonl"), "--out", path.join(outDir, "diagnostics", "local-main"), "--strict", "--report-schema", reportSchema],
    },
    {
      id: "github-golden",
      expect: 0,
      args: [path.join(scriptDir, "fsd-golden-eval.cjs"), "--input", path.join(evalRoot, "fixtures", "github"), "--manifest", path.join(evalRoot, "manifests", "github-augment.jsonl"), "--golden", path.join(evalRoot, "golden", "github"), "--out", path.join(outDir, "diagnostics", "github"), "--strict", "--report-schema", reportSchema],
    },
    {
      id: "schema-negative",
      expect: 20,
      args: [path.join(scriptDir, "fsd-schema-eval.cjs"), "--input", path.join(evalRoot, "fixtures", "negative"), "--manifest", path.join(evalRoot, "manifests", "negative.jsonl"), "--out", path.join(outDir, "diagnostics", "negative-schema"), "--strict", "--case", "missing-trace", "--report-schema", reportSchema],
    },
    {
      id: "markdown-negative",
      expect: 20,
      args: [path.join(scriptDir, "fsd-markdown-coverage.cjs"), "--input", path.join(evalRoot, "fixtures", "negative"), "--manifest", path.join(evalRoot, "manifests", "negative.jsonl"), "--out", path.join(outDir, "diagnostics", "negative-markdown"), "--strict", "--case", "markdown-gap", "--report-schema", reportSchema],
    },
    {
      id: "pollution-negative",
      expect: 20,
      args: [path.join(scriptDir, "fsd-pollution-eval.cjs"), "--input", path.join(evalRoot, "fixtures", "pollution"), "--out", path.join(outDir, "diagnostics", "negative-pollution"), "--strict", "--report-schema", reportSchema],
    },
    {
      id: "mutation",
      expect: 0,
      args: [path.join(scriptDir, "fsd-mutation-runner.cjs"), "--input", path.join(evalRoot, "fixtures", "local"), "--manifest", path.join(evalRoot, "manifests", "local-main.jsonl"), "--mutations", path.join(evalRoot, "mutations"), "--out", path.join(outDir, "diagnostics", "mutation"), "--strict", "--report-schema", reportSchema],
    },
    {
      id: "ab",
      expect: 0,
      args: [path.join(scriptDir, "fsd-ab-compare.cjs"), "--input", path.join(evalRoot, "fixtures", "local"), "--manifest", path.join(evalRoot, "manifests", "ab-samples.jsonl"), "--out", path.join(outDir, "diagnostics", "ab"), "--strict", "--report-schema", reportSchema],
    },
  ];

  for (const cmd of commands) {
    const result = runNode(cmd.args);
    cases.push({ case_id: cmd.id, ok: result.status === cmd.expect, expectedExit: cmd.expect, actualExit: result.status });
    if (result.status !== cmd.expect) {
      addFailure(failures, "EVAL_EXIT_MISMATCH", `${cmd.id} expected ${cmd.expect}, got ${result.status}`, { stdout: result.stdout, stderr: result.stderr });
    }
  }
}

function runFormalClaimDone(outDir, failures, cases, facts) {
  const workRepo = fs.mkdtempSync(path.join(os.tmpdir(), "repowiki-fsd-acceptance-"));
  setupRepo(workRepo, facts);

  const claim = runNode([taskScript, "claim", workRepo, "--agent", "acceptance"]);
  writeJson(path.join(outDir, "diagnostics", "claim-result.json"), { status: claim.status, stdout: claim.stdout, stderr: claim.stderr });
  if (claim.status !== 0) {
    addFailure(failures, "CLAIM_FAILED", "formal claim command failed", { stderr: claim.stderr });
    return;
  }

  const payload = JSON.parse(claim.stdout);
  const outputFile = payload.output;
  const fsdFacts = payload.factContext && payload.factContext.facts && payload.factContext.facts.fsd || {};
  const fsdFactsFile = fsdFacts.fsdFactsFile;
  const renderedSkeleton = fsdFacts.renderedSkeleton;
  if (!fsdFactsFile) addFailure(failures, "CLAIM_FSD_FACTS_MISSING", "claim payload missing facts.fsd.fsdFactsFile");
  if (!renderedSkeleton) addFailure(failures, "CLAIM_RENDERED_SKELETON_MISSING", "claim payload missing facts.fsd.renderedSkeleton");
  if (fsdFactsFile && !fs.existsSync(fsdFactsFile)) addFailure(failures, "CLAIM_FSD_FACTS_NOT_MATERIALIZED", "claim did not materialize fsd-facts sidecar");

  ensureDir(path.dirname(outputFile));
  fs.writeFileSync(outputFile, renderedSkeleton || "", "utf8");

  const done = runNode([taskScript, "done", workRepo, "--id", "acceptance-doc", "--agent", "acceptance"]);
  writeJson(path.join(outDir, "diagnostics", "done-result.json"), { status: done.status, stdout: done.stdout, stderr: done.stderr });
  cases.push({ case_id: "formal-claim-done", ok: done.status === 0, expectedExit: 0, actualExit: done.status });
  if (done.status !== 0) addFailure(failures, "DONE_FAILED", "formal done command failed", { stderr: done.stderr });

  if (fsdFactsFile && fs.existsSync(fsdFactsFile)) {
    const relFacts = path.join("fsd-facts", facts.identity.packageName, `${facts.identity.subprogramName}.json`);
    copyFile(fsdFactsFile, path.join(outDir, relFacts));
  }
  if (fs.existsSync(outputFile)) copyFile(outputFile, path.join(outDir, "docs", facts.identity.outputPath));
  const coverageSummary = path.join(workRepo, ".repowiki", "l3-scheduler", "metadata", "fsd-coverage.json");
  if (fs.existsSync(coverageSummary)) {
    copyFile(coverageSummary, path.join(outDir, "diagnostics", "fsd-coverage.json"));
  } else {
    addFailure(failures, "COVERAGE_SUMMARY_MISSING", "formal done did not write fsd coverage summary");
  }
}

function writeGateReport(outDir, failures, cases, args) {
  const gateCase = { case_id: "gate-diagnostics", ok: true };
  const finalCases = [...cases, gateCase];
  const gateReport = {
    ...replayFields("gate-diagnostics", failures.length === 0, args, {
      claimResult: path.join("diagnostics", "claim-result.json"),
      doneResult: path.join("diagnostics", "done-result.json"),
      coverageSummary: path.join("diagnostics", "fsd-coverage.json"),
      outDir,
    }, {
      failuresTotal: failures.length,
      casesTotal: finalCases.length,
    }),
    generatedAt: new Date().toISOString(),
    claimResult: path.join("diagnostics", "claim-result.json"),
    doneResult: path.join("diagnostics", "done-result.json"),
    coverageSummary: path.join("diagnostics", "fsd-coverage.json"),
    failures: failures.map((failure) => ({ ...failure })),
    cases: finalCases.map((row) => ({ ...row })),
    ok: failures.length === 0,
  };
  const gateReportFile = path.join(outDir, "diagnostics", "gate", "fsd-gate-report.json");
  writeJson(gateReportFile, gateReport);
  gateCase.ok = fs.existsSync(gateReportFile);
  cases.push(gateCase);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(args.out || ".repowiki/acceptance");
  ensureDir(outDir);
  const failures = [];
  const cases = [];
  const facts = readJson(path.join(scriptDir, "eval", "fsd", "fixtures", "local", "valid.json"));

  runFormalClaimDone(outDir, failures, cases, facts);
  runEvalCommands(outDir, failures, cases);

  const evalRoot = path.join(scriptDir, "eval", "fsd");
  const corpus = writeCorpusReport(outDir, evalRoot, args);
  cases.push({ case_id: "corpus-scale", ok: corpus.ok, thresholds: corpus.thresholds, effective: corpus.effective });
  if (!corpus.ok) addFailure(failures, "CORPUS_SCALE_BELOW_THRESHOLD", "corpus scale thresholds are not met", { corpus });

  copyRequiredReviews(outDir, failures, cases, args);

  const requiredFiles = [
    path.join(outDir, "fsd-facts", facts.identity.packageName, `${facts.identity.subprogramName}.json`),
    path.join(outDir, "docs", facts.identity.outputPath),
    path.join(outDir, "diagnostics", "fsd-coverage.json"),
    path.join(outDir, "diagnostics", "local-main", "fsd-coverage.json"),
    path.join(outDir, "diagnostics", "github", "fsd-golden-report.json"),
    path.join(outDir, "diagnostics", "negative-schema", "fsd-schema-report.json"),
    path.join(outDir, "diagnostics", "negative-markdown", "fsd-markdown-coverage.json"),
    path.join(outDir, "diagnostics", "negative-pollution", "fsd-pollution-report.json"),
    path.join(outDir, "diagnostics", "mutation", "fsd-mutation-report.json"),
    path.join(outDir, "diagnostics", "ab", "fsd-ab-report.json"),
    path.join(outDir, "diagnostics", "corpus", "fsd-corpus-report.json"),
    path.join(outDir, "reviews", "round-p6-test-report.md"),
    path.join(outDir, "reviews", "round-p6-final-architect.md"),
    path.join(outDir, "reviews", "round-p6-final-product.md"),
  ];
  for (const file of requiredFiles) {
    const ok = fs.existsSync(file);
    cases.push({ case_id: `artifact:${path.relative(outDir, file)}`, ok });
    if (!ok) addFailure(failures, "ACCEPTANCE_ARTIFACT_MISSING", `missing ${path.relative(outDir, file)}`);
  }

  writeGateReport(outDir, failures, cases, args);

  const report = {
    ok: failures.length === 0,
    generatedAt: new Date().toISOString(),
    metrics: {
      casesTotal: cases.length,
      casesPassed: cases.filter((row) => row.ok).length,
      failuresTotal: failures.length,
    },
    corpus,
    failures,
    cases,
  };
  writeJson(path.join(outDir, "acceptance-report.json"), report);
  if (args.strict && !report.ok) process.exitCode = 20;
}

main();
