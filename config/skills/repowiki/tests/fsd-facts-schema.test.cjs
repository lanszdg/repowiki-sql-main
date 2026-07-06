"use strict";

const assert = require("assert");
const {
  FSD_FACTS_SCHEMA_VERSION,
  SECTION_IDS,
  REQUIRED_FACT_FIELDS,
  validateFsdFacts,
  validateFsdFactsBatch,
} = require("../lib/fsd-facts-schema.cjs");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validFact(overrides = {}) {
  const base = {
    schemaVersion: FSD_FACTS_SCHEMA_VERSION,
    identity: {
      id: "INVENTORY_PKG.bulk_receive",
      packageName: "INVENTORY_PKG",
      subprogramName: "bulk_receive",
      refName: "bulk_receive",
      kind: "PROCEDURE",
      overloadIndex: null,
      outputPath: "fsd/INVENTORY_PKG/bulk_receive.md",
    },
    signature: {
      raw: "PROCEDURE bulk_receive(p_item_id IN NUMBER)",
      params: [{ name: "p_item_id", direction: "IN", oracleType: "NUMBER", javaType: "BigDecimal" }],
      return: null,
    },
    tableMappings: [{
      tableName: "INV_TXN",
      operations: ["INSERT"],
      columns: ["ITEM_ID"],
      sourceTrace: ["table_facts[0]"],
    }],
    dependencies: {
      calls: [{ target: "UTIL_PKG.get_param", sourceTrace: ["cross_package_calls[0]"] }],
      calledBy: [],
      sequences: [{ name: "INV_TXN_SEQ", sourceTrace: ["sequence_deps[0]"] }],
      constants: [{ target: "CONST_PKG.STATUS_OK", value: "OK", sourceTrace: ["constant_deps[0]"] }],
    },
    controlFlow: {
      nodes: [{ id: "n1", label: "validate input", sourceTrace: ["control_flow.nodes[0]"] }],
      branches: [],
      loops: [],
      mermaidHint: "",
    },
    exceptions: [{ name: "OTHERS", action: "RAISE", sourceTrace: ["exception_handlers[0]"] }],
    transactions: {
      hasCommit: false,
      hasRollback: false,
      hasSavepoint: false,
      autonomous: false,
      springEquivalent: "",
    },
    specialSyntax: [{
      id: "syn-dynamic-sql",
      type: "dynamic_sql",
      risk: "high",
      mapping: "Use reviewed MyBatis dynamic SQL",
      sourceTrace: ["special_syntax[0]"],
    }],
    manualReview: [{
      id: "review-dynamic-sql",
      sourceId: "syn-dynamic-sql",
      severity: "high",
      reason: "Dynamic SQL requires manual migration review",
    }],
    sourceTrace: [{ file: "pkg/inventory_pkg.sql", startLine: 1, endLine: 80, fact: "subprogram" }],
    coverage: {
      requiredSections: SECTION_IDS,
      factsTotal: 1,
      factsCoveredByMarkdown: 0,
      gaps: [],
    },
  };
  return { ...base, ...overrides };
}

function assertHasError(result, code, path) {
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((err) => err.code === code && (!path || err.path === path)), JSON.stringify(result.errors, null, 2));
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

test("exports schema contract constants", () => {
  assert.equal(FSD_FACTS_SCHEMA_VERSION, 1);
  assert.ok(Array.isArray(SECTION_IDS));
  assert.ok(SECTION_IDS.length >= 6);
  assert.ok(REQUIRED_FACT_FIELDS.includes("identity"));
  assert.equal(typeof validateFsdFacts, "function");
  assert.equal(typeof validateFsdFactsBatch, "function");
});

test("accepts a valid fsd-facts contract", () => {
  const result = validateFsdFacts(validFact());
  assert.deepEqual(result, { ok: true, errors: [] });
});

test("rejects each missing required top-level field with a path", () => {
  for (const field of REQUIRED_FACT_FIELDS) {
    const fact = validFact();
    delete fact[field];
    const result = validateFsdFacts(fact);
    assertHasError(result, "REQUIRED_FIELD_MISSING", field);
  }
});

test("rejects contracts without sourceTrace", () => {
  const fact = validFact({ sourceTrace: [] });
  const result = validateFsdFacts(fact);
  assertHasError(result, "SOURCE_TRACE_REQUIRED", "sourceTrace");
});

test("rejects high and medium special syntax not covered by manualReview", () => {
  for (const risk of ["high", "medium"]) {
    const fact = validFact({
      specialSyntax: [{ id: `syn-${risk}`, type: "FORALL", risk, sourceTrace: ["special_syntax[0]"] }],
      manualReview: [],
    });
    const result = validateFsdFacts(fact);
    assertHasError(result, "MANUAL_REVIEW_REQUIRED", "manualReview");
  }
});

test("rejects duplicate identity and outputPath in a batch", () => {
  const first = validFact();
  const second = validFact({
    identity: {
      ...validFact().identity,
      subprogramName: "bulk_receive_copy",
      refName: "bulk_receive_copy",
    },
  });
  const duplicateIdentity = validateFsdFactsBatch([first, second]);
  assertHasError(duplicateIdentity, "IDENTITY_DUPLICATE", "identity.id");

  const third = validFact();
  third.identity.id = "INVENTORY_PKG.other";
  const duplicatePath = validateFsdFactsBatch([first, third]);
  assertHasError(duplicatePath, "OUTPUT_PATH_COLLISION", "identity.outputPath");
});

