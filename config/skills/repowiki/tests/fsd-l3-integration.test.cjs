"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");
const { compileFsdFacts } = require("../lib/fsd-facts-compiler.cjs");
const { renderFsdMarkdown } = require("../lib/fsd-facts-renderer.cjs");

const repoScript = path.join(__dirname, "..", "repowiki-l3-task.cjs");
const progressScript = path.join(__dirname, "..", "repowiki-progress.cjs");
const node = process.execPath;

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function validFact() {
  return {
    schemaVersion: 1,
    identity: {
      id: "PKG.proc",
      packageName: "PKG",
      subprogramName: "proc",
      refName: "proc",
      kind: "PROCEDURE",
      overloadIndex: null,
      outputPath: "fsd/PKG/proc.md",
    },
    signature: { raw: "PROCEDURE proc", params: [], return: null },
    tableMappings: [{ tableName: "T1", operations: ["SELECT"], columns: ["ID"], sourceTrace: ["table_facts[0]"] }],
    dependencies: { calls: [], calledBy: [], sequences: [], constants: [] },
    controlFlow: { nodes: [], branches: [], loops: [], mermaidHint: "" },
    exceptions: [],
    transactions: { hasCommit: false, hasRollback: false, hasSavepoint: false, autonomous: false, springEquivalent: "" },
    specialSyntax: [{ id: "syn1", type: "FORALL", risk: "medium", mapping: "", sourceTrace: ["special_syntax[0]"] }],
    manualReview: [{ id: "review-syn1", sourceId: "syn1", severity: "medium", reason: "FORALL requires migration review" }],
    sourceTrace: [{ file: "pkg.sql", startLine: 1, endLine: 20, fact: "subprogram" }],
    coverage: {
      requiredSections: ["overview", "tableMappings", "dependencies", "businessRules", "controlFlowAndExceptions", "specialSyntaxMappings"],
      factsTotal: 4,
      factsCoveredByMarkdown: 0,
      gaps: [],
    },
  };
}

function factWithFlowExceptionTransaction() {
  const fact = validFact();
  fact.controlFlow = {
    nodes: [{ id: "n1", label: "validate input", sourceTrace: ["control_flow.nodes[0]"] }],
    branches: [{ id: "b1", condition: "p_id is null", sourceTrace: ["control_flow.branches[0]"] }],
    loops: [{ id: "l1", type: "FOR_LOOP", sourceTrace: ["control_flow.loops[0]"] }],
    mermaidHint: "",
  };
  fact.exceptions = [{ name: "OTHERS", action: "RAISE", sourceTrace: ["exception_handlers[0]"] }];
  fact.transactions = {
    hasCommit: true,
    hasRollback: true,
    hasSavepoint: false,
    autonomous: false,
    springEquivalent: "",
  };
  return fact;
}

function productionDocFact() {
  return compileFsdFacts({
    module: "m",
    impl_qn: "PKG",
    method: "proc",
    signature: "PROCEDURE proc",
    procedure_type: "PROCEDURE",
    source_file: "pkg.sql",
    table_facts: [{ table: "T1", operation: "SELECT", columns: ["ID"], sourceTrace: ["table_facts[0]"] }],
    special_syntax: [{ id: "syn1", type: "FORALL", risk: "medium", sourceTrace: ["special_syntax[0]"] }],
  });
}

function oracleSpDoc() {
  return renderFsdMarkdown(productionDocFact());
}

function setupRepo(status = "pending", options = {}) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "repowiki-fsd-p4-"));
  const scheduler = path.join(repo, ".repowiki", "l3-scheduler");
  const knowledge = path.join(repo, ".repowiki", "knowledge");
  const output = path.join(repo, "docs", "fsd", "PKG", "proc.md");
  const writeFinal = options.writeFinal !== false;
  const task = {
    id: "doc1",
    kind: "function-doc",
    l3Skill: "wiki-l3-oracle-sp",
    module: "m",
    relPath: "pkg.sql",
    output,
    function: {
      module: "m",
      impl_qn: "PKG",
      method: "proc",
      signature: "PROCEDURE proc",
      procedure_type: "PROCEDURE",
      source_file: "pkg.sql",
      table_facts: [{ table: "T1", operation: "SELECT", columns: ["ID"], sourceTrace: ["table_facts[0]"] }],
      special_syntax: [{ id: "syn1", type: "FORALL", risk: "medium", sourceTrace: ["special_syntax[0]"] }],
    },
  };
  writeJson(path.join(scheduler, "tasks.json"), [task]);
  writeJson(path.join(scheduler, "state.json"), {
    l3Skill: "wiki-l3-oracle-sp",
    concurrency: 1,
    tasks: {
      doc1: {
        id: "doc1",
        kind: "function-doc",
        status,
        agent: status === "running" ? "tester" : "",
        l3Skill: "wiki-l3-oracle-sp",
        output,
        boundOutput: output,
      },
    },
  });
  writeJson(path.join(repo, ".repowiki", "modules.json"), [{ slug: "m", relPath: "pkg.sql" }]);
  writeJson(path.join(knowledge, "functions.json"), [task.function]);
  writeJson(path.join(knowledge, "services.json"), []);
  writeJson(path.join(knowledge, "downstream.json"), []);
  writeJson(path.join(knowledge, "models.json"), []);
  writeJson(path.join(knowledge, "tables.json"), []);
  writeJson(path.join(knowledge, "callgraph.json"), { callees: {}, callers: {} });
  if (writeFinal) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, oracleSpDoc(), "utf8");
  }
  return repo;
}

