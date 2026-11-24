import type { PublicCharacter } from '../../../contracts/src/game.js';
import type { opening3 } from './opening.js';
import { gates } from './incident.js';
type Piece = Pick<PublicCharacter, 'area' | 'status' | 'counters'>;
export function effectiveRole(
  m: ReturnType<typeof opening3>,
  actor: string,
  role: string,
  p: Piece | undefined,
  causal: Set<string>,
  reason: string,
) {
  const row = m.ids.get(actor === '临时工？' ? '临时工' : actor);
  if (!row || !p) return undefined;
  const gate = gates(m.graph, reason + ' ' + actor + ' 结算为 ' + role);
  let value: boolean | number = actor === '临时工' ? role === '平民' : (row[role] ?? false);
  if (
    m.plots['妄想扩大病毒'] &&
    p.status === 'alive' &&
    p.counters.paranoia + p.counters.despair >= 3
  ) {
    const virus = gate.all([m.plots['妄想扩大病毒'], actor === '临时工' ? true : row['平民']!]);
    if (role === '杀人狂') value = gate.any([value, virus]);
    if (role === '平民') value = gate.all([value, gate.not(virus)]);
  }
  if (m.plots['因果之绊'] && causal.has(actor))
    value =
      role === '关键人物'
        ? gate.any([value, m.plots['因果之绊']])
        : gate.all([value, -m.plots['因果之绊']]);
  if (m.plots['古墓活尸'] && p.status === 'dead') {
    const changes = gate.all([
      m.plots['古墓活尸'],
      actor === '临时工' ? true : gate.any(['平民', '纸老虎', '胆小鬼'].map((n) => row[n]!)),
    ]);
    value = role === '丧尸' ? gate.any([value, changes]) : gate.all([value, gate.not(changes)]);
  }
  return value;
}
