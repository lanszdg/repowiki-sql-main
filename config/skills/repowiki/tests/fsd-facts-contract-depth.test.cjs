"use strict";

const assert = require("assert");
const { compileFsdFacts } = require("../lib/fsd-facts-compiler.cjs");
const { validateFsdFacts } = require("../lib/fsd-facts-schema.cjs");

function oracleL2Fact(overrides = {}) {
  return {
    package_name: "INV_PKG",
    method: "issue_stock",
    procedure_type: "PROCEDURE",
    signature: "PROCEDURE issue_stock(p_item_id IN NUMBER, p_qty IN NUMBER, p_status OUT VARCHAR2)",
    oracle_params: [
      { name: "p_item_id", direction: "IN", oracle_type: "NUMBER(12)", java_type: "BigDecimal" },
      { name: "p_qty", direction: "IN", oracle_type: "NUMBER(10,2)", java_type: "BigDecimal" },
      { name: "p_status", direction: "OUT", oracle_type: "VARCHAR2(20)", java_type: "String" },
    ],
    table_facts: [{
      table: "INV_TXN",
      operation: "INSERT",
      columns: [
        { name: "ITEM_ID", oracle_type: "NUMBER(12)", java_type: "Long", nullable: "N", primary_key: "Y", used_by_current_sp: true },
        { name: "TXN_QTY", oracle_type: "NUMBER(10,2)", java_type: "BigDecimal", nullable: "N", primary_key: "", used_by_current_sp: true },
      ],
      sourceTrace: ["table_facts[0]"],
    }],
    cross_package_calls: [{
      target_package: "UTIL_PKG",
      target_member: "normalize_status",
      sourceTrace: ["cross_package_calls[0]"],
    }],
    control_flow: [
      { construct: "IF", line: 24, text: "IF p_qty <= 0 THEN", sourceTrace: ["control_flow[0]"] },
      { construct: "FORALL", line: 38, text: "FORALL i IN 1..l_rows.COUNT", sourceTrace: ["control_flow[1]"] },
    ],
    exception_handlers: [{ name: "OTHERS", action: "RAISE", sourceTrace: ["exception_handlers[0]"] }],
    special_syntax: [
      { construct: "FORALL", line: 38, risk: "medium", sourceTrace: ["special_syntax[0]"] },
      { construct: "COMMIT", line: 55, risk: "low", sourceTrace: ["special_syntax[1]"] },
    ],
    source_file: "pkg/inv_pkg.sql",
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

test("preserves column object depth for FSD template mapping", () => {
  const fact = compileFsdFacts(oracleL2Fact());
  assert.equal(validateFsdFacts(fact).ok, true);
  assert.ok(fact.templateDepth, "templateDepth contract is required");
  const table = fact.templateDepth.tableMappings.find((row) => row.tableName === "INV_TXN");
  assert.ok(table, "templateDepth table mapping for INV_TXN is required");
  assert.equal(table.doClassName, "InvTxnDO");
  const itemId = table.columns.find((row) => row.name === "ITEM_ID");
  assert.ok(itemId, "ITEM_ID column mapping is required");
  assert.equal(itemId.oracleType, "NUMBER(12)");
  assert.equal(itemId.javaType, "Long");
  assert.equal(itemId.javaFieldName, "itemId");
  assert.equal(itemId.nullable, "N");
  assert.equal(itemId.primaryKey, "Y");
  assert.equal(itemId.usedByCurrentSp, true);
});

test("normalizes L2 array control_flow and construct-based special_syntax", () => {
  const fact = compileFsdFacts(oracleL2Fact());
  assert.ok(fact.controlFlow.branches.some((row) => row.condition.includes("p_qty <= 0")), JSON.stringify(fact.controlFlow));
  assert.ok(fact.controlFlow.loops.some((row) => row.type === "FORALL"), JSON.stringify(fact.controlFlow));
  assert.ok(fact.specialSyntax.some((row) => row.type === "FORALL" && row.risk === "medium"), JSON.stringify(fact.specialSyntax));
  assert.ok(fact.manualReview.some((row) => row.sourceId && row.sourceId.includes("forall")), JSON.stringify(fact.manualReview));
  assert.equal(fact.transactions.hasCommit, true);
});

test("compiles dependency injection and calledBy from context without scanning source", () => {
  const fact = compileFsdFacts(oracleL2Fact(), {
    calledBy: [{
      caller: "ORDER_PKG.submit_order",
      sourceTrace: ["downstream[0]"],
    }],
  });
  assert.ok(fact.dependencies.calls.some((row) => row.target === "UTIL_PKG.normalize_status"));
  assert.ok(fact.dependencies.calledBy.some((row) => row.caller === "ORDER_PKG.submit_order"));
  const injection = fact.templateDepth.dependencyInjection.find((row) => row.sourcePackage === "UTIL_PKG");
  assert.ok(injection, "Service injection row for UTIL_PKG is required");
  assert.equal(injection.fieldName, "utilPkgService");
  assert.equal(injection.serviceType, "UtilPkgService");
});
