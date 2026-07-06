"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");

const root = path.resolve(__dirname, "..");
const cli = path.join(root, "plsql-source-facts-corpus.cjs");

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `repowiki-${name}-`));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function makeCase(base, id, options = {}) {
  const caseDir = path.join(base, "cases", id);
  const src = path.join(caseDir, "src");
  const goldenDir = path.join(base, "golden");
  const sourceUrl = options.sourceUrl || `https://github.com/example/plsql-corpus/blob/main/${id}/demo_pkg.pks`;
  writeFile(path.join(src, "demo_pkg.pks"), [
    "CREATE OR REPLACE PACKAGE demo_pkg AS",
    "  PROCEDURE write_log(p_msg IN VARCHAR2);",
    "END demo_pkg;",
    "/",
    "",
  ].join("\n"));
  writeFile(path.join(src, "demo_pkg.pkb"), [
    "CREATE OR REPLACE PACKAGE BODY demo_pkg AS",
    "  PROCEDURE write_log(p_msg IN VARCHAR2) IS",
    "  BEGIN",
    "    INSERT INTO demo_log(msg) VALUES (p_msg);",
    "    COMMIT;",
    "  EXCEPTION",
    "    WHEN OTHERS THEN",
    "      RAISE;",
    "  END;",
    "END demo_pkg;",
    "/",
    "",
  ].join("\n"));
  writeFile(path.join(src, "schema.sql"), [
    "CREATE TABLE demo_log (",
    "  msg VARCHAR2(100)",
    ");",
    "",
  ].join("\n"));

  const golden = {
    schemaVersion: 1,
    caseId: id,
    thresholds: {
      default: { recall: 1, precision: 0 },
    },
    expected: options.expected || {
      packages: ["DEMO_PKG"],
      subprograms: ["DEMO_PKG.write_log"],
      tables: ["DEMO_PKG.write_log|DEMO_LOG|INSERT"],
      transactions: ["DEMO_PKG.write_log|COMMIT"],
    },
  };
  const goldenFile = path.join(goldenDir, `${id}.json`);
  writeJson(goldenFile, golden);

  return {
    id,
    repo: "https://github.com/example/plsql-corpus",
    license: "MIT",
    sampleMode: "unit-local-copy-with-github-provenance",
    coverageTags: ["package", "procedure", "DDL", "transaction"],
    sourceFiles: [
      { sourceUrl, localPath: path.join(src, "demo_pkg.pks"), targetPath: "demo_pkg.pks" },
      { sourceUrl: sourceUrl.replace(".pks", ".pkb"), localPath: path.join(src, "demo_pkg.pkb"), targetPath: "demo_pkg.pkb" },
      { sourceUrl: sourceUrl.replace("demo_pkg.pks", "schema.sql"), localPath: path.join(src, "schema.sql"), targetPath: "schema.sql" },
    ],
    golden: goldenFile,
  };
}

