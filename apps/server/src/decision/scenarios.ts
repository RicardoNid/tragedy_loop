import { readFileSync } from 'node:fs';
import type { Scenario } from '../../../../packages/contracts/src/decision.js';
import type { ReplayQuestion } from '../../../../scripts/engine/candidate-replays.js';
import type { ObservedQuestion } from '../../../../scripts/engine/observed-game.js';

export const scenarios: Scenario[] = [
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
