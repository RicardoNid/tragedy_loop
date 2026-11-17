import type { EngineState } from '../runtime/model.js';

/** Only used for whole-game victory. New phase entry cuts off the history scan
 * used by incidentHadPublicEffect. All future rule inputs, including private
 * assignments, once-only card statuses, delayed work, flags, serials and object
 * iteration order remain in the key. Transport receipts and prior announcements
 * cannot affect an uninterrupted continuation's winner. */
export function terminalProofKey(s: EngineState): string | undefined {
  if (s.phaseEntered || s.pending || (s.phase !== 'mastermind-abilities' && s.phase !== 'day-end'))
    return;
  const last = s.observations.public.at(-1);
  if (
    last?.type !== 'boundary' ||
    last.phase !== s.phase ||
    last.loop !== s.loop ||
    last.day !== s.day
  )
    return;
  const { audit, choices, receipts, revision, observations, ...rules } = s;
  return JSON.stringify(rules);
}

export class TerminalProofs {
  private readonly entries = new Map<string, 'win' | 'lose'>();
  hits = 0;
  constructor(readonly limit: number) {}
  get(key: string) {
    const found = this.entries.get(key);
    if (found) this.hits++;
    return found;
  }
  put(key: string, outcome: 'win' | 'lose') {
    if (!this.entries.has(key) && this.entries.size >= this.limit)
      this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, outcome);
  }
}
