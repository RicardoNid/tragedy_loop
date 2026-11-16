import type {
  Ability,
  Condition as C,
  Effect as E,
  Selector as S,
  Step,
  Value as V,
} from '../../../engine/src/runtime/model.js';
const eq = (a: V, b: V): C => ({ cmp: 'eq', left: a, right: b });
const ge = (a: V, b: V): C => ({ cmp: 'ge', left: a, right: b });
const le = (a: V, b: V): C => ({ cmp: 'le', left: a, right: b });
const field = (
  field: 'area' | 'identity' | 'character' | 'status' | 'rawTotal',
  target = '$it',
): V => ({ field, target });
const count = (counter: 'intrigue' | 'paranoia' | 'goodwill', target = '$self'): V => ({
  counter,
  target,
});
const all = (...conditions: C[]): C => ({ all: conditions });
const other: C = { cmp: 'ne', left: { ref: '$it' }, right: { ref: '$self' } };
const together = eq(field('area'), field('area', '$self'));
const alive = (where?: C): S => ({ kind: 'alive', where });
const co = (more: C = true): S => alive(all(together, more));
const another = (more: C = true): S => co(all(other, more));
const add = (
  target: string,
  counter: 'intrigue' | 'paranoia' | 'goodwill' | 'guard' | 'hope' | 'despair',
  amount: number,
): E => ({ op: 'counter', target, counter, amount });
const when = (condition: C, ...effects: E[]): E => ({ op: 'when', condition, effects });
const each = (selector: S, ...effects: E[]): E => ({ op: 'each', selector, effects });
const choice = (
  options: S | string[],
  effects: E[],
  key = 'target',
  actor?: 'mastermind' | 'captain',
): Step => ({ choices: [{ key, options, actor }], effects });
const simple = (...effects: E[]): Step => ({ effects });
const stepAbility = (
  id: string,
  timing: Ability['timing'],
  steps: Step[],
  extra: Partial<Ability> = {},
): Ability => ({ id, source: '', timing, steps, ...extra });
const optional = (id: string, steps: Step[], extra: Partial<Ability> = {}) =>
  stepAbility(id, 'mastermind-abilities', steps, extra);
const mandatory = (
  id: string,
  timing: Ability['timing'],
  effects: E[],
  extra: Partial<Ability> = {},
) => stepAbility(id, timing, [simple(...effects)], { mandatory: true, ...extra });
const good = (id: string, threshold: number, steps: Step[], extra: Partial<Ability> = {}) =>
  stepAbility(id, 'protagonist-abilities', steps, { threshold, ...extra });
const kill: E = { op: 'kill', target: '$target' };
const pd: E = { op: 'protagonist-death' };
const fail: E = { op: 'fail' };
const reveal: E = { op: 'reveal-identity', target: '$target' };
const student: C = { attribute: '学生', target: '$it' };
const upset: C = ge(count('paranoia', '$it'), { field: 'paranoiaLimit', target: '$it' });

