import type {
  Actor,
  Board,
  CardKind,
  CharacterSetup,
  GameSetup,
} from '../../../contracts/src/game.js';
import { setupSchema } from '../../../contracts/src/validation.js';
import {
  BOARDS,
  clone,
  zeroCounters,
  type Card,
  type CharacterState,
  type Diagnostic,
  type EngineState,
  type PlotDefinition,
  type RulePack,
} from './model.js';

export function hasUnsupportedDiagnostic(diagnostics: Diagnostic[]) {
  return diagnostics.some((d) => d.code.startsWith('unsupported'));
}
export function culpritDuty(c: CharacterSetup) {
  if (c.reverseIdentity) return;
  if (['强迫症', '愚者', '双胞胎', '祭品', '怪杰'].includes(c.identity)) return 'required';
  if (c.identity === '侦探') return 'forbidden';
}

/** Fixed roles are capped across the chosen rules. A paired identity occupies one
 * character slot and is allocated separately from the single-role counts. */
export function roleInventory(pack: RulePack, plots: readonly PlotDefinition[]) {
  const pool: Record<string, number> = {};
  const pairs: [string, string][] = [];
  for (const plot of plots) {
    for (const [identity, n] of Object.entries(plot.identities))
      pool[identity] = (pool[identity] ?? 0) + n;
    if (plot.pair) pairs.push(plot.pair);
  }
  for (const id of Object.keys(pool))
    pool[id] = Math.min(pool[id]!, pack.identities[id]?.max ?? Infinity);
  return { pool, pairs };
}

