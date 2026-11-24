import type { Counters, Counter } from '../../../contracts/src/game.js';
/** Lifecycle rules outside the ordinary Ability.steps interpreter. Included in the rule digest. */
export const lifecycle = {
  startPlacement: { owner: '手下', timing: 'loop-start', kind: 'move' },
  startCounter: {
    owner: '学者',
    timing: 'loop-start',
    kind: 'counter',
    counters: ['goodwill', 'paranoia', 'intrigue'],
    amount: 1,
  },
  dayEndDeath: { owner: '临时工', timing: 'day-end', kind: 'kill', minimumTotal: 3 },
  transformation: { plot: '妄想扩大病毒', initial: '平民', effective: '杀人狂', paranoia: 3 },
  previousFriend: { plot: '因果线', paranoia: 2 },
  revealedFriend: { identity: '亲友', goodwill: 1 },
  borrowed: { identity: '不安定因子', threshold: 2, school: '传谣人', city: '关键人物' },
  bypass: { goodwill: '时间旅者', intrigue: '邪教徒', otherTraveler: '次元旅者' },
  incident: { disguised: '伪造事件', repeatCulprit: '连续杀人' },
} as const;
Object.freeze(lifecycle.startCounter.counters);
for (const rule of Object.values(lifecycle)) Object.freeze(rule);
Object.freeze(lifecycle);

export function characterCounter(c: Counters, counter: Counter) {
  if (counter === 'goodwill') return c.goodwill + c.hope;
  if (counter === 'paranoia') return c.paranoia + c.despair;
  if (counter === 'intrigue') return Math.max(0, c.intrigue + c.despair - c.hope);
  return c[counter];
}
