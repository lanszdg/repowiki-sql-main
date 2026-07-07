"use strict";

const assert = require("assert");
const { compileFsdFacts } = require("../lib/fsd-facts-compiler.cjs");
const { computeFsdCoverage } = require("../lib/fsd-facts-coverage.cjs");
const { validateFsdMarkdown } = require("../lib/fsd-facts-gate.cjs");
const { renderFsdMarkdown } = require("../lib/fsd-facts-renderer.cjs");

function deliveryFact() {
  return compileFsdFacts({
    package_name: "INV_PKG",
    method: "issue_stock",
    procedure_type: "PROCEDURE",
    signature: "PROCEDURE issue_stock(p_item_id IN NUMBER)",
    oracle_params: [{ name: "p_item_id", direction: "IN", oracle_type: "NUMBER", java_type: "BigDecimal" }],
    table_facts: [{
      table: "INV_TXN",
      operation: "INSERT",
      columns: [{ name: "ITEM_ID", oracle_type: "NUMBER", java_type: "Long", nullable: "N", primary_key: "Y", used_by_current_sp: true }],
    }],
    cross_package_calls: [{ target_package: "UTIL_PKG", target_member: "normalize_status" }],
    control_flow: {
      nodes: [{ id: "n1", label: "validate input" }],
      branches: [{ id: "b1", condition: "p_item_id is null" }],
      loops: [],
    },
    exception_handlers: [{ name: "OTHERS", action: "RAISE" }],
    special_syntax: [{ construct: "FORALL", line: 42, risk: "medium" }],
    source_file: "pkg/inv_pkg.sql",
  });
}

function removeLines(markdown, predicate) {
  return markdown.split(/\r?\n/).filter((line) => !predicate(line)).join("\n");
}

const facts = deliveryFact();
const markdown = renderFsdMarkdown(facts);
const debugPatterns = [
  /^- FactId:/m,
  /^- Package:/m,
  /^- Subprogram:/m,
  /^- Kind:/m,
  /^- Signature:/m,
  /^- Param:/m,
  /^- Table:/m,
  /^\s+- Column:/m,
  /^- Call:/m,
  /^- FlowNode:/m,
  /^- Branch:/m,
  /^- Loop:/m,
  /^- Exception:/m,
  /^- Transaction:/m,
  /^- ManualReview:/m,
  /^- Syntax:/m,
  /^- SourceTrace:/m,
];

assert.deepEqual(validateFsdMarkdown(facts, markdown), { ok: true, errors: [] });
assert.equal(computeFsdCoverage(facts, markdown).ok, true);
for (const pattern of debugPatterns) {
  assert.equal(pattern.test(markdown), false, `final FSD exposes debug token ${pattern}\n${markdown}`);
}
assert.ok(markdown.includes("| 节点 ID | 步骤 |"), markdown);
assert.ok(markdown.includes("| n1 | validate input |"), markdown);

const missingFlowNode = removeLines(markdown, (line) => line.startsWith("| n1 | validate input |"));
const gate = validateFsdMarkdown(facts, missingFlowNode);
assert.equal(gate.ok, false, "missing flow node row should fail gate");
assert.ok(gate.errors.some((err) => err.path === "template.flowNodes.n1"), JSON.stringify(gate.errors, null, 2));

console.log("PASS delivery FSD markdown hides debug tokens and keeps flow facts in template content");
