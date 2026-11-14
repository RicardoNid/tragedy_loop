// Trusted host API. Send actor-bound ports, never these state objects, to clients.
export { initialize, advance, resume, snapshot, fork, legalCardTargets } from './runtime/engine.js';
export { validateSetup } from './runtime/setup.js';
export { LiveKnowledge, generateDomain } from './runtime/knowledge.js';
export { createSession, project } from './runtime/ports.js';
export { getDecisionContext } from './runtime/context.js';
export { replay, runBatch, enumerateChoices, replayFingerprint } from './runtime/replay.js';
export {
  createReferenceKnowledge,
  appendKnowledge,
  withAssumptions,
  queryReference,
  checkWitness,
} from './runtime/reference.js';
export type { RulePack, EngineState, Diagnostic } from './runtime/model.js';
