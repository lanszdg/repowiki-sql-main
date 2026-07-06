"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");

const repoRoot = path.join(__dirname, "..");
const node = process.execPath;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeReviewFixtures(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ["round-p6-test-report.md", "round-p6-final-architect.md", "round-p6-final-product.md"]) {
    fs.writeFileSync(path.join(dir, name), `# ${name}\n\nConclusion: PASS\n`, "utf8");
  }
}

function writeBadReviewFixtures(dir) {
  writeReviewFixtures(dir);
  fs.writeFileSync(path.join(dir, "round-p6-final-architect.md"), "# round-p6-final-architect.md\n\nVerdict: PARTIAL\n", "utf8");
}

function runAcceptance(outDir, options = {}) {
  const args = [
    path.join(repoRoot, "fsd-acceptance-e2e.cjs"),
    "--out", outDir,
    "--strict",
  ];
  if (options.reviewsDir) args.push("--reviews-dir", options.reviewsDir);
  return childProcess.spawnSync(node, args, { encoding: "utf8" });
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

function assertReplayFields(report, reportType) {
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.reportType, reportType);
  assert.ok(["PASS", "FAIL"].includes(report.status), report.status);
  assert.equal(typeof report.strict, "boolean");
  assert.ok(report.command && typeof report.command === "string", report.command);
  assert.ok(path.isAbsolute(report.cwd), report.cwd);
  assert.ok(report.inputs && typeof report.inputs === "object");
  assert.ok(report.summary && typeof report.summary === "object");
}

test("acceptance does not bypass production FSD generation path", () => {
  const source = fs.readFileSync(path.join(repoRoot, "fsd-acceptance-e2e.cjs"), "utf8");
  assert.ok(!source.includes("function richOracleSpMarkdown"), "acceptance must not define private rich markdown renderer");
  assert.ok(!source.includes("richOracleSpMarkdown("), "acceptance must not call private rich markdown renderer");
  assert.ok(!source.includes("writeJson(fsdFactsFile"), "acceptance must not hand-write fsdFactsFile; production claim must materialize it");
});

test("strict acceptance package includes mutation, AB, corpus, gate, and review evidence", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "fsd-acceptance-"));
  const reviewsDir = fs.mkdtempSync(path.join(os.tmpdir(), "fsd-reviews-"));
  writeReviewFixtures(reviewsDir);
  const result = runAcceptance(out, { reviewsDir });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = readJson(path.join(out, "acceptance-report.json"));
  const caseIds = new Set(report.cases.map((row) => row.case_id));
  for (const required of [
    "mutation",
    "ab",
    "corpus-scale",
    "gate-diagnostics",
    "review:test-engineer",
    "review:final-architect",
    "review:final-product",
    "artifact:diagnostics\\mutation\\fsd-mutation-report.json",
    "artifact:diagnostics\\ab\\fsd-ab-report.json",
    "artifact:diagnostics\\corpus\\fsd-corpus-report.json",
    "artifact:reviews\\round-p6-test-report.md",
    "artifact:reviews\\round-p6-final-architect.md",
    "artifact:reviews\\round-p6-final-product.md",
  ]) {
    assert.ok(caseIds.has(required), `missing acceptance case ${required}`);
  }
});

test("strict acceptance records corpus thresholds and passes only when configured scale is met", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "fsd-acceptance-scale-"));
  const reviewsDir = fs.mkdtempSync(path.join(os.tmpdir(), "fsd-reviews-scale-"));
  writeReviewFixtures(reviewsDir);
  const result = runAcceptance(out, { reviewsDir });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = readJson(path.join(out, "acceptance-report.json"));
  assert.ok(report.corpus, "missing corpus summary");
  assert.deepEqual(report.corpus.thresholds, {
    localPositive: 12,
    githubPositive: 30,
    negative: 15,
    pollution: 15,
    ab: 1,
  });
  assert.deepEqual(report.corpus.effective, report.corpus.seeds);
  assert.equal(report.corpus.ok, true, JSON.stringify(report.corpus, null, 2));
});

