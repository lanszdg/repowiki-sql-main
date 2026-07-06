"use strict";

const {
  FSD_FACTS_SCHEMA_VERSION,
  SECTION_IDS,
  validateFsdFacts,
} = require("./fsd-facts-schema.cjs");
const { listFactTokens } = require("./fsd-fact-tokens.cjs");

const SQL_ALIAS_NOISE = new Set([
  "OLD_SET",
  "NEW_SET",
  "TABLE",
  "S",
  "TGT",
  "SRC",
  "REC",
  "ROW",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanName(value) {
  return String(value || "").trim();
}

function isNoiseName(value) {
  const name = cleanName(value);
  return !name || SQL_ALIAS_NOISE.has(name.toUpperCase());
}

function traceOf(row, fallback) {
  if (row && Array.isArray(row.sourceTrace) && row.sourceTrace.length) return row.sourceTrace;
  return [fallback];
}

function dotName(pkg, member) {
  const left = cleanName(pkg);
  const right = cleanName(member);
  return left && right ? `${left}.${right}` : "";
}

function riskOf(row) {
  const risk = String(row && row.risk || row && row.severity || "").toLowerCase();
  if (risk === "high" || risk === "medium" || risk === "low") return risk;
  return "";
}

function compileIdentity(l2Fact) {
  const packageName = cleanName(l2Fact.package_name || l2Fact.packageName || l2Fact.service_iface || l2Fact.impl_qn);
  const subprogramName = cleanName(l2Fact.method || l2Fact.subprogramName || l2Fact.name);
  const overloadRaw = l2Fact.overload_index ?? l2Fact.overloadIndex ?? null;
  const overloadIndex = overloadRaw === undefined || overloadRaw === null || overloadRaw === "" ? null : Number(overloadRaw);
  const overloadSuffix = overloadIndex === null ? "" : `#${overloadIndex}`;
  const pathSuffix = overloadIndex === null ? "" : `__overload_${overloadIndex}`;
  return {
    id: `${packageName}.${subprogramName}${overloadSuffix}`,
    packageName,
    subprogramName,
    refName: overloadIndex === null ? subprogramName : `${subprogramName}${overloadSuffix}`,
    kind: cleanName(l2Fact.procedure_type || l2Fact.kind || "PROCEDURE").toUpperCase(),
    overloadIndex,
    outputPath: `fsd/${packageName}/${subprogramName}${pathSuffix}.md`,
  };
}

function compileSignature(l2Fact) {
  return {
    raw: cleanName(l2Fact.signature),
    params: asArray(l2Fact.oracle_params || l2Fact.params).map((param) => ({
      name: cleanName(param.name),
      direction: cleanName(param.direction || param.mode || "IN").toUpperCase(),
      oracleType: cleanName(param.oracle_type || param.oracleType || param.type),
      javaType: cleanName(param.java_type || param.javaType),
    })),
    return: l2Fact.return_type ? {
      oracleType: cleanName(l2Fact.return_type),
      javaType: cleanName(l2Fact.return_java_type || l2Fact.response_type),
    } : null,
  };
}

function compileTableMappings(l2Fact) {
  return asArray(l2Fact.table_facts).filter((row) => !isNoiseName(row.table || row.tableName)).map((row, index) => ({
    tableName: cleanName(row.table || row.tableName),
    operations: [cleanName(row.operation || row.op || row.action || "UNKNOWN").toUpperCase()].filter(Boolean),
    columns: asArray(row.columns).map((col) => typeof col === "string" ? col : cleanName(col.name || col.column)).filter(Boolean),
    sourceTrace: traceOf(row, `table_facts[${index}]`),
  }));
}

function compileDependencies(l2Fact) {
  const calls = asArray(l2Fact.cross_package_calls)
    .filter((row) => !isNoiseName(row.target_package || row.packageName))
    .map((row, index) => ({
      target: dotName(row.target_package || row.packageName, row.target_member || row.member || row.method),
      sourceTrace: traceOf(row, `cross_package_calls[${index}]`),
    }))
    .filter((row) => row.target);

  const sequences = asArray(l2Fact.sequence_deps).map((row, index) => ({
    name: cleanName(row.sequence || row.name),
    sourceTrace: traceOf(row, `sequence_deps[${index}]`),
  })).filter((row) => row.name && !isNoiseName(row.name));

  const constants = asArray(l2Fact.constant_deps)
    .filter((row) => !isNoiseName(row.target_package || row.packageName))
    .map((row, index) => ({
      target: dotName(row.target_package || row.packageName, row.target_member || row.member || row.name),
      value: row.value ?? null,
      sourceTrace: traceOf(row, `constant_deps[${index}]`),
    }))
    .filter((row) => row.target);

  return { calls, calledBy: [], sequences, constants };
}

function compileControlFlow(l2Fact) {
  const flow = isObject(l2Fact.control_flow) ? l2Fact.control_flow : {};
  return {
    nodes: asArray(flow.nodes),
    branches: asArray(flow.branches),
    loops: asArray(flow.loops),
    mermaidHint: cleanName(flow.mermaidHint || flow.mermaid || ""),
  };
}

function compileExceptions(l2Fact) {
  return asArray(l2Fact.exception_handlers).map((row, index) => ({
    name: cleanName(row.name || row.exception || row.when),
    action: cleanName(row.action || row.handler || row.statement),
    sourceTrace: traceOf(row, `exception_handlers[${index}]`),
  })).filter((row) => row.name || row.action);
}

function compileTransactions(l2Fact, specialSyntax) {
  const tx = isObject(l2Fact.transactions) ? l2Fact.transactions : {};
  const syntaxTypes = specialSyntax.map((row) => String(row.type || "").toUpperCase());
  return {
    hasCommit: Boolean(tx.hasCommit || tx.has_commit || syntaxTypes.includes("COMMIT")),
    hasRollback: Boolean(tx.hasRollback || tx.has_rollback || syntaxTypes.includes("ROLLBACK")),
    hasSavepoint: Boolean(tx.hasSavepoint || tx.has_savepoint || syntaxTypes.includes("SAVEPOINT")),
    autonomous: Boolean(tx.autonomous || syntaxTypes.includes("AUTONOMOUS_TRANSACTION")),
    springEquivalent: cleanName(tx.springEquivalent || tx.spring_equivalent),
  };
}

function compileSpecialSyntax(l2Fact) {
  return asArray(l2Fact.special_syntax).map((row, index) => {
    const type = cleanName(row.type || row.kind || "special");
    return {
      id: cleanName(row.id || `${type.toLowerCase()}-${index + 1}`),
      type,
      risk: riskOf(row),
      mapping: cleanName(row.mapping || row.javaMapping || row.target || ""),
      sourceTrace: traceOf(row, `special_syntax[${index}]`),
    };
  });
}

function compileManualReview(specialSyntax) {
  return specialSyntax
    .filter((row) => row.risk === "high" || row.risk === "medium")
    .map((row) => ({
      id: `review-${row.id}`,
      sourceId: row.id,
      severity: row.risk,
      reason: `${row.type} requires migration review`,
    }));
}

function compileSourceTrace(l2Fact) {
  return [{
    file: cleanName(l2Fact.source_file || l2Fact.sourceFile || l2Fact.file || "<l2-facts>"),
    startLine: Number(l2Fact.start_line || l2Fact.startLine || 1),
    endLine: Number(l2Fact.end_line || l2Fact.endLine || l2Fact.start_line || l2Fact.startLine || 1),
    fact: "subprogram",
  }];
}

function compileFsdFacts(l2Fact) {
  if (!isObject(l2Fact)) throw new Error("compileFsdFacts requires an L2 Oracle fact object");
  const identity = compileIdentity(l2Fact);
  const signature = compileSignature(l2Fact);
  const tableMappings = compileTableMappings(l2Fact);
  const dependencies = compileDependencies(l2Fact);
  const controlFlow = compileControlFlow(l2Fact);
  const exceptions = compileExceptions(l2Fact);
  const specialSyntax = compileSpecialSyntax(l2Fact);
  const manualReview = compileManualReview(specialSyntax);
  const sourceTrace = compileSourceTrace(l2Fact);
  const fact = {
    schemaVersion: FSD_FACTS_SCHEMA_VERSION,
    identity,
    signature,
    tableMappings,
    dependencies,
    controlFlow,
    exceptions,
    transactions: compileTransactions(l2Fact, specialSyntax),
    specialSyntax,
    manualReview,
    sourceTrace,
    coverage: {
      requiredSections: SECTION_IDS,
      factsTotal: 0,
      factsCoveredByMarkdown: 0,
      gaps: [],
    },
  };
  fact.coverage.factsTotal = listFactTokens(fact).length;
  const result = validateFsdFacts(fact);
  if (!result.ok) {
    const error = new Error(`compiled fsd-facts failed validation: ${result.errors.map((row) => `${row.code}:${row.path}`).join(", ")}`);
    error.validation = result;
    throw error;
  }
  return fact;
}

module.exports = {
  compileFsdFacts,
  SQL_ALIAS_NOISE,
};
