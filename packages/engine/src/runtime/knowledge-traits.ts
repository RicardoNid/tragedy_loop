import type { Observation, PlayerView } from '../../../contracts/src/game.js';
import type { RulePack } from './model.js';
import type { Cause } from './knowledge-causes.js';
import type { Profile } from './knowledge-domain.js';
import type { VisibleChange } from './knowledge-effects.js';

// These hooks are implemented by the settlement engine outside Ability.steps.
// Keep their trigger and outcome exceptions next to the character that owns them.
interface IncidentTrait {
  execution?: 'cancel' | 'repeat' | 'proxy';
  privateTrigger?: boolean;
  maySuppress?: boolean;
  totalThreshold?: boolean;
  thresholdMultiplier?: number;
}
const incidentTraits: Readonly<Record<string, IncidentTrait>> = {
  黑猫: { execution: 'cancel' },
  教主: { execution: 'repeat', thresholdMultiplier: 2 },
  临时工: { execution: 'proxy', privateTrigger: true },
  手下: { maySuppress: true },
  仙人: { privateTrigger: true },
  AI: { totalThreshold: true },
};
const ordinary: IncidentTrait = {};
export function traits(character?: string): IncidentTrait {
  return (character && incidentTraits[character]) || ordinary;
}
export function hasVirtualArea(pack: RulePack, character?: string): boolean {
  const rule = character && pack.characters[character];
  return character === 'UP主' || !!(rule && (rule.abilityArea || rule.incidentAreaFromBase));
}

type Intrinsic = (phase: Observation['phase'], q: VisibleChange) => string | undefined;
const characterEffects: Record<string, Intrinsic> = {
  临时工: (phase, q) =>
    phase === 'day-end' && (q.kind === 'kill' || (q.counter === 'guard' && q.sign === -1))
      ? '临时工日末死亡请求'
      : undefined,
  手下: (phase, q) =>
    phase === 'loop-start' && q.kind === 'move' ? '手下选择开局区域' : undefined,
  学者: (phase, q) =>
    phase === 'loop-start' &&
    q.sign === 1 &&
    ['goodwill', 'paranoia', 'intrigue'].includes(q.counter ?? '')
      ? '学者轮回开始选择指示物'
      : undefined,
};

export function intrinsicCauses(
  pack: RulePack,
  o: Observation,
  change: VisibleChange,
  p: Profile,
  actor: PlayerView['characters'][number] | undefined,
  characters: ReadonlyMap<string, PlayerView['characters'][number]>,
  deaths: ReadonlySet<string>,
  priorFriends: ReadonlySet<string>,
  cats: readonly { id: string }[],
): Cause[] {
  const causes: Cause[] = [];
  function add(label: string, owner?: string, requires: Cause['requires'] = [], rule?: string) {
    causes.push({
      category: rule ? 'rule' : 'character',
      label,
      owner,
      rule,
      requires,
      resources: [],
      notes: [],
    });
  }
  if (
    actor && pack.characters[actor.character]?.protects &&
    (change.kind === 'move' || change.kind === 'kill' || (change.counter === 'guard' && change.sign === -1))
  ) add(actor.character + '随行或代替受害者结算', actor.id);
  const character = actor && characterEffects[actor.character]?.(o.phase, change);
  if (character) add(character, actor?.id);
  if (o.phase === 'loop-start' && change.sign === 1) {
    if (change.target === 'shrine' && change.counter === 'intrigue')
      for (const c of cats) add('黑猫的神社密谋', c.id);
    if (
      actor &&
      change.counter === 'paranoia' &&
      priorFriends.has(actor.id) &&
      p.x.includes('因果线')
    )
      add('规则“因果线”的轮回开始效果', undefined, [], '因果线');
    if (
      actor &&
      change.counter === 'goodwill' &&
      p.store.domains.get('identity:' + actor.id)?.has('亲友')
    )
      add('已公开的亲友获得友好', actor.id, [{ key: 'identity:' + actor.id, value: '亲友' }]);
  }
  if (actor && change.counter === 'paranoia' && change.sign === 1 && deaths.size) {
    for (const [identity, partner] of [
      ['求爱者', '心上人'],
      ['心上人', '求爱者'],
    ] as const) {
      const survivor = 'identity:' + actor.id;
      if (!p.store.domains.get(survivor)?.has(identity)) continue;
      for (const dead of deaths) {
        const key = 'identity:' + dead;
        const special = ['临时工', '临时工？'].includes(characters.get(dead)?.character ?? '');
        if (dead === actor.id || (!special && !p.store.domains.get(key)?.has(partner))) continue;
        add(identity + '（' + actor.id + '）因' + dead + '死亡而增加不安', actor.id, [
          { key: survivor, value: identity },
          ...(special ? [] : [{ key, value: partner }]),
        ]);
      }
    }
  }
  return causes;
}
