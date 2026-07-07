"use strict";

const assert = require("assert");
const { compileFsdFacts } = require("../lib/fsd-facts-compiler.cjs");
const { renderFsdMarkdown } = require("../lib/fsd-facts-renderer.cjs");
const { validateFsdMarkdown, classifyFsdMarkdownGate } = require("../lib/fsd-facts-gate.cjs");

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

test("accepts renderer output with multiline SQL signature", () => {
  const fact = compileFsdFacts({
    package_name: "__STANDALONE__",
    method: "fn_abc_class",
    procedure_type: "FUNCTION",
    signature: "FUNCTION fn_abc_class(p_cum_pct in number,\n    p_a_pct   in number default 0.80,\n    p_b_pct   in number default 0.95) RETURN varchar2",
    oracle_params: [
      { name: "p_cum_pct", direction: "IN", oracle_type: "number", java_type: "BigDecimal" },
      { name: "p_a_pct", direction: "IN", oracle_type: "number default 0.80", java_type: "BigDecimal" },
      { name: "p_b_pct", direction: "IN", oracle_type: "number default 0.95", java_type: "BigDecimal" },
    ],
    return_type: "varchar2",
    return_java_type: "String",
    source_file: "func/fn_abc_class.sql",
  });
  const markdown = renderFsdMarkdown(fact);
  assert.ok(markdown.includes(fact.signature.raw), "renderer must preserve multiline signature block");
  assert.deepEqual(validateFsdMarkdown(fact, markdown), { ok: true, errors: [] });
});

test("classifies enriched UNKNOWN template values as non-blocking", () => {
  const fact = compileFsdFacts({
    package_name: "ITEM_PKG",
    method: "find_item",
    procedure_type: "FUNCTION",
    signature: "FUNCTION find_item(p_item_id IN NUMBER) RETURN VARCHAR2",
    oracle_params: [{ name: "p_item_id", direction: "IN", oracle_type: "NUMBER", java_type: "UNKNOWN" }],
    return_type: "VARCHAR2",
    return_java_type: "UNKNOWN",
    table_facts: [{
      table: "ITEM_MASTER",
      operation: "SELECT",
      columns: [{ name: "ITEM_ID", oracleType: "UNKNOWN", javaType: "UNKNOWN", nullable: "UNKNOWN", primaryKey: "", usedByCurrentSp: "UNKNOWN" }],
      sourceTrace: ["table_facts[0]"],
    }],
    source_file: "pkg/item_pkg.sql",
  });
  const markdown = renderFsdMarkdown(fact)
    .replace("| p_item_id | IN | NUMBER | UNKNOWN |", "| p_item_id | IN | NUMBER | BigDecimal |")
    .replace("| VARCHAR2 | UNKNOWN | Function", "| VARCHAR2 | String | Function")
    .replace("| ITEM_ID | UNKNOWN | UNKNOWN |  | UNKNOWN |  | UNKNOWN |", "| ITEM_ID | NUMBER | BigDecimal | itemId | N | Y | yes |");
  const result = classifyFsdMarkdownGate(fact, markdown);
  assert.equal(result.hardOk, true, JSON.stringify(result, null, 2));
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
  const markdown = renderFsdMarkdown(fact).replace(/INV_TXN/g, "");
  assertError(validateFsdMarkdown(fact, markdown), "TEMPLATE_FACT_ROW_MISSING");
});

test("rejects omitted identity, parameter, and table column facts from Markdown", () => {
  const fact = sampleFact();
  const markdown = renderFsdMarkdown(fact)
    .replace(/^\| 所属包 \| INVENTORY_PKG \|\r?\n/m, "")
    .replace(/^\| 子程序名 \| bulk_receive \|\r?\n/m, "")
    .replace(/^\| 类型 \| PROCEDURE \|\r?\n/m, "")
    .replace(/^\| p_item_id \| IN \| NUMBER \| BigDecimal \|.*\r?\n/m, "")
    .replace(/^\| ITEM_ID \|.*\r?\n/m, "");
  assertError(validateFsdMarkdown(fact, markdown), "TEMPLATE_FACT_ROW_MISSING");
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
  const markdown = renderFsdMarkdown(fact).replace(/^\| NUMBER \| BigDecimal \| Function 返回值映射 \|\r?\n/m, "");
  assertError(validateFsdMarkdown(fact, markdown), "TEMPLATE_FACT_ROW_MISSING");
});

test("rejects omitted control-flow facts from Markdown", () => {
  const fact = sampleFact();
  const markdown = renderFsdMarkdown(fact)
    .replace(/^\| n1 \| validate input \|\r?\n/m, "")
    .replace(/^\| b1 \| p_item_id is null \|.*\r?\n/m, "")
    .replace(/^\| l1 \| FOR_LOOP \|.*\r?\n/m, "");
  assertError(validateFsdMarkdown(fact, markdown), "TEMPLATE_FACT_ROW_MISSING");
});

test("rejects omitted exception and transaction facts from Markdown", () => {
  const fact = sampleFact();
  const markdown = renderFsdMarkdown(fact)
    .replace(/^\| OTHERS \| RAISE \| Java exception \/ rollback \| RAISE \|\r?\n/m, "")
    .replace(/^- 显式 COMMIT: 是\r?\n/m, "");
  assertError(validateFsdMarkdown(fact, markdown), "TEMPLATE_FACT_ROW_MISSING");
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
