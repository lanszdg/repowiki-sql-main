"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const cli = path.join(root, "repowiki-codegraph-init.cjs");

function tmpRepo(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `repowiki-${name}-`));
}

function writeFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

test("PL/SQL codegraph init runs plsql-l1-producer once and writes state", () => {
  const repo = tmpRepo("plsql-l1-init");
  writeFile(path.join(repo, "pkg", "inventory_pkg.pks"), `
CREATE OR REPLACE PACKAGE inventory_pkg AS
  PROCEDURE adjust_stock(p_item_id IN NUMBER, p_qty IN NUMBER);
END inventory_pkg;
/
`);

  const result = childProcess.spawnSync(process.execPath, [cli, repo], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = `${result.stdout}\n${result.stderr}`;
  const producerRuns = (output.match(/\[plsql-l1-producer\] backend=/g) || []).length;
  assert.equal(producerRuns, 1, output);

  const l1 = readJson(path.join(repo, ".repowiki", "plsql-l1.json"));
  assert.ok(l1.counts.nodes >= 1, JSON.stringify(l1.counts));
  const state = readJson(path.join(repo, ".repowiki", "codegraph-init.json"));
  assert.equal(state.status, "done");
  assert.equal(state.backend, "plsql-l1-producer");
  assert.equal(state.nodeCount, l1.counts.nodes);
});
