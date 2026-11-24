import type { GameSetup, Observation } from '../../packages/contracts/src/game.js';
import type { EngineState, RulePack } from '../../packages/engine/src/runtime/model.js';
import { advance, initializeDiscussion } from '../../packages/engine/src/runtime/engine.js';
import { project } from '../../packages/engine/src/runtime/ports.js';
/** Offline only. Scope: no scheduled events, all entry windows closed, no outsider or copycat.
 * The first continue command is replayed for every accepted setup. LL seat permutations are
 * fixed: the projections compared are character roles, and this prefix contains no seat evidence. */
export function openingOracle(pack: RulePack, fixture: GameSetup, history: Observation[]) {
  const size = fixture.characters.length,
    rows = fixture.characters.map(() => new Set<string>()),
    plots = new Set<string>();
  const publicHistory = history.map((o) => JSON.stringify(o));
  function matches(state: EngineState): boolean {
    const seen = project(state, 'protagonists').observations;
    if (seen.some((o, i) => JSON.stringify(o) !== publicHistory[i])) return false;
    if (seen.length === history.length) return true;
    const d = state.pending;
    if (d?.actor !== 'mastermind' || d.kind === 'cards') return false;
    return d.options.some((choice) => {
      const next = advance(pack, state, d.actor, {
        id: 'hidden' + state.revision,
        expectedRevision: state.revision,
        decisionId: d.id,
        choice,
      });
      return next.state.revision > state.revision && matches(next.state);
    });
  }
  let validations = 0,
    witnesses = 0;
  const side = Object.values(pack.plots).filter((p) => p.type === 'X');
  for (const main of Object.values(pack.plots).filter((p) => p.type === 'Y'))
    for (const [i, a] of side.entries())
      for (const [j, b] of side.entries()) {
        if (i === j || (fixture.module !== 'WM' && i > j)) continue;
        const selected = [main, a, b],
          pool: Record<string, number> = {};
        for (const p of selected)
          for (const [n, count] of Object.entries(p.identities))
            pool[n] = Math.min(pack.identities[n]!.max ?? Infinity, (pool[n] ?? 0) + count);
        const extras: GameSetup['secretAddition'][] =
          selected.some((p) => p.name === '捏造的秘密') && !pool['密钥']
            ? ['主谋', '杀手', '因果残片']
            : [undefined];
        for (const extra of extras) {
          if (extra && pool[extra]) continue;
          const assigned = Object.entries(pool).flatMap(([name, count]) =>
            name === '暴徒' ? [] : Array<string>(count).fill(name),
          );
          if (extra) assigned.push(extra);
          for (let thugs = 0; thugs <= (pool['暴徒'] ?? 0); thugs++) {
            const roles = assigned.concat(Array<string>(thugs).fill('暴徒'));
            if (roles.length > size) continue;
            roles.push(...Array<string>(size - roles.length).fill('平民'));
            const visit = (pending: string[], seats: string[]) => {
              if (pending.length) {
                for (const role of new Set(pending)) {
                  const left = pending.slice();
                  left.splice(left.indexOf(role), 1);
                  visit(left, [...seats, role]);
                }
                return;
              }
              const setup: GameSetup = {
                ...fixture,
                y: main.name,
                x: [a.name, b.name],
                characters: fixture.characters.map((c, k) => ({ ...c, identity: seats[k]! })),
                secretAddition: extra,
              };
              validations++;
              const initial = initializeDiscussion(pack, setup).state;
              if (!initial) return;
              const played = advance(pack, initial, 'p0', {
                id: 'continue',
                expectedRevision: initial.revision,
                decisionId: initial.pending!.id,
                choice: { kind: 'continue' },
              });
              if (!matches(played.state)) return;
              witnesses++;
              seats.forEach((r, k) => rows[k]!.add(r));
              selected.forEach((p) => plots.add(p.name));
            };
            visit(roles, []);
          }
        }
      }
  return { rows, plots, validations, witnesses };
}
