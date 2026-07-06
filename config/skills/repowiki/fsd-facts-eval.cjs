"use strict";

const fs = require("fs");
const path = require("path");
const { validateFsdFacts } = require("./lib/fsd-facts-schema.cjs");
const { computeFsdCoverage, detectFsdPollution } = require("./lib/fsd-facts-coverage.cjs");

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

function isJsonFile(file) {
  return file.toLowerCase().endsWith(".json");
}

function collectJsonFiles(input) {
  const root = path.resolve(input || ".");
  if (!fs.existsSync(root)) return [];
  const stat = fs.statSync(root);
  if (stat.isFile()) return isJsonFile(root) ? [root] : [];
  const files = [];
  for (const name of fs.readdirSync(root)) {
    const child = path.join(root, name);
    const childStat = fs.statSync(child);
    if (childStat.isDirectory()) {
      files.push(...collectJsonFiles(child));
    } else if (isJsonFile(child)) {
      files.push(child);
    }
  }
  return files.sort();
}

function basenameCaseId(file) {
  return path.basename(file, path.extname(file));
}

function wantedCaseId(caseId) {
  if (!caseId) return "";
  return String(caseId).split(":").pop();
}

function filterCase(files, caseId) {
  if (!caseId) return files;
  const wanted = wantedCaseId(caseId);
  return files.filter((file) => basenameCaseId(file) === wanted || path.basename(file) === wanted);
}

function pairedMarkdownFile(jsonFile) {
  return jsonFile.replace(/\.json$/i, ".md");
}

