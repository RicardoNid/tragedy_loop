import { readFileSync } from 'node:fs';
import type { Scenario } from '../../../../packages/contracts/src/decision.js';
import type { ReplayQuestion } from '../../../../scripts/engine/candidate-replays.js';
import type { ObservedQuestion } from '../../../../scripts/engine/observed-game.js';

export const scenarios: Scenario[] = [
  {
    id: 'incident-outcome',
    module: 'FS',
    title: '未发生的医院事故',
    description: '医生的不安已达界限，事件阶段却宣布医院事故未发生。检查当事人还能是谁。',
  },
  {
    id: 'loop-grant',
    module: 'FS',
    title: '第二轮缺少的希望牌',
    description: '第一轮结束时职员有两枚友好，女学生只有一枚。第二轮开始时无人获得希望牌。',
  },
  {
    id: 'day-end-observation',
    module: 'BTX',
    title: '两人独处的日末',
    description:
      '第一天日末，医院里只有医生和住院患者，两人都活到了次日。核对哪些身份组合仍能解释这个结果。',
  },
  {
    id: 'investigation',
    module: 'BTX',
    title: '职员的证言',
    description: '第二天的不安扩散有两名可能的当事人。比较发动友好能力后仍可能成立的答案。',
  },
  {
    id: 'game-policy',
    module: 'FS',
    title: '学校的最后一张牌',
    description: '最后一天，剧作家已在三个地点暗置行动牌。轮到第三名主人公决定如何防守。',
  },
  {
    id: 'observed-game',
    module: 'BTX',
    title: '医院事故前夕',
    description: '由角色范围和完整观察重建候选剧本，在事件结算前保护住院患者。',
  },
  {
    id: 'seat-policy',
    module: 'LL',
    title: 'C 的最终推理',
    description: '在单席视角下回答事件当事人，检查这名主人公能否单独获胜。',
  },
  {
    id: 'final-decision',
    module: 'BTX',
    title: '交换身份的嫌疑人',
    description: '两个候选剧本的角色身份不同，寻找能在最终决战中确保获胜的共同策略。',
  },
];
export function loadScenario(id: string): ReplayQuestion | ObservedQuestion {
  if (!scenarios.some((s) => s.id === id)) throw Error('找不到这个示例');
  return JSON.parse(
    readFileSync(
      new URL('../../../../products/engine/' + id + '-example.json', import.meta.url),
      'utf8',
    ),
  );
}
