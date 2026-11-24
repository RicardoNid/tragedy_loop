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

export function culpritRequirement(pack: RulePack, identity: string, reverse?: string) {
  return reverse ? undefined : pack.identities[identity]?.culpritRequirement;
}

export function requiredAttribute(
  pack: RulePack,
  y: string,
  x: string[],
  character: string,
  identity: string,
) {
  return pack.setupRules.attributes?.find(
    (rule) =>
      [y, ...x].includes(rule.plot) &&
      character !== rule.except &&
      rule.identities.includes(identity),
  )?.attribute;
}

export function oppositeSexAttributes(pack: RulePack, first: string, second: string) {
  const a = pack.characters[first]?.attributes ?? [],
    b = pack.characters[second]?.attributes ?? [];
  const male = (tags: string[]) => tags.includes('男性') || tags.includes('少年');
  const female = (tags: string[]) => tags.includes('女性') || tags.includes('少女');
  return (male(a) && female(b)) || (female(a) && male(b));
}