function readManifest(manifestFile, inputRoot, caseId) {
  if (!manifestFile) return [];
  const manifestPath = path.resolve(manifestFile);
  const root = inputRoot ? path.resolve(inputRoot) : path.dirname(manifestPath);
  const wanted = wantedCaseId(caseId);
  const lines = fs.readFileSync(manifestPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const entries = [];
  for (const line of lines) {
    const row = JSON.parse(line);
    const rowCase = row.case_id || row.id || (row.fixture && basenameCaseId(row.fixture));
    if (wanted && rowCase !== wanted && String(rowCase).split(":").pop() !== wanted) continue;
    const fixture = path.isAbsolute(row.fixture) ? row.fixture : path.join(root, row.fixture);
    const markdown = row.markdown
      ? (path.isAbsolute(row.markdown) ? row.markdown : path.join(root, row.markdown))
      : pairedMarkdownFile(fixture);
    const golden = row.golden
      ? (path.isAbsolute(row.golden) ? row.golden : path.resolve(path.dirname(manifestPath), row.golden))
      : "";
    entries.push({ ...row, case_id: rowCase, fixture, markdown, golden, manifest: manifestPath });
  }
  return entries;
}

function makeFailure(caseId, code, pathValue, message, extra = {}) {
  return { case_id: caseId, error_code: code, path: pathValue || "", message, ...extra };
}

function makeReport(kind, cases, failures, metrics = {}) {
  return {
    ok: failures.length === 0 && cases.every((row) => row.ok !== false),
    kind,
    generatedAt: new Date().toISOString(),
    metrics: {
      casesTotal: cases.length,
      casesPassed: cases.filter((row) => row.ok !== false).length,
      failuresTotal: failures.length,
      ...metrics,
    },
    failures,
    cases,
  };
}

function reportInputs(args) {
  const keys = ["input", "manifest", "golden", "mutations", "case", "out", "report-schema"];
  const inputs = {};
  for (const key of keys) {
    if (args[key] !== undefined) inputs[key] = args[key];
  }
  return inputs;
}

function attachReplayMetadata(report, args, reportName) {
  report.schemaVersion = 1;
  report.reportType = report.kind;
  report.status = report.ok ? "PASS" : "FAIL";
  report.strict = Boolean(args.strict);
  report.command = [process.execPath, ...process.argv.slice(1)].join(" ");
  report.cwd = process.cwd();
  report.inputs = reportInputs(args);
  report.summary = {
    reportName,
    casesTotal: report.metrics && report.metrics.casesTotal,
    casesPassed: report.metrics && report.metrics.casesPassed,
    failuresTotal: report.metrics && report.metrics.failuresTotal,
  };
  return report;
}

function validateReportShape(report, schemaFile) {
  if (!schemaFile) return [];
  const schema = readJson(schemaFile);
  const required = Array.isArray(schema.requiredTopLevelFields) ? schema.requiredTopLevelFields : [];
  return required
    .filter((field) => !(field in report))
    .map((field) => makeFailure("report-schema", "REPORT_FIELD_MISSING", field, `report missing top-level field ${field}`));
}

function finishReport(report, args, reportName) {
  attachReplayMetadata(report, args, reportName);
  const schemaFailures = validateReportShape(report, args["report-schema"]);
  if (schemaFailures.length) {
    report.failures.push(...schemaFailures);
    report.ok = false;
    report.status = "FAIL";
    report.metrics.failuresTotal = report.failures.length;
  }
  const outDir = path.resolve(args.out || ".repowiki/diagnostics/fsd");
  const outFile = path.join(outDir, reportName);
  writeJson(outFile, report);
  if (args.strict && !report.ok) process.exitCode = 20;
  return { report, outFile };
}

function loadFactCases(args) {
  const manifestEntries = readManifest(args.manifest, args.input, args.case);
  if (manifestEntries.length) {
    return manifestEntries.map((entry) => ({
      file: entry.fixture,
      caseId: entry.case_id || basenameCaseId(entry.fixture),
      markdownFile: entry.markdown,
      golden: entry.golden,
      manifest: entry,
      facts: readJson(entry.fixture),
    }));
  }
  const files = filterCase(collectJsonFiles(args.input), args.case);
  return files.map((file) => ({ file, caseId: basenameCaseId(file), markdownFile: pairedMarkdownFile(file), facts: readJson(file) }));
}

function evaluateSchema(args) {
  const cases = [];
  const failures = [];
  for (const item of loadFactCases(args)) {
    const result = validateFsdFacts(item.facts);
    cases.push({ case_id: item.caseId, file: item.file, ok: result.ok, errors: result.errors });
    for (const err of result.errors) {
      failures.push(makeFailure(item.caseId, err.code, err.path, err.message));
    }
  }
  return makeReport("schema", cases, failures);
}

function evaluateMarkdownCoverage(args) {
  const cases = [];
  const failures = [];
  let factsTotal = 0;
  let coveredTotal = 0;
  const markdownCoverage = {
    factsToMarkdown: [],
    markdownToFacts: [],
    orphanMarkdownFacts: [],
    unrenderedFacts: [],
  };
  for (const item of loadFactCases(args)) {
    const markdownFile = item.markdownFile || pairedMarkdownFile(item.file);
    if (!fs.existsSync(markdownFile)) {
      cases.push({ case_id: item.caseId, file: item.file, markdownFile, ok: false, manifest: item.manifest || null });
      failures.push(makeFailure(item.caseId, "MARKDOWN_MISSING", markdownFile, "paired Markdown fixture is missing"));
      continue;
    }
    const markdown = fs.readFileSync(markdownFile, "utf8");
    const result = computeFsdCoverage(item.facts, markdown, { outputPath: item.facts.identity && item.facts.identity.outputPath });
    factsTotal += result.metrics.factsTotal;
    coveredTotal += result.metrics.factsCoveredByMarkdown;
    for (const key of Object.keys(markdownCoverage)) {
      for (const row of result.markdownCoverage[key] || []) {
        markdownCoverage[key].push({ case_id: item.caseId, ...row });
      }
    }
    cases.push({
      case_id: item.caseId,
      file: item.file,
      markdownFile,
      manifest: item.manifest || null,
      ok: result.ok,
      metrics: result.metrics,
      gaps: result.gaps,
      gateErrors: result.gate.errors,
      schemaErrors: result.schema.errors,
      markdownCoverage: result.markdownCoverage,
    });
    for (const err of result.schema.errors) failures.push(makeFailure(item.caseId, err.code, err.path, err.message));
    for (const err of result.gate.errors) failures.push(makeFailure(item.caseId, err.code, err.path, err.message));
    for (const gap of result.gaps) failures.push(makeFailure(item.caseId, gap.code, gap.factCode, gap.message, { token: gap.token }));
  }
  const report = makeReport("markdown-coverage", cases, failures, {
    factsTotal,
    factsCoveredByMarkdown: coveredTotal,
    coverageRatio: factsTotal === 0 ? 1 : coveredTotal / factsTotal,
  });
  report.markdownCoverage = markdownCoverage;
  return report;
}

function evaluatePollution(args) {
  const cases = [];
  const failures = [];
  for (const item of loadFactCases(args)) {
    const result = detectFsdPollution(item.facts);
    cases.push({ case_id: item.caseId, file: item.file, ok: result.ok, findings: result.findings });
    for (const finding of result.findings) {
      failures.push(makeFailure(item.caseId, finding.code, finding.path, finding.message, { value: finding.value }));
    }
  }
  return makeReport("pollution", cases, failures);
}

function getPathValue(value, dottedPath) {
  return String(dottedPath).split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), value);
}

