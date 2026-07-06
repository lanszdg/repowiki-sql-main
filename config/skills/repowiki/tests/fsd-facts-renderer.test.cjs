"use strict";

const assert = require("assert");
const { compileFsdFacts } = require("../lib/fsd-facts-compiler.cjs");
const { renderFsdMarkdown, FSD_MARKDOWN_SECTIONS } = require("../lib/fsd-facts-renderer.cjs");

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

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

test("renders exactly six fixed second-level sections in order", () => {
  const markdown = renderFsdMarkdown(sampleFact());
  const headings = markdown.split(/\r?\n/).filter((line) => line.startsWith("## "));
  assert.deepEqual(headings, FSD_MARKDOWN_SECTIONS.map((title) => `## ${title}`));
  assert.ok(!/^##\s+\d+[.)]/m.test(markdown));
});

test("renders key contract facts into Markdown", () => {
  const markdown = renderFsdMarkdown(sampleFact());
  for (const token of [
    "INVENTORY_PKG.bulk_receive",
    "PROCEDURE bulk_receive",
    "Package: INVENTORY_PKG",
    "Subprogram: bulk_receive",
    "Kind: PROCEDURE",
    "Param: p_item_id | IN | NUMBER | BigDecimal",
    "INV_TXN",
    "Column: INV_TXN.ITEM_ID",
    "UTIL_PKG.get_param",
    "INV_TXN_SEQ",
    "CONST_PKG.STATUS_OK",
    "FlowNode: n1 | validate input",
    "Branch: b1 | p_item_id is null",
    "Loop: l1 | FOR_LOOP",
    "Exception: OTHERS -> RAISE",
    "Transaction: commit=true, rollback=true, savepoint=false, autonomous=false",
    "FORALL",
    "review-forall-1",
    "pkg/inventory_pkg.sql",
  ]) {
    assert.ok(markdown.includes(token), `missing token ${token}`);
  }
});

test("renders function return mapping into Markdown", () => {
  const markdown = renderFsdMarkdown(compileFsdFacts({
    package_name: "INVENTORY_PKG",
    method: "current_stock",
    procedure_type: "FUNCTION",
    signature: "FUNCTION current_stock(p_item_id IN NUMBER) RETURN NUMBER",
    oracle_params: [{ name: "p_item_id", direction: "IN", oracle_type: "NUMBER", java_type: "BigDecimal" }],
    return_type: "NUMBER",
    return_java_type: "BigDecimal",
    source_file: "pkg/inventory_pkg.sql",
  }));
  assert.ok(markdown.includes("Return: Oracle NUMBER -> Java BigDecimal"), markdown);
});

test("renders placeholder text for empty sections", () => {
  const fact = sampleFact();
  fact.tableMappings = [];
  fact.dependencies.calls = [];
  fact.dependencies.sequences = [];
  fact.dependencies.constants = [];
  fact.exceptions = [];
  fact.specialSyntax = [];
  fact.manualReview = [];
  const markdown = renderFsdMarkdown(fact);
  assert.ok(markdown.includes("- None"));
});
