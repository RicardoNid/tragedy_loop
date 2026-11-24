import { CandidatePairDisplay } from '../../../contracts/src/candidate-relations.js';
import { shownIdentity, type Profile } from './knowledge-domain.js';

/** Necessary pairs from the live symbolic domains and their native binary
 * constraints. A higher-order constraint can still reject a listed pairing. */
export function symbolicCandidatePairs(profiles: Profile[]) {
  const display = new CandidatePairDisplay();
  const varyingEvents = new Set(
    [...(profiles[0]?.store.domains ?? [])]
      .filter(
        ([key, domain]) =>
          key.startsWith('event:') &&
          (domain.size > 1 ||
            profiles.some((p) => [...p.store.values(key)].some((v) => !domain.has(v)))),
      )
      .map(([key]) => key),
  );
  for (const p of profiles) {
    // Read event columns before culprit columns regardless of domain insertion order.
    const fields = [...p.store.domains]
      .filter(([key]) => /^(identity|culprit|event):/.test(key))
      .sort(([a], [b]) => Number(b.startsWith('event:')) - Number(a.startsWith('event:')));
    const value = (key: string, v: string) => (key.startsWith('identity:') ? shownIdentity(v) : v);
    for (const [field, domain] of fields) {
      for (const v of domain)
        for (const rule of [p.y, ...p.x]) display.record('rule', field, rule, value(field, v));
    }
    for (let i = 0; i < fields.length; i++)
      for (const [other, choices] of fields.slice(i + 1)) {
        const [field, domain] = fields[i]!;
        const checks = p.store.constraints.filter(
          (c) => c.pairAllows && c.reads.includes(field) && c.reads.includes(other),
        );
        for (const a of domain)
          for (const b of choices) {
            if (
              checks.every((c) =>
                c.reads.indexOf(field) < c.reads.indexOf(other)
                  ? c.pairAllows!(a, b)
                  : c.pairAllows!(b, a),
              )
            ) {
              display.record(field, other, value(field, a), value(other, b));
              if (varyingEvents.has(field) && other === 'culprit:' + field.slice(6)) {
                const day = field.slice(6);
                for (const rule of [p.y, ...p.x]) display.recordEventPair('rule', rule, day, a, b);
                for (const [key, roles] of fields)
                  if (key.startsWith('identity:'))
                    for (const role of roles)
                      display.recordEventPair(key, shownIdentity(role), day, a, b);
              }
            }
          }
      }
  }
  return display.finish();
}
