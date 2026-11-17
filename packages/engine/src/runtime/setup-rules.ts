import type { RulePack } from './model.js';
/** The initial assignment is checked identically by setup validation and finite-domain construction. */
export function initialRoleViolation(
  pack: RulePack,
  plot: string,
  character: string,
  identity: string,
  reverse?: string,
) {
  const card = pack.characters[character];
  if (!reverse && card?.forbiddenInitial === 'civilian' && identity === '平民')
    return 'ai-civilian';
  if (
    !reverse &&
    card?.forbiddenInitial === 'ignores-goodwill' &&
    pack.identities[identity]?.ignore
  )
    return 'sister-ignore';
  const rule = pack.setupRules.attribute;
  if (
    rule &&
    plot === rule.plot &&
    identity === rule.identity &&
    character !== rule.except &&
    !card?.attributes.includes(rule.attribute)
  )
    return 'required-attribute';
}

export function culpritRequirement(identity: string, reverse?: string) {
  if (reverse) return;
  if (['强迫症', '愚者', '双胞胎', '祭品', '怪杰'].includes(identity)) return 'required';
  if (identity === '侦探') return 'forbidden';
}

export function requiredAttribute(y: string, x: string[], character: string, identity: string) {
  if (character === '局外人') return;
  if (y === '男子汉的战争' && identity === '忍者') return '男性';
  if (
    (x.includes('少女大危机') && identity === '关键人物') ||
    (x.includes('爱丽丝梦游仙境') && identity === '爱丽丝') ||
    (y === '叛逆的世界' && ['关键人物', '因果残片'].includes(identity))
  )
    return '少女';
}

export function oppositeSexAttributes(pack: RulePack, first: string, second: string) {
  const a = pack.characters[first]?.attributes ?? [],
    b = pack.characters[second]?.attributes ?? [];
  const male = (tags: string[]) => tags.includes('男性') || tags.includes('少年');
  const female = (tags: string[]) => tags.includes('女性') || tags.includes('少女');
  return (male(a) && female(b)) || (female(a) && male(b));
}
