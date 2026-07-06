"use strict";

const fs = require("fs");
const path = require("path");

const REPORT_NAME = "source-facts-report.json";
const REPAIR_TICKETS_NAME = "repair-tickets.json";
const DIMENSIONS = [
  "packages",
  "triggers",
  "subprograms",
  "signatures",
  "params",
  "returnTypes",
  "tables",
  "columns",
  "calls",
  "sequences",
  "constants",
  "controlFlow",
  "exceptions",
  "transactions",
  "specialSyntax",
];

const SQL_ALIAS_NOISE = new Set([
  "OLD_SET",
  "NEW_SET",
  "TABLE",
  "S",
  "T",
  "TGT",
  "SRC",
  "REC",
  "ROW",
]);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (key === "strict") {
      args.strict = true;
    } else {
      args[key] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function upper(value) {
  return clean(value).toUpperCase();
}

function identityOf(row) {
  const pkg = clean(row && (row.package_name || row.packageName || row.service_iface || row.impl_qn));
  const method = clean(row && (row.method || row.subprogramName || row.name));
  if (pkg && method && method !== "?") return `${upper(pkg)}.${method}`;
  const qn = clean(row && row.qualified_name);
  if (!qn.includes(".") || qn.endsWith(".?")) return "";
  const [owner, ...rest] = qn.split(".");
  return `${upper(owner)}.${rest.join(".")}`;
}

function signatureKey(owner, signature) {
  const sig = clean(signature);
  return owner && sig ? `${owner}|${sig}` : "";
}

function paramKey(owner, param) {
  if (!owner || !param) return "";
  const name = upper(param.name);
  const direction = upper(param.direction || param.mode || "IN");
  const oracleType = upper(param.oracle_type || param.oracleType || param.type);
  return name ? `${owner}|${name}|${direction}|${oracleType}` : "";
}

function tableKey(owner, row) {
  if (!owner || !row) return "";
  const table = upper(row.table || row.tableName || row.name);
  const op = upper(row.operation || row.op || row.action || "UNKNOWN");
  return table ? `${owner}|${table}|${op}` : "";
}

function columnName(col) {
  return upper(typeof col === "string" ? col : (col && (col.name || col.column || col.columnName)));
}

function columnKeys(owner, row) {
  if (!owner || !row) return [];
  const table = upper(row.table || row.tableName || row.name);
  if (!table) return [];
  return asArray(row.columns).map(columnName).filter(Boolean).map((col) => `${owner}|${table}|${col}`);
}

function callKey(owner, row) {
  if (!owner || !row) return "";
  const pkg = upper(row.target_package || row.packageName || row.package);
  const member = clean(row.target_member || row.member || row.method || row.name);
  return pkg && member ? `${owner}|${pkg}.${member}` : "";
}

function sequenceKey(owner, row) {
  if (!owner || !row) return "";
  const seq = upper(row.sequence || row.name);
  return seq ? `${owner}|${seq}` : "";
}

function constantKey(owner, row) {
  if (!owner || !row) return "";
  const pkg = upper(row.target_package || row.packageName || row.package);
  const member = upper(row.target_member || row.member || row.name);
  return pkg && member ? `${owner}|${pkg}.${member}` : "";
}

function controlFlowKeys(owner, flow) {
  if (!owner || !flow) return [];
  if (Array.isArray(flow)) {
    return flow.map((row) => {
      const construct = clean(row && (row.construct || row.label || row.name || row.type || row.id));
      return construct ? `${owner}|${upper(construct)}` : "";
    }).filter(Boolean);
  }
  if (typeof flow !== "object") return [];
  const keys = [];
  for (const row of asArray(flow.nodes)) {
    const label = clean(row.label || row.name || row.type || row.id);
    if (label) keys.push(`${owner}|NODE|${label}`);
  }
  for (const row of asArray(flow.branches)) {
    const condition = clean(row.condition || row.label || row.type || row.id);
    if (condition) keys.push(`${owner}|BRANCH|${condition}`);
  }
  for (const row of asArray(flow.loops)) {
    const type = upper(row.type || row.label || row.name || row.id);
    if (type) keys.push(`${owner}|LOOP|${type}`);
  }
  return keys;
}

function exceptionKey(owner, row) {
  if (!owner || !row) return "";
  const name = upper(row.name || row.exception || row.when);
  const action = upper(row.action || row.handler || row.statement);
  return name || action ? `${owner}|${name}|${action}` : "";
}

function transactionKeys(owner, row) {
  if (!owner || !row || typeof row !== "object") return [];
  const keys = [];
  if (row.hasCommit || row.has_commit) keys.push(`${owner}|COMMIT`);
  if (row.hasRollback || row.has_rollback) keys.push(`${owner}|ROLLBACK`);
  if (row.hasSavepoint || row.has_savepoint) keys.push(`${owner}|SAVEPOINT`);
  if (row.autonomous) keys.push(`${owner}|AUTONOMOUS_TRANSACTION`);
  return keys;
}

function specialSyntaxKey(owner, row) {
  if (!owner || !row) return "";
  const type = upper(row.construct || row.type || row.kind || row.name || row.id);
  return type ? `${owner}|${type}` : "";
}

function transactionKeysFromConstruct(owner, row) {
  if (!owner || !row) return [];
  const construct = upper(row.construct || row.type || row.kind || row.name || row.id);
  if (construct === "COMMIT") return [`${owner}|COMMIT`];
  if (construct === "ROLLBACK") return [`${owner}|ROLLBACK`];
  if (construct === "SAVEPOINT") return [`${owner}|SAVEPOINT`];
  if (construct === "PRAGMA AUTONOMOUS_TRANSACTION") return [`${owner}|AUTONOMOUS_TRANSACTION`];
  return [];
}

function makeSets() {
  return Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, new Set()]));
}

