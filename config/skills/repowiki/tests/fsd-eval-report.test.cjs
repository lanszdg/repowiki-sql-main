"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");

const repoRoot = path.join(__dirname, "..");
const evalRoot = path.join(repoRoot, "eval", "fsd");
const node = process.execPath;

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function run(script, args, options = {}) {
  return childProcess.spawnSync(node, [path.join(repoRoot, script), ...args], {
    encoding: "utf8",
    ...options,
  });
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

function strictReportSchema(dir) {
  const file = path.join(dir, "strict-report-schema.json");
  writeJson(file, {
    requiredTopLevelFields: [
      "schemaVersion",
      "reportType",
      "status",
      "strict",
      "command",
      "cwd",
      "inputs",
      "summary",
      "metrics",
      "failures",
      "cases",
    ],
  });
  return file;
}

function assertReplayFields(report, reportType) {
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.reportType, reportType);
  assert.ok(["PASS", "FAIL"].includes(report.status), report.status);
  assert.equal(typeof report.strict, "boolean");
  assert.ok(report.command && report.command.includes("fsd-"), report.command);
  assert.ok(path.isAbsolute(report.cwd), report.cwd);
  assert.ok(report.inputs && typeof report.inputs === "object");
  assert.ok(report.summary && typeof report.summary === "object");
  assert.ok(report.metrics && typeof report.metrics === "object");
  assert.ok(Array.isArray(report.failures));
  assert.ok(Array.isArray(report.cases));
}

test("strict eval reports include replay metadata required by final acceptance", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "fsd-report-"));
  const schema = strictReportSchema(out);
  const result = run("fsd-facts-eval.cjs", [
    "--input", path.join(evalRoot, "fixtures", "local"),
    "--manifest", path.join(evalRoot, "manifests", "local-main.jsonl"),
    "--out", out,
    "--strict",
    "--report-schema", schema,
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = readJson(path.join(out, "fsd-coverage.json"));
  assertReplayFields(report, "facts-eval");
});

test("markdown coverage report exposes bidirectional fact mapping fields", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "fsd-md-coverage-"));
  const schema = strictReportSchema(out);
  const result = run("fsd-markdown-coverage.cjs", [
    "--input", path.join(evalRoot, "fixtures", "local"),
    "--manifest", path.join(evalRoot, "manifests", "local-main.jsonl"),
    "--out", out,
    "--strict",
    "--report-schema", schema,
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = readJson(path.join(out, "fsd-markdown-coverage.json"));
  assertReplayFields(report, "markdown-coverage");
  assert.ok(report.markdownCoverage && typeof report.markdownCoverage === "object");
  assert.ok(Array.isArray(report.markdownCoverage.factsToMarkdown));
  assert.ok(Array.isArray(report.markdownCoverage.markdownToFacts));
  assert.ok(Array.isArray(report.markdownCoverage.orphanMarkdownFacts));
  assert.ok(Array.isArray(report.markdownCoverage.unrenderedFacts));
});
