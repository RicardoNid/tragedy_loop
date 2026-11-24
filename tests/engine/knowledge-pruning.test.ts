import test from 'node:test';
import assert from 'node:assert/strict';
import { compileOfficial } from '../../packages/content/src/official/index.js';
import { BOARDS, zeroCounters } from '../../packages/engine/src/runtime/model.js';
import {
  PruningCatalog,
  eligibleSource,
  indexOwners,
} from '../../packages/engine/src/runtime/knowledge-pruning.js';
import { compileEffects } from '../../packages/engine/src/runtime/knowledge-effects.js';
import type { Ability } from '../../packages/engine/src/runtime/model.js';

test('a scheduled death effect remains eligible in a later window without a new death', () => {
  const pack = compileOfficial('BTX');
  const ability: Ability = {
    id: 'on-death', source: '', timing: 'death', mandatory: true,
    steps: [{ effects: [
      { op: 'fail' },
      { op: 'schedule', day: 2, timing: 'day-end', effects: [{ op: 'fail' }] },
    ] }],
  };
  const [immediate, delayed] = compileEffects(ability.steps, ability.timing, ability);
  const context = {
    pack, clock: { loop: 1, day: 2, phase: 'day-end' as const }, loops: 1, days: 2,
    owner: 'actor', boards: { city: 0, shrine: 0, school: 0, hospital: 0 }, characters: new Map(),
  };
  const window = { phase: 'day-end', deaths: new Set<string>(), occurrence: new Map() };
  const change = { kind: 'failure' as const, target: '主人公' };
  assert.equal(eligibleSource(immediate!, change, context, window), false);
  assert.equal(eligibleSource(delayed!, change, context, window), true);
  window.deaths.add('actor');
  assert.equal(eligibleSource(immediate!, change, context, window), true);
});

for (const module of ['FS', 'BTX'] as const)
  test(
    module + ' source reach is independent of board names and preserves uncertain owners',
    () => {
      const pack = compileOfficial(module);
      const roster = BOARDS.map((area) => ({
        id: area + '-actor',
        character: '男学生',
        area,
        status: 'alive' as const,
        counters: zeroCounters(),
      }));
      roster.push({ ...roster[0]!, id: 'virtual', character: '仙人' });
      const characters = new Map(roster.map((c) => [c.id, c]));
      const catalog = new PruningCatalog(pack, { incidents: [] }, roster);
      const missing = { id: 'unknown', character: '女学生' };
      const sources = catalog.sourcesFor('identities', '主谋');
      const local = sources.find((s) => s.ownerRange === 'same-area')!;
      assert.ok(local);
      for (const board of BOARDS) {
        const q = {
          kind: 'counter' as const,
          counter: 'intrigue' as const,
          sign: 1,
          target: board,
        };
        const owners = indexOwners([...roster, missing], characters, q, false, pack);
        assert.deepEqual(
          new Set(owners(local).map((c) => c.id)),
          new Set([board + '-actor', 'unknown', 'virtual']),
        );
        assert.equal(
          indexOwners([...roster, missing], characters, q, true, pack)(local).length,
          roster.length + 1,
        );
        const global = compileEffects(
          [{ effects: [{ op: 'counter', target: board, counter: 'intrigue', amount: 1 }] }],
          'incident',
        )[0]!;
        assert.equal(owners(global).length, roster.length + 1);
        const delayed = compileEffects(
          [
            {
              effects: [
                {
                  op: 'schedule',
                  day: 2,
                  timing: 'day-end',
                  effects: [
                    { op: 'counter', target: '$self.area', counter: 'intrigue', amount: 1 },
                  ],
                },
              ],
            },
          ],
          'incident',
        )[0]!;
        assert.equal(owners(delayed).length, roster.length + 1);
        assert.ok(
          catalog.forChange('mastermind-abilities', q).identities.get('主谋')?.includes(local),
        );
        assert.ok(!catalog.forChange('incident', q).identities.get('主谋')?.includes(local));
      }
    },
  );

test('incident movement follows compiled follow-up steps under any incident name', () => {
  const pack = structuredClone(compileOfficial('FS'));
  const incident = pack.incidents['医院事故']!;
  const movements = () => new PruningCatalog(pack, { incidents: [] }, []).forChange(
    'incident', { kind: 'move', target: 'b', destination: 'school' },
  ).events.get(incident.name);
  assert.equal(movements(), undefined);
  incident.afterIncidentSteps = [{ moveOthersFromEffectiveArea: true, effects: [] }];
  assert.ok(movements()?.some((source) => source.kind === 'move' && source.reports === Infinity));
});
test('public target binding and refusal remove only voluntary sources, retaining scheduled and mandatory effects', () => {
  const pack = structuredClone(compileOfficial('FS'));
  const make = (id: string): Ability => ({
    id,
    source: 'test',
    timing: 'protagonist-abilities',
    threshold: 2,
    steps: [
      {
        choices: [{ key: 'victim', options: { kind: 'alive' } }],
        effects: [{ op: 'counter', target: '$victim', counter: 'hope', amount: 1 }],
      },
    ],
  });
  const delayed: Ability = {
    ...make('earlier'),
    timing: 'day-start',
    steps: [
      {
        effects: [
          {
            op: 'schedule',
            day: 1,
            timing: 'protagonist-abilities',
            effects: [{ op: 'counter', target: 'a', counter: 'hope', amount: 1 }],
          },
        ],
      },
    ],
  };
  const followup: Ability = { ...make('after'), timing: 'goodwill-completed', mandatory: true };
  pack.characters['男学生']!.abilities = [make('cast'), make('other'), delayed, followup];
  const catalog = new PruningCatalog(
    pack,
    { incidents: [] },
    ['a', 'b'].map((id) => ({ id, character: '男学生' })),
  );
  const q = { kind: 'counter' as const, target: 'b', counter: 'hope' as const, sign: 1 };
  const declaration = { id: 'a', ability: 'cast', choices: { victim: 'b' } };
  const names = (target: string, current: typeof declaration | null, owner: string) =>
    catalog
      .forChange('protagonist-abilities', { ...q, target }, current)
      .cards.get(owner)
      ?.map((s) => s.ability?.id);
  assert.deepEqual(names('b', declaration, 'a'), ['earlier', 'after', 'cast']);
  assert.deepEqual(names('a', declaration, 'a'), ['earlier', 'after']);
  assert.deepEqual(names('b', declaration, 'b'), ['earlier', 'after']);
  assert.deepEqual(names('b', null, 'a'), ['earlier', 'after']);
  assert.deepEqual(names('b', declaration, 'a'), ['earlier', 'after', 'cast']);
});
