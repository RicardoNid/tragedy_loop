import type {
  CharacterTraits,
  IdentityTraits,
  IncidentDefinition,
  RulePack,
  Ability,
} from '../../../engine/src/runtime/model.js';

// 身份先从实际位置确定基准版图（默认原地），角色再从该基准计算备选版图。
type CardRules<T> = T & { abilities?: Omit<Ability, 'source'>[] };
export const characterTraits: Record<string, CardRules<CharacterTraits>> = {
  医生: { mastermindGoodwill: { ability: 'doctor-counter', minimum: 2 } },
  上位存在: { mastermindGoodwill: { minimum: 1, overrideThreshold: 1 } },
  御神木: { mandatoryFirstMastermindAbility: true },
  黑猫: { incident: { execution: 'cancel' }, loopShrineIntrigue: true },
  教主: { incident: { execution: 'repeat', thresholdMultiplier: 2 } },
  临时工: { incident: { execution: 'proxy', privateTrigger: true } },
  手下: { incident: { maySuppress: true } },
  AI: { incident: { totalThreshold: true }, forbiddenInitial: 'civilian' },
  妹妹: { forbiddenInitial: 'ignores-goodwill' },
  大人物: {
    abilityArea: {
      actor: 'mastermind',
      modes: ['actual', 'territory'],
      publicMarker: 'territory',
      selection: 'before-declaration',
    },
  },
  仙人: {
    incident: { privateTrigger: true },
    incidentAreaFromBase: 'clockwise',
    abilities: [
      {
        id: 'immortal-revive',
        timing: 'protagonist-abilities',
        threshold: 5,
        loopLimit: 1,
        // 首步先声明目的地和尸体，拒绝检查之后才执行移动。次步复查已声明目标。
        steps: [
          {
            choices: [
              { key: 'area', options: ['hospital', 'shrine', 'city', 'school', 'far'] },
              { key: 'target', options: ['$corpses-after-self-move'], allowEmpty: true },
            ],
            effects: [{ op: 'move', target: '$self', area: '$area' }],
          },
          {
            condition: {
              cmp: 'eq',
              left: { field: 'area', target: '$target' },
              right: { field: 'area', target: '$self' },
            },
            effects: [
              {
                op: 'when',
                condition: {
                  cmp: 'eq',
                  left: { field: 'status', target: '$target' },
                  right: 'dead',
                },
                effects: [
                  { op: 'revive', target: '$target' },
                  { op: 'counter', target: '$target', counter: 'goodwill', amount: { ref: '$x' } },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  从者: { protects: { characters: ['大人物', '大小姐'], selectedTargetFlag: 'protect' } },
};

export const identityTraits: Record<string, CardRules<IdentityTraits>> = {
  心上人: { partnerReaction: { survivor: '求爱者', paranoia: 6 } },
  求爱者: { partnerReaction: { survivor: '心上人', paranoia: 6 } },
  胆小鬼: {
    abilities: [
      {
        id: 'coward',
        timing: 'mastermind-abilities',
        mandatory: true,
        condition: { cmp: 'ge', left: { counter: 'paranoia', target: '$self' }, right: 2 },
        steps: [
          {
            choices: [{ key: 'area', options: ['$adjacent-any-self'] }],
            effects: [{ op: 'move', target: '$self', area: '$area' }],
          },
        ],
      },
    ],
  },
  双胞胎: { baseIncidentArea: 'diagonal' },
  侦探: { sameAreaIncidentTrigger: { cmp: 'eq', left: { game: 'ex' }, right: 0 } },
};

// 事件正文处理完后追加的步骤。沿用现行孤守与黑猫的处理，等待维护者裁定。
export const incidentTraits: Record<string, Pick<IncidentDefinition, 'afterIncidentSteps'>> = {
  孤守: { afterIncidentSteps: [{ moveOthersFromEffectiveArea: true, effects: [] }] },
};

export const moduleAbilities: Partial<Record<RulePack['module'], RulePack['moduleAbilities']>> = {
  HSA: [
    {
      owner: 'module:zombies',
      ability: {
        id: 'zombie-move',
        source: 'module.HSA.zombie',
        timing: 'day-end',
        steps: [
          {
            choices: [
              { key: 'target', options: ['$zombie-corpses'] },
              { key: 'area', options: ['$adjacent-corpse'] },
            ],
            effects: [{ op: 'move-corpse', target: '$target', area: '$area' }],
          },
        ],
      },
    },
  ],
};
