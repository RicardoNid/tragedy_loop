import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { compile, createGame, legalCommands, step, DefinitionError } from "../src/index.mjs";
import { simulate, replay } from "../src/simulator.mjs";

const fixtureUrl = new URL("../fixtures/counter.json", import.meta.url);
const fixture = () => JSON.parse(readFileSync(fixtureUrl, "utf8"));
const command = ruleId => ({ ruleId });

test("compilation rejects unknown operations, fields, references and duplicate IDs", () => {
  for (const mutate of [
    x => { x.rules[0].effects[0].op = "execute_js"; },
    x => { x.rules[0].when[0].counter = "missing"; },
    x => { x.rules[0].outcome.goto = "missing"; },
    x => { x.rules[0].outcome.finish = "also"; },
    x => { x.rules[0].actor = "unknown"; },
    x => { x.rules[1].id = x.rules[0].id; },
    x => { x.counters.energy.initial = 4; },
    x => { x.hiddenInformation = {}; },
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => compile(input), DefinitionError);
  }
});

test("definition is isolated and frozen; key and rule ordering are canonical", () => {
  const input = fixture();
  const definition = compile(input);
  input.rules[0].effects[0].amount = 100;
  assert.equal(definition.data.rules[0].effects[0].amount, -1);
  assert.throws(() => { definition.data.rules[0].effects[0].amount = 100; }, TypeError);
  const reordered = fixture(); reordered.rules.reverse();
  assert.equal(compile(reordered).identity, definition.identity);
});

test("independent expected transitions, actor checks, exhaustion and terminal rejection", () => {
  const definition = compile(fixture());
  let state = createGame(definition);
  assert.deepEqual(legalCommands(definition, state, "other"), []);
  assert.equal(step(definition, state, "other", command("spend")).kind, "rejected");
  for (const expected of [2, 1, 0]) {
    const before = structuredClone(state);
    const result = step(definition, state, "tester", command("spend"));
    assert.deepEqual(state, before);
    assert.equal(result.kind, "settled");
    assert.equal(result.state.counters.energy, expected);
    assert.deepEqual(result.event.effects, [{ counter: "energy", before: expected + 1, after: expected }]);
    state = result.state;
  }
  assert.deepEqual(legalCommands(definition, state, "tester"), [command("stop")]);
  assert.equal(step(definition, state, "tester", command("spend")).kind, "rejected");
  state = step(definition, state, "tester", command("stop")).state;
  assert.equal(state.outcome, "completed");
  assert.deepEqual(legalCommands(definition, state, "tester"), []);
  assert.equal(step(definition, state, "tester", command("stop")).kind, "rejected");
});

test("phase transition transfers command ownership", () => {
  const input = fixture();
  input.actors.push("reviewer");
  input.phases.review = { actor: "reviewer" };
  input.rules[0].outcome = { goto: "review" };
  input.rules[1].phase = "review"; input.rules[1].actor = "reviewer";
  const definition = compile(input);
  const next = step(definition, createGame(definition), "tester", command("spend")).state;
  assert.equal(next.phase, "review");
  assert.deepEqual(legalCommands(definition, next, "tester"), []);
  assert.equal(step(definition, next, "reviewer", command("stop")).kind, "finished");
});

test("effect failure is atomic and remains observable to legal-action exploration", () => {
  const input = fixture();
  input.rules = [input.rules[0]];
  input.rules[0].effects.push({ op: "change_counter", counter: "energy", amount: 100 });
  const definition = compile(input);
  const state = createGame(definition);
  const before = structuredClone(state);
  assert.deepEqual(legalCommands(definition, state, "tester"), [command("spend")]);
  assert.deepEqual(step(definition, state, "tester", command("spend")), { kind: "rule_error", code: "counter_bounds", ruleId: "spend" });
  assert.deepEqual(state, before);
  const trace = simulate(definition);
  assert.equal(trace.result.kind, "rule_error");
  assert.equal(replay(trace).verified, true);
});

test("invalid state, definition mismatch and malformed commands fail explicitly", () => {
  const definition = compile(fixture());
  for (const mutate of [
    x => { x.counters.energy = -1; },
    x => { x.definition = "wrong"; },
    x => { x.phase = "unknown"; },
    x => { x.revision = -1; },
    x => { x.status = "finished"; x.outcome = undefined; },
  ]) {
    const state = createGame(definition); mutate(state);
    assert.equal(step(definition, state, "tester", command("stop")).code, "invalid_state");
  }
  for (const invalid of [null, {}, { ruleId: "stop", extra: true }, []]) {
    assert.equal(step(definition, createGame(definition), "tester", invalid).code, "invalid_command");
  }
});

test("same seed produces identical replayable traces across 100 seeds", () => {
  const definition = compile(fixture());
  for (let seed = 0; seed < 100; seed++) {
    const trace = simulate(definition, { seed });
    assert.deepEqual(trace, simulate(definition, { seed }));
    assert.equal(trace.result.kind, "finished");
    assert.equal(replay(JSON.parse(JSON.stringify(trace))).verified, true);
  }
});

test("deadlocks and exploration limits are distinct from success", () => {
  const deadlock = fixture(); deadlock.rules = [];
  const stuck = simulate(compile(deadlock));
  assert.equal(stuck.result.kind, "deadlock");
  assert.equal(replay(stuck).result.kind, "deadlock");
  const limited = simulate(compile(fixture()), { maxSteps: 0 });
  assert.equal(limited.result.kind, "limit");
  assert.equal(replay(limited).result.kind, "limit");
});

test("replay rejects modified events, state, outcome and truncated trajectories", () => {
  const original = simulate(compile(fixture()), { seed: 42 });
  for (const mutate of [
    x => { x.steps[0].result.event.actor = "forged"; },
    x => { x.steps[0].result.state.counters.energy = 99; },
    x => { x.result = { kind: "limit" }; },
    x => { x.steps.pop(); },
    x => { x.steps[0].command = { ruleId: "unknown" }; },
    x => { x.steps.push(x.steps.at(-1)); },
  ]) {
    const trace = structuredClone(original); mutate(trace);
    assert.throws(() => replay(trace));
  }
});

test("CLI produces replayable JSON and nonzero exit codes for incomplete runs", () => {
  const cli = new URL("../bin/engine.mjs", import.meta.url);
  const run = (...args) => spawnSync(process.execPath, [cli.pathname, ...args], { encoding: "utf8" });
  const completed = run("simulate", fixtureUrl.pathname, "--seed", "42");
  assert.equal(completed.status, 0, completed.stderr);
  const trace = JSON.parse(completed.stdout);
  assert.equal(trace.result.kind, "finished");
  assert.equal(run("simulate", fixtureUrl.pathname, "--max-steps", "0").status, 1);
  assert.equal(run("simulate", fixtureUrl.pathname, "--seed", "-1").status, 2);
  const dir = mkdtempSync(join(tmpdir(), "tragedy-engine-"));
  try {
    const path = join(dir, "trace.json"); writeFileSync(path, completed.stdout);
    const replayed = run("replay", path);
    assert.equal(replayed.status, 0, replayed.stderr);
    assert.equal(JSON.parse(replayed.stdout).verified, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
