"use strict";

const assert = require("assert");
const { compileFsdFacts } = require("../lib/fsd-facts-compiler.cjs");
const { computeFsdCoverage } = require("../lib/fsd-facts-coverage.cjs");
const { validateFsdMarkdown } = require("../lib/fsd-facts-gate.cjs");
const { renderFsdMarkdown } = require("../lib/fsd-facts-renderer.cjs");

function sampleFacts() {
  return compileFsdFacts({
    package_name: "INV_PKG",
    method: "issue_stock",
    procedure_type: "FUNCTION",
    signature: "FUNCTION issue_stock(p_item_id IN NUMBER, p_qty IN NUMBER) RETURN VARCHAR2",
    oracle_params: [
      { name: "p_item_id", direction: "IN", oracle_type: "NUMBER(12)", java_type: "BigDecimal" },
      { name: "p_qty", direction: "IN", oracle_type: "NUMBER(10,2)", java_type: "BigDecimal" },
    ],
    return_type: "VARCHAR2(20)",
    return_java_type: "String",
    table_facts: [{
      table: "INV_TXN",
      operation: "INSERT",
      columns: [
        { name: "ITEM_ID", oracle_type: "NUMBER(12)", java_type: "Long", nullable: "N", primary_key: "Y", used_by_current_sp: true },
        { name: "TXN_QTY", oracle_type: "NUMBER(10,2)", java_type: "BigDecimal", nullable: "N", primary_key: "", used_by_current_sp: true },
      ],
    }],
    cross_package_calls: [{
      target_package: "UTIL_PKG",
      target_member: "normalize_status",
    }],
    sequence_deps: [{ sequence: "INV_TXN_SEQ" }],
    constant_deps: [{ target_package: "CONST_PKG", target_member: "STATUS_OK", value: "OK" }],
    control_flow: [
      { construct: "IF", line: 24, text: "IF p_qty <= 0 THEN" },
      { construct: "FORALL", line: 38, text: "FORALL i IN 1..l_rows.COUNT" },
    ],
    exception_handlers: [{ name: "OTHERS", action: "RAISE" }],
    special_syntax: [
      { construct: "FORALL", line: 38, risk: "medium" },
      { construct: "COMMIT", line: 55, risk: "low" },
    ],
    source_file: "pkg/inv_pkg.sql",
  }, {
    calledBy: [{ caller: "ORDER_PKG.reserve_stock" }],
  });
}

function removeLines(markdown, predicate) {
  return markdown.split(/\r?\n/).filter((line) => !predicate(line)).join("\n");
}

function mutateColumnRowToComment(markdown, columnName) {
  return markdown.replace(
    new RegExp(`(\\| ${columnName} \\|[^\\n]+\\|\\n)`),
    "<!-- $1 -->\n"
  );
}

function assertRejected(name, facts, markdown, expectedCode) {
  const gate = validateFsdMarkdown(facts, markdown);
  const coverage = computeFsdCoverage(facts, markdown);
  assert.equal(gate.ok, false, `${name} should fail validateFsdMarkdown`);
  assert.equal(coverage.ok, false, `${name} should fail computeFsdCoverage`);
  const codes = gate.errors.map((err) => err.code);
  assert.ok(codes.includes(expectedCode), `${name} expected ${expectedCode}, got ${codes.join(", ")}`);
}

function assertAdvisory(name, facts, markdown, expectedCode) {
  const gate = validateFsdMarkdown(facts, markdown);
  const coverage = computeFsdCoverage(facts, markdown);
  assert.equal(gate.ok, false, `${name} should still be recorded by strict validateFsdMarkdown`);
  assert.equal(coverage.ok, true, `${name} should not hard fail computeFsdCoverage`);
  const codes = gate.errors.map((err) => err.code);
  assert.ok(codes.includes(expectedCode), `${name} expected ${expectedCode}, got ${codes.join(", ")}`);
  assert.ok(
    coverage.templateDepth.advisoryGaps.some((err) => err.code === expectedCode),
    `${name} expected advisory gap ${expectedCode}, got ${JSON.stringify(coverage.templateDepth, null, 2)}`
  );
}

