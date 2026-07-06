"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");
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

function oracleSpDoc() {
  const projected = renderFsdMarkdown(validFact());
  return projected
    .replace("## 概览", "## 概览\n### 存储过程功能\n### 参数清单与 Java 类型映射\n### 转换策略\n### 签名\n### 输入类型定义")
    .replace("## 表结构映射", "## 表结构映射\n### 涉及的表清单\n### 列 → DO 字段映射\n### 跨表关系\n### 特殊列处理")
    .replace("## 依赖分析", "## 依赖分析\n### 调用的其他子程序\n### 被其他子程序调用\n### 跨包调用 → Service 注入\n### 序列依赖\n### 常量依赖")
    .replace("## 业务规则", "## 业务规则\n### 校验规则\n### 计算逻辑\n### 状态流转\n### 边界条件")
    .replace("## 控制流与异常", "## 控制流与异常\n### 流程图\n### 分支逻辑\n### 循环结构\n### 异常处理")
    .replace("## 特殊语法转化规约", "## 特殊语法转化规约\n### 转化映射\n### 事务边界\n### 需手动审查的构造");
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

test("oracle-sp done rejects SQL alias pollution in fsd-facts", () => {
  const repo = setupRepo("pending", { writeFinal: false });
  const payload = claimTask(repo);
  const polluted = validFact();
  polluted.tableMappings.push({ tableName: "tgt", operations: ["SELECT"], columns: ["ID"], sourceTrace: ["table_facts[1]"] });
  writeJson(path.join(repo, ".repowiki", "fsd-facts", "PKG", "proc.json"), polluted);
  fs.writeFileSync(payload.factContext.task.output, oracleSpDoc().replace("Table: T1", "Table: T1\n- Table: tgt"), "utf8");
  const result = run(["done", repo, "--id", "doc1", "--agent", "tester"]);
  assert.notEqual(result.status, 0, "done unexpectedly accepted SQL alias pollution");
  assert.ok(result.stderr.includes("SQL_ALIAS_POLLUTION"), result.stderr);
  assert.ok(!fs.existsSync(payload.factContext.task.finalOutput), "rejected draft must not publish final docs");
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
  assert.ok(progress.stdout.includes("fsdCoverage=1/1"), progress.stdout);
  assert.ok(progress.stdout.includes("drafts=1/1"), progress.stdout);
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
  assert.equal(report.strict, true);
  assert.ok(report.command.includes("repowiki-l3-task.cjs done"));
  assert.ok(path.isAbsolute(report.cwd), report.cwd);
  assert.ok(report.inputs && report.inputs.fsdFactsFile && report.inputs.outputFile && report.inputs.draftOutputFile);
  assert.ok(report.summary && report.summary.taskId === "doc1");

  const summaryFile = path.join(repo, ".repowiki", "l3-scheduler", "metadata", "fsd-coverage.json");
  const summary = JSON.parse(fs.readFileSync(summaryFile, "utf8"));
  assert.equal(summary.schemaVersion, 1);
  assert.equal(summary.reportType, "fsd-coverage-summary");
  assert.equal(summary.status, "PASS");
  assert.equal(summary.strict, true);
  assert.ok(summary.command.includes("repowiki-l3-task.cjs done"));
  assert.ok(path.isAbsolute(summary.cwd), summary.cwd);
  assert.ok(summary.inputs && summary.inputs.coverageReportsDir);
  assert.ok(summary.summary && summary.summary.reportsTotal === 1);
});

test("oracle-sp pollution rejection writes failing coverage diagnostics", () => {
  const repo = setupRepo("pending", { writeFinal: false });
  const payload = claimTask(repo);
  const polluted = validFact();
  polluted.tableMappings.push({ tableName: "tgt", operations: ["SELECT"], columns: ["ID"], sourceTrace: ["table_facts[1]"] });
  writeJson(path.join(repo, ".repowiki", "fsd-facts", "PKG", "proc.json"), polluted);
  fs.writeFileSync(payload.factContext.task.output, oracleSpDoc().replace("Table: T1", "Table: T1\n- Table: tgt"), "utf8");
  const result = run(["done", repo, "--id", "doc1", "--agent", "tester"]);
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
    .replace("- FlowNode: n1 | validate input\n", "")
    .replace("- Exception: OTHERS -> RAISE\n", "")
    .replace("- Transaction: commit=true, rollback=true, savepoint=false, autonomous=false\n", "");
  fs.writeFileSync(payload.factContext.task.output, brokenMarkdown, "utf8");

  const done = run(["done", repo, "--id", "doc1", "--agent", "tester"]);
  assert.notEqual(done.status, 0, "done unexpectedly accepted unrendered FSD facts");
  assert.ok(!fs.existsSync(payload.factContext.task.finalOutput), "rejected draft must not publish final docs");

  const stateFile = path.join(repo, ".repowiki", "l3-scheduler", "state.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(state.tasks.doc1.status, "pending");
  assert.ok(state.tasks.doc1.repairContext, JSON.stringify(state.tasks.doc1, null, 2));
  assert.equal(state.tasks.doc1.repairContext.repairType, "l3-fsd-markdown");
  assert.ok(state.tasks.doc1.repairContext.unrenderedFacts.some((row) => row.token.includes("FlowNode: n1")));
  assert.ok(state.tasks.doc1.repairContext.unrenderedFacts.some((row) => row.token.includes("Exception: OTHERS")));
  assert.ok(state.tasks.doc1.repairContext.unrenderedFacts.some((row) => row.token.includes("Transaction: commit=true")));

  const claim = run(["claim", repo, "--agent", "tester"]);
  assert.equal(claim.status, 0, claim.stderr);
  const repairPayload = JSON.parse(claim.stdout);
  assert.ok(repairPayload.factContext.facts.repairContext, JSON.stringify(repairPayload.factContext, null, 2));
  assert.ok(repairPayload.factContext.facts.repairContext.instruction.includes("Do not rerun from scratch"));
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
    .replace("- Package: PKG\n", "")
    .replace("- Param: p_id | IN | NUMBER | BigDecimal\n", "")
    .replace("  - Column: T1.ID\n", "")
    .replace("- Return: Oracle VARCHAR2 -> Java String\n", "");
  fs.writeFileSync(payload.factContext.task.output, brokenMarkdown, "utf8");

  const done = run(["done", repo, "--id", "doc1", "--agent", "tester"]);
  assert.notEqual(done.status, 0, "done unexpectedly accepted draft with missing FSD tokens");
  assert.ok(!fs.existsSync(payload.factContext.task.finalOutput), "rejected draft must not publish final docs");

  const state = JSON.parse(fs.readFileSync(path.join(repo, ".repowiki", "l3-scheduler", "state.json"), "utf8"));
  assert.ok(state.tasks.doc1.repairContext, JSON.stringify(state.tasks.doc1, null, 2));
  const tokens = state.tasks.doc1.repairContext.unrenderedFacts.map((row) => row.token).join("\n");
  assert.ok(tokens.includes("Package: PKG"), tokens);
  assert.ok(tokens.includes("Param: p_id | IN | NUMBER | BigDecimal"), tokens);
  assert.ok(tokens.includes("Column: T1.ID"), tokens);
  assert.ok(tokens.includes("Return: Oracle VARCHAR2 -> Java String"), tokens);
});
