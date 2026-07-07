#!/usr/bin/env node
/* score-l3.cjs <repoRoot> — L3 wiki 质量评分（对齐《Repowiki-Dubbo-评分标准(L2+L3)》二、L3）
 * 读 L3 产物(docs/功能文档/{应用名}-{服务清单,功能清单}.md + 功能文档/*.md) + L2 事实(parts)。
 * 铁律：LLM 只填语义最小面；确定性字段(接口/实现/版本/功能入口/方法集)必须==L2 事实。
 * 确定性层(覆盖/接地/结构/无占位)全机器算；LLM 语义层(命名/概述)输出待 LLM-judge 抽样清单。
 */
const fs = require("fs"), path = require("path");
const repo = process.argv[2];
if (!repo) { console.error("usage: node score-l3.cjs <repoRoot>"); process.exit(2); }
const simple = (s) => String(s || "").split(".").pop();
const P = path.join(repo, ".repowiki", "knowledge", "parts");
const readParts = (pre) => { if (!fs.existsSync(P)) return []; let a = []; for (const f of fs.readdirSync(P)) if (f.startsWith(pre) && f.endsWith(".json")) { try { const j = JSON.parse(fs.readFileSync(path.join(P, f), "utf8")); a = a.concat(Array.isArray(j) ? j : [j]); } catch {} } return a; };
const functions = readParts("functions.part"), services = readParts("services.part");

// L2 事实索引
const l2IfaceSet = new Set(services.map((s) => s.iface_qn || s.service_iface).filter(Boolean));
const l2IfaceSimple = new Set(services.map((s) => simple(s.service_iface || s.iface_qn)));
const l2MethodKeys = new Set(functions.map((f) => simple(f.impl_qn || f.iface_qn) + "." + (f.method || "")));
const l2MethodByIfaceMethod = new Set(functions.map((f) => simple(f.iface_qn || f.service_iface) + "." + (f.method || "")));

// 找 L3 md
const found = [];
(function walk(d) { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { if ([".repowiki", ".codegraph", "node_modules", "target"].includes(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/功能清单\.md$|服务清单\.md$|功能文档.*\.md$/.test(e.name)) found.push(p); } })(path.join(repo, "docs"));
const funcListFile = found.find((f) => /功能清单\.md$/.test(f));
const svcListFile = found.find((f) => /服务清单\.md$/.test(f));
const docFiles = found.filter((f) => /功能文档[\\/][^\\/]+\.md$/.test(f) && !/清单/.test(f));

if (!funcListFile && !svcListFile) {
  console.log("===== L3 评分 =====");
  console.log("⚠ 未找到 L3 产物(功能清单/服务清单.md)。L3 尚未运行 → 无法评分。");
  console.log("（L3 标准已就绪；待 L3 跑出 docs/功能文档/*-功能清单.md 后重跑本脚本）");
  process.exit(3);
}

const parseTable = (file) => {
  if (!file || !fs.existsSync(file)) return { header: [], rows: [] };
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim().startsWith("|"));
  if (lines.length < 2) return { header: [], rows: [] };
  const cells = (l) => l.split("|").slice(1, -1).map((c) => c.trim());
  const header = cells(lines[0]);
  const rows = lines.slice(2).map(cells).filter((r) => r.length === header.length);
  return { header, rows };
};
const funcT = parseTable(funcListFile);
const col = (h, name) => funcT.header.findIndex((c) => c.includes(name));
const iEntry = col(funcT.header, "功能入口"), iIface = col(funcT.header, "接口"), iName = col(funcT.header, "功能名称"), iType = col(funcT.header, "功能类型"), iDesc = col(funcT.header, "功能概述");

const fails = []; let score = 0;
const chk = (name, w, ok, ev) => { if (ok) score += w; else fails.push(`${name} | ${ev}`); console.log((ok ? "✅" : "❌") + ` ${name} (${ok ? w : 0}/${w}) ${ok ? "" : ev}`); };

