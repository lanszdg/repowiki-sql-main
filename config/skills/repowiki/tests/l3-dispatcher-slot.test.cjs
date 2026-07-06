"use strict";

const assert = require("assert");
const { spawnCountForProgress } = require("../repowiki-l3-dispatcher.cjs");

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

test("dispatcher frees slots held by stale active workers that are not reflected as running tasks", () => {
  const progress = {
    dispatch: 15,
    running: 5,
    runningLimit: 20,
    ready: 19,
    dispatchHint: "spawn_exactly_15",
  };
  const decision = spawnCountForProgress(progress, 19, 4, 0);
  assert.equal(decision.action, "spawn");
  assert.equal(decision.externalRunning, 1);
  assert.equal(decision.spawnNow, 15);
});

test("dispatcher still reserves short-lived active workers during startup grace", () => {
  const progress = {
    dispatch: 15,
    running: 5,
    runningLimit: 20,
    ready: 19,
    dispatchHint: "spawn_exactly_15",
  };
  const decision = spawnCountForProgress(progress, 19, 4, 15);
  assert.equal(decision.action, "spawn");
  assert.equal(decision.spawnNow, 0);
});