function evaluateGolden(args) {
  const cases = [];
  const failures = [];
  const goldenRoot = args.golden ? path.resolve(args.golden) : "";
  for (const item of loadFactCases(args)) {
    const goldenFile = item.golden || (goldenRoot ? path.join(goldenRoot, `${item.caseId}.json`) : "");
    if (!goldenFile || !fs.existsSync(goldenFile)) {
      cases.push({ case_id: item.caseId, file: item.file, goldenFile, ok: false });
      failures.push(makeFailure(item.caseId, "GOLDEN_MISSING", goldenFile, "golden fixture is missing"));
      continue;
    }
    const golden = readJson(goldenFile);
    const expected = golden.expected || {};
    const localFailures = [];
    for (const [key, expectedValue] of Object.entries(expected)) {
      const actual = getPathValue(item.facts, key);
      if (Array.isArray(expectedValue)) {
        const actualArray = Array.isArray(actual) ? actual : [];
        for (const needle of expectedValue) {
          if (!actualArray.includes(needle)) {
            localFailures.push(makeFailure(item.caseId, "GOLDEN_VALUE_MISSING", key, `golden value missing ${needle}`, { expected: needle }));
          }
        }
      } else if (actual !== expectedValue) {
        localFailures.push(makeFailure(item.caseId, "GOLDEN_VALUE_MISMATCH", key, `expected ${expectedValue}, got ${actual}`, { expected: expectedValue, actual }));
      }
    }
    failures.push(...localFailures);
    cases.push({ case_id: item.caseId, file: item.file, goldenFile, ok: localFailures.length === 0, checked: Object.keys(expected) });
  }
  return makeReport("golden", cases, failures);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function pathParts(pathValue) {
  return String(pathValue || "").split(".").filter(Boolean).map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

function parentAt(root, parts) {
  let current = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current == null) return null;
    current = current[parts[i]];
  }
  return current;
}

function setAt(root, parts, value) {
  const parent = parentAt(root, parts);
  if (parent == null || parts.length === 0) return;
  parent[parts[parts.length - 1]] = value;
}

function removeAt(root, parts) {
  const parent = parentAt(root, parts);
  if (parent == null || parts.length === 0) return;
  const key = parts[parts.length - 1];
  if (Array.isArray(parent) && typeof key === "number") parent.splice(key, 1);
  else delete parent[key];
}