// 解析功能入口 → 方法FQN
const parseEntry = (e) => { const m = String(e || "").match(/([\w.]+)\.(\w+)\s*\(/); return m ? { fqn: m[1], method: m[2] } : null; };
const rows = funcT.rows;
const echoRe = /Echo(Server)?/i;

// ---- L3 P0 ----
console.log("===== L3 评分 =====");
console.log(`功能清单行=${rows.length}  L2 functions=${functions.length}  功能文档=${docFiles.length}`);
console.log("\n-- P0 硬闸 --");
const p0 = [];
// P0-2 零幻觉: 每行接口∈L2, 每行入口方法∈L2
let halluc = [];
for (const r of rows) {
  const iface = iIface >= 0 ? r[iIface] : ""; const ent = parseEntry(iEntry >= 0 ? r[iEntry] : "");
  if (iface && !l2IfaceSimple.has(simple(iface))) halluc.push("接口:" + simple(iface));
  if (ent && !l2MethodKeys.has(simple(ent.fqn) + "." + ent.method) && !l2MethodByIfaceMethod.has(simple(iface) + "." + ent.method)) halluc.push("入口:" + ent.fqn + "." + ent.method);
}
p0.push({ id: "L3-P0-2", name: "零幻觉(接口/入口∈L2)", pass: halluc.length === 0, ev: halluc.slice(0, 8).join(",") });
// P0-1 覆盖: L2 in_scope functions(排除 review_required/无证据, 与 l3-selection 一致) 全在清单
const reviewIf = new Set(services.filter((s) => s.review_required || s.exposure_evidence === "none").map((s) => simple(s.service_iface || s.iface_qn)));
const inScopeFns = functions.filter((f) => !reviewIf.has(simple(f.iface_qn || f.service_iface)));
const listed = new Set(rows.map((r) => { const e = parseEntry(r[iEntry] || ""); const iface = simple(r[iIface] || ""); return e ? iface + "." + e.method : ""; }));
const missingFns = inScopeFns.filter((f) => !listed.has(simple(f.iface_qn || f.service_iface) + "." + (f.method || "")));
p0.push({ id: "L3-P0-1", name: "覆盖=L2 in_scope functions全集", pass: missingFns.length === 0, ev: "漏" + missingFns.length + "条(in_scope=" + inScopeFns.length + ")" });
// P0-4 echo/consumer/DTO 不出现
const echoInList = rows.filter((r) => echoRe.test(r[iIface] || "") || /^G\d+(Input|Output)$/.test(simple(r[iIface] || "")));
p0.push({ id: "L3-P0-4", name: "echo/DTO不出现", pass: echoInList.length === 0, ev: echoInList.length + "条" });
// P0-5 无占位符
const allText = [funcListFile, svcListFile].filter(Boolean).map((f) => fs.readFileSync(f, "utf8")).join("\n");
const ph = (allText.match(/TODO|待补充|占位|xxx|XXX|示例填写|\{[^}]*\}/g) || []);
p0.push({ id: "L3-P0-5", name: "无占位符", pass: ph.length === 0, ev: ph.slice(0, 5).join(",") });
// P0-3 确定性字段未篡改: 抽查功能类型固定值
const badType = iType >= 0 ? rows.filter((r) => r[iType] !== "联机-DSF服务").length : 0;
p0.push({ id: "L3-P0-3", name: "确定性字段(功能类型固定)", pass: badType === 0, ev: "异常" + badType + "行" });
for (const g of p0) console.log((g.pass ? "✅" : "❌") + " " + g.id + " " + g.name + " : " + (g.ev || "ok"));

// ---- 加权(确定性层 80) ----
console.log("\n-- 加权(确定性层) --");
chk("A 覆盖完整性(功能清单==L2 in_scope functions)", 30, missingFns.length === 0 && Math.abs(rows.length - inScopeFns.length) <= 1, `清单${rows.length} vs in_scope ${inScopeFns.length} 漏${missingFns.length}`);
chk("B 接地(零幻觉)", 25, halluc.length === 0, "幻觉" + halluc.length);
chk("C 结构(列/功能类型/无占位)", 15, iEntry >= 0 && iIface >= 0 && iName >= 0 && badType === 0 && ph.length === 0, "列缺/类型异/占位");
chk("E 功能文档完整(每功能一份/无占位)", 10, docFiles.length > 0 && !docFiles.some((f) => /TODO|待补充|占位/.test(fs.readFileSync(f, "utf8"))), "doc=" + docFiles.length);

// ---- D LLM 语义层(20): 输出抽样清单, 不机器判 ----
console.log("\n-- D LLM语义层(20): 待 LLM-judge/人审抽样 --");
// 通用抽样：按接口多样性各取一条(覆盖不同服务), 不认具体项目名
const seenIf = new Set(); const sample = [];
for (const r of rows) { const k = simple(iIface >= 0 ? r[iIface] : ""); if (k && !seenIf.has(k)) { seenIf.add(k); sample.push(r); } if (sample.length >= 8) break; }
console.log("抽样" + sample.length + "条(功能名称/概述待打分): " + sample.map((r) => (iName >= 0 ? r[iName] : "?")).join(" | "));
console.log("评法: 每条 功能名称接地/概述接地/不重复/中文通顺 → LLM-judge 0/0.5/1，满分20；幻觉已在 P0-2 一票否决。");
const dupNames = iName >= 0 ? Object.entries(rows.reduce((o, r) => { o[r[iName]] = (o[r[iName]] || 0) + 1; return o; }, {})).filter(([, c]) => c > 1) : [];
console.log("功能名称重复(机器查): " + (dupNames.length ? dupNames.map(([n, c]) => n + "×" + c).join(",") : "无"));

const p0Pass = p0.every((g) => g.pass);
const detMax = 80;
const grade = !p0Pass ? "FAIL(P0)" : (score / detMax) * 100 >= 95 ? "PASS(确定性层)" : (score / detMax) * 100 >= 80 ? "CONDITIONAL" : "FAIL";
console.log("\n确定性层得分: " + score + "/80 (+LLM语义20待判)  P0:" + (p0Pass ? "全过" : "否决") + "  判级(确定性层): " + grade);
if (!p0Pass) console.log("否决项: " + p0.filter((g) => !g.pass).map((g) => g.id).join(","));
process.exit(grade.startsWith("FAIL") ? 1 : 0);
