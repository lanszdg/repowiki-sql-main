"use strict";

const assert = require("assert");
const { compileFsdFacts } = require("../lib/fsd-facts-compiler.cjs");
const { renderFsdMarkdown } = require("../lib/fsd-facts-renderer.cjs");

function sampleFact() {
  return compileFsdFacts({
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
    sequence_deps: [{ sequence: "INV_TXN_SEQ", sourceTrace: ["sequence_deps[0]"] }],
    constant_deps: [{ target_package: "CONST_PKG", target_member: "STATUS_OK", value: "OK", sourceTrace: ["constant_deps[0]"] }],
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
  });
}

function assertIncludes(markdown, needle) {
  assert.ok(markdown.includes(needle), `missing ${needle}\n${markdown}`);
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

test("renderer outputs Oracle-SP FSD template tables instead of token-only bullets", () => {
  const markdown = renderFsdMarkdown(sampleFact());
  assertIncludes(markdown, "| 参数名 | 方向 | Oracle 类型 | Java 类型 | 说明 |");
  assertIncludes(markdown, "| 表名 | 操作类型 | DO 类名 | 说明 |");
  assertIncludes(markdown, "| 列名 | Oracle 类型 | Java 类型 | Java 字段名 | 可空 | 主键 | 本 SP 使用 |");
  assertIncludes(markdown, "| 字段 | 类型 | 来源包 | 用途 |");
  assertIncludes(markdown, "### 校验规则");
  assertIncludes(markdown, "### 计算逻辑");
  assertIncludes(markdown, "### 状态流转");
  assertIncludes(markdown, "### 边界条件");
  assertIncludes(markdown, "### 事务边界");
  assertIncludes(markdown, "### 需手动审查的构造");
  assertIncludes(markdown, "| ITEM_ID | NUMBER(12) | Long | itemId | N | Y | 是 |");
  assertIncludes(markdown, "| utilPkgService | UtilPkgService | UTIL_PKG | normalize_status |");
});