function applyMutation(facts, mutation) {
  const next = clone(facts);
  const parts = pathParts(mutation.path);
  if (mutation.op === "remove") {
    removeAt(next, parts);
  } else if (mutation.op === "set") {
    setAt(next, parts, mutation.value);
  }
  return next;
}

function applyMarkdownMutation(markdown, mutation) {
  if (mutation.target !== "markdown") return markdown;
  if (mutation.op === "append") return `${markdown || ""}\n${mutation.value || ""}\n`;
  if (mutation.op === "replace") return String(markdown || "").replace(mutation.find || "", mutation.value || "");
  return markdown;
}

function mutationKilledBy(mutated, markdown, mutation) {
  const schema = validateFsdFacts(mutated);
  const pollution = detectFsdPollution(mutated);
  const coverage = computeFsdCoverage(mutated, markdown, { outputPath: mutated.identity && mutated.identity.outputPath });
  const reasons = [];
  if (!schema.ok) reasons.push(...schema.errors.map((err) => err.code));
  if (!pollution.ok) reasons.push(...pollution.findings.map((finding) => finding.code));
  if (!coverage.ok) {
    reasons.push(...coverage.schema.errors.map((err) => err.code));
    reasons.push(...coverage.gate.errors.map((err) => err.code));
    reasons.push(...coverage.gaps.map((gap) => gap.code));
  }
  const expected = String(mutation.expectedGate || "").trim();
  const ok = expected ? reasons.includes(expected) : reasons.length > 0;
  return { ok, schema, pollution, coverage, reasons };
}

function evaluateMutation(args) {
  const mutationFiles = filterCase(collectJsonFiles(args.mutations), args.case);
  const killed = [];
  const survivors = [];
  const failures = [];
  const cases = [];
  for (const item of loadFactCases(args)) {
    const baseMarkdownFile = item.markdownFile || pairedMarkdownFile(item.file);
    const baseMarkdown = fs.existsSync(baseMarkdownFile) ? fs.readFileSync(baseMarkdownFile, "utf8") : "";
    for (const file of mutationFiles) {
      const mutation = readJson(file);
      const mutated = mutation.target === "markdown" ? clone(item.facts) : applyMutation(item.facts, mutation);
      const markdown = applyMarkdownMutation(baseMarkdown, mutation);
      const killedBy = mutationKilledBy(mutated, markdown, mutation);
      const ok = killedBy.ok;
      const row = {
        case_id: `${item.caseId}:${mutation.id || basenameCaseId(file)}`,
        file: item.file,
        mutationFile: file,
        mutationType: mutation.type || "unspecified",
        ok,
        killReasons: killedBy.reasons,
        schemaErrors: killedBy.schema.errors,
        pollutionFindings: killedBy.pollution.findings,
        coverageFailures: [
          ...killedBy.coverage.gate.errors,
          ...killedBy.coverage.gaps,
        ],
      };
      cases.push(row);
      if (ok) {
        killed.push({ case_id: row.case_id, mutationType: row.mutationType, reason: row.killReasons.join(",") });
      } else {
        survivors.push({ case_id: row.case_id, mutation: mutation.id || basenameCaseId(file), mutationType: row.mutationType });
        failures.push(makeFailure(row.case_id, "MUTATION_SURVIVED", mutation.path, "mutation survived all strict validation gates"));
      }
    }
  }
  const requiredTypes = ["identity", "params", "return", "manualReview", "dynamicSql", "alias", "overload", "markdownExtraFact", "transaction", "sourceTrace"];
  const mutationTypesCovered = [...new Set(cases.map((row) => row.mutationType).filter(Boolean))].sort();
  for (const requiredType of requiredTypes) {
    if (!mutationTypesCovered.includes(requiredType)) {
      failures.push(makeFailure("mutation-types", "MUTATION_TYPE_MISSING", requiredType, `required mutation type missing: ${requiredType}`));
    }
  }
  const report = makeReport("mutation", cases, failures, {
    mutationsTotal: cases.length,
    killedTotal: killed.length,
    survivorsTotal: survivors.length,
    killRate: cases.length === 0 ? 1 : killed.length / cases.length,
  });
  report.requiredMutationTypes = requiredTypes;
  report.mutationTypesCovered = mutationTypesCovered;
  report.killed = killed;
  report.survivors = survivors;
  return report;
}