function makeSourceFactsGapCases(base) {
  const goldenDir = path.join(base, "golden");

  const dynSrc = path.join(base, "cases", "dynamic-open-for", "src");
  writeFile(path.join(dynSrc, "demo_dyn.pks"), [
    "CREATE OR REPLACE PACKAGE demo_dyn AS",
    "  FUNCTION name_sal_for(where_in IN VARCHAR2 DEFAULT NULL) RETURN sys_refcursor;",
    "END demo_dyn;",
    "/",
    "",
  ].join("\n"));
  writeFile(path.join(dynSrc, "demo_dyn.pkb"), [
    "CREATE OR REPLACE PACKAGE BODY demo_dyn AS",
    "  FUNCTION name_sal_for(where_in IN VARCHAR2 DEFAULT NULL)",
    "    RETURN sys_refcursor",
    "  IS",
    "    l_query VARCHAR2(32767) := 'select * from employees where ' || where_in;",
    "    l_cursor sys_refcursor;",
    "  BEGIN",
    "    OPEN l_cursor FOR l_query;",
    "    RETURN l_cursor;",
    "  END name_sal_for;",
    "END demo_dyn;",
    "/",
    "",
  ].join("\n"));
  const dynGolden = path.join(goldenDir, "dynamic-open-for.json");
  writeJson(dynGolden, {
    schemaVersion: 1,
    caseId: "dynamic-open-for",
    thresholds: { default: { recall: 1, precision: 0 } },
    expected: {
      packages: ["DEMO_DYN"],
      subprograms: ["DEMO_DYN.name_sal_for"],
      specialSyntax: ["DEMO_DYN.name_sal_for|OPEN FOR"],
    },
  });

  const exceptionSrc = path.join(base, "cases", "standalone-exception-raise", "src");
  writeFile(path.join(exceptionSrc, "put_in_table.sql"), [
    "CREATE OR REPLACE TYPE idlist_t IS TABLE OF INTEGER;",
    "/",
    "CREATE OR REPLACE PROCEDURE put_in_table (n_in IN idlist_t)",
    "IS",
    "BEGIN",
    "  BEGIN",
    "    EXECUTE IMMEDIATE 'drop table empno_temp';",
    "  EXCEPTION",
    "    WHEN OTHERS THEN",
    "      NULL;",
    "  END;",
    "  FORALL indx IN 1 .. n_in.COUNT",
    "    EXECUTE IMMEDIATE 'insert into empno_temp values (:empno)' USING n_in(indx);",
    "  COMMIT;",
    "EXCEPTION",
    "  WHEN OTHERS THEN",
    "    ROLLBACK;",
    "    RAISE;",
    "END;",
    "/",
    "",
  ].join("\n"));
  const exceptionGolden = path.join(goldenDir, "standalone-exception-raise.json");
  writeJson(exceptionGolden, {
    schemaVersion: 1,
    caseId: "standalone-exception-raise",
    thresholds: { default: { recall: 1, precision: 0 } },
    expected: {
      subprograms: ["__STANDALONE__.put_in_table"],
      exceptions: ["__STANDALONE__.put_in_table|OTHERS|RAISE"],
      specialSyntax: ["__STANDALONE__.put_in_table|FORALL"],
      transactions: ["__STANDALONE__.put_in_table|COMMIT", "__STANDALONE__.put_in_table|ROLLBACK"],
    },
  });

  const mergeSrc = path.join(base, "cases", "standalone-merge-script", "src");
  writeFile(path.join(mergeSrc, "merge_sales.sql"), [
    "CREATE TABLE sales_ledger (sale_id NUMBER, amount NUMBER);",
    "CREATE TABLE sales_ledger_copy (sale_id NUMBER, amount NUMBER);",
    "MERGE INTO sales_ledger_copy tgt",
    "USING (SELECT sale_id, amount FROM sales_ledger) src",
    "ON (tgt.sale_id = src.sale_id)",
    "WHEN MATCHED THEN UPDATE SET tgt.amount = src.amount",
    "WHEN NOT MATCHED THEN INSERT (sale_id, amount) VALUES (src.sale_id, src.amount);",
    "SELECT * FROM TABLE(dbms_xplan.display_cursor);",
    "COMMIT;",
    "",
  ].join("\n"));
  const mergeGolden = path.join(goldenDir, "standalone-merge-script.json");
  writeJson(mergeGolden, {
    schemaVersion: 1,
    caseId: "standalone-merge-script",
    thresholds: { default: { recall: 1, precision: 0 } },
    expected: {
      subprograms: ["__STANDALONE__.merge_sales_ledger"],
      specialSyntax: ["__STANDALONE__.merge_sales_ledger|MERGE INTO"],
      transactions: ["__STANDALONE__.merge_sales_ledger|COMMIT"],
    },
  });

  return [
    {
      id: "dynamic-open-for",
      repo: "https://github.com/example/plsql-corpus",
      license: "MIT",
      sampleMode: "unit-local-copy-with-github-provenance",
      coverageTags: ["package", "function", "dynamic-sql", "cursor"],
      sourceFiles: [
        { sourceUrl: "https://github.com/example/plsql-corpus/blob/main/dynamic-open-for/demo_dyn.pks", localPath: path.join(dynSrc, "demo_dyn.pks"), targetPath: "demo_dyn.pks" },
        { sourceUrl: "https://github.com/example/plsql-corpus/blob/main/dynamic-open-for/demo_dyn.pkb", localPath: path.join(dynSrc, "demo_dyn.pkb"), targetPath: "demo_dyn.pkb" },
      ],
      golden: dynGolden,
    },
    {
      id: "standalone-exception-raise",
      repo: "https://github.com/example/plsql-corpus",
      license: "MIT",
      sampleMode: "unit-local-copy-with-github-provenance",
      coverageTags: ["procedure", "FORALL", "exception", "transaction"],
      sourceFiles: [
        { sourceUrl: "https://github.com/example/plsql-corpus/blob/main/standalone-exception-raise/put_in_table.sql", localPath: path.join(exceptionSrc, "put_in_table.sql"), targetPath: "put_in_table.sql" },
      ],
      golden: exceptionGolden,
    },
    {
      id: "standalone-merge-script",
      repo: "https://github.com/example/plsql-corpus",
      license: "MIT",
      sampleMode: "unit-local-copy-with-github-provenance",
      coverageTags: ["MERGE", "standalone-sql"],
      sourceFiles: [
        { sourceUrl: "https://github.com/example/plsql-corpus/blob/main/standalone-merge-script/merge.sql", localPath: path.join(mergeSrc, "merge_sales.sql"), targetPath: "merge/merge.sql" },
      ],
      golden: mergeGolden,
    },
  ];
}

