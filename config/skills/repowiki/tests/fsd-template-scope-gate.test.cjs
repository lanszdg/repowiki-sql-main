"use strict";

const assert = require("assert");
const { compileFsdFacts } = require("../lib/fsd-facts-compiler.cjs");
const { computeFsdCoverage } = require("../lib/fsd-facts-coverage.cjs");
const { validateFsdMarkdown } = require("../lib/fsd-facts-gate.cjs");
const { renderFsdMarkdown } = require("../lib/fsd-facts-renderer.cjs");

function richFact() {
  return compileFsdFacts({
    package_name: "INV_PKG",
    method: "issue_stock",
    procedure_type: "PROCEDURE",
    signature: "PROCEDURE issue_stock(p_item_id IN NUMBER, p_qty IN NUMBER)",
    oracle_params: [
      { name: "p_item_id", direction: "IN", oracle_type: "NUMBER(12)", java_type: "BigDecimal" },
      { name: "p_qty", direction: "IN", oracle_type: "NUMBER(10,2)", java_type: "BigDecimal" },
    ],
    table_facts: [{
      table: "INV_TXN",
      operation: "INSERT",
      columns: [
        { name: "ITEM_ID", oracle_type: "NUMBER(12)", java_type: "Long", nullable: "N", primary_key: "Y", used_by_current_sp: true },
        { name: "TXN_QTY", oracle_type: "NUMBER(10,2)", java_type: "BigDecimal", nullable: "N", primary_key: "", used_by_current_sp: true },
      ],
    }],
    cross_package_calls: [{ target_package: "UTIL_PKG", target_member: "normalize_status" }],
    sequence_deps: [{ sequence: "INV_TXN_SEQ" }],
    control_flow: [
      { construct: "IF", line: 24, text: "IF p_qty <= 0 THEN" },
      { construct: "FORALL", line: 38, text: "FORALL i IN 1..l_rows.COUNT" },
    ],
    special_syntax: [{ construct: "FORALL", line: 38, risk: "medium" }],
    source_file: "pkg/inv_pkg.sql",
  });
}

function noTableFact() {
  return compileFsdFacts({
    package_name: "CALC_PKG",
    method: "tax_rate",
    procedure_type: "FUNCTION",
    signature: "FUNCTION tax_rate(p_amount IN NUMBER) RETURN NUMBER",
    oracle_params: [{ name: "p_amount", direction: "IN", oracle_type: "NUMBER", java_type: "BigDecimal" }],
    return_type: "NUMBER",
    return_java_type: "BigDecimal",
    table_facts: [],
    source_file: "pkg/calc_pkg.sql",
  });
}

function moveLineToAppendix(markdown, predicate) {
  const moved = [];
  const kept = markdown.split(/\r?\n/).filter((line) => {
    if (predicate(line)) {
      moved.push(line);
      return false;
    }
    return true;
  });
  assert.ok(moved.length, "mutation did not move any line");
  return `${kept.join("\n")}\n\n## Gate Appendix\n${moved.join("\n")}\n`;
}

function moveLineAfterSubsection(markdown, predicate, subsection) {
  const moved = [];
  const kept = markdown.split(/\r?\n/).filter((line) => {
    if (predicate(line)) {
      moved.push(line);
      return false;
    }
    return true;
  });
  assert.ok(moved.length, "mutation did not move any line");
  const marker = `### ${subsection}`;
  const index = kept.findIndex((line) => line.trim() === marker);
  assert.ok(index >= 0, `missing marker ${marker}`);
  kept.splice(index + 1, 0, ...moved);
  return `${kept.join("\n")}\n`;
}

function assertRejected(name, facts, markdown) {
  const result = validateFsdMarkdown(facts, markdown);
  assert.equal(result.ok, false, `${name} should be rejected`);
  assert.ok(
    result.errors.some((err) => ["EXTRA_SECTION", "TEMPLATE_FACT_ROW_MISSING"].includes(err.code)),
    `${name} expected scope/template error, got ${JSON.stringify(result.errors, null, 2)}`
  );
}

const facts = richFact();
const markdown = renderFsdMarkdown(facts);
assert.deepEqual(validateFsdMarkdown(facts, markdown), { ok: true, errors: [] });

assertRejected(
  "appendix stuffing cannot satisfy Service injection row",
  facts,
  moveLineToAppendix(markdown, (line) => line.includes("| utilPkgService |"))
);

assertRejected(
  "wrong subsection row cannot satisfy column mapping",
  facts,
  moveLineAfterSubsection(markdown, (line) => line.startsWith("| ITEM_ID | NUMBER(12) |"), "特殊列处理")
);

const emptyFacts = noTableFact();
const emptyMarkdown = renderFsdMarkdown(emptyFacts);
assert.deepEqual(validateFsdMarkdown(emptyFacts, emptyMarkdown), { ok: true, errors: [] });

const coverage = computeFsdCoverage(facts, markdown);
assert.equal(coverage.ok, true);
assert.ok(coverage.metrics.templateRequiredItemsTotal > 0, JSON.stringify(coverage.metrics));
assert.equal(coverage.metrics.templateRequiredItemsCovered, coverage.metrics.templateRequiredItemsTotal);
assert.equal(coverage.metrics.templateDepthRatio, 1);
assert.deepEqual(coverage.templateDepth.missingTemplateItems, []);
assert.ok(coverage.metrics.visibleFactsCoveredByMarkdown <= coverage.metrics.factsCoveredByMarkdown);

console.log("PASS scoped template gate rejects appendix stuffing and reports template metrics");
