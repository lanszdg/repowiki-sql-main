"use strict";

const assert = require("assert");
const fs = require("fs");
const childProcess = require("child_process");
const { compileFsdFacts } = require("../lib/fsd-facts-compiler.cjs");
const { validateFsdFacts } = require("../lib/fsd-facts-schema.cjs");
const { listFactTokens } = require("../lib/fsd-facts-coverage.cjs");
const { applySourceFactRepairsToFunction } = require("../lib/source-facts-repairs.cjs");

function sampleL2Fact(overrides = {}) {
  return {
    package_name: "INVENTORY_PKG",
    method: "bulk_receive",
    procedure_type: "PROCEDURE",
    signature: "PROCEDURE bulk_receive(p_item_id IN NUMBER, p_result OUT VARCHAR2)",
    oracle_params: [
      { name: "p_item_id", direction: "IN", oracle_type: "NUMBER", java_type: "BigDecimal" },
      { name: "p_result", direction: "OUT", oracle_type: "VARCHAR2", java_type: "String" },
    ],
    return_type: null,
    table_facts: [
      { table: "INV_TXN", operation: "INSERT", columns: ["ITEM_ID", "QTY"], sourceTrace: ["table_facts[0]"] },
      { table: "tgt", operation: "UPDATE", columns: ["ID"], sourceTrace: ["table_facts[1]"] },
      { table: "OLD_SET", operation: "SELECT", columns: ["ID"], sourceTrace: ["table_facts[2]"] },
    ],
    cross_package_calls: [
      { target_package: "UTIL_PKG", target_member: "get_param", sourceTrace: ["cross_package_calls[0]"] },
      { target_package: "src", target_member: "not_real_call", sourceTrace: ["cross_package_calls[1]"] },
    ],
    sequence_deps: [{ sequence: "INV_TXN_SEQ", sourceTrace: ["sequence_deps[0]"] }],
    constant_deps: [
      { target_package: "CONST_PKG", target_member: "STATUS_OK", value: "OK", sourceTrace: ["constant_deps[0]"] },
      { target_package: "rec", target_member: "noise", value: null, sourceTrace: ["constant_deps[1]"] },
    ],
    control_flow: {
      nodes: [{ id: "n1", label: "validate input", sourceTrace: ["control_flow.nodes[0]"] }],
      branches: [{ id: "b1", condition: "p_item_id is null", sourceTrace: ["control_flow.branches[0]"] }],
      loops: [{ id: "l1", type: "FORALL", sourceTrace: ["control_flow.loops[0]"] }],
    },
    exception_handlers: [{ name: "OTHERS", action: "RAISE", sourceTrace: ["exception_handlers[0]"] }],
    special_syntax: [{ id: "forall-1", type: "FORALL", risk: "medium", sourceTrace: ["special_syntax[0]"] }],
    source_file: "pkg/inventory_pkg.sql",
    module: "mfg",
    ...overrides,
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

test("compiles L2 Oracle facts into a valid fsd-facts contract", () => {
  const fact = compileFsdFacts(sampleL2Fact());
  assert.equal(fact.identity.id, "INVENTORY_PKG.bulk_receive");
  assert.equal(fact.identity.packageName, "INVENTORY_PKG");
  assert.equal(fact.identity.subprogramName, "bulk_receive");
  assert.equal(fact.identity.outputPath, "fsd/INVENTORY_PKG/bulk_receive.md");
  assert.equal(fact.signature.params.length, 2);
  assert.equal(fact.signature.params[0].javaType, "BigDecimal");
  assert.ok(Array.isArray(fact.tableMappings));
  assert.ok(Array.isArray(fact.sourceTrace));
  assert.equal(validateFsdFacts(fact).ok, true);
});

test("compiler coverage fact count uses the same token contract as L3 markdown gate", () => {
  const fact = compileFsdFacts(sampleL2Fact());
  assert.equal(fact.coverage.factsTotal, listFactTokens(fact).length);
});

test("source fact repair overlay is visible to compiled FSD facts", () => {
  const repaired = applySourceFactRepairsToFunction(sampleL2Fact({
    table_facts: [],
    special_syntax: [],
  }), {
    adds: [
      { dimension: "tables", fact: "INVENTORY_PKG.bulk_receive|INV_AUDIT|INSERT" },
      { dimension: "columns", fact: "INVENTORY_PKG.bulk_receive|INV_AUDIT|ACTION" },
      { dimension: "specialSyntax", fact: "INVENTORY_PKG.bulk_receive|FORALL" },
    ],
  });
  const fact = compileFsdFacts(repaired);
  assert.ok(fact.tableMappings.some((row) => row.tableName === "INV_AUDIT"));
  assert.ok(fact.tableMappings.some((row) => row.columns.includes("ACTION")));
  assert.ok(fact.specialSyntax.some((row) => row.type === "FORALL"));
});

test("compiler does not scan source, invoke a model, or spawn subprocesses", () => {
  const originalReadFileSync = fs.readFileSync;
  const originalExecSync = childProcess.execSync;
  const originalExecFileSync = childProcess.execFileSync;
  const originalSpawnSync = childProcess.spawnSync;
  fs.readFileSync = () => { throw new Error("source scan forbidden"); };
  childProcess.execSync = () => { throw new Error("subprocess forbidden"); };
  childProcess.execFileSync = () => { throw new Error("subprocess forbidden"); };
  childProcess.spawnSync = () => { throw new Error("subprocess forbidden"); };
  try {
    const fact = compileFsdFacts(sampleL2Fact());
    assert.equal(fact.identity.id, "INVENTORY_PKG.bulk_receive");
  } finally {
    fs.readFileSync = originalReadFileSync;
    childProcess.execSync = originalExecSync;
    childProcess.execFileSync = originalExecFileSync;
    childProcess.spawnSync = originalSpawnSync;
  }
});

test("filters SQL alias pollution from true mappings and dependencies", () => {
  const fact = compileFsdFacts(sampleL2Fact());
  const tables = fact.tableMappings.map((row) => row.tableName);
  const calls = fact.dependencies.calls.map((row) => row.target);
  const constants = fact.dependencies.constants.map((row) => row.target);
  assert.ok(tables.includes("INV_TXN"));
  assert.ok(!tables.includes("tgt"));
  assert.ok(!tables.includes("OLD_SET"));
  assert.ok(calls.includes("UTIL_PKG.get_param"));
  assert.ok(!calls.includes("src.not_real_call"));
  assert.ok(constants.includes("CONST_PKG.STATUS_OK"));
  assert.ok(!constants.includes("rec.noise"));
});

test("adds manualReview for high and medium risk syntax", () => {
  const fact = compileFsdFacts(sampleL2Fact());
  assert.ok(fact.specialSyntax.some((row) => row.id === "forall-1"));
  assert.ok(fact.manualReview.some((row) => row.sourceId === "forall-1" && row.severity === "medium"));
});

test("supports deterministic overload output paths", () => {
  const fact = compileFsdFacts(sampleL2Fact({ overload_index: 2 }));
  assert.equal(fact.identity.id, "INVENTORY_PKG.bulk_receive#2");
  assert.equal(fact.identity.outputPath, "fsd/INVENTORY_PKG/bulk_receive__overload_2.md");
});
