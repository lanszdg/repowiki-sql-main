"use strict";

const FSD_MARKDOWN_SECTIONS = [
  "概览",
  "表结构映射",
  "依赖分析",
  "业务规则",
  "控制流与异常",
  "特殊语法转化规约",
];

const FSD_MARKDOWN_SUBSECTIONS = {
  "概览": ["存储过程功能", "参数清单与 Java 类型映射", "转换策略", "签名", "输入类型定义"],
  "表结构映射": ["涉及的表清单", "列 → DO 字段映射", "跨表关系", "特殊列处理"],
  "依赖分析": ["调用的其他子程序", "被其他子程序调用", "跨包调用 → Service 注入", "序列依赖", "常量依赖"],
  "业务规则": ["校验规则", "计算逻辑", "状态流转", "边界条件"],
  "控制流与异常": ["流程图", "分支逻辑", "循环结构", "异常处理"],
  "特殊语法转化规约": ["转化映射", "事务边界", "需手动审查的构造"],
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function pushNone(lines) {
  lines.push("- None");
}

function pushSection(lines, name) {
  lines.push(`## ${name}`);
  for (const sub of FSD_MARKDOWN_SUBSECTIONS[name] || []) {
    lines.push(`### ${sub}`);
  }
}

function renderReturn(signature) {
  const ret = signature && signature.return;
  if (!ret || !ret.oracleType) return "- Return: None";
  return `- Return: Oracle ${ret.oracleType || ""} -> Java ${ret.javaType || ""}`;
}

function renderFsdMarkdown(facts) {
  const lines = [];
  const identity = facts.identity || {};
  const signature = facts.signature || {};
  const dependencies = facts.dependencies || {};
  const controlFlow = facts.controlFlow || {};
  const transactions = facts.transactions || {};

  lines.push(`# FSD - ${identity.id || ""}`);
  lines.push("");

  pushSection(lines, "概览");
  lines.push(`- FactId: ${identity.id || ""}`);
  lines.push(`- Package: ${identity.packageName || ""}`);
  lines.push(`- Subprogram: ${identity.subprogramName || ""}`);
  lines.push(`- Kind: ${identity.kind || ""}`);
  lines.push(`- Signature: ${signature.raw || ""}`);
  for (const param of asArray(signature.params)) {
    lines.push(`- Param: ${param.name || ""} | ${param.direction || ""} | ${param.oracleType || ""} | ${param.javaType || ""}`);
  }
  lines.push(renderReturn(signature));
  lines.push("");

  pushSection(lines, "表结构映射");
  if (asArray(facts.tableMappings).length === 0) {
    pushNone(lines);
  } else {
    for (const row of asArray(facts.tableMappings)) {
      lines.push(`- Table: ${row.tableName}`);
      lines.push(`  - Operations: ${asArray(row.operations).join(", ")}`);
      for (const op of asArray(row.operations)) {
        lines.push(`  - Operation: ${row.tableName}.${op}`);
      }
      lines.push(`  - Columns: ${asArray(row.columns).join(", ")}`);
      for (const col of asArray(row.columns)) {
        const name = typeof col === "string" ? col : (col && (col.name || col.column || col.columnName));
        if (name) lines.push(`  - Column: ${row.tableName}.${name}`);
      }
    }
  }
  lines.push("");

  pushSection(lines, "依赖分析");
  let dependencyCount = 0;
  for (const row of asArray(dependencies.calls)) {
    dependencyCount++;
    lines.push(`- Call: ${row.target}`);
  }
  for (const row of asArray(dependencies.sequences)) {
    dependencyCount++;
    lines.push(`- Sequence: ${row.name}`);
  }
  for (const row of asArray(dependencies.constants)) {
    dependencyCount++;
    lines.push(`- Constant: ${row.target}`);
  }
  if (!dependencyCount) pushNone(lines);
  lines.push("");

  pushSection(lines, "业务规则");
  if (asArray(facts.manualReview).length === 0) {
    pushNone(lines);
  } else {
    for (const row of asArray(facts.manualReview)) {
      lines.push(`- ManualReview: ${row.id} -> ${row.sourceId} (${row.severity})`);
      lines.push(`  - Reason: ${row.reason || ""}`);
    }
  }
  lines.push("");

  pushSection(lines, "控制流与异常");
  let flowCount = 0;
  for (const row of asArray(controlFlow.nodes)) {
    flowCount++;
    lines.push(`- FlowNode: ${row.id || ""} | ${row.label || ""}`);
  }
  for (const row of asArray(controlFlow.branches)) {
    flowCount++;
    lines.push(`- Branch: ${row.id || ""} | ${row.condition || ""}`);
  }
  for (const row of asArray(controlFlow.loops)) {
    flowCount++;
    lines.push(`- Loop: ${row.id || ""} | ${row.type || ""}`);
  }
  for (const row of asArray(facts.exceptions)) {
    flowCount++;
    lines.push(`- Exception: ${row.name || ""} -> ${row.action || ""}`);
  }
  lines.push(`- Transaction: commit=${Boolean(transactions.hasCommit)}, rollback=${Boolean(transactions.hasRollback)}, savepoint=${Boolean(transactions.hasSavepoint)}, autonomous=${Boolean(transactions.autonomous)}`);
  if (!flowCount) pushNone(lines);
  lines.push("");

  pushSection(lines, "特殊语法转化规约");
  if (asArray(facts.specialSyntax).length === 0) {
    pushNone(lines);
  } else {
    for (const row of asArray(facts.specialSyntax)) {
      lines.push(`- Syntax: ${row.id} | ${row.type} | risk=${row.risk || ""}`);
      if (row.mapping) lines.push(`  - Mapping: ${row.mapping}`);
    }
  }
  for (const row of asArray(facts.sourceTrace)) {
    lines.push(`- SourceTrace: ${row.file || ""}:${row.startLine || ""}-${row.endLine || ""}`);
  }
  lines.push("");

  return `${lines.join("\n").trim()}\n`;
}

module.exports = {
  FSD_MARKDOWN_SECTIONS,
  FSD_MARKDOWN_SUBSECTIONS,
  renderFsdMarkdown,
};
