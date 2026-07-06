#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const root = path.resolve(__dirname, "..");
const testsDir = path.join(root, "config", "skills", "repowiki", "tests");
const tests = fs.readdirSync(testsDir)
  .filter((name) => name.endsWith(".test.cjs"))
  .sort();

for (const name of tests) {
  const file = path.join(testsDir, name);
  console.log(`RUN ${name}`);
  const r = childProcess.spawnSync(process.execPath, [file], {
    cwd: root,
    stdio: "inherit",
  });
  if (r.status !== 0) process.exit(r.status || 1);
}
