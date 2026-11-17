import type { Observation } from '../../../contracts/src/game.js';

// Event routing is independent of the game content. Stateful evaluators still check the
// actual window, snapshot and competing causes before emitting a necessary constraint.
interface Route {
  types?: readonly Observation['type'][];
  phases?: readonly Observation['phase'][];
  include: string;
  skip: string;
  result: string;
}
export const routes = {
  cardSettlement: {
    types: ['cards'],
    phases: ['card-resolution'],
    include: '按整批翻牌统计希望与禁止密谋，再按目标依次核对移动、增加、减少。只在本阶段有对应牌型时检查可能在场的修正规则。',
    skip: '普通结算吻合就更新盘面。无相关牌、模组无该规则、或存活角色的剩余候选均不满足时跳过对应身份检查。',
    result: '只对被改写的目标和牌建立必要条件。未翻全、无法解释的变化和可能的替代结算保留历史核验。',
  },
  direct: {
    types: ['own-choice'],
    phases: ['protagonist-abilities'],
    include: '本人独立请求已知友好能力',
    skip: '代发、未声明、私有条件',
    result: '有效友好低于所请求能力的门槛则公开前缀矛盾',
  },
  declaredEffect: {
    phases: ['protagonist-abilities'],
    include: '通用发动窗口检查公开请求、拒绝和已知次数。声明者、目标及首批盘面变化均可确定且与报告吻合时，直接记账。',
    skip: '跳过其他角色和同一角色未声明的普通主动能力。已认领的首批变化只消费一次，不搜索谁造成了它。拒绝则关闭正文。',
    result:
      '正式披露、死亡与不死性矛盾、护卫或替代、额外变化及闭合窗口缺少必报结果，分别检查对应候选。代发、隐藏条件和无法对齐的步骤保留历史核验。',
  },
  refusal: {
    types: ['refused'],
    include: '有该项能力的角色被正式拒绝',
    skip: '替身或能力不明',
    result: '保留当时能拒绝的身份（含希望、绝望和身份转变）。明确不可拒绝的能力收到拒绝报告时，公开前缀矛盾。',
  },
  afterDeclaration: {
    include: '紧接独立声明的下一条不是拒绝报告',
    skip: '中间有序号缺口、代发、不可拒绝或临时工',
    result: '只在强制拒绝本应立即披露时排除该解释',
  },
  end: {
    types: ['boundary'],
    include: '安静的日末窗口已关闭，有日末入口快照',
    skip: '窗口未闭合、目标不确定或存在其他干预',
    result: '不可能保持安静的强制来源与目标配对不可行',
  },
  pairClose: {
    types: ['boundary'],
    include: '同日事件窗口进入队长交换',
    skip: '死亡报告仍在同一批；缺报告、替身或有额外强制反应时保留未决',
    result: '检查必选第二步、幸存者强制反应及事件完成义务，不按死亡报告顺序淘汰',
  },
  loopWindow: {
    include: '商议记录上轮友好；轮回开始收集强制效果，连续窗口进入回合开始',
    skip: '序号、轮次或结束边界不符',
    result: '检查黑猫神社密谋和因果线不安；缺失必报的变化才缩窄',
  },
  reset: {
    types: ['board', 'character'],
    phases: ['discussion'],
    include: '首日同轮商议窗口首次合法重置',
    skip: '目标已重置、状态或初始区域不吻合',
    result: '绑定已披露的初始区域等参数',
  },
  arrival: {
    types: ['character'],
    phases: ['day-start'],
    include: '同一日初窗口内转校生合法登场',
    skip: '并非从缺席进入存活或指示物、区域不符',
    result: '绑定登场日及公开初始区域',
  },
  empty: {
    types: ['no-effect'],
    include: '事件产生明确的无现象报告',
    skip: '非事件窗口、可能取消或程序形状不确定，保留替代解释',
    result: '仅排除无法无声完成的事件、当事人或目标组合',
  },
  occurrence: {
    types: ['incident'],
    phases: ['incident'],
    include: '日期与发生／未发生明确且触发模型已支持',
    skip: '群体或私有门槛、可能改变触发的规则，需要另外核验',
    result: '约束真实事件与当事人所在的联合域，不把发生等同于产生效果',
  },
  failure: {
    types: ['failure'],
    include: '明确观察到主人公死亡或失败',
    skip: '报告不是失败效果，或另有可行原因',
    result: '在该阶段建立失败来源析取',
  },
  disclosure: {
    types: ['identity', 'rule', 'culprit'],
    include: '正式公开身份、规则或事件当事人',
    skip: '变化身份与替身不得直接等同于初始身份',
    result: '缩窄已披露变量并传播，其他变量保留',
  },
} as const satisfies Record<string, Route>;
export function routesObservation(id: keyof typeof routes, o: Observation) {
  const r: Route = routes[id];
  return (!r.types || r.types.includes(o.type)) && (!r.phases || r.phases.includes(o.phase));
}