function runCorpus(manifest, out, extraArgs = []) {
  const args = [
    cli,
    "--manifest", manifest,
    "--out", out,
    "--strict",
    ...extraArgs,
  ];
  const result = childProcess.spawnSync(process.execPath, args, { encoding: "utf8" });
  const reportFile = path.join(out, "source-facts-corpus-report.json");
  return {
    ...result,
    reportFile,
    report: fs.existsSync(reportFile) ? readJson(reportFile) : null,
  };
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

test("corpus strict pass requires GitHub provenance, real L1/L2 run artifacts, and aggregate metrics", () => {
  const base = tmpDir("source-facts-corpus-valid");
  const manifest = path.join(base, "manifest.json");
  writeJson(manifest, {
    schemaVersion: 1,
    corpusId: "unit-github-corpus",
    cases: [makeCase(base, "unit-valid")],
  });
  const out = path.join(base, "out");
  const result = runCorpus(manifest, out);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(result.report, "aggregate report missing");
  assert.equal(result.report.reportType, "source-facts-github-corpus");
  assert.equal(result.report.status, "PASS");
  assert.equal(result.report.cases.length, 1);
  assert.equal(result.report.cases[0].realRun, true);
  assert.ok(result.report.cases[0].commands.some((cmd) => cmd.includes("plsql-l1-producer.cjs")));
  assert.ok(result.report.cases[0].commands.some((cmd) => cmd.includes("repowiki-l2.cjs")));
  assert.ok(result.report.cases[0].artifacts["plsql-l1"].endsWith("plsql-l1.json"));
  assert.ok(result.report.cases[0].artifacts.functions.includes("functions.part-"));
  assert.equal(result.report.metrics.casesTotal, 1);
  assert.equal(result.report.metrics.casesPassed, 1);
  assert.ok(result.report.aggregate.recall > 0);
});

test("corpus strict fails when GitHub provenance is missing", () => {
  const base = tmpDir("source-facts-corpus-no-provenance");
  const badCase = makeCase(base, "no-provenance", { sourceUrl: "file:///not-github/demo_pkg.pks" });
  badCase.repo = "";
  const manifest = path.join(base, "manifest.json");
  writeJson(manifest, { schemaVersion: 1, corpusId: "bad", cases: [badCase] });
  const result = runCorpus(manifest, path.join(base, "out"));
  assert.notEqual(result.status, 0, "strict corpus unexpectedly passed");
  assert.ok(result.report, "failure report missing");
  assert.equal(result.report.status, "FAIL");
  assert.ok(result.report.failures.some((row) => row.error_code === "PROVENANCE_MISSING"));
});

test("corpus strict fails when a case has no manual golden", () => {
  const base = tmpDir("source-facts-corpus-no-golden");
  const badCase = makeCase(base, "no-golden");
  fs.rmSync(badCase.golden);
  const manifest = path.join(base, "manifest.json");
  writeJson(manifest, { schemaVersion: 1, corpusId: "bad", cases: [badCase] });
  const result = runCorpus(manifest, path.join(base, "out"));
  assert.notEqual(result.status, 0, "strict corpus unexpectedly passed");
  assert.ok(result.report.failures.some((row) => row.error_code === "GOLDEN_MISSING"));
});

test("corpus strict fails when any case misses threshold", () => {
  const base = tmpDir("source-facts-corpus-threshold-fail");
  const badCase = makeCase(base, "threshold-fail", {
    expected: {
      packages: ["MISSING_PKG"],
    },
  });
  const manifest = path.join(base, "manifest.json");
  writeJson(manifest, { schemaVersion: 1, corpusId: "bad", cases: [badCase] });
  const result = runCorpus(manifest, path.join(base, "out"));
  assert.notEqual(result.status, 0, "strict corpus unexpectedly passed");
  assert.equal(result.report.cases[0].realRun, true, "threshold failure must still prove L1/L2 really ran");
  assert.ok(result.report.cases[0].evalReport.failures.some((row) => row.error_code === "RECALL_BELOW_THRESHOLD"));
  assert.ok(result.report.failures.some((row) => row.error_code === "CASE_FAILED"));
});

test("corpus real L1/L2 covers dynamic cursor, standalone exception, and standalone merge script facts", () => {
  const base = tmpDir("source-facts-corpus-gap-regression");
  const manifest = path.join(base, "manifest.json");
  writeJson(manifest, {
    schemaVersion: 1,
    corpusId: "unit-source-facts-gap-regression",
    cases: makeSourceFactsGapCases(base),
  });
  const result = runCorpus(manifest, path.join(base, "out"));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.report.status, "PASS");
  assert.equal(result.report.metrics.casesTotal, 3);
  assert.equal(result.report.metrics.casesPassed, 3);
  for (const row of result.report.cases) {
    assert.equal(row.realRun, true, `${row.id} did not run L1/L2`);
  }
});
