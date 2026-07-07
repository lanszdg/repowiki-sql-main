#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

const requiredPaths = [
  ["CodeGraph node runtime", "config/bin/codegraph/node.exe"],
  ["CodeGraph CLI", "config/bin/codegraph/dist/bin/codegraph.js"],
  ["opencode runner", "bin/opencode.exe"],
  ["lingxicode launcher", "lingxicode.bat"],
  ["parser resources", "parsers"],
  ["opencode config", "config/opencode.json"],
  ["opencode instructions", "config/AGENTS.md"],
  ["opencode agent config", "config/agent"],
  ["opencode agents config", "config/agents"],
  ["PL/SQL parser vendor deps", "config/skills/repowiki/vendor/node_modules"],
  ["repowiki skill", "config/skills/repowiki/repowiki-run.cjs"],
  ["oracle-sp L3 skill", "config/skills/wiki-l3-oracle-sp/SKILL.md"],
];

let ok = true;
for (const [label, rel] of requiredPaths) {
  const full = path.join(root, rel);
  const exists = fs.existsSync(full);
  console.log(`${exists ? "OK  " : "MISS"} ${label}: ${rel}`);
  if (!exists) ok = false;
}

const configFile = path.join(root, "config", "opencode.json");
if (fs.existsSync(configFile)) {
  const text = fs.readFileSync(configFile, "utf8");
  if (/PUT_YOUR_API_KEY_HERE|your-intranet-llm\.example\.com|default-model/.test(text)) {
    console.log("WARN model config still contains placeholders: config/opencode.json");
    console.log("WARN Fill baseURL/apiKey/model before running L3 dispatcher.");
  }
}

if (!ok) {
  console.error("Preflight failed: runtime bundle is incomplete. Rebuild the release package; do not ask users to download missing runtime files manually.");
  process.exit(1);
}

console.log("Preflight passed: runtime bundle files are present.");
