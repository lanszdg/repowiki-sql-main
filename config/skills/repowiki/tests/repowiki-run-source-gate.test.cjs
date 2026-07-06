"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");

const root = path.resolve(__dirname, "..");
const cli = path.join(root, "repowiki-run.cjs");
const fixtures = path.join(root, "eval", "source-facts", "fixtures");
const golden = path.join(root, "eval", "source-facts", "golden", "valid.json");

function tmpRepo(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `repowiki-run-${name}-`));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function copyFixture(repo, fixtureName) {
  const fixture = path.join(fixtures, fixtureName);
  fs.mkdirSync(path.join(repo, ".repowiki", "knowledge"), { recursive: true });
  fs.copyFileSync(path.join(fixture, ".repowiki", "plsql-l1.json"), path.join(repo, ".repowiki", "plsql-l1.json"));
  fs.copyFileSync(path.join(fixture, ".repowiki", "knowledge", "functions.json"), path.join(repo, ".repowiki", "knowledge", "functions.json"));
}

function runGate(repo, args = []) {
  return childProcess.spawnSync(process.execPath, [
    cli,
    repo,
    "--from",
    "done",
    "--source-facts-gate-only",
    ...args,
  ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
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

test("source-facts gate-only fails before L3 and points to repair tickets when golden is configured", () => {
  const repo = tmpRepo("source-gate-fail");
  copyFixture(repo, "missing-bottom-facts");
  const result = runGate(repo, ["--source-facts-golden", golden]);
  assert.notEqual(result.status, 0, "source gate unexpectedly passed");
  assert.ok((result.stdout + result.stderr).includes("source-facts gate failed"), result.stdout + result.stderr);
  const outDir = path.join(repo, ".repowiki", "diagnostics", "source-facts");
  const report = readJson(path.join(outDir, "source-facts-report.json"));
  const tickets = readJson(path.join(outDir, "repair-tickets.json"));
  assert.equal(report.status, "FAIL");
  assert.ok(tickets.tickets.some((row) => row.action === "add-missing-fact" && row.fact.includes("INV_AUDIT")));
});

test("source-facts gate-only consumes default repair overlay before deciding pass", () => {
  const repo = tmpRepo("source-gate-repaired");
  copyFixture(repo, "missing-bottom-facts");
  writeJson(path.join(repo, ".repowiki", "knowledge", "source-facts-repairs.json"), {
    schemaVersion: 1,
    repairType: "l2-source-facts-overlay",
    adds: [
      { dimension: "tables", fact: "INVENTORY_PKG.bulk_receive|INV_AUDIT|INSERT" },
      { dimension: "columns", fact: "INVENTORY_PKG.bulk_receive|INV_AUDIT|ITEM_ID" },
      { dimension: "columns", fact: "INVENTORY_PKG.bulk_receive|INV_AUDIT|ACTION" },
      { dimension: "controlFlow", fact: "INVENTORY_PKG.bulk_receive|LOOP|FORALL" },
      { dimension: "specialSyntax", fact: "INVENTORY_PKG.bulk_receive|FORALL" },
    ],
  });
  const result = runGate(repo, ["--source-facts-golden", golden]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const outDir = path.join(repo, ".repowiki", "diagnostics", "source-facts");
  const report = readJson(path.join(outDir, "source-facts-report.json"));
  assert.equal(report.status, "PASS");
  assert.ok(report.inputs.repairs.endsWith("source-facts-repairs.json"), JSON.stringify(report.inputs));
});

test("source-facts gate-only records skip reason instead of pretending pass when no golden is configured", () => {
  const repo = tmpRepo("source-gate-skip");
  writeJson(path.join(repo, ".repowiki", "knowledge", "functions.json"), []);
  writeJson(path.join(repo, ".repowiki", "plsql-l1.json"), { nodes: [] });
  const result = runGate(repo);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const gate = readJson(path.join(repo, ".repowiki", "diagnostics", "source-facts", "source-facts-gate.json"));
  assert.equal(gate.status, "SKIP");
  assert.equal(gate.ok, true);
  assert.ok(gate.skipReason.includes("golden"));
});