function run(args, options = {}) {
  return childProcess.spawnSync(node, [repoScript, ...args], { encoding: "utf8", ...options });
}

function claimTask(repo, agent = "tester") {
  const result = run(["claim", repo, "--agent", agent]);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
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

test("oracle-sp claim exposes fsd-facts contract and does not require functionRow", () => {
  const repo = setupRepo("pending", { writeFinal: false });
  const payload = claimTask(repo);
  assert.equal(payload.factContext.facts.functionRow, null);
  assert.ok(payload.factContext.facts.fsd, "missing facts.fsd");
  assert.ok(payload.factContext.facts.fsd.fsdFactsFile.replace(/\\/g, "/").endsWith("PKG/proc.json"));
  assert.ok(fs.existsSync(payload.factContext.facts.fsd.fsdFactsFile), "claim must materialize fsd-facts sidecar through production path");
  assert.ok(payload.factContext.facts.fsd.renderedSkeleton.includes("FSD - PKG.proc"));
  assert.ok(payload.factContext.task.output.replace(/\\/g, "/").includes("/.repowiki/l3-drafts/"), payload.factContext.task.output);
  assert.ok(payload.factContext.task.finalOutput.replace(/\\/g, "/").endsWith("/docs/fsd/PKG/proc.md"), payload.factContext.task.finalOutput);
  assert.ok(fs.existsSync(payload.factContext.task.output), "claim must prewrite worker draft skeleton");
  assert.ok(!fs.existsSync(payload.factContext.task.finalOutput), "claim must not publish final docs before done gate");
  assert.ok(!payload.factContext.requiredFacts.some((row) => row.field === "facts.functionRow" && row.required));
});

test("oracle-sp done rejects Markdown-only output without fsd-facts contract", () => {
  const repo = setupRepo("running", { writeFinal: false });
  const result = run(["done", repo, "--id", "doc1", "--agent", "tester"]);
  assert.notEqual(result.status, 0, "done unexpectedly accepted Markdown without fsd-facts");
  assert.ok(/fsd-facts|output file does not exist|draft/i.test(result.stderr), result.stderr);
});

test("oracle-sp done accepts draft when fsd-facts contract is valid and publishes final docs", () => {
  const repo = setupRepo("pending", { writeFinal: false });
  const payload = claimTask(repo);
  fs.writeFileSync(payload.factContext.task.output, oracleSpDoc(), "utf8");
  const result = run(["done", repo, "--id", "doc1", "--agent", "tester"]);
  assert.equal(result.status, 0, result.stderr);
  const state = JSON.parse(fs.readFileSync(path.join(repo, ".repowiki", "l3-scheduler", "state.json"), "utf8"));
  assert.equal(state.tasks.doc1.status, "done");
  assert.ok(fs.existsSync(payload.factContext.task.finalOutput), "done gate must publish final docs after validating draft");
  assert.equal(fs.readFileSync(payload.factContext.task.finalOutput, "utf8"), fs.readFileSync(payload.factContext.task.output, "utf8"));
});

test("oracle-sp soft gate publishes SQL alias pollution and records warning diagnostics", () => {
  const repo = setupRepo("pending", { writeFinal: false });
  const payload = claimTask(repo);
  const polluted = validFact();
  polluted.tableMappings.push({ tableName: "tgt", operations: ["SELECT"], columns: ["ID"], sourceTrace: ["table_facts[1]"] });
  writeJson(path.join(repo, ".repowiki", "fsd-facts", "PKG", "proc.json"), polluted);
  fs.writeFileSync(payload.factContext.task.output, oracleSpDoc().replace("Table: T1", "Table: T1\n- Table: tgt"), "utf8");
  const result = run(["done", repo, "--id", "doc1", "--agent", "tester"]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(payload.factContext.task.finalOutput), "soft gate must publish final docs");
  const reportFile = path.join(repo, ".repowiki", "l3-scheduler", "metadata", "fsd-coverage", "doc1.json");
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  assert.equal(report.ok, true);
  assert.equal(report.actualOk, false);
  assert.equal(report.status, "WARN");
  assert.equal(report.blocking, false);
  assert.ok(report.failures.some((row) => row.error_code === "SQL_ALIAS_POLLUTION"));
});

test("oracle-sp progress exposes fsd fact and coverage summary", () => {
  const repo = setupRepo("pending", { writeFinal: false });
  const payload = claimTask(repo);
  fs.writeFileSync(payload.factContext.task.output, oracleSpDoc(), "utf8");
  const done = run(["done", repo, "--id", "doc1", "--agent", "tester"]);
  assert.equal(done.status, 0, done.stderr);
  const progress = childProcess.spawnSync(node, [progressScript, repo, "l3", "--line"], { encoding: "utf8" });
  assert.equal(progress.status, 0, progress.stderr);
  assert.ok(progress.stdout.includes("fsdFacts=1/1"), progress.stdout);
  assert.ok(progress.stdout.includes("fsdDiag=1/1"), progress.stdout);
  assert.ok(progress.stdout.includes("drafts=1/1"), progress.stdout);
});

test("oracle-sp reaper publishes stale function-doc draft instead of creating fake done", () => {
  const repo = setupRepo("pending", { writeFinal: false });
  const payload = claimTask(repo, "worker-a");
  fs.writeFileSync(payload.factContext.task.output, oracleSpDoc(), "utf8");
  const stateFile = path.join(repo, ".repowiki", "l3-scheduler", "state.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  state.tasks.doc1.started_at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  writeJson(stateFile, state);

  const reap = run(["reap", repo]);
  assert.equal(reap.status, 0, reap.stderr);
  const after = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(after.tasks.doc1.status, "done");
  assert.ok(fs.existsSync(payload.factContext.task.finalOutput), "reaper must publish final docs when accepting draft");

  const progress = childProcess.spawnSync(node, [progressScript, repo, "l3", "--line"], { encoding: "utf8" });
  assert.equal(progress.status, 0, progress.stderr);
  assert.ok(progress.stdout.includes("outputs=1/1"), progress.stdout);
  assert.ok(progress.stdout.includes("fakeDone=0"), progress.stdout);
});

test("oracle-sp reaper repairs historical fake-done function-doc by publishing draft", () => {
  const repo = setupRepo("pending", { writeFinal: false });
  const payload = claimTask(repo, "worker-a");
  fs.writeFileSync(payload.factContext.task.output, oracleSpDoc(), "utf8");
  const stateFile = path.join(repo, ".repowiki", "l3-scheduler", "state.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  state.tasks.doc1.status = "done";
  state.tasks.doc1.agent = "worker-a";
  state.tasks.doc1.completed_by = "control-plane";
  state.tasks.doc1.finished_at = new Date().toISOString();
  writeJson(stateFile, state);
  assert.ok(!fs.existsSync(payload.factContext.task.finalOutput), "test setup must start with missing final output");

  const reap = run(["reap", repo]);
  assert.equal(reap.status, 0, reap.stderr);
  const after = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(after.tasks.doc1.status, "done");
  assert.ok(fs.existsSync(payload.factContext.task.finalOutput), "reaper must publish final docs for historical fake-done task");

  const progress = childProcess.spawnSync(node, [progressScript, repo, "l3", "--line"], { encoding: "utf8" });
  assert.equal(progress.status, 0, progress.stderr);
  assert.ok(progress.stdout.includes("outputs=1/1"), progress.stdout);
  assert.ok(progress.stdout.includes("fakeDone=0"), progress.stdout);
});

test("oracle-sp done writes replay metadata into coverage diagnostics", () => {
  const repo = setupRepo("pending", { writeFinal: false });
  const payload = claimTask(repo);
  fs.writeFileSync(payload.factContext.task.output, oracleSpDoc(), "utf8");
  const done = run(["done", repo, "--id", "doc1", "--agent", "tester"]);
  assert.equal(done.status, 0, done.stderr);
  const reportFile = path.join(repo, ".repowiki", "l3-scheduler", "metadata", "fsd-coverage", "doc1.json");
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.reportType, "fsd-coverage");
  assert.equal(report.status, "PASS");
  assert.equal(report.strict, false);
  assert.equal(report.blocking, false);
  assert.ok(report.command.includes("repowiki-l3-task.cjs done"));
  assert.ok(path.isAbsolute(report.cwd), report.cwd);
  assert.ok(report.inputs && report.inputs.fsdFactsFile && report.inputs.outputFile && report.inputs.draftOutputFile);
  assert.ok(report.summary && report.summary.taskId === "doc1");

  const summaryFile = path.join(repo, ".repowiki", "l3-scheduler", "metadata", "fsd-coverage.json");
  const summary = JSON.parse(fs.readFileSync(summaryFile, "utf8"));
  assert.equal(summary.schemaVersion, 1);
  assert.equal(summary.reportType, "fsd-coverage-summary");
  assert.equal(summary.status, "PASS");
  assert.equal(summary.strict, false);
  assert.equal(summary.blocking, false);
  assert.ok(summary.command.includes("repowiki-l3-task.cjs done"));
  assert.ok(path.isAbsolute(summary.cwd), summary.cwd);
  assert.ok(summary.inputs && summary.inputs.coverageReportsDir);
  assert.ok(summary.summary && summary.summary.reportsTotal === 1);
});

test("oracle-sp strict gate rejects SQL alias pollution and writes failing coverage diagnostics", () => {
  const repo = setupRepo("pending", { writeFinal: false });
  const payload = claimTask(repo);
  const polluted = validFact();
  polluted.tableMappings.push({ tableName: "tgt", operations: ["SELECT"], columns: ["ID"], sourceTrace: ["table_facts[1]"] });
  writeJson(path.join(repo, ".repowiki", "fsd-facts", "PKG", "proc.json"), polluted);
  fs.writeFileSync(payload.factContext.task.output, oracleSpDoc().replace("Table: T1", "Table: T1\n- Table: tgt"), "utf8");
  const result = run(["done", repo, "--id", "doc1", "--agent", "tester"], { env: { ...process.env, REPOWIKI_FSD_GATE_MODE: "strict" } });
  assert.notEqual(result.status, 0, "done unexpectedly accepted SQL alias pollution");
  const reportFile = path.join(repo, ".repowiki", "l3-scheduler", "metadata", "fsd-coverage", "doc1.json");
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  assert.equal(report.ok, false);
  assert.equal(report.status, "FAIL");
  assert.ok(report.failures.some((row) => row.error_code === "SQL_ALIAS_POLLUTION"));
});

test("oracle-sp done rejection keeps local repair context and exposes it on next claim", () => {
  const repo = setupRepo("pending", { writeFinal: false });
  const payload = claimTask(repo);
  const fact = factWithFlowExceptionTransaction();
  writeJson(path.join(repo, ".repowiki", "fsd-facts", "PKG", "proc.json"), fact);
  const brokenMarkdown = renderFsdMarkdown(fact)
    .replace(/^\| n1 \| validate input \|\r?\n/m, "")
    .replace(/^\| OTHERS \| RAISE \| Java exception \/ rollback \| RAISE \|\r?\n/m, "")
    .replace(/^- 显式 COMMIT: 是\r?\n/m, "");
  fs.writeFileSync(payload.factContext.task.output, brokenMarkdown, "utf8");

  const done = run(["done", repo, "--id", "doc1", "--agent", "tester"], { env: { ...process.env, REPOWIKI_FSD_GATE_MODE: "strict" } });
  assert.notEqual(done.status, 0, "done unexpectedly accepted unrendered FSD facts");
  assert.ok(!fs.existsSync(payload.factContext.task.finalOutput), "rejected draft must not publish final docs");

  const stateFile = path.join(repo, ".repowiki", "l3-scheduler", "state.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(state.tasks.doc1.status, "repair_pending");
  assert.ok(state.tasks.doc1.repairContext, JSON.stringify(state.tasks.doc1, null, 2));
  assert.equal(state.tasks.doc1.repairContext.repairType, "l3-fsd-markdown");
  assert.ok(state.tasks.doc1.repairContext.unrenderedFacts.some((row) => row.token.includes("template.flowNodes.n1")));
  assert.ok(state.tasks.doc1.repairContext.unrenderedFacts.some((row) => row.token.includes("template.exceptions.OTHERS")));
  assert.ok(state.tasks.doc1.repairContext.unrenderedFacts.some((row) => row.token.includes("template.transaction.commit")));

  const claim = run(["claim", repo, "--agent", "tester"]);
  assert.equal(claim.status, 0, claim.stderr);
  const repairPayload = JSON.parse(claim.stdout);
  assert.ok(repairPayload.factContext.facts.repairContext, JSON.stringify(repairPayload.factContext, null, 2));
  assert.ok(repairPayload.factContext.facts.repairContext.instruction.includes("Do not rerun from scratch"));
});

test("oracle-sp repairable FSD rejection is claimed as a repair task, not a fresh pending task", () => {
  const repo = setupRepo("pending", { writeFinal: false });
  const payload = claimTask(repo, "worker-a");
  const fact = factWithFlowExceptionTransaction();
  writeJson(path.join(repo, ".repowiki", "fsd-facts", "PKG", "proc.json"), fact);
  const brokenMarkdown = renderFsdMarkdown(fact)
    .replace(/^\| n1 \| validate input \|\r?\n/m, "")
    .replace(/^\| OTHERS \| RAISE \| Java exception \/ rollback \| RAISE \|\r?\n/m, "");
  fs.writeFileSync(payload.factContext.task.output, brokenMarkdown, "utf8");

  const done = run(["done", repo, "--id", "doc1", "--agent", "worker-a"], { env: { ...process.env, REPOWIKI_FSD_GATE_MODE: "strict" } });
  assert.notEqual(done.status, 0, "done unexpectedly accepted unrendered FSD facts");

  let state = JSON.parse(fs.readFileSync(path.join(repo, ".repowiki", "l3-scheduler", "state.json"), "utf8"));
  assert.equal(state.tasks.doc1.status, "repair_pending");
  assert.ok(state.tasks.doc1.repairContext, JSON.stringify(state.tasks.doc1, null, 2));

  const claim = run(["claim", repo, "--agent", "worker-b"]);
  assert.equal(claim.status, 0, claim.stderr);
  const repairPayload = JSON.parse(claim.stdout);
  assert.equal(repairPayload.id, "doc1");
  assert.ok(repairPayload.factContext.facts.repairContext, JSON.stringify(repairPayload.factContext, null, 2));

  state = JSON.parse(fs.readFileSync(path.join(repo, ".repowiki", "l3-scheduler", "state.json"), "utf8"));
  assert.equal(state.tasks.doc1.status, "running");
  assert.equal(state.tasks.doc1.agent, "worker-b");
});

test("oracle-sp done rejects drafts missing identity, parameter, column, and return facts", () => {
  const repo = setupRepo("pending", { writeFinal: false });
  const payload = claimTask(repo);
  const fact = validFact();
  fact.identity.kind = "FUNCTION";
  fact.signature = {
    raw: "FUNCTION proc(p_id IN NUMBER) RETURN VARCHAR2",
    params: [{ name: "p_id", direction: "IN", oracleType: "NUMBER", javaType: "BigDecimal" }],
    return: { oracleType: "VARCHAR2", javaType: "String" },
  };
  writeJson(path.join(repo, ".repowiki", "fsd-facts", "PKG", "proc.json"), fact);
  const brokenMarkdown = renderFsdMarkdown(fact)
    .replace(/^\| 所属包 \| PKG \|\r?\n/m, "")
    .replace(/^\| p_id \| IN \| NUMBER \| BigDecimal \|.*\r?\n/m, "")
    .replace(/^\| ID \|.*\r?\n/m, "")
    .replace(/^\| VARCHAR2 \| String \| Function 返回值映射 \|\r?\n/m, "");
  fs.writeFileSync(payload.factContext.task.output, brokenMarkdown, "utf8");

  const done = run(["done", repo, "--id", "doc1", "--agent", "tester"], { env: { ...process.env, REPOWIKI_FSD_GATE_MODE: "strict" } });
  assert.notEqual(done.status, 0, "done unexpectedly accepted draft with missing FSD template rows");
  assert.ok(!fs.existsSync(payload.factContext.task.finalOutput), "rejected draft must not publish final docs");

  const state = JSON.parse(fs.readFileSync(path.join(repo, ".repowiki", "l3-scheduler", "state.json"), "utf8"));
  assert.equal(state.tasks.doc1.status, "repair_pending");
  assert.ok(state.tasks.doc1.repairContext, JSON.stringify(state.tasks.doc1, null, 2));
  const tokens = state.tasks.doc1.repairContext.unrenderedFacts.map((row) => row.token).join("\n");
  assert.ok(tokens.includes("template.overview.packageName"), tokens);
  assert.ok(tokens.includes("template.params.p_id"), tokens);
  assert.ok(tokens.includes("template.columns.T1.ID"), tokens);
  assert.ok(tokens.includes("template.return"), tokens);
});