export function identityPrograms(name: string): Ability[] | null {
  switch (name) {
    case '平民':
    case '魔女':
    case '暴徒':
    case '永生者':
    case '不安定因子':
    case '无面者':
    case '因果残片':
      return [];
    case '关键人物':
      return [mandatory('key-death', 'death', [fail])];
    case '传谣人':
      return [optional('gossip', [choice(co(), [add('$target', 'paranoia', 1)])])];
    case '主谋':
      return [
        optional('brain', [
          choice({ kind: 'alive-or-boards', where: eq(field('area'), field('area', '$self')) }, [
            add('$target', 'intrigue', 1),
          ]),
        ]),
      ];
    case '邪教徒':
      return [
        stepAbility('cultist', 'card-resolution', [
          simple({ op: 'flag', target: '$self', key: 'cultist' }),
        ]),
      ];
    case '杀手':
      return [
        stepAbility('killer-character', 'day-end', [
          choice(co(all(eq(field('identity'), '关键人物'), ge(count('intrigue', '$it'), 2))), [
            kill,
          ]),
        ]),
        stepAbility('killer-protagonists', 'day-end', [simple(pd)], {
          condition: ge(count('intrigue'), 4),
        }),
      ];
    case '杀人狂':
      return [
        mandatory('serial-killer', 'day-end', [each(another(), { op: 'kill', target: '$it' })], {
          condition: eq({ count: another() }, 1),
        }),
      ];
    case '亲友':
      return [
        mandatory('friend-dead', 'loop-end', [{ op: 'reveal-identity', target: '$self' }, fail], {
          condition: eq(field('status', '$self'), 'dead'),
        }),
      ];
    case '心上人':
      return [];
    case '求爱者':
      return [
        stepAbility('lover-kill', 'day-end', [simple(pd)], {
          condition: all(ge(count('intrigue'), 1), ge(count('paranoia'), 3)),
        }),
      ];
    case '时间旅者':
      return [
        stepAbility('time-traveler', 'day-end', [simple(fail)], {
          condition: all(eq({ game: 'day' }, { game: 'days' }), le(count('goodwill'), 2)),
        }),
      ];
    case '强迫症':
    case '预言家':
    case '侦探':
    case '双胞胎':
      return [];
    case '忍者':
      return [
        stepAbility('ninja-kill', 'day-end', [choice(co(ge(count('intrigue', '$it'), 2)), [kill])]),
      ];
    case '吸血鬼':
      return [
        identityPrograms('杀手')![0]!,
        stepAbility('vampire-corpses', 'day-end', [simple(pd)], {
          condition: ge(
            { count: { kind: 'dead', where: eq(field('area'), { ref: '$self.initialArea' }) } },
            2,
          ),
        }),
      ];
    case '狼人':
      return [
        stepAbility('werewolf', 'day-end', [simple(pd)], {
          condition: { flag: 'mad-night-today' },
        }),
      ];
    case '梦魇':
      return [
        stepAbility('nightmare-kill', 'day-end', [choice(co(), [kill])]),
        stepAbility('nightmare-corpses', 'day-end', [simple(pd)], {
          condition: ge({ sum: { kind: 'dead' }, value: count('intrigue', '$it') }, 3),
        }),
      ];
    case '纸老虎':
    case '丧尸':
      return [];
    case '鬼魂':
      return [
        stepAbility(
          'ghost',
          'mastermind-abilities',
          [
            choice(alive({ any: [together, eq(field('area'), { ref: '$self.initialArea' })] }), [
              add('$target', 'paranoia', 1),
            ]),
          ],
          { mandatory: true, condition: eq(field('status', '$self'), 'dead') },
        ),
      ];
    case '提线木偶':
      return [
        mandatory(
          'puppet-completed',
          'goodwill-completed',
          [{ op: 'kill', target: '$self' }, { op: 'world-move' }],
          { condition: ge({ field: 'kinds', target: '$self' }, 2) },
        ),
      ];
    case '叙述者':
      return [
        optional(
          'narrator-transfer',
          [
            {
              choices: [
                { key: 'from', options: another() },
                {
                  key: 'to',
                  options: another({ cmp: 'ne', left: { ref: '$it' }, right: { ref: '$from' } }),
                },
                {
                  key: 'counter',
                  options: ['goodwill', 'paranoia', 'intrigue', 'guard', 'hope', 'despair'],
                },
              ],
              effects: [{ op: 'transfer', from: '$from', to: '$to', counter: '$counter' }],
            },
          ],
          { condition: ge({ game: 'ex' }, 1) },
        ),
      ];
    case '童谣':
      return [
        optional(
          'fairytale-counter',
          [
            {
              choices: [
                { key: 'target', options: co() },
                { key: 'counter', options: ['goodwill', 'paranoia'] },
              ],
              effects: [{ op: 'counter', target: '$target', counter: '$counter', amount: 1 }],
            },
          ],
          { loopLimit: 1 },
        ),
        stepAbility('fairytale-kill', 'day-end', [simple(pd)], {
          condition: ge({ field: 'kinds', target: '$self' }, 4),
        }),
      ];
    case '次元旅者':
      return [
        stepAbility('dimension-traveler', 'day-end', [simple(pd)], {
          condition: all(
            eq({ game: 'day' }, { game: 'days' }),
            le({ field: 'kinds', target: '$self' }, 2),
          ),
        }),
      ];
    case '魔笛手':
      return [
        stepAbility('piper-kill', 'day-end', [choice(co(), [kill])], {
          mandatory: true,
          loopLimit: 1,
          condition: ge({ game: 'ex' }, 2),
        }),
        stepAbility('piper-intrigue', 'day-end', [
          choice({ kind: 'dead', where: together }, [add('$target', 'intrigue', 1)]),
          simple(when(ge({ sum: { kind: 'dead' }, value: count('intrigue', '$it') }, 3), pd)),
        ]),
      ];
    case '布道者':
      return [
        optional('evangelist-goodwill', [choice(co(), [add('$target', 'goodwill', 1)])]),
        stepAbility(
          'evangelist-death',
          'death',
          [
            choice(co(), [add('$target', 'despair', 1)]),
            {
              choices: [{ key: 'move', options: ['yes', 'no'] }],
              effects: [when(eq({ ref: '$move' }, 'yes'), { op: 'world-move' })],
            },
          ],
          { mandatory: true },
        ),
      ];
    case '爱丽丝':
      return [
        mandatory('alice-dead', 'loop-end', [fail], {
          condition: eq(field('status', '$self'), 'dead'),
        }),
        mandatory(
          'alice-goodwill',
          'goodwill-completed',
          [each(another(), add('$it', 'hope', 1))],
          { loopLimit: 1, condition: ge({ game: 'ex' }, 1) },
        ),
      ];
    case '监视者':
    case '怪杰':
      return [];
    case '密钥':
      return [
        mandatory('key-reveal-death', 'death', [{ op: 'reveal-identity', target: '$self' }]),
        mandatory('key-reveal-goodwill', 'goodwill-completed', [
          { op: 'reveal-identity', target: '$self' },
        ]),
      ];
    case '网络名流':
      return [
        mandatory('celebrity-death', 'death', [
          each(
            alive(
              all(
                other,
                eq(
                  { field: 'initialArea', target: '$it' },
                  { field: 'initialArea', target: '$self' },
                ),
              ),
            ),
            add('$it', 'paranoia', 1),
          ),
        ]),
        mandatory(
          'celebrity-goodwill',
          'goodwill-completed',
          [
            each(
              alive(
                all(
                  other,
                  eq(
                    { field: 'initialArea', target: '$it' },
                    { field: 'initialArea', target: '$self' },
                  ),
                ),
              ),
              add('$it', 'goodwill', 1),
              add('$it', 'paranoia', 1),
            ),
          ],
          { loopLimit: 1 },
        ),
      ];
    case '魔术师':
      return [
        optional(
          'magician-move',
          [
            {
              choices: [
                { key: 'target', options: co(ge(count('paranoia', '$it'), 1)) },
                { key: 'area', options: ['$adjacent-target'] },
              ],
              effects: [{ op: 'move', target: '$target', area: '$area' }],
            },
          ],
          { loopLimit: 1, sharedKey: 'magicians' },
        ),
        mandatory('magician-death', 'death', [
          { op: 'clear', target: '$self', counter: 'paranoia' },
        ]),
      ];
    case '愚者':
      return [
        mandatory('fool-completion', 'incident-completed', [
          { op: 'clear', target: '$self', counter: 'paranoia' },
        ]),
      ];
    case '偏执狂':
      return [
        optional('paranoiac', [
          choice(
            ['intrigue', 'paranoia'],
            [{ op: 'counter', target: '$self', counter: '$counter', amount: 1 }],
            'counter',
          ),
        ]),
      ];
    case '心理医生':
      return [
        stepAbility(
          'therapist',
          'mastermind-abilities',
          [choice(another(), [add('$target', 'paranoia', -1)])],
          { mandatory: true, condition: ge({ game: 'ex' }, 1) },
        ),
      ];
    case '投毒者':
      return [
        stepAbility('poisoner-character', 'day-end', [choice(co(), [kill])], {
          mandatory: true,
          loopLimit: 1,
          condition: ge({ game: 'ex' }, 2),
        }),
        mandatory('poisoner-protagonists', 'day-end', [pd], { condition: ge({ game: 'ex' }, 4) }),
      ];
    case '深潜者':
      return [
        ...identityPrograms('主谋')!,
        mandatory('deep-one-death', 'death', [
          { op: 'reveal-identity', target: '$self' },
          { op: 'ex', amount: 1 },
        ]),
      ];
    case '祭品':
      return [
        stepAbility(
          'sacrifice',
          'day-end',
          [simple(each(alive(), { op: 'kill', target: '$it' }), pd)],
          { condition: all(ge(count('intrigue'), 2), ge(count('paranoia'), 2)) },
        ),
      ];
    case '目击者':
      return [
        mandatory(
          'witness',
          'day-end',
          [
            { op: 'kill', target: '$self' },
            { op: 'ex', amount: 1 },
          ],
          { condition: ge(count('paranoia'), 4) },
        ),
      ];
    case '巫师':
      return [
        mandatory('wizard-dead', 'loop-end', [fail], {
          condition: eq(field('status', '$self'), 'dead'),
        }),
        stepAbility(
          'wizard-goodwill',
          'goodwill-completed',
          [
            simple({ op: 'reveal-identity', target: '$self' }),
            {
              choices: [{ key: 'increase', options: ['yes', 'no'], actor: 'captain' }],
              effects: [when(eq({ ref: '$increase' }, 'yes'), { op: 'ex', amount: 1 })],
            },
          ],
          { mandatory: true },
        ),
      ];
    default:
      return null;
  }
}
export function plotPrograms(name: string): Ability[] | null {
  const loss = (condition: C) => [mandatory('loss', 'loop-end', [fail], { condition })];
  switch (name) {
    case '谋杀计划':
    case '开膛者的魔影':
    case '最黑暗的剧本':
    case '好友圈':
    case '恋爱风景线':
    case '潜伏的杀人狂':
    case '未知因子Χ':
    case '妄想扩大病毒':
    case '因果线':
    case '爱与恨的螺旋':
    case '魔女的茶会':
    case '魔爪渐进':
    case '心无灵犀':
    case '灭亡讴歌':
    case '我是名侦探':
    case '愚者之舞':
    case '绝对意志':
    case '双子的诡计':
    case '士的宁毒液':
    case '抗争者':
    case '见证恐惧':
    case '伊斯之伟大种族':
    case '深渊之都的私语':
    case '无貌之神':
      return [];
    case '流言四起':
      return [
        optional('rumor-intrigue', [choice({ kind: 'boards' }, [add('$target', 'intrigue', 1)])], {
          loopLimit: 1,
        }),
      ];
    case '复仇的火种':
      return [
        mandatory('loss', 'loop-end', [
          each(
            { kind: 'cards', where: eq(field('identity'), '主谋') },
            when(ge({ counter: 'intrigue', target: '$it.initialArea' }, 2), fail),
          ),
        ]),
      ];
    case '巨大定时炸弹X':
    case '巨大定时炸弹Y':
    case '巨大定时炸弹Z':
      return [
        mandatory('loss', 'loop-end', [
          each(
            { kind: 'cards', where: eq(field('identity'), '魔女') },
            when(ge({ counter: 'intrigue', target: '$it.initialArea' }, 2), fail),
          ),
        ]),
      ];
    case '守护此地':
      return loss(ge(count('intrigue', 'school'), 2));
    case '被封印的邪灵':
      return loss(ge(count('intrigue', 'shrine'), 2));
    case '和我签订契约吧！':
      return loss(
        ge(
          { count: alive(all(eq(field('identity'), '关键人物'), ge(count('intrigue', '$it'), 2))) },
          1,
        ),
      );
    case '改变未来':
      return loss({ incidentOccurred: '蝴蝶效应' });
    case '死亡真人秀':
      return loss(le({ count: alive() }, 6));
    case '事件交织的罗网':
      return loss(ge({ game: 'ex' }, 3));
    case '命悬一线的计划':
      return loss(le({ game: 'ex' }, 1));
    case '黑暗学园':
      return loss(ge(count('intrigue', 'school'), { op: 'subtract', args: [{ game: 'loop' }, 1] }));
    case '外神合唱曲':
      return loss(ge({ count: alive(ge(count('intrigue', '$it'), 1)) }, 5));
    case '达贡的福音书':
      return loss(ge(count('intrigue', 'shrine'), { game: 'ex' }));
    case '染血的仪式':
      return loss(ge({ count: { kind: 'dead' } }, { game: 'ex' }));
    case '黄衣之王':
      return loss({ flag: 'ex-increased' });
    case '因果之绊':
    case '诸神之骰':
    case '隔离病房惊魂记':
    case '疯狂的真相':
    case '超越世界线':
      return [];
    case '绝密报告':
      return loss({ flag: 'classified-revealed' });
    case '男子汉的战争':
      return loss(
        ge(
          {
            count: {
              kind: 'cards',
              where: all(eq(field('identity'), '忍者'), ge(count('intrigue', '$it'), 2)),
            },
          },
          1,
        ),
      );
    case 'X异因子':
      return [
        optional(
          'factor-intrigue',
          [
            choice(alive(eq(field('identity'), '不安定因子')), [
              add('$target.area', 'intrigue', 1),
            ]),
          ],
          { loopLimit: 1 },
        ),
      ];
    case '火药的味道':
      return loss(ge({ sum: alive(), value: count('paranoia', '$it') }, 12));
    case '高贵的血族':
    case '月夜凶兽':
    case '雾中夜惊梦':
    case '古墓活尸':
    case '心慌派对':
    case '少女大危机':
    case '恐慌与妄想':
    case '不听劝的人':
      return [];
    case '魔女遗咒':
      return [
        stepAbility('witch-curse', 'loop-start', [
          choice({ kind: 'cards', where: eq(field('identity'), '魔女') }, [
            { op: 'curse', target: '$target.initialArea' },
          ]),
        ]),
      ];
    case '被诅咒的土地':
      return [
        stepAbility('ghost-curse', 'loop-start', [
          choice({ kind: 'cards', where: eq(field('identity'), '鬼魂') }, [
            { op: 'curse', target: '$target.initialArea' },
          ]),
        ]),
        stepAbility('curse-no-target', 'day-end', [simple(pd)], {
          condition: { flag: 'curse-no-target' },
        }),
      ];
    case '怪物们的阴谋':
      return [
        optional(
          'monsters-intrigue',
          [choice(['$ignore-goodwill-areas'], [add('$target', 'intrigue', 1)])],
          { loopLimit: 2 },
        ),
      ];
    case '童话里的杀人鬼':
    case '化身博士':
    case '恶魔吹着笛子来':
    case '傀儡之线':
    case '爱丽丝梦游仙境':
    case '空想扩大病毒':
      return [];
    case '闭锁的未来':
      return loss(eq({ game: 'world' }, 0));
    case '鹅妈妈神秘故事':
      return loss(ge({ count: { kind: 'dead' } }, { op: 'min', args: [{ game: 'loop' }, 3] }));
    case '次元融合计划':
      return loss({ any: [{ incidentOccurred: '遗言' }, { incidentOccurred: '遗失物' }] });
    case '虚幻世界':
      return loss(
        ge(
          {
            count: {
              kind: 'cards',
              where: all(
                { flag: 'y-obsessive', target: '$it' },
                { any: [eq(field('status'), 'alive'), eq(field('status'), 'dead')] },
                ge({ op: 'add', args: [count('intrigue', '$it'), { game: 'ex' }] }, 3),
              ),
            },
          },
          1,
        ),
      );
    case '难以言喻的怪物':
      return [
        stepAbility('monster', 'day-end', [simple(pd)], { condition: ge({ game: 'ex' }, 3) }),
      ];
    case '最终计划':
    case '真正的怪物':
    case '神话收集者':
    case '我才是名侦探':
    case 'SNS恐慌':
    case '捏造的秘密':
      return [];
    case '封印的终末':
      return [
        stepAbility('sealed-end', 'day-end', [simple(pd)], {
          condition: ge(count('intrigue', 'shrine'), 2),
        }),
      ];
    case '叛逆的世界':
      return loss(
        ge(
          { count: alive(all(eq(field('identity'), '关键人物'), ge(count('intrigue', '$it'), 2))) },
          1,
        ),
      );
    case '恶魔的剧本':
      return [
        ...loss({ any: [{ incidentOccurred: '遗言' }, { incidentOccurred: '代行者' }] }),
        stepAbility('devil-watcher', 'day-end', [simple(pd)], {
          condition: all(
            eq({ game: 'day' }, { game: 'days' }),
            ge({ count: alive(all(eq(field('identity'), '监视者'), le(field('rawTotal'), 1))) }, 1),
          ),
        }),
      ];
    default:
      return null;
  }
}
export function incidentProgram(name: string): Step[] | null {
  const deathIn = (board: string, protagonists: boolean): Step =>
    simple(
      when(
        ge(count('intrigue', board), 1),
        each(alive(eq(field('area'), board)), { op: 'kill', target: '$it' }),
      ),
      ...(protagonists ? [when(ge(count('intrigue', board), 2), pd)] : []),
    );
  switch (name) {
    case '医院事故':
      return [deathIn('hospital', true)];
    case '恐怖袭击':
      return [deathIn('city', true)];
    case '暴乱':
      return [simple(...deathIn('city', false).effects, ...deathIn('school', false).effects)];
    case '谋杀':
    case '连续杀人':
    case '冲动杀人':
      return [choice(another(), [kill])];
    case '疯狂杀人':
      return [choice(co(), [kill])];
    case '自杀':
      return [simple({ op: 'kill', target: '$self' })];
    case '邪气污染':
      return [simple(add('shrine', 'intrigue', 2))];
    case '不安扩散':
      return [
        choice(alive(), [add('$target', 'paranoia', 2)], 'first'),
        choice(alive({ cmp: 'ne', left: { ref: '$it' }, right: { ref: '$first' } }), [
          add('$target', 'intrigue', 1),
        ]),
      ].map((s, i) => (i === 0 ? { ...s, effects: [add('$first', 'paranoia', 2)] } : s));
    case '散播':
      return [
        choice(alive(), [add('$first', 'goodwill', -2)], 'first'),
        choice(alive({ cmp: 'ne', left: { ref: '$it' }, right: { ref: '$first' } }), [
          add('$target', 'goodwill', 2),
        ]),
      ];
    case '失踪':
      return [
        choice({ kind: 'boards' }, [{ op: 'move', target: '$self', area: '$area' }], 'area'),
        simple(add('$self.area', 'intrigue', 1)),
      ];
    case '远距离杀人':
      return [choice(alive(ge(count('intrigue', '$it'), 2)), [kill])];
    case '蝴蝶效应':
      return [
        {
          choices: [
            { key: 'target', options: co() },
            { key: 'counter', options: ['goodwill', 'paranoia', 'intrigue'] },
          ],
          effects: [{ op: 'counter', target: '$target', counter: '$counter', amount: 1 }],
        },
      ];
    case '自白':
      return [simple({ op: 'reveal-identity', target: '$self' })];
    case '前兆':
      return [choice(co(), [add('$target', 'paranoia', 1)])];
    case '猎奇杀人':
      return [...incidentProgram('连续杀人')!, ...incidentProgram('不安扩散')!];
    case '破局':
      return [
        choice({ kind: 'alive-or-boards' }, [add('$target', 'intrigue', -2)], 'target', 'captain'),
      ];
    case '阴谋活动':
      return [
        choice(
          ['连续杀人', '失踪'],
          [{ op: 'invoke-incident', name: '$incident', culprit: '$self' }],
          'incident',
        ),
      ];
    case '伪造事件':
      return [simple(when(ge(count('intrigue', '$self.initialArea'), 2), pd))];
    case '伪装自杀':
      return [simple({ op: 'flag', target: '$self', key: 'no-protagonist-cards' })];
    case '银色子弹':
      return [simple({ op: 'flag', key: 'end-after-incident' })];
    case '送葬':
      return [choice(alive(), [kill], 'target', 'captain')];
    case '集体自杀':
      return [simple(when(ge(count('intrigue'), 1), each(co(), { op: 'kill', target: '$it' })))];
    case '发现':
      return [simple({ op: 'ex', amount: 1 })];
    case '廷达罗斯之嗅':
      return [simple({ op: 'flag', key: 'hound' })];
    case '可疑信件':
      return [
        {
          choices: [
            { key: 'target', options: co() },
            { key: 'area', options: { kind: 'boards' } },
          ],
          effects: [
            { op: 'move', target: '$target', area: '$area' },
            {
              op: 'schedule',
              onlyIfMoved: '$target',
              day: { op: 'add', args: [{ game: 'day' }, 1] },
              timing: 'day-start',
              effects: [{ op: 'flag', target: '$target', key: 'immobile' }],
            },
          ],
        },
      ];
    case '封锁':
      return [
        simple(
          { op: 'flag', key: 'lockdown-area', value: '$self.area' },
          { op: 'flag', key: 'lockdown-day', value: '$day' },
        ),
      ];
    case '亵渎杀人':
      return [
        choice(['murder', 'intrigue'], [], 'branch'),
        { ...choice(another(), [kill]), condition: eq({ ref: '$branch' }, 'murder') },
        {
          effects: [add('$self.area', 'intrigue', 1)],
          condition: eq({ ref: '$branch' }, 'intrigue'),
        },
      ];
    case '言灵诅咒':
      return [simple({ op: 'curse', target: '$self' })];
    case '诅咒活化':
      return [simple({ op: 'curse', target: '$self' })];
    case '污秽溢出':
      return [
        choice(alive(), [add('$target', 'paranoia', 2)]),
        choice({ kind: 'boards' }, [add('$target', 'intrigue', 1)]),
      ];
    case '死者默示录':
      return [
        simple(each(co(), { op: 'kill', target: '$it' })),
        simple(when(ge({ count: { kind: 'dead', where: together } }, 5), pd)),
      ];
    case '疯狂之夜':
      return [
        simple(
          { op: 'flag', key: 'mad-night-today' },
          when(ge({ count: { kind: 'dead', where: eq(field('identity'), '丧尸') } }, 6), {
            op: 'schedule',
            day: { game: 'day' },
            timing: 'day-end',
            effects: [pd],
          }),
        ),
      ];
    case '次元转换':
      return [simple({ op: 'world-move' })];
    case '次元歪曲':
      return [
        {
          choices: [
            { key: 'worldMove', options: ['yes', 'no'] },
            { key: 'first', options: alive() },
          ],
          effects: [
            when(eq({ ref: '$worldMove' }, 'yes'), { op: 'world-move' }),
            add('$first', 'paranoia', 2),
          ],
        },
        choice(alive({ cmp: 'ne', left: { ref: '$it' }, right: { ref: '$first' } }), [
          add('$target', 'goodwill', 2),
        ]),
      ];
    case '次元断层':
      return [
        choice(
          ['yes', 'no'],
          [when(eq({ ref: '$worldMove' }, 'yes'), { op: 'world-move' })],
          'worldMove',
        ),
        simple(when(ge({ field: 'kinds', target: '$self' }, 3), pd)),
      ];
    case '遗失物':
      return [
        choice(co(), [add('$target', 'intrigue', 1)]),
        choice({ kind: 'boards' }, [{ op: 'move', target: '$self', area: '$area' }], 'area'),
      ];
    case '空想事件':
      return [
        choice(
          ['冲动杀人', '次元歪曲', '遗失物'],
          [{ op: 'invoke-incident', name: '$incident', culprit: '$self' }],
          'incident',
        ),
      ];
    case '遗言':
      return [
        simple(
          { op: 'kill', target: '$self' },
          {
            op: 'schedule',
            timing: 'loop-start',
            day: 1,
            loop: { op: 'add', args: [{ game: 'loop' }, 1] },
            effects: [{ op: 'grant', side: 'protagonists', card: 'hope+1' }],
          },
        ),
      ];
    case '奇点':
      return [
        simple(
          when(all(eq({ game: 'world' }, 0), eq({ ref: '$firstOccurrence' }, 'yes')), pd),
          when(
            { not: all(eq({ game: 'world' }, 0), eq({ ref: '$firstOccurrence' }, 'yes')) },
            { op: 'world-move' },
          ),
          when(all(eq({ game: 'world' }, 1), ge(count('intrigue', '$self.initialArea'), 1)), pd),
        ),
      ];
    case '骤变':
      return [
        simple(
          when(ge(count('intrigue', '$self.initialArea'), 2), pd),
          when(
            le(count('intrigue', '$self.initialArea'), 1),
            add('$self.initialArea', 'intrigue', 2),
          ),
        ),
      ];
    case '代行者':
      return [
        {
          choices: [
            { key: 'delegate', options: ['p0', 'p1', 'p2'], actor: 'mastermind' },
            { key: 'target', options: alive(), actor: '$delegate' },
          ],
          effects: [kill],
        },
      ];
    case '灭绝之火':
      return [
        simple(
          when(
            eq({ ref: '$firstOccurrence' }, 'yes'),
            each(alive(), { op: 'kill', target: '$it' }),
            pd,
          ),
        ),
      ];
    case '孤守':
      return [];
    case '绝望之暗':
      return [choice(alive(), [add('$target', 'despair', 1)])];
    case '希望之光':
    case '隙间的阳光':
      return [choice(alive(), [add('$target', 'hope', 1)], 'target', 'captain')];
    default:
      return null;
  }
}
export function characterPrograms(name: string): Ability[] | null {
  switch (name) {
    case 'UP主':
      return [
        good('streamer', 3, [
          choice(another(), [add('$target', 'goodwill', 1), add('$target', 'paranoia', -1)]),
          {
            choices: [
              { key: 'transfer', options: ['yes', 'no'] },
              {
                key: 'newTarget',
                options: alive(
                  all(eq(field('area'), field('area', '$target')), {
                    cmp: 'ne',
                    left: field('character'),
                    right: 'UP主',
                  }),
                ),
              },
            ],
            effects: [
              when(
                all(
                  eq({ gameFlag: 'streamer-target' }, { ref: '$target' }),
                  eq({ ref: '$transfer' }, 'yes'),
                ),
                { op: 'flag', key: 'streamer-target', value: '$newTarget' },
              ),
            ],
          },
        ]),
      ];
    case '御神木':
      return [
        stepAbility('sacred-tree', 'protagonist-abilities', [
          {
            choices: [
              { key: 'target', options: another() },
              {
                key: 'counter',
                options: ['goodwill', 'paranoia', 'intrigue', 'guard', 'hope', 'despair'],
              },
            ],
            effects: [{ op: 'transfer', from: '$self', to: '$target', counter: '$counter' }],
          },
        ]),
      ];
    case '妹妹':
      return [
        good('little-sister', 5, [
          {
            choices: [
              { key: 'target', options: co({ attribute: '成人', target: '$it' }) },
              { key: 'ability', options: ['$target-goodwill'] },
            ],
            effects: [{ op: 'invoke-goodwill', target: '$target', ability: '$ability' }],
          },
        ]),
      ];
    case '模仿犯':
      return [
        good('copycat-reveal', 3, [simple({ op: 'same-identity', target: '$self' })], {
          condition: ge({ game: 'loop' }, 2),
          cannotRefuse: true,
        }),
      ];
    case '学者':
      return [
        good('scholar-clear', 3, [
          simple({ op: 'clear', target: '$self' }),
          {
            choices: [{ key: 'direction', options: ['up', 'down'] }],
            effects: [
              when(eq({ ref: '$direction' }, 'up'), { op: 'ex', amount: 1 }),
              when(eq({ ref: '$direction' }, 'down'), { op: 'ex', amount: -1 }),
            ],
          },
        ]),
      ];
    case '临时工？':
      return [
        good(
          'parttimer-reveal',
          3,
          [
            simple({ op: 'reveal-identity', target: '$self' }),
            choice(co(), [add('$target', 'goodwill', 2)]),
          ],
          { loopLimit: 1 },
        ),
      ];
    case '大人物':
      return [
        good(
          'boss-reveal',
          5,
          [choice(alive(all(other, eq(field('area'), { ref: '$territory' }))), [reveal])],
          { loopLimit: 1 },
        ),
      ];
    case '情报商':
      return [
        good(
          'informant',
          5,
          [
            choice(['$all-x'], [], 'excluded'),
            choice(
              ['$other-selected-x'],
              [{ op: 'reveal-rule', rule: '$rule' }],
              'rule',
              'mastermind',
            ),
          ],
          { loopLimit: 1 },
        ),
      ];
    case '住院患者':
    case '黑猫':
    case '临时工':
      return [];
    case '男学生':
    case '女学生':
      return [good('student', 2, [choice(another(student), [add('$target', 'paranoia', -1)])])];
    case '大小姐':
      return [
        good('rich-girl', 3, [choice(co(), [add('$target', 'goodwill', 1)])], {
          condition: {
            any: [eq(field('area', '$self'), 'school'), eq(field('area', '$self'), 'city')],
          },
        }),
      ];
    case '偶像':
      return [
        good('idol-paranoia', 3, [choice(another(), [add('$target', 'paranoia', -1)])]),
        good('idol-goodwill', 4, [choice(another(), [add('$target', 'goodwill', 1)])]),
      ];
    case '媒体人':
      return [
        good('media-paranoia', 2, [choice(alive(other), [add('$target', 'paranoia', 1)])]),
        good('media-intrigue', 2, [
          choice({ kind: 'alive-or-boards', where: together }, [add('$target', 'intrigue', 1)]),
        ]),
      ];
    case '军人':
      return [
        good('soldier-paranoia', 2, [choice(co(), [add('$target', 'paranoia', 2)])], {
          loopLimit: 1,
        }),
        good('soldier-protect', 5, [simple({ op: 'protect-protagonists' })], { loopLimit: 1 }),
      ];
    case '护士':
      return [
        good('nurse', 2, [choice(another(upset), [add('$target', 'paranoia', -1)])], {
          cannotRefuse: true,
        }),
      ];
    case '职员':
      return [good('office-worker', 3, [simple({ op: 'reveal-identity', target: '$self' })])];
    case '巫女':
      return [
        good('shrine-maiden-remove', 3, [simple(add('shrine', 'intrigue', -1))], {
          condition: eq(field('area', '$self'), 'shrine'),
        }),
        good('shrine-maiden-reveal', 5, [choice(co(), [reveal])], { loopLimit: 1 }),
      ];
    case '异界人':
      return [
        good('alien-kill', 4, [choice(another(), [kill])], { loopLimit: 1 }),
        good(
          'alien-revive',
          5,
          [choice({ kind: 'dead', where: together }, [{ op: 'revive', target: '$target' }])],
          { loopLimit: 1 },
        ),
      ];
    case '从者':
      return [
        good(
          'servant',
          4,
          [
            choice(alive(other), [
              { op: 'flag', target: '$self', key: 'protect', value: '$target' },
            ]),
          ],
          { loopLimit: 1 },
        ),
      ];
    case '转校生':
      return [
        good('transfer-student', 2, [
          choice(another(), [
            { op: 'replace', target: '$target', from: 'intrigue', to: 'goodwill' },
          ]),
        ]),
      ];
    case '教师':
      return [
        good('teacher-counter', 3, [
          {
            choices: [
              { key: 'target', options: co(student) },
              { key: 'direction', options: ['add', 'remove'] },
            ],
            effects: [
              when(eq({ ref: '$direction' }, 'add'), add('$target', 'paranoia', 1)),
              when(eq({ ref: '$direction' }, 'remove'), add('$target', 'paranoia', -1)),
            ],
          },
        ]),
        good('teacher-reveal', 4, [choice(co(student), [reveal])], { loopLimit: 1 }),
      ];
    case '医生':
      return [
        good('doctor-counter', 2, [
          {
            choices: [
              { key: 'target', options: another() },
              { key: 'direction', options: ['add', 'remove'] },
            ],
            effects: [
              when(eq({ ref: '$direction' }, 'add'), add('$target', 'paranoia', 1)),
              when(eq({ ref: '$direction' }, 'remove'), add('$target', 'paranoia', -1)),
            ],
          },
        ]),
        good('doctor-release', 3, [
          simple(
            each(
              { kind: 'cards', where: eq(field('character'), '住院患者') },
              { op: 'flag', target: '$it', key: 'free-movement' },
            ),
          ),
        ]),
      ];
    case '小女孩':
      return [
        good('girl-release', 1, [simple({ op: 'flag', target: '$self', key: 'free-movement' })]),
        good(
          'girl-move',
          3,
          [choice(['$adjacent-self'], [{ op: 'move', target: '$self', area: '$area' }], 'area')],
          { loopLimit: 1 },
        ),
      ];
    case '手下':
      return [good('henchman', 3, [simple({ op: 'flag', target: '$self', key: 'no-incidents' })])];
    case '局外人':
      return [
        good('outsider-reveal', 3, [simple({ op: 'reveal-identity', target: '$self' })], {
          condition: ge({ game: 'loop' }, 2),
          cannotRefuse: true,
        }),
      ];
    case '幻想':
      return [
        good(
          'illusion-move',
          3,
          [
            {
              choices: [
                { key: 'target', options: co() },
                { key: 'area', options: { kind: 'boards' } },
              ],
              effects: [{ op: 'move', target: '$target', area: '$area' }],
            },
          ],
          { loopLimit: 1 },
        ),
        good('illusion-remove', 4, [simple({ op: 'remove', target: '$self' })]),
      ];
    case '刑警':
      return [
        good(
          'detective-incident',
          4,
          [choice(['$occurred-days'], [{ op: 'reveal-culprit', day: '$day' }], 'day')],
          { loopLimit: 1 },
        ),
        good('detective-guard', 5, [choice(co(), [add('$target', 'guard', 1)])], {
          loopLimit: 1,
          condition: eq(
            {
              count: {
                kind: 'cards',
                where: ge({ counter: 'guard', target: '$it', raw: true }, 1),
              },
            },
            0,
          ),
        }),
      ];
    case '神灵':
      return [
        good(
          'divinity-incident',
          3,
          [choice(['$incident-days'], [{ op: 'reveal-culprit', day: '$day' }], 'day')],
          { loopLimit: 1 },
        ),
        good('divinity-intrigue', 5, [
          choice({ kind: 'alive-or-boards', where: together }, [add('$target', 'intrigue', -1)]),
        ]),
      ];
    case '教主':
      return [
        good('leader-goodwill', 3, [
          choice(alive(all(other, upset)), [add('$target', 'goodwill', 1)]),
        ]),
        good('leader-reveal', 4, [choice(another(upset), [reveal])], { loopLimit: 1 }),
      ];
    case '班长':
      return [
        good('class-representative', 2, [
          choice(['$used-captain-cards'], [{ op: 'recover-card', card: '$card' }], 'card'),
        ]),
      ];
    case 'AI':
      return [
        good(
          'ai',
          3,
          [
            choice(
              ['$public-incidents'],
              [{ op: 'invoke-incident', name: '$incident', culprit: '$self' }],
              'incident',
            ),
          ],
          { loopLimit: 1 },
        ),
      ];
    case '鉴别员':
      return [
        good(
          'forensic-transfer',
          2,
          [
            {
              choices: [
                { key: 'from', options: another() },
                {
                  key: 'to',
                  options: another({ cmp: 'ne', left: { ref: '$it' }, right: { ref: '$from' } }),
                },
                {
                  key: 'counter',
                  options: ['goodwill', 'paranoia', 'intrigue', 'guard', 'hope', 'despair'],
                },
              ],
              effects: [{ op: 'transfer', from: '$from', to: '$to', counter: '$counter' }],
            },
          ],
          { loopLimit: 1 },
        ),
        good('forensic-reveal', 5, [choice({ kind: 'dead' }, [reveal])], { loopLimit: 1 }),
      ];
    case '上位存在':
      return [
        good(
          'higher-being',
          3,
          [
            {
              choices: [
                { key: 'target', options: co() },
                { key: 'counter', options: ['hope', 'despair'] },
              ],
              effects: [{ op: 'counter', target: '$target', counter: '$counter', amount: 1 }],
            },
          ],
          { loopLimit: 1 },
        ),
      ];
    default:
      return null;
  }
}
