import type { PolicyView } from '../../../../packages/contracts/src/decision.js';
import type {
  Board,
  CardKind,
  Choice,
  Counter,
  Observation,
  Phase,
} from '../../../../packages/contracts/src/game.js';

export const areas: Record<Board | 'far', string> = {
  hospital: '医院',
  shrine: '神社',
  city: '都市',
  school: '学校',
  far: '远方',
};
export const phases: Record<Phase, string> = {
  briefing: '剧本说明',
  discussion: '主人公讨论',
  'loop-start': '轮回开始',
  'day-start': '日开始',
  'mastermind-cards': '剧作家出牌',
  'protagonist-cards': '主人公出牌',
  'card-resolution': '行动牌结算',
  'mastermind-abilities': '剧作家能力',
  'protagonist-abilities': '主人公能力',
  incident: '事件',
  'captain-change': '队长交接',
  'day-end': '日末',
  'loop-end': '轮回结束',
  'final-guess': '最终决战',
  finished: '终局',
};
export const counters: Record<Counter, string> = {
  goodwill: '友好',
  paranoia: '不安',
  intrigue: '密谋',
  guard: '守护',
  hope: '希望',
  despair: '绝望',
};
export const cardNames: Record<CardKind, string> = {
  horizontal: '横向移动',
  vertical: '纵向移动',
  diagonal: '斜向移动',
  'block-movement': '禁止移动',
  'goodwill+1': '友好 +1',
  'goodwill+2': '友好 +2',
  'block-goodwill': '禁止友好',
  'paranoia+1': '不安 +1',
  'paranoia+2': '不安 +2',
  'paranoia-1': '不安 −1',
  'block-paranoia': '禁止不安',
  'intrigue+1': '密谋 +1',
  'intrigue+2': '密谋 +2',
  'block-intrigue': '禁止密谋',
  'hope+1': '希望 +1',
  'despair+1': '绝望 +1',
};
export const target = (id: string, view?: Pick<PolicyView, 'characters'>) =>
  view?.characters.find((c) => c.id === id)?.character ?? areas[id as Board] ?? id;
export const actor = (id: string) =>
  ({ p0: '主人公一', p1: '主人公二', p2: '主人公三', mastermind: '剧作家' })[id] ?? id;
export function action(choice: Choice, view?: Pick<PolicyView, 'characters' | 'ownCards'>): string {
  switch (choice.kind) {
    case 'cards':
      return choice.placements
        .map((p) => {
          const card = view?.ownCards.find((c) => c.id === p.card);
          return '对' + target(p.target, view) + '使用' + (card ? cardNames[card.kind] : p.card);
        })
        .join('、');
    case 'ability': {
      const who = choice.owner ? target(choice.owner, view) : '';
      const ability: Record<string, string> = {
        'doctor-counter': '调整不安',
        'office-worker': '公开身份',
      };
      return who + '发动' + (ability[choice.ability] ?? choice.ability);
    }
    case 'select':
      return '选择' + target(choice.value, view);
    case 'pass':
      return '放弃剩余能力';
    case 'continue':
      return '继续游戏';
    case 'start':
      return '开始游戏';
    case 'request-final-guess':
      return '提议进入最终决战';
    case 'vote-final-guess':
      return choice.agree ? '同意最终决战' : '拒绝最终决战';
    case 'guess':
      return (
        '回答' +
        target(choice.character, view) +
        '是' +
        choice.identity +
        (choice.reverseIdentity ? '／' + choice.reverseIdentity : '')
      );
    case 'guess-culprits':
      return (
        Object.entries(choice.answers)
          .map(([d, id]) => '第 ' + d + ' 天当事人为' + target(id, view))
          .join('、') || '提交无事件答案'
      );
    case 'refuse':
      return choice.refuse ? '拒绝发动' : '允许发动';
  }
}
const reportNames: Record<Observation['type'], string> = {
  boundary: '阶段转换',
  board: '盘面变化',
  character: '角色变化',
  cards: '出牌或翻牌',
  incident: '事件结算',
  refused: '拒绝能力',
  identity: '身份公告',
  rule: '规则公告',
  culprit: '当事人公告',
  failure: '败北',
  victory: '胜利裁定',
  'card-grant': '获得行动牌',
  'no-effect': '未发生效果',
  declaration: '能力声明',
  'own-choice': '主人公行动',
};
export const reportName = (o: Observation) => reportNames[o.type] ?? o.type;
export const reasons: Record<string, string> = {
  limit: '搜索达到预算或分支上限',
  incomplete: '候选覆盖尚不完整',
  unsupported: '包含未支持的规则',
  lost: '正向裁判判定目标一方落败',
  death: '保护目标死亡',
  'left-play': '保护目标离场',
  'illegal-choice': '行动无法在当前菜单执行',
  'missing-response': '策略缺少对应观察的行动',
  'ambiguous-response': '相同观察对应多项行动',
  'invalid-node': '策略节点与当前提问不符',
  'ability-limit': '超过允许发动能力的次数',
  'setup-coverage': '给定剧本范围未穷尽',
  'world-limit': '重建到达世界上限',
  'work-limit': '重建达到步数上限',
  'setup-domain': '剧本生成范围未穷尽',
};
