"use strict";

const { FSD_MARKDOWN_SECTIONS } = require("./fsd-facts-renderer.cjs");
const { listFactTokens, transactionToken } = require("./fsd-fact-tokens.cjs");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function addError(errors, code, path, message) {
  errors.push({ code, path, message });
}

function expectedTokens(facts) {
  return listFactTokens(facts).map((token) => token.label || token.value).filter(Boolean);
}

function expectedStructuralKeys(facts) {
  const deps = facts.dependencies || {};
  const controlFlow = facts.controlFlow || {};
  const keys = new Set();
  if (facts.identity && facts.identity.packageName) keys.add(`Package:${facts.identity.packageName}`);
  if (facts.identity && facts.identity.subprogramName) keys.add(`Subprogram:${facts.identity.subprogramName}`);
  if (facts.identity && facts.identity.kind) keys.add(`Kind:${facts.identity.kind}`);
  for (const param of asArray(facts.signature && facts.signature.params)) keys.add(`Param:${param.name || ""} | ${param.direction || ""} | ${param.oracleType || ""} | ${param.javaType || ""}`);
  if (facts.signature && facts.signature.return && facts.signature.return.oracleType) {
    keys.add(`Return:Oracle ${facts.signature.return.oracleType || ""} -> Java ${facts.signature.return.javaType || ""}`);
  } else {
    keys.add("Return:None");
  }
  for (const row of asArray(facts.tableMappings)) keys.add(`Table:${row.tableName}`);
  for (const row of asArray(facts.tableMappings)) {
    for (const op of asArray(row.operations)) keys.add(`Operation:${row.tableName}.${op}`);
    for (const col of asArray(row.columns)) keys.add(`Column:${row.tableName}.${typeof col === "string" ? col : (col && (col.name || col.column || col.columnName))}`);
  }
  for (const row of asArray(deps.calls)) keys.add(`Call:${row.target}`);
  for (const row of asArray(deps.sequences)) keys.add(`Sequence:${row.name}`);
  for (const row of asArray(deps.constants)) keys.add(`Constant:${row.target}`);
  for (const row of asArray(controlFlow.nodes)) keys.add(`FlowNode:${row.id || ""} | ${row.label || ""}`);
  for (const row of asArray(controlFlow.branches)) keys.add(`Branch:${row.id || ""} | ${row.condition || ""}`);
  for (const row of asArray(controlFlow.loops)) keys.add(`Loop:${row.id || ""} | ${row.type || ""}`);
  for (const row of asArray(facts.exceptions)) keys.add(`Exception:${row.name || ""} -> ${row.action || ""}`);
  keys.add(`Transaction:${transactionToken(facts.transactions).slice("Transaction: ".length)}`);
  for (const row of asArray(facts.specialSyntax)) keys.add(`Syntax:${row.id}`);
  return keys;
}

function markdownStructuralKeys(markdown) {
  const keys = [];
  const re = /^\s*- (Package|Subprogram|Kind|Param|Return|Table|Operation|Column|Call|Sequence|Constant|Syntax|FlowNode|Branch|Loop|Exception|Transaction):\s*([^\n]+)/gm;
  let match;
  while ((match = re.exec(markdown))) {
    const prefix = match[1];
    const raw = match[2].trim();
    const value = ["Table", "Call", "Sequence", "Constant", "Syntax"].includes(prefix)
      ? raw.split("|")[0].trim()
      : raw;
    keys.push(`${prefix}:${value}`);
  }
  return keys;
}

function validateSections(markdown, errors) {
  if (/^##\s+\d+[.)]\s*/m.test(markdown)) {
    addError(errors, "NUMBERED_SECTION_HEADING", "sections", "FSD section headings must not be numbered");
  }
  const headings = markdown.split(/\r?\n/)
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3).trim());
  for (const section of FSD_MARKDOWN_SECTIONS) {
    if (!headings.includes(section)) addError(errors, "SECTION_MISSING", "sections", `missing section ${section}`);
  }
  if (FSD_MARKDOWN_SECTIONS.every((section) => headings.includes(section))) {
    const actual = headings.filter((heading) => FSD_MARKDOWN_SECTIONS.includes(heading));
    if (actual.join("\n") !== FSD_MARKDOWN_SECTIONS.join("\n")) {
      addError(errors, "SECTION_ORDER_INVALID", "sections", "FSD sections are out of order");
    }
  }
}

function validateFsdMarkdown(facts, markdown, options = {}) {
  const errors = [];
  const text = String(markdown || "");
  if (options.outputPath && facts.identity && facts.identity.outputPath && options.outputPath !== facts.identity.outputPath) {
    addError(errors, "OUTPUT_PATH_MISMATCH", "identity.outputPath", "provided output path does not match facts identity");
  }

  validateSections(text, errors);

  for (const token of expectedTokens(facts)) {
    if (!text.includes(token)) addError(errors, "FACT_NOT_RENDERED", "markdown", `missing rendered fact ${token}`);
  }

  const expectedKeys = expectedStructuralKeys(facts);
  for (const key of markdownStructuralKeys(text)) {
    if (!expectedKeys.has(key)) {
      addError(errors, "MARKDOWN_FACT_WITHOUT_TRACE", "markdown", `orphan structural fact ${key}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  validateFsdMarkdown,
};
