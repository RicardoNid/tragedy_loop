import { lifecycle } from './shared-lifecycle.js';
import type { Observation, PlayerView } from '../../../contracts/src/game.js';
import type { RulePack } from './model.js';
import type { Cause } from './knowledge-causes.js';
import type { Profile } from './knowledge-domain.js';
import type { VisibleChange } from './knowledge-effects.js';

export function traits(pack: RulePack, character?: string) {
  return (character && pack.characters[character]?.incident) || {};
}
// Only strictly positive mandatory reactions justify the absence-of-a-rise inference.
export function partnerPairs(pack: RulePack): [string, string][] {
  return Object.values(pack.identities).flatMap(({ name, partnerReaction: r }) =>
    r && r.paranoia > 0 ? [[name, r.survivor] as [string, string]] : [],
  );
}
export function hasVirtualArea(pack: RulePack, character?: string): boolean {
  const rule = character && pack.characters[character];
  return character === 'UP主' || !!(rule && (rule.abilityArea || rule.incidentAreaFromBase));
}

type Intrinsic = (phase: Observation['phase'], q: VisibleChange) => string | undefined;
const characterEffects: Record<string, Intrinsic> = {
  [lifecycle.dayEndDeath.owner]: (phase, q) =>
    phase === lifecycle.dayEndDeath.timing &&
    (q.kind === lifecycle.dayEndDeath.kind || (q.counter === 'guard' && q.sign === -1))
      ? '临时工日末死亡请求'
      : undefined,
  [lifecycle.startPlacement.owner]: (phase, q) =>
    phase === lifecycle.startPlacement.timing && q.kind === lifecycle.startPlacement.kind
      ? '手下选择开局区域'
      : undefined,
  [lifecycle.startCounter.owner]: (phase, q) =>
    phase === lifecycle.startCounter.timing &&
    q.sign === 1 &&
    lifecycle.startCounter.counters.some((counter) => counter === q.counter)
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
    actor &&
    pack.characters[actor.character]?.protects &&
    (change.kind === 'move' ||
      change.kind === 'kill' ||
      (change.counter === 'guard' && change.sign === -1))
  )
    add(actor.character + '随行或代替受害者结算', actor.id);
  const character = actor && characterEffects[actor.character]?.(o.phase, change);
  if (character) add(character, actor?.id);
  if (o.phase === 'loop-start' && change.sign === 1) {
    if (change.target === 'shrine' && change.counter === 'intrigue')
      for (const c of cats) add('黑猫的神社密谋', c.id);
    if (
      actor &&
      change.counter === 'paranoia' &&
      priorFriends.has(actor.id) &&
      p.x.includes(lifecycle.previousFriend.plot)
    )
      add('规则“因果线”的轮回开始效果', undefined, [], lifecycle.previousFriend.plot);
    if (
      actor &&
      change.counter === 'goodwill' &&
      p.store.domains.get('identity:' + actor.id)?.has(lifecycle.revealedFriend.identity)
    )
      add('已公开的亲友获得友好', actor.id, [
        { key: 'identity:' + actor.id, value: lifecycle.revealedFriend.identity },
      ]);
  }
  if (actor && change.counter === 'paranoia' && change.sign === 1 && deaths.size) {
    for (const [partner, identity] of partnerPairs(pack)) {
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