function add(setMap, dimension, value) {
  const fact = clean(value);
  if (fact) setMap[dimension].add(fact);
}

function remove(setMap, dimension, value) {
  const fact = clean(value);
  if (fact && setMap[dimension]) setMap[dimension].delete(fact);
}

function readRepairOverlay(args) {
  const file = args.repairs || args["repair-overlay"] || "";
  if (!file) return { file: "", adds: [], removes: [] };
  const abs = path.resolve(file);
  const data = readJson(abs);
  return {
    file,
    adds: asArray(data.adds),
    removes: asArray(data.removes),
  };
}

function applyRepairOverlay(actual, overlay) {
  if (!overlay || (!overlay.adds.length && !overlay.removes.length)) return { actual, summary: { adds: 0, removes: 0 } };
  let adds = 0;
  let removes = 0;
  for (const row of overlay.adds) {
    if (!DIMENSIONS.includes(row.dimension)) continue;
    add(actual, row.dimension, row.fact);
    adds++;
  }
  for (const row of overlay.removes) {
    if (!DIMENSIONS.includes(row.dimension)) continue;
    remove(actual, row.dimension, row.fact);
    removes++;
  }
  return { actual, summary: { adds, removes } };
}

function collectActualFacts(plsqlL1, functions) {
  const actual = makeSets();
  const nodes = asArray(plsqlL1 && plsqlL1.nodes);
  for (const node of nodes) {
    if (node.kind === "package") {
      add(actual, "packages", upper(node.name || node.qualified_name));
      continue;
    }
    if (node.kind === "trigger") {
      add(actual, "triggers", upper(node.name || node.qualified_name));
      continue;
    }
    if (node.kind === "procedure" || node.kind === "function") {
      const owner = identityOf(node);
      add(actual, "subprograms", owner);
      add(actual, "signatures", signatureKey(owner, node.signature));
      for (const param of asArray(node.params)) add(actual, "params", paramKey(owner, param));
      if (node.return_type) add(actual, "returnTypes", `${owner}|${upper(node.return_type)}`);
    }
  }

  for (const row of asArray(functions)) {
    const owner = identityOf(row);
    const pkg = clean(row.package_name || row.packageName || row.service_iface || row.impl_qn);
    if (pkg) add(actual, "packages", upper(pkg));
    add(actual, "subprograms", owner);
    add(actual, "signatures", signatureKey(owner, row.signature));
    for (const param of asArray(row.oracle_params || row.params)) add(actual, "params", paramKey(owner, param));
    if (row.return_type) add(actual, "returnTypes", `${owner}|${upper(row.return_type)}`);
    for (const table of asArray(row.table_facts)) {
      add(actual, "tables", tableKey(owner, table));
      for (const colKey of columnKeys(owner, table)) add(actual, "columns", colKey);
    }
    for (const call of asArray(row.cross_package_calls)) add(actual, "calls", callKey(owner, call));
    for (const seq of asArray(row.sequence_deps)) add(actual, "sequences", sequenceKey(owner, seq));
    for (const constant of asArray(row.constant_deps)) add(actual, "constants", constantKey(owner, constant));
    for (const cf of controlFlowKeys(owner, row.control_flow)) add(actual, "controlFlow", cf);
    for (const ex of asArray(row.exception_handlers)) add(actual, "exceptions", exceptionKey(owner, ex));
    for (const tx of transactionKeys(owner, row.transactions)) add(actual, "transactions", tx);
    for (const flow of asArray(row.control_flow)) {
      for (const tx of transactionKeysFromConstruct(owner, flow)) add(actual, "transactions", tx);
    }
    for (const syntax of asArray(row.special_syntax)) {
      add(actual, "specialSyntax", specialSyntaxKey(owner, syntax));
      for (const tx of transactionKeysFromConstruct(owner, syntax)) add(actual, "transactions", tx);
    }
  }
  return actual;
}

