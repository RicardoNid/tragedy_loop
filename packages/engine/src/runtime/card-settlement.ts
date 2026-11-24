import type { Area, Counter, Module } from '../../../contracts/src/game.js';
import { destination } from './expressions.js';
import { lifecycle } from './shared-lifecycle.js';

export const mastermindCardImmune = (role: string) => role === '预言家' || role === '狼人';
export const multipleBlocksApply = (module: Module, ex: number) => module === 'WM' && ex >= 3;
export const goodwillMovePlot = '心无灵犀';
export const cardBypassRoles: Record<'goodwill' | 'intrigue', readonly string[]> = {
  goodwill: [lifecycle.bypass.goodwill, lifecycle.bypass.otherTraveler],
  intrigue: [lifecycle.bypass.intrigue],
};

export function affectedByBoardCards(character?: string) {
  return character === '幻想';
}

export function cardTotals(placements: readonly { kind: string }[]) {
  return {
    blocks: placements.filter((p) => p.kind === 'block-intrigue').length,
    hopes: placements.filter((p) => p.kind === 'hope+1').length,
  };
}

export function cardDestination(area: Area, kinds: string[], goodwillBlocksMove: boolean) {
  if (kinds.includes('block-movement') || (goodwillBlocksMove && kinds.includes('block-goodwill')))
    return area;
  return destination(
    area,
    kinds.filter((k) => ['horizontal', 'vertical', 'diagonal'].includes(k)),
  );
}

/** The block is evaluated against the effective counter after the global hope conversion. */
export function cardCounterEffect(
  kind: string,
  group: string[],
  totals: ReturnType<typeof cardTotals>,
  multipleIntrigueBlocksApply: boolean,
) {
  const match = /^(paranoia|goodwill|intrigue|hope|despair)([+-][12])$/.exec(kind);
  if (!match) return;
  const counter = (kind === 'hope+1' && totals.hopes >= 2 ? 'goodwill' : match[1]) as Counter;
  const block =
    group.includes('block-' + counter) &&
    (counter !== 'intrigue' || totals.blocks < 2 || multipleIntrigueBlocksApply)
      ? counter
      : undefined;
  return { counter, amount: Number(match[2]), block };
}
