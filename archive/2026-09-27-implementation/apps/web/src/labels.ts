import type { SeatId } from '@tragedy/contracts';
export const seats: Record<SeatId, string> = {
  mastermind: '剧作家',
  protagonistA: '主人公 A',
  protagonistB: '主人公 B',
  protagonistC: '主人公 C',
};
const names: Record<string, string> = {
  hospital: '医院',
  shrine: '神社',
  city: '都市',
  school: '学校',
  goodwill: '友好',
  anxiety: '不安',
  intrigue: '密谋',
  setup: '开局',
  loop_start: '轮回开始',
  turn_start: '每日开始',
  mastermind_action: '剧作家行动',
  protagonist_action: '主人公行动',
  action_resolution: '行动结算',
  mastermind_ability: '剧作家能力',
  protagonist_ability: '主人公能力',
  incident: '事件',
  leader_rotation: '队长轮换',
  turn_end: '每日结束',
  loop_end: '轮回结束',
  final_showdown: '最终决战',
};
Object.assign(names, seats, {
  'move-horizontal': '横向移动',
  'move-vertical': '纵向移动',
  'move-diagonal': '斜向移动',
  'forbid-intrigue': '禁止密谋',
  'forbid-movement': '禁止移动',
  'forbid-goodwill': '禁止友好',
  'forbid-anxiety': '禁止不安',
  hand: '可用',
  used: '已使用',
  discard: '弃牌',
  civilian: '平民',
  key_person: '关键人物',
  killer: '杀手',
  cultist: '邪教徒',
});
export const label = (text: string): string =>
  names[text] ??
  text.replace(
    /protagonist[ABC]|mastermind|goodwill|anxiety|intrigue|loop_start|turn_start|turn_end|loop_end/g,
    (token) => names[token] ?? token,
  );
