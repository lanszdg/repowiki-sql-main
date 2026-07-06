"use strict";

const assert = require("assert");
const { compileFsdFacts } = require("../lib/fsd-facts-compiler.cjs");
const { renderFsdMarkdown } = require("../lib/fsd-facts-renderer.cjs");
const { validateFsdMarkdown } = require("../lib/fsd-facts-gate.cjs");

function sampleFact() {
  return compileFsdFacts({
    package_name: "INVENTORY_PKG",
    method: "bulk_receive",
    procedure_type: "PROCEDURE",
    signature: "PROCEDURE bulk_receive(p_item_id IN NUMBER)",
    oracle_params: [{ name: "p_item_id", direction: "IN", oracle_type: "NUMBER", java_type: "BigDecimal" }],
    table_facts: [{ table: "INV_TXN", operation: "INSERT", columns: ["ITEM_ID"], sourceTrace: ["table_facts[0]"] }],
    cross_package_calls: [{ target_package: "UTIL_PKG", target_member: "get_param", sourceTrace: ["cross_package_calls[0]"] }],
    sequence_deps: [{ sequence: "INV_TXN_SEQ", sourceTrace: ["sequence_deps[0]"] }],
    constant_deps: [{ target_package: "CONST_PKG", target_member: "STATUS_OK", value: "OK", sourceTrace: ["constant_deps[0]"] }],
    control_flow: {
      nodes: [{ id: "n1", label: "validate input", sourceTrace: ["control_flow.nodes[0]"] }],
      branches: [{ id: "b1", condition: "p_item_id is null", sourceTrace: ["control_flow.branches[0]"] }],
      loops: [{ id: "l1", type: "FOR_LOOP", sourceTrace: ["control_flow.loops[0]"] }],
    },
    exception_handlers: [{ name: "OTHERS", action: "RAISE", sourceTrace: ["exception_handlers[0]"] }],
    transactions: { hasCommit: true, hasRollback: true, hasSavepoint: false, autonomous: false },
    special_syntax: [{ id: "forall-1", type: "FORALL", risk: "medium", sourceTrace: ["special_syntax[0]"] }],
    source_file: "pkg/inventory_pkg.sql",
  });
}

function assertError(result, code) {
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((err) => err.code === code), JSON.stringify(result.errors, null, 2));
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

test("accepts renderer output", () => {
  const fact = sampleFact();
  const markdown = renderFsdMarkdown(fact);
  assert.deepEqual(validateFsdMarkdown(fact, markdown), { ok: true, errors: [] });
});

test("rejects missing section", () => {
  const fact = sampleFact();
  const markdown = renderFsdMarkdown(fact).replace(/## 依赖分析[\s\S]*?(?=## 业务规则)/, "");
  assertError(validateFsdMarkdown(fact, markdown), "SECTION_MISSING");
});

test("rejects numbered headings", () => {
  const fact = sampleFact();
  const markdown = renderFsdMarkdown(fact).replace("## 概览", "## 1. 概览");
  assertError(validateFsdMarkdown(fact, markdown), "NUMBERED_SECTION_HEADING");
});

test("rejects facts omitted from Markdown", () => {
  const fact = sampleFact();
  const markdown = renderFsdMarkdown(fact).replace("INV_TXN", "");
  assertError(validateFsdMarkdown(fact, markdown), "FACT_NOT_RENDERED");
});

test("rejects omitted identity, parameter, and table column facts from Markdown", () => {
  const fact = sampleFact();
  const markdown = renderFsdMarkdown(fact)
    .replace("- Package: INVENTORY_PKG\n", "")
    .replace("- Subprogram: bulk_receive\n", "")
    .replace("- Kind: PROCEDURE\n", "")
    .replace("- Param: p_item_id | IN | NUMBER | BigDecimal\n", "")
    .replace(/  - Columns: ITEM_ID\n/, "");
  assertError(validateFsdMarkdown(fact, markdown), "FACT_NOT_RENDERED");
});

test("rejects omitted function return mapping from Markdown", () => {
  const fact = compileFsdFacts({
    package_name: "INVENTORY_PKG",
    method: "current_stock",
    procedure_type: "FUNCTION",
    signature: "FUNCTION current_stock(p_item_id IN NUMBER) RETURN NUMBER",
    oracle_params: [{ name: "p_item_id", direction: "IN", oracle_type: "NUMBER", java_type: "BigDecimal" }],
    return_type: "NUMBER",
    return_java_type: "BigDecimal",
    table_facts: [],
    source_file: "pkg/inventory_pkg.sql",
  });
  const markdown = renderFsdMarkdown(fact).replace("- Return: Oracle NUMBER -> Java BigDecimal\n", "");
  assertError(validateFsdMarkdown(fact, markdown), "FACT_NOT_RENDERED");
});

test("rejects omitted control-flow facts from Markdown", () => {
  const fact = sampleFact();
  const markdown = renderFsdMarkdown(fact)
    .replace("- FlowNode: n1 | validate input\n", "")
    .replace("- Branch: b1 | p_item_id is null\n", "")
    .replace("- Loop: l1 | FOR_LOOP\n", "");
  assertError(validateFsdMarkdown(fact, markdown), "FACT_NOT_RENDERED");
});

test("rejects omitted exception and transaction facts from Markdown", () => {
  const fact = sampleFact();
  const markdown = renderFsdMarkdown(fact)
    .replace("- Exception: OTHERS -> RAISE\n", "")
    .replace("- Transaction: commit=true, rollback=true, savepoint=false, autonomous=false\n", "");
  assertError(validateFsdMarkdown(fact, markdown), "FACT_NOT_RENDERED");
});

test("rejects orphan structural facts in Markdown", () => {
  const fact = sampleFact();
  const markdown = `${renderFsdMarkdown(fact)}\n- Table: SHADOW_TABLE\n`;
  assertError(validateFsdMarkdown(fact, markdown), "MARKDOWN_FACT_WITHOUT_TRACE");
});

test("rejects output path mismatch when provided", () => {
  const fact = sampleFact();
  const markdown = renderFsdMarkdown(fact);
  assertError(validateFsdMarkdown(fact, markdown, { outputPath: "fsd/OTHER/bulk_receive.md" }), "OUTPUT_PATH_MISMATCH");
});
