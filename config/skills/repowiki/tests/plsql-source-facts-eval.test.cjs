"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");

const root = path.resolve(__dirname, "..");
const cli = path.join(root, "plsql-source-facts-eval.cjs");
const fixtures = path.join(root, "eval", "source-facts", "fixtures");
const golden = path.join(root, "eval", "source-facts", "golden", "valid.json");

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `repowiki-${name}-`));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function runEval(fixtureName, extraArgs = []) {
  const fixture = path.join(fixtures, fixtureName);
  const out = tmpDir(`source-facts-${fixtureName}`);
  const args = [
    cli,
    "--source", path.join(fixture, "src"),
    "--golden", golden,
    "--plsql-l1", path.join(fixture, ".repowiki", "plsql-l1.json"),
    "--functions", path.join(fixture, ".repowiki", "knowledge", "functions.json"),
    "--out", out,
    "--strict",
    ...extraArgs,
  ];
  const result = childProcess.spawnSync(process.execPath, args, { encoding: "utf8" });
  const reportFile = path.join(out, "source-facts-report.json");
  const repairTicketsFile = path.join(out, "repair-tickets.json");
  return {
    ...result,
    out,
    reportFile,
    repairTicketsFile,
    report: fs.existsSync(reportFile) ? readJson(reportFile) : null,
    repairTickets: fs.existsSync(repairTicketsFile) ? readJson(repairTicketsFile) : null,
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runEvalRaw(inputs) {
  const base = tmpDir("source-facts-raw");
  const out = path.join(base, "out");
  const goldenFile = path.join(base, "golden.json");
  const l1File = path.join(base, "plsql-l1.json");
  const functionsFile = path.join(base, "functions.json");
  fs.writeFileSync(goldenFile, `${JSON.stringify(inputs.golden, null, 2)}\n`, "utf8");
  fs.writeFileSync(l1File, `${JSON.stringify(inputs.plsqlL1, null, 2)}\n`, "utf8");
  fs.writeFileSync(functionsFile, `${JSON.stringify(inputs.functions || [], null, 2)}\n`, "utf8");
  const result = childProcess.spawnSync(process.execPath, [
    cli,
    "--golden", goldenFile,
    "--plsql-l1", l1File,
    "--functions", functionsFile,
    "--out", out,
    "--strict",
  ], { encoding: "utf8" });
  const reportFile = path.join(out, "source-facts-report.json");
  const repairTicketsFile = path.join(out, "repair-tickets.json");
  return {
    ...result,
    out,
    reportFile,
    repairTicketsFile,
    report: fs.existsSync(reportFile) ? readJson(reportFile) : null,
    repairTickets: fs.existsSync(repairTicketsFile) ? readJson(repairTicketsFile) : null,
  };
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

test("source-to-facts strict pass reports replayable recall and precision by dimension", () => {
  const result = runEval("valid");
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(result.report, "report missing");
  assert.equal(result.report.reportType, "source-to-facts");
  assert.equal(result.report.status, "PASS");
  assert.equal(result.report.strict, true);
  assert.ok(result.report.command.includes("plsql-source-facts-eval.cjs"));
  assert.ok(result.report.inputs["plsql-l1"].endsWith("plsql-l1.json"));
  assert.equal(result.report.dimensions.packages.recall, 1);
  assert.equal(result.report.dimensions.params.precision, 1);
  assert.equal(result.report.dimensions.tables.matched, 3);
  assert.equal(result.report.dimensions.specialSyntax.expected, 1);
  assert.equal(result.report.summary.missingFactsTotal, 0);
  assert.equal(result.report.summary.extraFactsTotal, 0);
});

test("source-to-facts strict fails when L2 functions miss table and special syntax facts", () => {
  const result = runEval("missing-bottom-facts");
  assert.notEqual(result.status, 0, "strict run unexpectedly passed");
  assert.ok(result.report, "failure report missing");
  assert.equal(result.report.status, "FAIL");
  assert.ok(result.report.missingFacts.some((row) => row.dimension === "tables" && row.fact.includes("INV_AUDIT")));
  assert.ok(result.report.missingFacts.some((row) => row.dimension === "specialSyntax" && row.fact.includes("FORALL")));
  assert.ok(result.report.failures.some((row) => row.error_code === "RECALL_BELOW_THRESHOLD"));
  assert.ok(result.repairTickets, "repair-tickets.json missing");
  assert.equal(result.repairTickets.reportType, "source-to-facts-repair-tickets");
  assert.ok(result.repairTickets.tickets.some((row) =>
    row.repairType === "l2-source-facts" &&
    row.action === "add-missing-fact" &&
    row.dimension === "tables" &&
    row.fact.includes("INV_AUDIT") &&
    row.instruction.includes("Do not rerun from scratch")
  ), JSON.stringify(result.repairTickets, null, 2));
});

test("source-to-facts strict consumes repair overlay and rechecks only repaired facts", () => {
  const fixture = path.join(fixtures, "missing-bottom-facts");
  const out = tmpDir("source-facts-repair-overlay");
  const repairsFile = path.join(out, "source-facts-repairs.json");
  writeJson(repairsFile, {
    schemaVersion: 1,
    repairType: "l2-source-facts-overlay",
    adds: [
      { dimension: "tables", fact: "INVENTORY_PKG.bulk_receive|INV_AUDIT|INSERT", source: "repair-ticket" },
      { dimension: "columns", fact: "INVENTORY_PKG.bulk_receive|INV_AUDIT|ITEM_ID", source: "repair-ticket" },
      { dimension: "columns", fact: "INVENTORY_PKG.bulk_receive|INV_AUDIT|ACTION", source: "repair-ticket" },
      { dimension: "controlFlow", fact: "INVENTORY_PKG.bulk_receive|LOOP|FORALL", source: "repair-ticket" },
      { dimension: "specialSyntax", fact: "INVENTORY_PKG.bulk_receive|FORALL", source: "repair-ticket" },
    ],
  });
  const result = childProcess.spawnSync(process.execPath, [
    cli,
    "--source", path.join(fixture, "src"),
    "--golden", golden,
    "--plsql-l1", path.join(fixture, ".repowiki", "plsql-l1.json"),
    "--functions", path.join(fixture, ".repowiki", "knowledge", "functions.json"),
    "--repairs", repairsFile,
    "--out", out,
    "--strict",
  ], { encoding: "utf8" });
  const report = readJson(path.join(out, "source-facts-report.json"));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(report.status, "PASS");
  assert.equal(report.inputs.repairs, repairsFile);
  assert.equal(report.dimensions.tables.recall, 1);
  assert.equal(report.dimensions.specialSyntax.recall, 1);
});

test("source-to-facts strict fails on SQL alias pollution and false positives", () => {
  const result = runEval("alias-pollution");
  assert.notEqual(result.status, 0, "strict run unexpectedly passed");
  assert.ok(result.report, "failure report missing");
  assert.equal(result.report.status, "FAIL");
  assert.ok(result.report.pollution.some((row) => row.fact.includes("TGT")));
  assert.ok(result.report.extraFacts.some((row) => row.dimension === "calls" && row.fact.includes("SRC.not_real_call")));
  assert.ok(result.report.failures.some((row) => row.error_code === "POLLUTION_DETECTED"));
  assert.ok(result.repairTickets, "repair-tickets.json missing");
  assert.ok(result.repairTickets.tickets.some((row) =>
    row.repairType === "l2-source-facts" &&
    (row.action === "remove-extra-fact" || row.action === "remove-pollution") &&
    row.fact.includes("SRC.not_real_call")
  ), JSON.stringify(result.repairTickets, null, 2));
});

test("source-to-facts does not accept FSD-contract-only evidence as source facts", () => {
  const out = tmpDir("source-facts-contract-only");
  const result = childProcess.spawnSync(process.execPath, [
    cli,
    "--golden", golden,
    "--out", out,
    "--strict",
  ], { encoding: "utf8" });
  const report = readJson(path.join(out, "source-facts-report.json"));
  assert.notEqual(result.status, 0, "contract-only run unexpectedly passed");
  assert.equal(report.status, "FAIL");
  assert.ok(report.failures.some((row) => row.error_code === "INPUT_MISSING" && row.path === "plsql-l1"));
  assert.ok(report.failures.some((row) => row.error_code === "INPUT_MISSING" && row.path === "functions"));
});

test("source-to-facts reports trigger recall from PL/SQL L1 nodes", () => {
  const result = runEvalRaw({
    golden: {
      schemaVersion: 1,
      caseId: "trigger-golden",
      thresholds: { default: { recall: 1, precision: 0 } },
      expected: {
        triggers: ["EMPLOYEE_CHANGES_AFTER"],
      },
    },
    plsqlL1: {
      nodes: [
        {
          kind: "trigger",
          name: "employee_changes_after",
          qualified_name: "employee_changes_after",
        },
      ],
    },
    functions: [],
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(result.report.dimensions.triggers, "trigger dimension missing");
  assert.equal(result.report.dimensions.triggers.expected, 1);
  assert.equal(result.report.dimensions.triggers.matched, 1);
});
