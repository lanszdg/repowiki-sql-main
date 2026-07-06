"use strict";

const { validateFsdFacts } = require("./fsd-facts-schema.cjs");
const { validateFsdMarkdown } = require("./fsd-facts-gate.cjs");
const { listFactTokens, transactionToken } = require("./fsd-fact-tokens.cjs");

const POLLUTION_IDENTIFIERS = new Set([
  "s",
  "src",
  "tgt",
  "rec",
  "row",
  "old_set",
  "new_set",
  "table",
]);

function lower(value) {
  return String(value || "").trim().toLowerCase();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function computeFsdCoverage(facts, markdown, options = {}) {
  const text = String(markdown || "");
  const schema = validateFsdFacts(facts);
  const gate = validateFsdMarkdown(facts, text, options);
  const tokens = listFactTokens(facts);
  const covered = [];
  const gaps = [];
  for (const token of tokens) {
    const needle = token.label || token.value;
    if (needle && text.includes(needle)) {
      covered.push(token);
    } else {
      gaps.push({
        code: "FACT_NOT_RENDERED",
        token: needle,
        factCode: token.code,
        message: `Markdown does not render ${token.code} ${needle}`,
      });
    }
  }
  const factsTotal = tokens.length;
  const factsCoveredByMarkdown = covered.length;
  const orphanMarkdownFacts = gate.errors
    .filter((err) => err.code === "MARKDOWN_FACT_WITHOUT_TRACE")
    .map((err) => ({ path: err.path || "", message: err.message || "", token: err.token || "" }));
  const markdownCoverage = {
    factsToMarkdown: covered.map((token) => ({ factCode: token.code, token: token.value, label: token.label })),
    markdownToFacts: covered.map((token) => ({ token: token.value, factCode: token.code })),
    orphanMarkdownFacts,
    unrenderedFacts: gaps.map((gap) => ({ factCode: gap.factCode, token: gap.token, message: gap.message })),
  };
  return {
    ok: schema.ok && gate.ok && gaps.length === 0,
    schema,
    gate,
    metrics: {
      factsTotal,
      factsCoveredByMarkdown,
      coverageRatio: factsTotal === 0 ? 1 : factsCoveredByMarkdown / factsTotal,
    },
    gaps,
    covered,
    markdownCoverage,
  };
}

function detectFsdPollution(facts) {
  const findings = [];
  const deps = facts.dependencies || {};
  for (const row of asArray(facts.tableMappings)) {
    if (POLLUTION_IDENTIFIERS.has(lower(row.tableName))) {
      findings.push({
        code: "SQL_ALIAS_POLLUTION",
        path: "tableMappings.tableName",
        value: row.tableName,
        message: `table mapping looks like SQL alias noise: ${row.tableName}`,
      });
    }
  }
  for (const row of asArray(deps.calls)) {
    const pkg = String(row.target || "").split(".")[0];
    if (POLLUTION_IDENTIFIERS.has(lower(pkg))) {
      findings.push({
        code: "SQL_ALIAS_POLLUTION",
        path: "dependencies.calls.target",
        value: row.target,
        message: `call target looks like SQL alias noise: ${row.target}`,
      });
    }
  }
  for (const row of asArray(deps.constants)) {
    const pkg = String(row.target || "").split(".")[0];
    if (POLLUTION_IDENTIFIERS.has(lower(pkg))) {
      findings.push({
        code: "SQL_ALIAS_POLLUTION",
        path: "dependencies.constants.target",
        value: row.target,
        message: `constant target looks like SQL alias noise: ${row.target}`,
      });
    }
  }
  return { ok: findings.length === 0, findings };
}

module.exports = {
  POLLUTION_IDENTIFIERS,
  listFactTokens,
  transactionToken,
  computeFsdCoverage,
  detectFsdPollution,
};