test("acceptance corpus and gate diagnostics include replay metadata", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "fsd-acceptance-replay-"));
  const reviewsDir = fs.mkdtempSync(path.join(os.tmpdir(), "fsd-reviews-replay-"));
  writeReviewFixtures(reviewsDir);
  const result = runAcceptance(out, { reviewsDir });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assertReplayFields(readJson(path.join(out, "diagnostics", "corpus", "fsd-corpus-report.json")), "corpus-scale");
  assertReplayFields(readJson(path.join(out, "diagnostics", "gate", "fsd-gate-report.json")), "gate-diagnostics");
});

test("acceptance gate diagnostics reflect missing reviews when strict e2e fails", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "fsd-acceptance-missing-review-"));
  const reviewsDir = fs.mkdtempSync(path.join(os.tmpdir(), "fsd-reviews-missing-"));
  const result = runAcceptance(out, { reviewsDir });
  assert.equal(result.status, 20, result.stderr || result.stdout);
  const acceptance = readJson(path.join(out, "acceptance-report.json"));
  const gate = readJson(path.join(out, "diagnostics", "gate", "fsd-gate-report.json"));
  assert.equal(acceptance.ok, false);
  assert.equal(gate.status, "FAIL");
  assert.equal(gate.ok, false);
  assert.equal(gate.summary.failuresTotal, acceptance.metrics.failuresTotal);
  assert.equal(gate.cases.length, acceptance.metrics.casesTotal);
  assert.ok(gate.cases.some((row) => row.case_id === "gate-diagnostics"));
  assert.ok(gate.failures.some((row) => row.error_code === "ACCEPTANCE_REVIEW_MISSING"));
});

test("acceptance rejects review archives without PASS verdict", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "fsd-acceptance-bad-review-"));
  const reviewsDir = fs.mkdtempSync(path.join(os.tmpdir(), "fsd-reviews-bad-"));
  writeBadReviewFixtures(reviewsDir);
  const result = runAcceptance(out, { reviewsDir });
  assert.equal(result.status, 20, result.stderr || result.stdout);
  const acceptance = readJson(path.join(out, "acceptance-report.json"));
  const gate = readJson(path.join(out, "diagnostics", "gate", "fsd-gate-report.json"));
  assert.ok(acceptance.failures.some((row) => row.error_code === "ACCEPTANCE_REVIEW_NOT_PASS"));
  assert.ok(gate.failures.some((row) => row.error_code === "ACCEPTANCE_REVIEW_NOT_PASS"));
});

test("mutation and AB diagnostics enforce strict acceptance metrics", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "fsd-acceptance-strict-metrics-"));
  const reviewsDir = fs.mkdtempSync(path.join(os.tmpdir(), "fsd-reviews-strict-metrics-"));
  writeReviewFixtures(reviewsDir);
  const result = runAcceptance(out, { reviewsDir });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const mutation = readJson(path.join(out, "diagnostics", "mutation", "fsd-mutation-report.json"));
  const ab = readJson(path.join(out, "diagnostics", "ab", "fsd-ab-report.json"));
  for (const requiredType of ["identity", "params", "return", "manualReview", "dynamicSql", "alias", "overload", "markdownExtraFact", "transaction", "sourceTrace"]) {
    assert.ok(mutation.mutationTypesCovered.includes(requiredType), `missing mutation type ${requiredType}`);
  }
  assert.equal(mutation.metrics.survivorsTotal, 0);
  assert.equal(mutation.metrics.killRate, 1);
  assert.equal(ab.metrics.aFalsePassRate, 1);
  assert.equal(ab.metrics.bFalsePassRate, 0);
  assert.ok(Array.isArray(ab.perCaseDelta) && ab.perCaseDelta.length > 0);
  assert.ok(ab.metrics.falsePassImprovement >= 1);
});