function evaluateAb(args) {
  const coverage = evaluateMarkdownCoverage(args);
  const candidateFalsePasses = coverage.cases.filter((row) => row.ok === false).length;
  const bFalsePassRate = coverage.cases.length === 0 ? 1 : candidateFalsePasses / coverage.cases.length;
  const aFalsePassRate = coverage.cases.length === 0 ? 0 : 1;
  const falsePassImprovement = aFalsePassRate - bFalsePassRate;
  const improvement = falsePassImprovement;
  const failures = [...coverage.failures];
  const perCaseDelta = coverage.cases.map((row) => ({
    case_id: row.case_id,
    aFalsePass: true,
    bFalsePass: row.ok === false,
    delta: row.ok === false ? 0 : 1,
  }));
  if (args.strict && coverage.cases.length === 0) {
    failures.push(makeFailure(args.case || "ab", "AB_SAMPLE_EMPTY", "cases", "AB sample set is empty"));
  }
  if (args.strict && aFalsePassRate === 0) {
    failures.push(makeFailure(args.case || "ab", "AB_BASELINE_INVALID", "metrics.aFalsePassRate", "baseline false-pass rate is zero, sample cannot prove improvement"));
  }
  if (args.strict && falsePassImprovement < 0.8) {
    failures.push(makeFailure(args.case || "ab", "AB_FALSE_PASS_IMPROVEMENT_BELOW_THRESHOLD", "metrics.falsePassImprovement", "false-pass improvement is below threshold", { falsePassImprovement }));
  }
  const report = makeReport("ab", coverage.cases, failures, {
    baselineCoverage: 0,
    candidateCoverage: coverage.metrics.coverageRatio,
    improvement,
    aFalsePassRate,
    bFalsePassRate,
    falsePassImprovement,
  });
  report.perCaseDelta = perCaseDelta;
  return report;
}

function evaluateAll(args) {
  const schema = evaluateSchema(args);
  const markdown = evaluateMarkdownCoverage(args);
  const pollution = evaluatePollution(args);
  const cases = [
    ...schema.cases.map((row) => ({ ...row, stage: "schema" })),
    ...markdown.cases.map((row) => ({ ...row, stage: "markdown" })),
    ...pollution.cases.map((row) => ({ ...row, stage: "pollution" })),
  ];
  const failures = [...schema.failures, ...markdown.failures, ...pollution.failures];
  return makeReport("facts-eval", cases, failures, {
    schemaOk: schema.ok,
    markdownOk: markdown.ok,
    pollutionOk: pollution.ok,
    coverageRatio: markdown.metrics.coverageRatio,
  });
}

function runCli(kind, reportName) {
  const args = parseArgs(process.argv.slice(2));
  const evaluators = {
    schema: evaluateSchema,
    "markdown-coverage": evaluateMarkdownCoverage,
    pollution: evaluatePollution,
    golden: evaluateGolden,
    mutation: evaluateMutation,
    ab: evaluateAb,
    all: evaluateAll,
  };
  const report = evaluators[kind](args);
  finishReport(report, args, reportName);
}

if (require.main === module) {
  runCli("all", "fsd-coverage.json");
}

module.exports = {
  parseArgs,
  collectJsonFiles,
  evaluateSchema,
  evaluateMarkdownCoverage,
  evaluatePollution,
  evaluateGolden,
  evaluateMutation,
  evaluateAb,
  evaluateAll,
  finishReport,
  runCli,
};
