import type { Choice, PlayerView } from '../../../packages/contracts/src/game.js';
export const labels: Record<string, string> = {
  actual: '实际所在区域',
  territory: '大人物领地',
  clockwise: '顺时针版图',
  hospital: '医院',
  shrine: '神社',
  city: '都市',
  school: '学校',
  far: '远方',
  p0: '主人公 1',
  p1: '主人公 2',
  p2: '主人公 3',
  mastermind: '剧作家',
  protagonists: '主人公',
  goodwill: '友好',
  paranoia: '不安',
  intrigue: '密谋',
  guard: '守护',
  hope: '希望',
  despair: '绝望',
  alive: '存活',
  dead: '死亡',
  absent: '未登场',
  removed: '已离场',
  discussion: '轮回间讨论',
  briefing: '游戏开始前',
  'loop-start': '轮回开始',
  'day-start': '日初',
  'mastermind-cards': '剧作家盖牌',
  'protagonist-cards': '主人公盖牌',
  'card-resolution': '行动牌结算',
  'mastermind-abilities': '剧作家能力',
  'protagonist-abilities': '主人公能力',
  incident: '事件',
  'captain-change': '队长交接',
  'day-end': '日末',
  'loop-end': '轮回结束',
  'final-guess': '最终回答',
  finished: '对局结束',
  horizontal: '横向移动',
  vertical: '纵向移动',
  diagonal: '斜向移动',
  'block-movement': '禁止移动',
  'block-goodwill': '禁止友好',
  'block-paranoia': '禁止不安',
  'block-intrigue': '禁止密谋',
  'goodwill+1': '友好 +1',
  'goodwill+2': '友好 +2',
  'paranoia+1': '不安 +1',
  'paranoia+2': '不安 +2',
  'paranoia-1': '不安 −1',
  'intrigue+1': '密谋 +1',
  'intrigue+2': '密谋 +2',
  'hope+1': '希望 +1',
  'despair+1': '绝望 +1',
  hand: '可用',
  set: '已盖放',
  used: '已使用',
  boundary: '阶段变化',
  board: '区域变化',
  character: '角色变化',
  cards: '行动牌',
  refused: '能力回应',
  identity: '身份公开',
  rule: '规则公开',
  culprit: '犯人公开',
  failure: '轮回失败',
  victory: '胜利',
  'card-grant': '获得行动牌',
  'no-effect': '事件已发生，无现象',
  declaration: '能力宣言',
  'own-choice': '本席位行动',
  continue: '继续',
  pass: '结束阶段',
  ability: '发动能力',
  select: '选择',
  refuse: '回应能力',
  yes: '是',
  no: '否',
  add: '增加',
  remove: '移除',
  student: '减少学生的不安',
  'rich-girl': '增加友好',
  servant: '保护角色',
  'idol-paranoia': '减少不安',
  'idol-goodwill': '增加友好',
  'shrine-maiden-remove': '移除神社密谋',
  'shrine-maiden-reveal': '揭示角色身份',
  'office-worker': '揭示自身身份',
  'doctor-counter': '调整不安',
  'doctor-free': '解除住院限制',
  nurse: '减少不安',
  'media-paranoia': '增加不安',
  'media-intrigue': '增加密谋',
  brain: '主谋：放置密谋',
  gossip: '传谣人：放置不安',
  'killer-character': '杀手：杀死关键人物',
  'killer-protagonists': '杀手：杀死主人公',
};
export const label = (value: string) => labels[value] ?? value;
export function name(value: string, view: PlayerView): string {
  const card = Object.values(view.hands)
    .flat()
    .find((c) => c?.id === value);
  return (
    view.characters.find((c) => c.id === value)?.character ??
    (card ? label(card.kind) : label(value))
  );
}
export function choiceLabel(c: Choice, view: PlayerView): string {
  switch (c.kind) {
    case 'start':
      return '开始游戏';
    case 'continue':
      return '继续';
    case 'pass':
      return '结束本阶段';
    case 'request-final-guess':
      return '提议最终回答';
    case 'vote-final-guess':
      return c.agree ? '同意最终回答' : '继续轮回';
    case 'refuse':
      return c.refuse ? '拒绝能力' : '接受能力';
    case 'select':
      return view.decision?.areas?.[c.value] ? label(view.decision.areas[c.value]!) : name(c.value, view);
    case 'ability':
      return `${c.owner ? name(c.owner, view) + ' · ' : ''}${label(c.ability)}${
        c.choices
          ? ' · ' +
            Object.values(c.choices)
              .map((v) => name(v, view))
              .join('、')
          : ''
      }`;
    case 'guess':
      return `${name(c.character, view)}：${c.identity}`;
    case 'guess-culprits':
      return '提交犯人回答';
    case 'cards':
      return '盖放行动牌';
  }
}
export function readable(value: unknown, view: PlayerView): string {
  if (typeof value === 'string') return name(value, view);
  if (Array.isArray(value)) return value.map((v) => readable(v, view)).join('、');
  if (value && typeof value === 'object') {
    const keys: Record<string, string> = {
      counter: '指示物',
      amount: '数量',
      before: '原值',
      after: '现值',
      occurred: '发生',
      correct: '回答正确',
      ex: 'EX',
      target: '目标',
      area: '区域',
      guess: '回答',
      identity: '身份',
    };
    return Object.entries(value)
      .map(([k, v]) => `${keys[k] ? keys[k] + '：' : ''}${readable(v, view)}`)
      .filter(Boolean)
      .join(' · ');
  }
  if (typeof value === 'boolean') return value ? '是' : '否';
  return value == null ? '' : String(value);
}
