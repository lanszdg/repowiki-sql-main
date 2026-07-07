#!/usr/bin/env node
/* score-l2.cjs <repoRoot> [--anchors <anchors.json>] [--baseline <services.json>]
 * 通用 L2 事实质量评分 —— 跨项目可用：所有核心检查从该项目自己的 provider.xml + L2 facts 派生，无硬编码场景名。
 * 可选 --anchors：fixture/项目特定断言(方法数/必含/必排等)，作回归校验单独报，不影响通用分。
 * 可选 --baseline：上轮 services 快照，做非回归(集合不缩水)。
 * 度量: <repo>/.repowiki/knowledge/parts/{services,functions,coverage-ledger}.part-*.json
 */
const fs = require("fs"), path = require("path");
const args = process.argv.slice(2);
const repo = args.find((a) => !a.startsWith("--") && (args.indexOf(a) === 0 || !args[args.indexOf(a) - 1].startsWith("--")));
const optVal = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const anchorsFile = optVal("--anchors"), baselineFile = optVal("--baseline");
if (!repo) { console.error("usage: node score-l2.cjs <repoRoot> [--anchors a.json] [--baseline s.json]"); process.exit(2); }
const simple = (s) => String(s || "").split(".").pop();
const P = path.join(repo, ".repowiki", "knowledge", "parts");
const readParts = (pre) => { if (!fs.existsSync(P)) return []; let a = []; for (const f of fs.readdirSync(P)) if (f.startsWith(pre) && f.endsWith(".json")) { try { const j = JSON.parse(fs.readFileSync(path.join(P, f), "utf8")); a = a.concat(Array.isArray(j) ? j : [j]); } catch {} } return a; };
const services = readParts("services.part"), functions = readParts("functions.part"), ledgers = readParts("coverage-ledger.part");

// ---- provider.xml: 声明集 + 消费者(通用解析, 不认具体项目) ----
const xmls = [];
(function walk(d) { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  if ([".repowiki", ".codegraph", "node_modules", "target", ".git"].includes(e.name)) continue;
  const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p); else if (e.name.endsWith(".xml")) xmls.push(p);
} })(repo);
const declared = [], consumers = [];
for (const x of xmls) { const t = fs.readFileSync(x, "utf8");
  for (const m of t.matchAll(/<dubbo:service\b([^>]*)>/g)) { const a = m[1]; const iface = (a.match(/\binterface="([^"]+)"/) || [])[1]; const ref = (a.match(/\bref="([^"]+)"/) || [])[1] || ""; if (iface) declared.push({ iface, ref }); }
  for (const m of t.matchAll(/<dubbo:reference\b[^>]*\binterface="([^"]+)"/g)) consumers.push(m[1]);
}
const isEcho = (ref, iface) => /^echoServer(Impl)?$/i.test(ref || "") || /^Echo(Server)?$/.test(simple(iface));
const expected = [...new Set(declared.filter((d) => !isEcho(d.ref, d.iface)).map((d) => simple(d.iface)))];
const consumerSimple = new Set(consumers.map(simple));

const svcSet = new Set(services.map((s) => simple(s.service_iface || s.iface_qn)));
const cov = ledgers.reduce((o, l) => { for (const k in (l.counts || {})) o[k] = (o[k] || 0) + Number(l.counts[k] || 0); return o; }, {});
const isReview = (s) => s.review_required === true || s.exposure_evidence === "none";
const inScope = services.filter((s) => !isReview(s));
const fnsByIface = (n) => functions.filter((f) => simple(f.iface_qn || f.service_iface) === n).length;