export function validateSetup(pack: RulePack, setup: GameSetup): Diagnostic[] {
  const parsed = setupSchema.safeParse(setup);
  if (!parsed.success)
    return parsed.error.issues.map((issue) => ({
      code: 'invalid-setup',
      path: issue.path.join('.'),
      message: issue.message,
    }));
  const errors: Diagnostic[] = [];
  const fail = (code: string, path: string, message: string) =>
    errors.push({ code, path, message });
  if (setup.module !== pack.module || setup.anniversary !== pack.anniversary)
    fail('profile-mismatch', 'module', 'Setup and compiled rule profile differ.');
  if (!['FS', 'BTX', 'MZ', 'MC', 'WM', 'HSA', 'AHR', 'LL'].includes(pack.module))
    fail(
      'unsupported-module-semantics',
      'module',
      'This module is inventoried but not yet executable.',
    );
  if (pack.anniversary && ['AHR', 'LL'].includes(pack.module))
    fail(
      'invalid-overlay',
      'anniversary',
      'The anniversary overlay applies only to pre-anniversary modules.',
    );
  if (
    !Number.isSafeInteger(setup.days) ||
    setup.days < 1 ||
    !Number.isSafeInteger(setup.loops) ||
    setup.loops < 1
  )
    fail('invalid-duration', 'days', 'Days and loops must be positive integers.');
  if (!['p0', 'p1', 'p2'].includes(setup.captain))
    fail('invalid-captain', 'captain', 'Exactly three protagonist seats are supported.');
  if (!['allowed', 'between-loops'].includes(setup.discussion))
    fail('invalid-policy', 'discussion', 'Unknown discussion policy.');
  const xCount = pack.module === 'FS' ? 1 : 2;
  if (setup.x.length !== xCount || new Set(setup.x).size !== setup.x.length)
    fail('invalid-x-slots', 'x', `Exactly ${xCount} distinct X rules are required.`);
  const plots: PlotDefinition[] = [];
  const assignedPairs: string[] = [];
  for (const [name, type] of [[setup.y, 'Y'], ...setup.x.map((x) => [x, 'X'])]) {
    const plot = name ? pack.plots[name] : undefined;
    if (!plot || plot.type !== type) {
      fail('invalid-rule', 'rules', `Unknown ${type} rule: ${name}`);
      continue;
    }
    if (!plot.supported) fail('unsupported-rule', 'rules', `Pending translation: ${name}`);
    plots.push(plot);
  }
  const inventory = roleInventory(pack, plots);
  const pool = inventory.pool,
    pairs = inventory.pairs.map((p) => p.join('/'));
  const inherentPool = { ...pool };
  if (setup.x.includes('捏造的秘密') && !setup.characters.some((c) => c.identity === '密钥')) {
    if (!setup.secretAddition || pool[setup.secretAddition])
      fail(
        'invalid-secret-addition',
        'secretAddition',
        'Choose an absent killer, brain or causal fragment identity.',
      );
    else pool[setup.secretAddition] = 1;
  }
  if (
    pack.module === 'LL' &&
    (!setup.privateRoles ||
      Object.values(setup.privateRoles).sort().join('') !== 'ABC' ||
      !['p0', 'p1', 'p2'].every((p) => p in setup.privateRoles!))
  )
    fail(
      'missing-private-shuffle',
      'privateRoles',
      'The trusted host must supply a recorded permutation of A, B and C.',
    );
  const ids = new Set<string>(),
    names = new Set<string>(),
    actual: Record<string, number> = {};
  for (const c of setup.characters) {
    const path = `characters.${c.id}`;
    if (
      !/^[a-zA-Z0-9_-]+$/.test(c.id) ||
      BOARDS.includes(c.id as Board) ||
      ids.has(c.id) ||
      ['__proto__', 'constructor', 'prototype'].includes(c.id)
    )
      fail(
        'invalid-id',
        path,
        'Character IDs must be unique safe identifiers distinct from boards.',
      );
    ids.add(c.id);
    if (names.has(c.character))
      fail('duplicate-character', path, 'Each character card occurs once.');
    names.add(c.character);
    const def = pack.characters[c.character],
      identity = pack.identities[c.identity];
    if (!def?.supported)
      fail('unsupported-character', path, `Untranslated or unknown character: ${c.character}`);
    if (!identity?.supported)
      fail('unsupported-identity', path, `Untranslated or unknown identity: ${c.identity}`);
    if (c.reverseIdentity && !pack.identities[c.reverseIdentity]?.supported)
      fail(
        'unsupported-identity',
        path,
        `Untranslated or unknown reverse identity: ${c.reverseIdentity}`,
      );
    if (c.character === '临时工？')
      fail('invalid-setup-card', path, 'Replacement card cannot be assigned at setup.');
    if (c.character === '手下' && c.initialArea && !BOARDS.includes(c.initialArea as Board))
      fail('invalid-initial-area', path, 'Henchman can only start on a board.');
    if (
      def &&
      c.character !== '手下' &&
      (def.initial.length > 1
        ? !c.initialArea
        : c.initialArea && !def.initial.includes(c.initialArea))
    )
      fail('invalid-initial-area', path, 'Initial area must match the character definition.');
    if (c.initialArea && c.character !== '手下' && !def?.initial.includes(c.initialArea))
      fail('invalid-initial-area', path, 'Invalid initial area.');
    if (
      c.character === '转校生' &&
      (!Number.isInteger(c.enterDay) || c.enterDay! < 1 || c.enterDay! > setup.days)
    )
      fail('missing-enter-day', path, 'Transfer student requires an arrival day.');
    if (
      c.character === '神灵' &&
      (!Number.isInteger(c.enterLoop) || c.enterLoop! < 1 || c.enterLoop! > setup.loops)
    )
      fail('missing-enter-loop', path, 'Divinity requires an arrival loop.');
    if (c.character === '仙人' && (!Number.isSafeInteger(c.x) || c.x! < 0))
      fail('missing-x', path, 'Immortal requires a nonnegative X.');
    if (def?.abilityArea && !BOARDS.includes(c[def.abilityArea.publicMarker]!))
      fail('missing-territory', path, 'Boss requires a territory.');
    if (c.character === 'AI' && c.identity === '平民' && !c.reverseIdentity)
      fail('ai-civilian', path, 'AI cannot be a civilian.');
    if (c.character === '妹妹' && identity?.ignore && !c.reverseIdentity)
      fail(
        'sister-ignore',
        path,
        'Little sister cannot have a goodwill-refusing initial identity.',
      );
    if (c.character === '局外人') {
      if (
        inherentPool[c.identity] ||
        c.identity === '平民' ||
        c.identity === '因果残片' ||
        c.reverseIdentity ||
        pairs.some((p) => p.split('/').includes(c.identity))
      )
        fail(
          'outsider-pool',
          path,
          'Outsider must use a fixed module identity absent from both sides of selected rules.',
        );
    } else if (c.character === '模仿犯') {
      const copied = setup.characters.find((t) => t.id === c.copiedFrom && t.id !== c.id);
      if (!copied || copied.identity !== c.identity || copied.reverseIdentity !== c.reverseIdentity)
        fail(
          'copycat-identity',
          path,
          'Copycat must copy another complete configured identity pair.',
        );
    } else if (c.reverseIdentity) assignedPairs.push(`${c.identity}/${c.reverseIdentity}`);
    else actual[c.identity] = (actual[c.identity] ?? 0) + 1;
    const duty = culpritDuty(c);
    if (duty === 'required' && !setup.incidents.some((i) => i.culprit === c.id))
      fail('required-culprit', path, 'Identity must be a scheduled culprit.');
    if (duty === 'forbidden' && setup.incidents.some((i) => i.culprit === c.id))
      fail('forbidden-culprit', path, 'Detective cannot be a culprit.');
    if (
      setup.y === '和我签订契约吧！' &&
      c.identity === '关键人物' &&
      !def?.attributes.includes('少女') &&
      c.character !== '局外人'
    )
      fail('required-attribute', path, 'Key person must have the girl attribute.');
  }
  if (JSON.stringify(pairs.sort()) !== JSON.stringify(assignedPairs.sort()))
    fail(
      'identity-pairs',
      'characters',
      'Paired identities must be allocated whole, with exact front/reverse pairing.',
    );
  for (const identity of new Set([...Object.keys(pool), ...Object.keys(actual)])) {
    if (identity === '平民') continue;
    const n = actual[identity] ?? 0,
      required = pool[identity] ?? 0;
    if (identity === '暴徒' && n <= required) continue;
    if (n !== required)
      fail('identity-pool', 'characters', `Expected ${required} ${identity}, got ${n}.`);
  }
  const days = new Set<number>();
  const culpritIncidents = new Map<string, string[]>();
  for (const i of setup.incidents) {
    if (!Number.isInteger(i.day) || i.day < 1 || i.day > setup.days || days.has(i.day))
      fail('invalid-incident-day', 'incidents', 'At most one incident per valid day.');
    days.add(i.day);
    if (ids.has(i.culprit))
      culpritIncidents.set(i.culprit, [...(culpritIncidents.get(i.culprit) ?? []), i.name]);
    if (
      pack.incidents[i.name]?.crowdThreshold !== undefined
        ? !BOARDS.includes(i.culprit as Board)
        : !ids.has(i.culprit)
    )
      fail(
        'invalid-culprit',
        'incidents',
        'Culprit must match the incident type (character or crowd board).',
      );
    if (!pack.incidents[i.name]?.supported)
      fail('unsupported-incident', 'incidents', `Pending incident: ${i.name}`);
    if (i.publicName && i.publicName !== i.name && i.name !== '伪造事件')
      fail(
        'invalid-public-name',
        'incidents',
        'Only a forged incident can use a different public name.',
      );
  }
  for (const [culprit, names] of culpritIncidents)
    if (names.length > 1 && names.some((name) => name !== '连续杀人'))
      fail(
        'repeated-culprit',
        `incidents.${culprit}`,
        'Only actual serial murders can share a character culprit.',
      );
  for (const c of setup.characters)
    if (c.character === '临时工' && ids.has(`${c.id}_replacement`))
      fail('reserved-id', `characters.${c.id}`, 'Replacement character ID is reserved.');
  if (setup.x.includes('灭亡讴歌') && !setup.incidents.some((i) => i.name === '自杀'))
    fail('required-incident', 'incidents', 'This rule requires suicide.');
  if (
    setup.x.includes('疯狂的真相') &&
    (!setup.characters.some((c) => c.character === '情报商') ||
      !setup.alternateY ||
      pack.plots[setup.alternateY]?.type !== 'Y' ||
      setup.alternateY === setup.y)
  )
    fail(
      'missing-alternate-y',
      'alternateY',
      'Mad truth requires an informant and another configured Y loss condition.',
    );
  if (setup.y === '男子汉的战争')
    for (const c of setup.characters.filter(
      (c) => c.identity === '忍者' && c.character !== '局外人',
    ))
      if (!pack.characters[c.character]?.attributes.includes('男性'))
        fail(
          'required-attribute',
          `characters.${c.id}`,
          'Ninja must have the male attribute; boy is not a substitute.',
        );
  if (setup.x.includes('少女大危机'))
    for (const c of setup.characters.filter(
      (c) => c.identity === '关键人物' && c.character !== '局外人',
    ))
      if (!pack.characters[c.character]?.attributes.includes('少女'))
        fail(
          'required-attribute',
          `characters.${c.id}`,
          'Key person must have the girl attribute.',
        );
  if (setup.x.includes('爱丽丝梦游仙境'))
    for (const c of setup.characters.filter(
      (c) => c.identity === '爱丽丝' && c.character !== '局外人',
    ))
      if (!pack.characters[c.character]?.attributes.includes('少女'))
        fail('required-attribute', `characters.${c.id}`, 'Alice must have the girl attribute.');
  if (setup.y === '叛逆的世界')
    for (const c of setup.characters.filter(
      (c) => ['关键人物', '因果残片'].includes(c.identity) && c.character !== '局外人',
    ))
      if (!pack.characters[c.character]?.attributes.includes('少女'))
        fail(
          'required-attribute',
          `characters.${c.id}`,
          'Both specified identities require the girl attribute.',
        );
  if (setup.y === '高贵的血族') {
    const keys = setup.characters.filter(
      (c) => c.identity === '关键人物' && c.character !== '局外人',
    );
    const vampires = setup.characters.filter(
      (c) => c.identity === '吸血鬼' && c.character !== '局外人',
    );
    const male = ['男性', '少年'],
      female = ['女性', '少女'];
    for (const a of keys)
      for (const b of vampires) {
        const aa = pack.characters[a.character]?.attributes ?? [],
          bb = pack.characters[b.character]?.attributes ?? [];
        if (
          !(male.some((t) => aa.includes(t)) && female.some((t) => bb.includes(t))) &&
          !(female.some((t) => aa.includes(t)) && male.some((t) => bb.includes(t)))
        )
          fail(
            'opposite-sex-required',
            'characters',
            'Vampire and key person must have opposite sex attributes.',
          );
      }
  }
  if (pack.anniversary) {
    const fragment = setup.characters.find((c) => c.id === setup.anniversaryFragment);
    if (!fragment || fragment.identity !== '平民')
      fail(
        'missing-anniversary-fragment',
        'anniversaryFragment',
        'Anniversary overlay requires one civilian after ordinary allocation.',
      );
  } else if (setup.anniversaryFragment)
    fail('unexpected-fragment', 'anniversaryFragment', 'No anniversary overlay is active.');
  return errors;
}
export function createCards(): Card[] {
  const cards: Card[] = [];
  const protagonist: CardKind[] = [
    'horizontal',
    'vertical',
    'block-movement',
    'goodwill+1',
    'goodwill+2',
    'paranoia+1',
    'paranoia-1',
    'block-intrigue',
  ];
  const mastermind: CardKind[] = [
    'horizontal',
    'vertical',
    'diagonal',
    'block-goodwill',
    'paranoia+1',
    'paranoia+1',
    'paranoia-1',
    'block-paranoia',
    'intrigue+1',
    'intrigue+2',
  ];
  for (const owner of ['mastermind', 'p0', 'p1', 'p2'] as Actor[])
    (owner === 'mastermind' ? mastermind : protagonist).forEach((kind, i) =>
      cards.push({
        id: `${owner}-${i}`,
        owner,
        kind,
        once: ['goodwill+2', 'diagonal', 'intrigue+2', 'paranoia+2'].includes(kind),
        status: 'hand',
      }),
    );
  return cards;
}
export function initialState(pack: RulePack, setup: GameSetup): EngineState {
  const characters: Record<string, CharacterState> = {};
  for (const c of setup.characters) {
    const def = pack.characters[c.character]!;
    const initialArea = c.initialArea ?? def.initial[0] ?? 'hospital';
    const initialIdentity = setup.anniversaryFragment === c.id ? '因果残片' : c.identity;
    characters[c.id] = {
      id: c.id,
      character: c.character,
      initialIdentity,
      identity: c.character === '临时工' ? '平民' : initialIdentity,
      initialArea,
      area: initialArea,
      status: c.enterDay || (c.enterLoop ?? 1) > 1 ? 'absent' : 'alive',
      counters: zeroCounters(),
      flags: {},
      forbidden: [...def.forbidden],
      attributes: [...def.attributes],
      paranoiaLimit: c.x ?? def.paranoia,
      revealed: false,
    };
  }
  const parttimer = setup.characters.find((c) => c.character === '临时工');
  if (parttimer) {
    const id = `${parttimer.id}_replacement`;
    if (characters[id]) throw new Error('Reserved replacement character identifier.');
    const def = pack.characters['临时工？']!;
    characters[id] = {
      id,
      character: '临时工？',
      initialIdentity: characters[parttimer.id]!.initialIdentity,
      identity: characters[parttimer.id]!.initialIdentity,
      initialArea: 'city',
      area: 'city',
      status: 'absent',
      counters: zeroCounters(),
      flags: {},
      forbidden: [],
      attributes: [...def.attributes],
      paranoiaLimit: 3,
      revealed: false,
    };
  }
  return {
    schema: 1,
    ruleDigest: pack.digest,
    publicTerritory: setup.characters.find(
      (c) => pack.characters[c.character]?.abilityArea?.publicMarker === 'territory',
    )?.territory,
    setup: clone(setup),
    revision: 0,
    loop: 1,
    day: 1,
    phase: 'discussion',
    phaseEntered: false,
    captain: setup.captain,
    characters,
    boards: { hospital: 0, shrine: 0, city: 0, school: 0 },
    ex: 0,
    cards: createCards(),
    placements: [],
    failed: false,
    protagonistDead: false,
    endRequested: false,
    protected: false,
    flags: {},
    uses: {},
    previousLoop: null,
    incidents: [],
    revealedIdentities: [],
    appeared: [],
    frames: [],
    batch: null,
    pending: null,
    refusal: null,
    observations: { public: [], protagonists: [], mastermind: [] },
    audit: [],
    choices: [],
    receipts: {},
    serial: 0,
    ll:
      pack.module === 'LL'
        ? {
            roles: clone(setup.privateRoles!),
            communicated: [],
            died: [],
            finalTraitorsDisabled: false,
          }
        : undefined,
  };
}
