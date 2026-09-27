// This module has no platform imports. Definitions are JSON, never executable code.
export class DefinitionError extends Error {
  constructor(message) { super(message); this.name = "DefinitionError"; }
}

const definitions = new WeakSet();
const own = (object, key) => Object.hasOwn(object, key);
const integer = Number.isSafeInteger;
const identifier = (value) => typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.-]*$/.test(value);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort(compare).map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function requireDefinition(condition, message) {
  if (!condition) throw new DefinitionError(message);
}

function fields(value, keys, path) {
  requireDefinition(value !== null && typeof value === "object" && !Array.isArray(value), `${path}: expected object`);
  requireDefinition(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, `${path}: expected plain object`);
  requireDefinition(Object.keys(value).length === keys.length && keys.every(key => own(value, key)), `${path}: expected exactly ${keys.join(", ")}`);
}

function dictionary(value, path) {
  requireDefinition(value !== null && typeof value === "object" && !Array.isArray(value), `${path}: expected dictionary`);
  requireDefinition(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, `${path}: expected plain dictionary`);
  requireDefinition(Object.keys(value).length > 0 && Object.keys(value).every(identifier), `${path}: nonempty identifier keys required`);
}

export function compile(input) {
  fields(input, ["schemaVersion", "id", "actors", "phases", "initialPhase", "counters", "rules"], "definition");
  requireDefinition(input.schemaVersion === 1 && identifier(input.id), "unsupported schema or invalid id");
  requireDefinition(Array.isArray(input.actors) && input.actors.length > 0 && input.actors.every(identifier) && new Set(input.actors).size === input.actors.length, "actors: unique identifiers required");
  dictionary(input.phases, "phases");
  dictionary(input.counters, "counters");
  requireDefinition(typeof input.initialPhase === "string" && own(input.phases, input.initialPhase), "initialPhase: unknown phase");
  for (const [id, phase] of Object.entries(input.phases)) {
    fields(phase, ["actor"], `phase ${id}`);
    requireDefinition(input.actors.includes(phase.actor), `phase ${id}: unknown actor`);
  }
  for (const [id, counter] of Object.entries(input.counters)) {
    fields(counter, ["min", "max", "initial"], `counter ${id}`);
    requireDefinition(Object.values(counter).every(integer) && counter.min <= counter.initial && counter.initial <= counter.max, `counter ${id}: invalid bounds`);
  }
  requireDefinition(Array.isArray(input.rules), "rules: expected array");
  const ids = new Set();
  for (const rule of input.rules) {
    fields(rule, ["id", "phase", "actor", "when", "effects", "outcome"], "rule");
    requireDefinition(identifier(rule.id) && !ids.has(rule.id), "rule: invalid or duplicate id");
    ids.add(rule.id);
    requireDefinition(typeof rule.phase === "string" && own(input.phases, rule.phase) && input.phases[rule.phase].actor === rule.actor, `${rule.id}: phase/actor mismatch`);
    requireDefinition(Array.isArray(rule.when) && Array.isArray(rule.effects), `${rule.id}: expected condition/effect arrays`);
    for (const condition of rule.when) {
      fields(condition, ["op", "counter", "value"], `${rule.id} condition`);
      requireDefinition(condition.op === "counter_gte" && typeof condition.counter === "string" && own(input.counters, condition.counter) && integer(condition.value), `${rule.id}: invalid condition`);
    }
    for (const effect of rule.effects) {
      fields(effect, ["op", "counter", "amount"], `${rule.id} effect`);
      requireDefinition(effect.op === "change_counter" && typeof effect.counter === "string" && own(input.counters, effect.counter) && integer(effect.amount), `${rule.id}: invalid effect`);
    }
    const outcome = rule.outcome;
    fields(outcome, outcome && own(outcome, "goto") ? ["goto"] : ["finish"], `${rule.id} outcome`);
    requireDefinition(own(outcome, "goto") ? typeof outcome.goto === "string" && own(input.phases, outcome.goto) : identifier(outcome.finish), `${rule.id}: invalid outcome`);
  }
  const definition = structuredClone(input);
  definition.rules.sort((a, b) => compare(a.id, b.id));
  const handle = freeze({ data: definition, identity: canonical(definition) });
  definitions.add(handle);
  return handle;
}

function requireHandle(definition) {
  if (!definitions.has(definition)) throw new DefinitionError("expected compile() result");
}

export function createGame(definition) {
  requireHandle(definition);
  return {
    definition: definition.identity,
    phase: definition.data.initialPhase,
    revision: 0,
    status: "active",
    outcome: null,
    counters: Object.fromEntries(Object.entries(definition.data.counters).map(([id, spec]) => [id, spec.initial])),
  };
}

function validState(definition, state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  if (Object.keys(state).length !== 6 || !["definition", "phase", "revision", "status", "outcome", "counters"].every(key => own(state, key))) return false;
  if (state.definition !== definition.identity || !integer(state.revision) || state.revision < 0) return false;
  if (typeof state.phase !== "string" || !own(definition.data.phases, state.phase)) return false;
  if (state.status !== "active" && state.status !== "finished") return false;
  if (state.status === "active" ? state.outcome !== null : !identifier(state.outcome) || !definition.data.rules.some(rule => own(rule.outcome, "finish") && rule.outcome.finish === state.outcome)) return false;
  const counters = state.counters;
  if (!counters || typeof counters !== "object" || Array.isArray(counters)) return false;
  return Object.keys(counters).length === Object.keys(definition.data.counters).length && Object.entries(definition.data.counters).every(([id, spec]) => own(counters, id) && integer(counters[id]) && counters[id] >= spec.min && counters[id] <= spec.max);
}

function enabled(rule, state, actor) {
  return state.status === "active" && rule.phase === state.phase && rule.actor === actor && rule.when.every(condition => state.counters[condition.counter] >= condition.value);
}

export function legalCommands(definition, state, actor) {
  requireHandle(definition);
  if (!validState(definition, state)) throw new DefinitionError("invalid state");
  return definition.data.rules.filter(rule => enabled(rule, state, actor)).map(rule => ({ ruleId: rule.id }));
}

export function step(definition, state, actor, command) {
  requireHandle(definition);
  if (!validState(definition, state)) return { kind: "rule_error", code: "invalid_state" };
  if (!command || typeof command !== "object" || Array.isArray(command) || Object.keys(command).length !== 1 || typeof command.ruleId !== "string" || !own(command, "ruleId")) return { kind: "rejected", code: "invalid_command" };
  const rule = definition.data.rules.find(rule => rule.id === command.ruleId);
  if (!rule || !enabled(rule, state, actor)) return { kind: "rejected", code: "not_legal" };
  if (!integer(state.revision + 1)) return { kind: "rule_error", code: "revision_overflow" };
  const next = structuredClone(state);
  const effects = [];
  for (const effect of rule.effects) {
    const before = next.counters[effect.counter];
    const after = before + effect.amount;
    const bounds = definition.data.counters[effect.counter];
    if (!integer(after) || after < bounds.min || after > bounds.max) return { kind: "rule_error", code: "counter_bounds", ruleId: rule.id };
    next.counters[effect.counter] = after;
    effects.push({ counter: effect.counter, before, after });
  }
  next.revision += 1;
  if (own(rule.outcome, "goto")) next.phase = rule.outcome.goto;
  else { next.status = "finished"; next.outcome = rule.outcome.finish; }
  return {
    kind: next.status === "finished" ? "finished" : "settled",
    state: next,
    event: { revision: next.revision, ruleId: rule.id, actor, effects },
  };
}