// ---- P0 硬闸(全通用) ----
const p0 = [];
const missing = expected.filter((n) => !svcSet.has(n));
p0.push({ id: "P0-1", name: "真实服务零丢弃", pass: missing.length === 0, ev: missing.length ? "缺:" + missing.slice(0, 8).join(",") : "ok" });
const echoLeak = services.filter((s) => isEcho(s.evidence && s.evidence.ref, s.service_iface || s.iface_qn) || /^Echo(Server)?Impl$/.test(simple(s.impl_qn)));
p0.push({ id: "P0-2", name: "echo零泄漏", pass: echoLeak.length === 0, ev: echoLeak.length ? echoLeak.map((s) => s.service_iface).slice(0, 6).join(",") : "ok" });
const consLeak = services.filter((s) => consumerSimple.has(simple(s.service_iface || s.iface_qn)));
p0.push({ id: "P0-3", name: "消费者零泄漏", pass: consLeak.length === 0, ev: consLeak.length ? consLeak.map((s) => s.service_iface).join(",") : "ok" });
p0.push({ id: "P0-4", name: "无死停", pass: (cov.unresolvedBindings || 0) === 0, ev: "unresolvedBindings=" + (cov.unresolvedBindings || 0) });
const fnUpper = Math.max(50, expected.length * 20);
p0.push({ id: "P0-5", name: "functions合理带宽", pass: functions.length > 0 && functions.length <= fnUpper, ev: "functions=" + functions.length + " 上限~" + fnUpper });
const byII = {}; for (const s of services) { const k = [simple(s.service_iface || s.iface_qn), s.version || "", s.group || ""].join("|"); (byII[k] = byII[k] || []).push(s.impl_qn || ""); }
const dups = Object.entries(byII).filter(([, impls]) => impls.includes("") && impls.some((i) => i !== ""));
p0.push({ id: "P0-6", name: "无重复服务(impl-less+impl-ful双计)", pass: dups.length === 0, ev: dups.length ? dups.slice(0, 6).map(([k, im]) => k + "×" + im.length).join("; ") : "ok" });

// ---- 加权(全通用, 数据派生, 100) ----
let score = 0; const items = [];
const add = (name, w, got, ev) => { items.push({ name, w, got: Math.round(got * 100) / 100, ev }); score += got; };
// A 覆盖率(35) = 命中真实声明服务比例
const hit = expected.filter((n) => svcSet.has(n)).length;
add("A 覆盖率(真实声明服务in_scope)", 35, expected.length ? 35 * hit / expected.length : 35, hit + "/" + expected.length);
// B 排除(20): echo + consumer
add("B1 echo 100%排除", 12, echoLeak.length === 0 ? 12 : 0, "泄漏" + echoLeak.length);
add("B2 消费者100%排除", 8, consLeak.length === 0 ? 8 : 0, "泄漏" + consLeak.length);
// C 噪声治理(15): exposure_evidence=none 服务全 review + 不入 functions
const noneSvc = services.filter((s) => s.exposure_evidence === "none");
const noneNotReview = noneSvc.filter((s) => !s.review_required);
// 仅"不可过滤的污染"才扣分：exposure_evidence=none 且未标 review_required 的服务的方法(L3 selection 无法分桶过滤)。
// review_required 的 review 方法会被 l3-selection 分到 review 桶、不进 in_scope/功能清单 → 在 wiki 层无害。
const unfilterableIfaces = new Set(noneNotReview.map((s) => simple(s.service_iface || s.iface_qn)));
const noneFnPollute = functions.filter((f) => unfilterableIfaces.has(simple(f.iface_qn || f.service_iface))).length;
add("C1 无证据服务全入review", 8, noneSvc.length === 0 || noneNotReview.length === 0 ? 8 : 8 * (1 - noneNotReview.length / noneSvc.length), "未review:" + noneNotReview.length + "/" + noneSvc.length);
add("C2 噪声不污染functions(不可过滤)", 7, noneFnPollute === 0 ? 7 : 0, noneFnPollute ? "不可过滤污染" + noneFnPollute + "条" : "review方法由L3 selection过滤,无害");
// D 方法枚举完整(15): in_scope 服务有方法 或 被显式标记(空接口/jar-debt), 不静默0
const flagged = (s) => s.impl_resolution === "dispatch" || s.impl_resolution === "mybatis-proxy" || s.status === "empty_interface";
const goodMethod = inScope.filter((s) => { const n = simple(s.service_iface || s.iface_qn); return fnsByIface(n) > 0 || flagged(s); }).length;
add("D 方法枚举完整(in_scope有方法/已标记)", 15, inScope.length ? 15 * goodMethod / inScope.length : 15, goodMethod + "/" + inScope.length);
// E 守恒/非回归(15)
add("E1 账本自洽(decl>=resolved)", 5, (cov.declaredExposures || 0) >= (cov.resolvedBindings || 0) ? 5 : 0, "decl=" + (cov.declaredExposures || 0) + " resolved=" + (cov.resolvedBindings || 0));
add("E2 无重复服务", 5, dups.length === 0 ? 5 : 0, dups.length + "组");
// E3 非回归(可选 baseline)
let e3 = 5, e3ev = "无baseline(跳过)";
if (baselineFile && fs.existsSync(baselineFile)) { try { const base = JSON.parse(fs.readFileSync(baselineFile, "utf8")); const baseSet = new Set((Array.isArray(base) ? base : base.services || []).map((s) => simple(s.service_iface || s.iface_qn || s))); const lost = [...baseSet].filter((n) => !svcSet.has(n)); e3 = lost.length === 0 ? 5 : 0; e3ev = lost.length ? "丢失:" + lost.slice(0, 6).join(",") : "ok"; } catch { e3ev = "baseline解析失败"; } }
add("E3 非回归(baseline服务不缩水)", 5, e3, e3ev);