const facts = sampleFacts();
facts.transactions.hasSavepoint = true;
facts.transactions.autonomous = true;
facts.templateDepth.businessRules.validations = [{
  id: "VAL_QTY",
  category: "validation",
  description: "qty positive",
  location: "line 24",
  javaImplementation: "throw",
}];
facts.templateDepth.businessRules.calculations = [{
  id: "CALC_TOTAL",
  description: "total qty",
  oracleExpression: "p_qty * price",
  javaImplementation: "multiply",
}];
facts.templateDepth.businessRules.stateTransitions = [{
  transition: "NEW->DONE",
  condition: "ok",
  action: "insert txn",
}];
facts.templateDepth.businessRules.boundaries = [{
  condition: "p_qty <= 0",
  handling: "raise error",
  oracleBehavior: "RAISE",
  javaMapping: "throw",
}];
const markdown = renderFsdMarkdown(facts);

assertRejected(
  "wrong FSD title identity",
  facts,
  markdown.replace(`# FSD - ${facts.identity.id}`, "# FSD - INV_PKG.changed_identity"),
  "TEMPLATE_FACT_ROW_MISSING"
);

assertRejected(
  "missing params table",
  facts,
  removeLines(markdown, (line) => line.includes("| 参数名 |")),
  "TEMPLATE_TABLE_MISSING"
);

assertRejected(
  "missing column mapping row while token bullets remain",
  facts,
  removeLines(markdown, (line) => line.startsWith("| ITEM_ID | NUMBER(12) |")),
  "TEMPLATE_FACT_ROW_MISSING"
);

assertAdvisory(
  "missing service injection row",
  facts,
  removeLines(markdown, (line) => line.includes("| utilPkgService |")),
  "TEMPLATE_FACT_ROW_MISSING"
);

assertAdvisory(
  "missing calledBy row",
  facts,
  removeLines(markdown, (line) => line.includes("ORDER_PKG.reserve_stock")),
  "TEMPLATE_FACT_ROW_MISSING"
);

assertAdvisory(
  "missing validation business rule row",
  facts,
  removeLines(markdown, (line) => line.includes("| VAL_QTY |")),
  "TEMPLATE_FACT_ROW_MISSING"
);

assertAdvisory(
  "missing calculation business rule row",
  facts,
  removeLines(markdown, (line) => line.includes("| CALC_TOTAL |")),
  "TEMPLATE_FACT_ROW_MISSING"
);

assertAdvisory(
  "missing state transition business rule row",
  facts,
  removeLines(markdown, (line) => line.includes("| NEW->DONE |")),
  "TEMPLATE_FACT_ROW_MISSING"
);

assertAdvisory(
  "missing boundary business rule row",
  facts,
  removeLines(markdown, (line) => line.includes("| p_qty <= 0 | raise error |")),
  "TEMPLATE_FACT_ROW_MISSING"
);

assertRejected(
  "missing business rule subsection",
  facts,
  removeLines(markdown, (line) => line.includes("### 校验规则")),
  "SUBSECTION_MISSING"
);

assertRejected(
  "missing transaction boundary details",
  facts,
  removeLines(markdown, (line) => line.includes("显式 COMMIT")),
  "TEMPLATE_FACT_ROW_MISSING"
);

assertRejected(
  "missing savepoint transaction boundary detail",
  facts,
  removeLines(markdown, (line) => line.includes("SAVEPOINT:")),
  "TEMPLATE_FACT_ROW_MISSING"
);

assertRejected(
  "missing autonomous transaction boundary detail",
  facts,
  removeLines(markdown, (line) => line.includes("自治")),
  "TEMPLATE_FACT_ROW_MISSING"
);

assertRejected(
  "missing manual review row",
  facts,
  removeLines(markdown, (line) => line.includes("FORALL requires migration review")),
  "TEMPLATE_FACT_ROW_MISSING"
);

assertRejected(
  "HTML comment cannot satisfy template table row",
  facts,
  mutateColumnRowToComment(markdown, "ITEM_ID"),
  "TEMPLATE_FACT_ROW_MISSING"
);

console.log("PASS template-depth mutation gate rejects thin or hidden FSD content");