function collectExpectedFacts(golden) {
  const expected = makeSets();
  const rows = golden && golden.expected && typeof golden.expected === "object" ? golden.expected : {};
  for (const dimension of DIMENSIONS) {
    for (const fact of asArray(rows[dimension])) add(expected, dimension, fact);
  }
  return expected;
}

function thresholdsFor(golden, dimension) {
  const thresholds = golden && golden.thresholds && typeof golden.thresholds === "object" ? golden.thresholds : {};
  const defaults = thresholds.default || {};
  const own = thresholds[dimension] || {};
  return {
    recall: Number(own.recall ?? defaults.recall ?? 1),
    precision: Number(own.precision ?? defaults.precision ?? 1),
  };
}

function sorted(set) {
  return [...set].sort();
}

function intersect(left, right) {
  return sorted(left).filter((value) => right.has(value));
}

function difference(left, right) {
  return sorted(left).filter((value) => !right.has(value));
}

function ratio(numerator, denominator) {
  if (denominator === 0) return 1;
  return numerator / denominator;
}

function factHasPollution(fact) {
  const tokens = upper(fact).split(/[^A-Z0-9_$#]+/).filter(Boolean);
  return tokens.some((token) => SQL_ALIAS_NOISE.has(token));
}

function missingInputFailure(pathValue, message) {
  return { case_id: "source-to-facts", error_code: "INPUT_MISSING", path: pathValue, message };
}

function buildInputFailures(args) {
  const checks = [
    ["golden", args.golden],
    ["plsql-l1", args["plsql-l1"]],
    ["functions", args.functions],
  ];
  const failures = [];
  for (const [key, file] of checks) {
    if (!file) {
      failures.push(missingInputFailure(key, `--${key} is required`));
    } else if (!fs.existsSync(path.resolve(file))) {
      failures.push(missingInputFailure(key, `input file not found: ${file}`));
    }
  }
  if (args.source && !fs.existsSync(path.resolve(args.source))) {
    failures.push(missingInputFailure("source", `source path not found: ${args.source}`));
  }
  const repairsFile = args.repairs || args["repair-overlay"];
  if (repairsFile && !fs.existsSync(path.resolve(repairsFile))) {
    failures.push(missingInputFailure("repairs", `repair overlay file not found: ${repairsFile}`));
  }
  return failures;
}

function reportInputs(args) {
  const keys = ["source", "golden", "plsql-l1", "functions", "repairs", "repair-overlay", "out"];
  const inputs = {};
  for (const key of keys) {
    if (args[key] !== undefined) inputs[key] = args[key];
  }
  return inputs;
}

function emptyReport(args, failures) {
  return {
    schemaVersion: 1,
    reportType: "source-to-facts",
    status: "FAIL",
    ok: false,
    strict: Boolean(args.strict),
    generatedAt: new Date().toISOString(),
    command: [process.execPath, ...process.argv.slice(1)].join(" "),
    cwd: process.cwd(),
    inputs: reportInputs(args),
    thresholds: {},
    metrics: {},
    dimensions: {},
    summary: {
      missingFactsTotal: 0,
      extraFactsTotal: 0,
      pollutionTotal: 0,
      failuresTotal: failures.length,
    },
    missingFacts: [],
    extraFacts: [],
    pollution: [],
    failures,
  };
}

function targetFromFact(row) {
  const fact = clean(row && row.fact);
  if (!fact) return row && row.case_id || "source-to-facts";
  const pipe = fact.indexOf("|");
  if (pipe > 0) return fact.slice(0, pipe);
  const dot = fact.indexOf(".");
  if (dot > 0) return fact.slice(0, dot);
  return row && row.case_id || "source-to-facts";
}

function repairTicket(id, row, action, instruction) {
  return {
    id,
    repairType: "l2-source-facts",
    action,
    case_id: row.case_id || "source-to-facts",
    target: targetFromFact(row),
    dimension: row.dimension || "",
    fact: row.fact || "",
    instruction,
  };
}

function buildRepairTickets(report, reportFile = "") {
  const tickets = [];
  for (const [index, row] of asArray(report.missingFacts).entries()) {
    tickets.push(repairTicket(
      `missing-${index + 1}`,
      row,
      "add-missing-fact",
      `Add only this missing ${row.dimension} fact to the L2 source-to-facts output for ${targetFromFact(row)}. Do not rerun from scratch or rewrite unrelated facts.`
    ));
  }
  for (const [index, row] of asArray(report.extraFacts).entries()) {
    tickets.push(repairTicket(
      `extra-${index + 1}`,
      row,
      "remove-extra-fact",
      `Remove or correct only this unsupported ${row.dimension} fact for ${targetFromFact(row)}. Do not rerun from scratch or rewrite unrelated facts.`
    ));
  }
  for (const [index, row] of asArray(report.pollution).entries()) {
    tickets.push(repairTicket(
      `pollution-${index + 1}`,
      row,
      "remove-pollution",
      `Remove SQL alias/local-name pollution for ${targetFromFact(row)} and preserve genuine source facts. Do not rerun from scratch or rewrite unrelated facts.`
    ));
  }
  for (const [index, row] of asArray(report.failures).filter((failure) => failure.error_code === "INPUT_MISSING").entries()) {
    tickets.push({
      id: `input-${index + 1}`,
      repairType: "l2-source-facts",
      action: "provide-missing-input",
      case_id: row.case_id || "source-to-facts",
      target: row.path || "input",
      dimension: "inputs",
      fact: row.message || "",
      instruction: `Provide the missing ${row.path || "input"} artifact and rerun only the source-to-facts evaluation for this case.`,
    });
  }
  return {
    schemaVersion: 1,
    reportType: "source-to-facts-repair-tickets",
    status: tickets.length ? "OPEN" : "EMPTY",
    generatedAt: new Date().toISOString(),
    sourceReport: reportFile,
    summary: {
      ticketsTotal: tickets.length,
      missingFactsTotal: asArray(report.missingFacts).length,
      extraFactsTotal: asArray(report.extraFacts).length,
      pollutionTotal: asArray(report.pollution).length,
    },
    tickets,
  };
}

function evaluate(args) {
  const inputFailures = buildInputFailures(args);
  if (inputFailures.length) return emptyReport(args, inputFailures);

  const golden = readJson(path.resolve(args.golden));
  const plsqlL1 = readJson(path.resolve(args["plsql-l1"]));
  const functions = readJson(path.resolve(args.functions));
  const overlay = readRepairOverlay(args);
  const expected = collectExpectedFacts(golden);
  const repaired = applyRepairOverlay(collectActualFacts(plsqlL1, functions), overlay);
  const actual = repaired.actual;
  const dimensions = {};
  const missingFacts = [];
  const extraFacts = [];
  const pollution = [];
  const failures = [];
  const thresholds = {};

  for (const dimension of DIMENSIONS) {
    const expectedSet = expected[dimension];
    const actualSet = actual[dimension];
    const matched = intersect(expectedSet, actualSet);
    const missing = difference(expectedSet, actualSet);
    const extra = difference(actualSet, expectedSet);
    const recall = ratio(matched.length, expectedSet.size);
    const precision = ratio(matched.length, actualSet.size);
    const threshold = thresholdsFor(golden, dimension);
    thresholds[dimension] = threshold;
    dimensions[dimension] = {
      expected: expectedSet.size,
      actual: actualSet.size,
      matched: matched.length,
      missing: missing.length,
      extra: extra.length,
      recall,
      precision,
    };
    for (const fact of missing) missingFacts.push({ case_id: golden.caseId || "source-to-facts", dimension, fact });
    for (const fact of extra) extraFacts.push({ case_id: golden.caseId || "source-to-facts", dimension, fact });
    for (const fact of extra.filter(factHasPollution)) {
      pollution.push({ case_id: golden.caseId || "source-to-facts", dimension, fact, kind: "sql-alias-or-local-noise" });
    }
    if (recall < threshold.recall) {
      failures.push({
        case_id: golden.caseId || "source-to-facts",
        error_code: "RECALL_BELOW_THRESHOLD",
        path: `dimensions.${dimension}.recall`,
        message: `${dimension} recall ${recall} below ${threshold.recall}`,
        dimension,
        actual: recall,
        threshold: threshold.recall,
      });
    }
    if (precision < threshold.precision) {
      failures.push({
        case_id: golden.caseId || "source-to-facts",
        error_code: "PRECISION_BELOW_THRESHOLD",
        path: `dimensions.${dimension}.precision`,
        message: `${dimension} precision ${precision} below ${threshold.precision}`,
        dimension,
        actual: precision,
        threshold: threshold.precision,
      });
    }
  }

  if (pollution.length) {
    failures.push({
      case_id: golden.caseId || "source-to-facts",
      error_code: "POLLUTION_DETECTED",
      path: "pollution",
      message: `detected ${pollution.length} SQL alias/local-name pollution facts`,
      count: pollution.length,
    });
  }

  const totalExpected = Object.values(dimensions).reduce((sum, row) => sum + row.expected, 0);
  const totalActual = Object.values(dimensions).reduce((sum, row) => sum + row.actual, 0);
  const totalMatched = Object.values(dimensions).reduce((sum, row) => sum + row.matched, 0);
  const ok = failures.length === 0;
  return {
    schemaVersion: 1,
    reportType: "source-to-facts",
    status: ok ? "PASS" : "FAIL",
    ok,
    strict: Boolean(args.strict),
    generatedAt: new Date().toISOString(),
    command: [process.execPath, ...process.argv.slice(1)].join(" "),
    cwd: process.cwd(),
    inputs: reportInputs(args),
    thresholds,
    metrics: {
      expectedTotal: totalExpected,
      actualTotal: totalActual,
      matchedTotal: totalMatched,
      recall: ratio(totalMatched, totalExpected),
      precision: ratio(totalMatched, totalActual),
    },
    dimensions,
    repairOverlay: {
      file: overlay.file || "",
      adds: repaired.summary.adds,
      removes: repaired.summary.removes,
    },
    summary: {
      caseId: golden.caseId || "source-to-facts",
      missingFactsTotal: missingFacts.length,
      extraFactsTotal: extraFacts.length,
      pollutionTotal: pollution.length,
      failuresTotal: failures.length,
    },
    missingFacts,
    extraFacts,
    pollution,
    failures,
  };
}

function runCli() {
  const args = parseArgs(process.argv.slice(2));
  const report = evaluate(args);
  const outDir = path.resolve(args.out || path.join(".repowiki", "diagnostics", "source-facts"));
  const outFile = path.join(outDir, REPORT_NAME);
  writeJson(outFile, report);
  if (!report.ok) {
    writeJson(path.join(outDir, REPAIR_TICKETS_NAME), buildRepairTickets(report, outFile));
  }
  if (args.strict && !report.ok) process.exitCode = 20;
  return { report, outFile };
}

if (require.main === module) {
  runCli();
}

module.exports = {
  DIMENSIONS,
  parseArgs,
  collectActualFacts,
  collectExpectedFacts,
  buildRepairTickets,
  evaluate,
  runCli,
};