// ---- 输出 ----
const p0Pass = p0.every((g) => g.pass);
score = Math.round(score * 10) / 10;
const grade = !p0Pass ? "FAIL(P0)" : score >= 95 ? "PASS" : score >= 80 ? "CONDITIONAL" : "FAIL";
console.log("===== L2 评分(通用) =====  repo=" + path.basename(repo));
console.log("services=" + services.length + " in_scope=" + inScope.length + " functions=" + functions.length + " 期望真实服务=" + expected.length + " review=" + (cov.reviewServices || services.filter((s) => s.review_required).length));
console.log("\n-- P0 硬闸 --");
for (const g of p0) console.log((g.pass ? "✅" : "❌") + " " + g.id + " " + g.name + " : " + g.ev);
console.log("\n-- 加权(数据派生) --");
for (const it of items) console.log((it.got >= it.w - 0.01 ? "✅" : (it.got > 0 ? "◐" : "❌")) + " " + it.name + " (" + it.got + "/" + it.w + ") " + it.ev);
console.log("\n通用总分: " + score + "/100  P0:" + (p0Pass ? "全过" : "否决:" + p0.filter((g) => !g.pass).map((g) => g.id).join(",")) + "  判级: " + grade);

// ---- 可选 anchors(fixture/项目回归断言, 单独报) ----
if (anchorsFile && fs.existsSync(anchorsFile)) {
  const A = JSON.parse(fs.readFileSync(anchorsFile, "utf8"));
  console.log("\n-- fixture anchors 回归(单独, 不计通用分) --");
  let ap = 0, at = 0; const af = (name, ok, ev) => { at++; if (ok) ap++; console.log((ok ? "✅" : "❌") + " " + name + (ok ? "" : " " + ev)); };
  for (const [n, c] of Object.entries(A.methodCounts || {})) af("方法数 " + n + "=" + c, fnsByIface(n) === c, "实=" + fnsByIface(n));
  for (const n of A.inScopeMustHave || []) af("必含 " + n, svcSet.has(n), "缺");
  for (const n of A.excludedMustNotHave || []) af("必排 " + n, !svcSet.has(n), "泄漏");
  for (const n of A.emptyServices || []) af("空接口 " + n + "≤1方法", fnsByIface(n) <= 1, "实=" + fnsByIface(n));
  for (const [n, c] of Object.entries(A.versionedServices || {})) af("版本分组 " + n + "=" + c + "条", services.filter((s) => simple(s.service_iface) === n).length === c, "实=" + services.filter((s) => simple(s.service_iface) === n).length);
  console.log("anchors: " + ap + "/" + at + (ap === at ? " 全过" : " 有未过"));
}
process.exit(grade.startsWith("FAIL") ? 1 : 0);
