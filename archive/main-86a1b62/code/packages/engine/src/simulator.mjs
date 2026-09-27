import { canonical, compile, createGame, legalCommands, step } from "./index.mjs";

function checkOptions(seed, maxSteps) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("seed must be a uint32");
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 0) throw new Error("maxSteps must be a nonnegative safe integer");
}

function random(seed) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function boundary(definition, state, count, maxSteps) {
  if (state.status === "finished") return { kind: "finished", outcome: state.outcome };
  const actor = definition.data.phases[state.phase].actor;
  if (legalCommands(definition, state, actor).length === 0) return { kind: "deadlock", phase: state.phase };
  if (count >= maxSteps) return { kind: "limit" };
  return null;
}

export function simulate(definition, { seed = 1, maxSteps = 100 } = {}) {
  checkOptions(seed, maxSteps);
  let state = createGame(definition);
  const choose = random(seed);
  const trace = { format: 1, definition: definition.data, seed, maxSteps, steps: [], result: null };
  while (true) {
    const end = boundary(definition, state, trace.steps.length, maxSteps);
    if (end) { trace.result = end; return trace; }
    const actor = definition.data.phases[state.phase].actor;
    const commands = legalCommands(definition, state, actor);
    const command = commands[Math.floor(choose() * commands.length)];
    const result = step(definition, state, actor, command);
    trace.steps.push({ actor, command, result });
    if (result.kind === "rejected" || result.kind === "rule_error") {
      trace.result = { kind: "rule_error", code: result.code };
      return trace;
    }
    state = result.state;
  }
}

export function replay(trace) {
  if (!trace || trace.format !== 1 || !Array.isArray(trace.steps)) throw new Error("invalid trace format");
  checkOptions(trace.seed, trace.maxSteps);
  const definition = compile(trace.definition);
  let state = createGame(definition);
  let result;
  for (const [index, entry] of trace.steps.entries()) {
    if (result || boundary(definition, state, index, trace.maxSteps)) throw new Error(`unexpected step ${index}`);
    const actor = definition.data.phases[state.phase].actor;
    if (entry.actor !== actor || !legalCommands(definition, state, actor).some(command => canonical(command) === canonical(entry.command))) throw new Error(`illegal recorded command at step ${index}`);
    const actual = step(definition, state, actor, entry.command);
    if (canonical(actual) !== canonical(entry.result)) throw new Error(`replay mismatch at step ${index}`);
    if (actual.kind === "rule_error" || actual.kind === "rejected") result = { kind: "rule_error", code: actual.code };
    else state = actual.state;
  }
  result ??= boundary(definition, state, trace.steps.length, trace.maxSteps);
  if (!result || canonical(result) !== canonical(trace.result)) throw new Error("replay outcome mismatch or incomplete trace");
  return { verified: true, steps: trace.steps.length, result };
}
