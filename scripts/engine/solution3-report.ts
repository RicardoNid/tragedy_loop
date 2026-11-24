import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { advance, initializeDiscussion } from '../../packages/engine/src/runtime/engine.js';
import { project, initialPlacementView } from '../../packages/engine/src/runtime/ports.js';
import { LiveKnowledge } from '../../packages/engine/src/runtime/knowledge-live.js';
import { SolutionSpace3 } from '../../packages/engine/src/solution3/space.js';
import { officialModules, type GameSetup } from '../../packages/contracts/src/game.js';
const cwd = new URL('../../', import.meta.url);
const esc = (s: unknown) =>
  String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const table = (head: string[], rows: (string | number)[][]) =>
  '<table><thead><tr>' +
  head.map((x) => '<th>' + esc(x) + '</th>').join('') +
  '</tr></thead><tbody>' +
  rows.map((r) => '<tr>' + r.map((x) => '<td>' + esc(x) + '</td>').join('') + '</tr>').join('') +
  '</tbody></table>';
const files = [
  'tests/engine/solution3.test.ts',
  'tests/engine/solution3-replay.test.ts',
  'tests/engine/knowledge-curse-history.test.ts',
];
const testRun = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', '--test-reporter=tap', ...files],
  { cwd, encoding: 'utf8' },
);
if (testRun.error) throw testRun.error;
const cases = [...testRun.stdout.matchAll(/^(not ok|ok) \d+ - (.+)$/gm)].map((m) => [
  m[2]!,
  m[1] === 'ok' ? '通过' : '失败',
]);
if (!cases.length) throw Error(testRun.stderr || testRun.stdout);
if (testRun.status !== 0) process.exitCode = 1;
const phases = [
  [
    'briefing',
    '开局前',
    '公开模组、日数和日程',
    '等待首次放置，不公开未登场候选。',
    '延迟登场、测试页 GUI',
  ],
  [
    'discussion',
    '讨论／复原',
    '公开阵容或上轮结束后的边界',
    '跨轮保留剧本约束；记录上轮盘面。',
    '延迟登场、官方重放',
  ],
  [
    'loop-start',
    '轮回开始',
    '轮回边界、EX、发牌与已闭合登场窗口',
    '绑定神灵轮次；区分本轮和配置的失败条件。',
    'WM、延迟登场',
  ],
  [
    'day-start',
    '回合开始',
    '转校生公示、分组序号与下一阶段边界',
    '没有到齐的同批公告不消去登场日。',
    '延迟登场',
  ],
  [
    'mastermind-cards',
    '剧作家盖牌',
    '公开设置对象',
    '登记对卡牌免疫身份的限制。',
    '边界推进、官方重放',
  ],
  [
    'protagonist-cards',
    '主人公盖牌',
    '公开设置对象及己方选择',
    '保留已有表格。单独的卡组、次数与目标合法性未验证。',
    '边界推进',
  ],
  [
    'card-resolution',
    '行动结算',
    '禁止友好、友好牌、角色快照及下一边界',
    '已覆盖角色的时间旅者随真实结果出现或缺失确定或排除。',
    '闭合禁止友好结算',
  ],
  [
    'mastermind-abilities',
    '剧作家能力',
    '某版图增加一枚密谋',
    '保留当地身份和规则来源的替代关系，限制来源使用次数。',
    '后台替代关系、无关角色对照',
  ],
  [
    'protagonist-abilities',
    '主人公能力',
    '公开规则、当事人、身份或拒绝',
    '公开配置当事人锁定对应日期，有效身份按来源解释。',
    '伪造事件、WM、公开前缀',
  ],
  [
    'incident',
    '事件',
    '公告、入场盘面、窗口闭合与效果',
    '匹配发生门槛、群众尸体、复合身份和部分事件结算。',
    '发生门槛、群众门槛、MC、闭合自杀',
  ],
  [
    'captain-change',
    '队长变更',
    '事件结束后的边界',
    '结算上个窗口；保留事件及当事人联合关系。',
    '闭合自杀',
  ],
  [
    'day-end',
    '回合结束',
    '同一区域、有效不安、死亡及下一边界',
    '病毒达到三枚后检查杀人狂来源；缺失死亡保留不死解释。',
    '强制击杀',
  ],
  [
    'loop-end',
    '轮回结束',
    'EX、窗口内失败与闭合边界',
    '部分主线失败条件匹配。WM 只替换失败条件来源。',
    'WM、官方重放',
  ],
  [
    'final-guess',
    '最终决战',
    '公布猜测及对错',
    '配置身份或当事人绑定；多个错误答案只需一项不成立。',
    'LL 决战前 C 的机会、错误答案与随后公开当事人的固定用例',
  ],
  ['finished', '结局', '公开胜负', '停止推进，保留当前约束。', '边界推进、官方重放'],
];
const inventory: string[][] = [];
const traitWindows: Record<string, string> = {
  forbiddenInitial: '剧本制作',
  culpritRequirement: '剧本制作',
  pair: '剧本制作',
  identities: '剧本制作',
  max: '剧本制作',
  incident: '事件',
  ordinaryIncidentTrigger: '事件',
  baseIncidentArea: '事件',
  sameAreaIncidentTrigger: '事件',
  partnerReaction: '死亡结算后',
  immortal: '死亡结算',
  protects: '死亡结算',
  ignore: '友好声明',
  puppet: '剧作家能力',
  loopShrineIntrigue: '轮回开始',
  mastermindGoodwill: '剧作家能力',
  mandatoryFirstMastermindAbility: '剧作家能力',
  abilityArea: '能力声明与结算',
  incidentAreaFromBase: '事件',
};
for (const mod of officialModules.filter((m) => m !== 'AHR')) {
  const pack = compileOfficial(mod, mod !== 'LL');
  for (const [kind, defs] of [
    ['角色', pack.characters],
    ['身份', pack.identities],
    ['规则', pack.plots],
  ] as const)
    for (const d of Object.values(defs)) {
      for (const a of d.abilities)
        inventory.push([mod, kind, d.name, a.timing, a.id, a.source, '逐条正反及组合未全部验证']);
      for (const [key, field] of Object.entries(d))
        if (traitWindows[key] && field != null && field !== false) {
          inventory.push([
            mod,
            kind,
            d.name,
            traitWindows[key]!,
            key + ' ' + JSON.stringify(field),
            d.source,
            '制作约束或特性；逐条正反及组合未全部验证',
          ]);
        }
    }
  for (const [key, value] of Object.entries(pack.setupRules))
    inventory.push([
      mod,
      '模组',
      '剧本制作',
      '剧本制作',
      key + ' ' + JSON.stringify(value),
      '模组制作正文及基础规则',
      '见开局固定用例，全部组合未验证',
    ]);
  for (const d of Object.values(pack.incidents))
    inventory.push([
      mod,
      '事件',
      d.name,
      'incident',
      '发生及效果',
      d.source,
      '见固定用例，其余未验证',
    ]);
  for (const d of pack.moduleAbilities)
    inventory.push([
      mod,
      '模组',
      d.owner,
      d.ability.timing,
      d.ability.id,
      d.ability.source,
      '逐条未验证',
    ]);
}
const setup = JSON.parse(readFileSync(new URL('apps/server/src/fixtures/fs-01g.json', cwd), 'utf8'))
  .setup as GameSetup;
const pack = compileOfficial('FS'),
  v = initialPlacementView(initializeDiscussion(pack, setup).state!);
const timed = <T>(fn: () => T) => {
  const t = performance.now(),
    value = fn();
  return { value, ms: (performance.now() - t).toFixed(2) };
};
const first = timed(() => new LiveKnowledge(pack, v).snapshot());
const third = timed(() => new SolutionSpace3(v));
const s = third.value;
const day = setup.incidents[0]!.day;
const comparison =
  first.value.realIncidents?.[String(day)]?.join('、') === '自杀' &&
  s.model.graph.mark(s.model.events.get(day)!['自杀']!) === '√';
const work = s.model.graph.work;
const tiny: GameSetup = {
  ...setup,
  loops: 1,
  days: 1,
  y: '复仇的火种',
  x: ['流言四起'],
  characters: [
    { id: 'a', character: '男学生', identity: '主谋' },
    { id: 'b', character: '女学生', identity: '传谣人' },
  ],
  incidents: [],
};
const initial = initializeDiscussion(pack, tiny).state!,
  opening = initialPlacementView(initial);
const played = advance(pack, initial, 'p0', {
  id: 'continue',
  expectedRevision: initial.revision,
  decisionId: initial.pending!.id,
  choice: { kind: 'continue' },
});
const current = project(played.state, 'protagonists');
const one = timed(() => {
  const solver = new LiveKnowledge(pack, opening);
  solver.update(current.observations, current.revision);
  solver.verifyCombinations();
  for (let i = 0; i < 100 && solver.snapshot().status === 'running'; i++) solver.tick(25);
  return solver.snapshot();
});
const three = timed(() => {
  const solver = new SolutionSpace3(opening),
    openingWork = solver.model.graph.work;
  solver.append(current.observations, current.characters);
  return { solver, openingWork };
});
const small = three.value.solver,
  graph = small.model.graph;
const pairs = ['主谋', '传谣人'].sort().join(',');
const aligned =
  one.value.status === 'exact' &&
  one.value.rules.slice().sort().join(',') === tiny.x.concat(tiny.y).sort().join(',') &&
  tiny.characters.every(
    (c) =>
      one.value.identities[c.id]?.slice().sort().join(',') === pairs &&
      Object.entries(small.model.ids.get(c.character)!)
        .filter(([, a]) => graph.truth(a) !== false)
        .map(([n]) => n)
        .sort()
        .join(',') === pairs,
  ) &&
  [...tiny.x, tiny.y].every((n) => graph.truth(small.model.plots[n]!) === true) &&
  !small.conflict;
const secondComparison =
  '<h3>两席 FS 的全部可见身份与采用规则</h3><p>一日一轮，首个剧作家盖牌窗口，两位延迟角色的合法登场窗口均已闭合。两席各只剩主谋和传谣人，两种联合分配，主副线确定。相同公开历史与投影核对' +
  (aligned ? '通过' : '失败') +
  '。求解器 1 执行联合核验，求解器 3 传播制作和登场约束。两种联合分配另由独立完整小穷举核对。</p>' +
  table(
    ['实现', '来源检查', '局部计数', '完整配置', '开局至此窗口 ms'],
    [
      [
        '求解器 1',
        '未单列',
        '传播分支 ' + String(one.value.propagation?.branches),
        '生成 ' + one.value.generated,
        one.ms,
      ],
      [
        '求解器 3',
        graph.work.sources.length,
        '主副线 ' + three.value.openingWork.combinations + '；此批配对 ' + graph.work.combinations,
        graph.work.configurations,
        three.ms,
      ],
    ],
  );
if (!aligned) process.exitCode = 1;
const root = fileURLToPath(cwd),
  folder = mkdtempSync(join(root, 'test-results-solver3-report-'));
const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
let gui = '未验证';
try {
  const run = spawnSync(
    process.execPath,
    [
      cli,
      'test',
      '-c',
      'scripts/review/playwright.local.config.ts',
      'solution3.spec.ts',
      '--output=' + folder,
    ],
    { cwd, encoding: 'utf8' },
  );
  gui = run.status === 0 ? '通过' : '失败';
  if (run.status !== 0) {
    console.error(run.stdout, run.stderr);
    process.exitCode = 1;
  }
} finally {
  if (dirname(folder) === dirname(join(root, 'owned')))
    rmSync(folder, { recursive: true, force: true });
}
const categories: [string, RegExp][] = [
  ['单条规则', /模组|门槛|禁止友好|友好声明|WM|忍者/],
  ['复合规则', /伪造|MC |强制击杀|两步|LL |因果|重复的剧作家|闭合自杀/],
  ['递推一致性', /前缀|窗口|阶段|登场|预算/],
  ['联合正确性', /穷举|替代关系|制作真值/],
  ['计算开销', /无关角色|完整配置|零工作/],
];
const resultSummary = table(
  ['类别', '通过', '失败', '未验证项详见下方范围表'],
  categories.map(([name, match]) => {
    const tested = cases.filter(([title]) => match.test(title!));
    return [
      name,
      tested.filter(([, r]) => r === '通过').length,
      tested
        .filter(([, r]) => r === '失败')
        .map(([n]) => n)
        .join('、') || '0',
      '固定用例可以同时检验多个类别',
    ];
  }),
);
const examples = [
  [
    'MC 心理医生的真实目标',
    'MC 心理医生正文与 FAQ 第 13 行',
    'EX 为零或一；同区另有一人，分别为零不安与一不安。',
    '观察到减少、经过完整窗口但没有减少、提前中断分别验收。',
    'MC 心理医生',
  ],

  [
    '未记录的从者保护对象',
    '从者友好 4 与替死特性',
    '接受声明时未记目标，异界人杀害后从者护卫减少，再观察预定自杀。',
    '两次结果须由整轮同一个被保护者解释。',
    '从者未记录',
  ],
  [
    '可疑信件与教主',
    'MC 正文；角色 FAQ 中教主触发可疑信件条目',
    '第一步移动教主，第二步在新区域选择角色；另测未实际移动。',
    '实际直接移动者次日禁行，同区选择与第三日移动仍合法。',
    'MC 教主可疑信件',
  ],
  [
    '封锁与双胞胎',
    'MC 正文；MC FAQ 第 14、15、23 行',
    '黑猫静默、普通与对角版图声明，边界第三日、第四日及跨轮。',
    '普通当事人按所在版图，双胞胎按结算位置，持续包括当天。',
    'MC 双胞胎担任',
  ],
  [
    '偏执狂的两种选择',
    'MC 身份 偏执狂',
    '同区没有其他来源时，先给自己放密谋，再在同一阶段加不安。',
    '共享本阶段一次使用，不能用同一偏执狂解释两次。',
    'MC 偏执狂',
  ],
  [
    '猎奇杀人中间边界',
    'MC 事件正文与 FAQ 第 18、22 行',
    '连续杀人之后第一笔加不安已送齐，尚未送出后续密谋。',
    '核对第一步杀害、不死与护卫，后续结果继续等待。',
    'MC 猎奇杀人首次',
  ],
  [
    'LL 最终计划与 C 回答',
    'LL 模组特殊规则与最终计划、我才是名侦探',
    '最终轮关键人物有希望，或提前决战。多个当事人回答错误后再揭示一项。',
    '最终轮复原前的资格影响决战，答错只排除整个答案组合。',
    'LL 决战前 C',
  ],

  [
    'AI 调用与正式日程',
    '流程 308fc73ab869b7c4 第230至242行',
    '预定自杀的配置当事人为女学生。AI 声明自杀，观察守护减少、错杀别人、被拒绝和窗口闭合。',
    '只有 AI 作为执行者受到死亡请求。女学生的制作当事人保持确定。',
    'AI 按公开名',
  ],
  [
    'AI 调用 HSA 群众事件',
    'AI 角色与 HSA 诅咒活化；流程第234行',
    'AI 在第一日调用第二日公开的诅咒活化，诅咒目标分别为都市、学校，或直到闭合均无诅咒。',
    '只有都市群众合法；第二日的预定当事人仍可为其他版图。',
    'AI 以都市',
  ],
  [
    'HSA 死亡鬼魂与初始位置',
    'f497855359fe9b6e 身份；流程第157行',
    '学校出身的鬼魂在医院死亡。下一剧作家阶段观察学校角色、其他区域的角色或没有不安增加。',
    '已闭合且有对象时必须有一次合法增加。',
    'HSA 死亡鬼魂在',
  ],
  [
    'HSA 污秽溢出先后顺序',
    'f497855359fe9b6e 群众事件',
    '观察加二不安、版图加一，以及反序、版图饱和与缺失。',
    '未闭合保留；闭合后同时核对数值、对象与顺序。',
    'HSA 污秽溢出让',
  ],
  [
    'WM 目击者与杀人狂',
    'f7c96b28229536d3 身份',
    '同区仅有两人。目击者带一枚守护有三或四枚不安，与杀人狂的强制效果同时结算。',
    '四枚时应消耗守护并死亡，闭合时还要求 EX 增加。三枚时只有一次死亡请求。',
    'WM 目击者与',
  ],
  [
    'WM 祭品、全场死亡与不死',
    'f7c96b28229536d3 身份',
    '有两枚不安与两枚密谋；其中一项不足，或其他区域漏记一名平民死亡。',
    '使用同一批死亡请求核对每名角色及守护、替死。',
    'WM 祭品使用',
  ],
  [
    'WM 发现的 EX 增量',
    'f7c96b28229536d3 事件，教主与黑猫特性',
    '观察 EX 增零、一或二和未闭合状态。',
    '完整记录分别支持黑猫、普通执行者、教主。',
    'WM 发现的增量',
  ],
  [
    'WM 集体自杀',
    'f7c96b28229536d3 事件',
    '当事人有效密谋零或一；同区平民死亡或存活。',
    '达到门槛时向区域内全体同时提出请求。',
    'WM 集体自杀先',
  ],
  [
    'HSA 怪物们的阴谋和身份名额',
    'f497855359fe9b6e 副线',
    '两席同区，版图增加一枚密谋，其他合法来源已排除。',
    '两个魔女位置都可行，必须采用魔女遗咒，排除少女大危机。',
    'HSA 怪物们的阴谋要求',
  ],
  [
    '灭绝之火 × 跨轮日程',
    'WM FAQ 第28、29行',
    '两个日期均有灭绝之火。已发生过的日期再次发生，或第二个日期首次发生。',
    '记录依预定日跨轮保留，作用于首次发生时的所有角色及主人公。',
    'WM 灭绝之火按',
  ],
  [
    '廷达罗斯之嗅 × 后续事件 × 黑猫',
    'WM FAQ 第30行，事件阶段流程 308fc73ab869b7c4',
    '第一天廷达罗斯之嗅，第二天发现。比较发生、未发生、中断及主人公死亡四种结果。',
    '后续阶段正常结束时核对必定死亡，缺失和出现均能反推首日黑猫是否替换文本。',
    'WM 廷达罗斯之嗅在',
  ],
  [
    '医生 × 禁行 × 失踪',
    '基础流程 308fc73ab869b7c4 第632行；FS/BTX FAQ 第29行',
    '比较住院患者当日移动前医生已被接受、遭拒或未使用解除禁行能力。',
    '只有本轮已经解除禁行时，患者才可以失踪到都市。',
    '医生解除住院',
  ],

  [
    '送葬 × 主人公选人',
    'WM 模组 f7c96b28229536d3，事件表',
    '队长选择女学生或另一名角色，随后收到女学生死亡。',
    '窗口未闭合时保持候选；闭合窗口后核对所选对象及从者替死。',
    'WM 送葬绑定',
  ],
  [
    '医院事故 × 仙人',
    '仙人卡正文；Promo FAQ 第11行、MC FAQ 第4、5行',
    '都市的仙人引发医院事故；医院角色死亡，同时观察仙人生死。',
    '保留当事人按都市或顺时针医院结算的两种记录。学校的旁观者不能因此死亡。混合阵容种子 200 同时核对基础版与周年版。',
    'BTX 医院事故允许',
  ],
  [
    '大人物 × 未公布领地',
    '大人物 1a4ec21b9d7bb05f',
    '医院内仅有一名已公开平民；在剧作家阶段收到该角色不安增加，随后公示领地。',
    '未绑定领地允许大人物在医院使用能力；公示与该来源相容或冲突后重新传播。',
    '大人物未绑定',
  ],

  [
    'HSA 手下是鬼魂，轮初放诅咒',
    '手下 b48749824ce70ed9、LL FAQ 第13行、基础流程 308fc73ab869b7c4',
    '第一轮手下选择医院，第二轮改选神社，分别把地缚诅咒放在旧／新初始区域。',
    '支持当轮选定的区域。混合阵容种子 67 经离线联合核验，基础版 268 条及周年版 327 条均保留真实配置。',
    'HSA 手下为鬼魂',
  ],
  [
    '猎奇杀人 × 愚者 × 关键人物',
    'MC FAQ 第17、18行，MC 事件文本 bee371fd65b819b7',
    '同区死亡后其他两名角色依次接收不安、密谋，最后移除愚者不安；另测前半死亡后中断。',
    '完整结算需要正确的先后顺序与不同目标，中途中断不要求后半或愚者完成后触发。',
    'MC 猎奇杀人先',
  ],
  [
    '疯狂之夜 × 古墓活尸',
    'HSA 正文 f497855359fe9b6e、流程 308fc73ab869b7c4',
    '发生时有五具或六具丧尸尸体，日末前数量可跨过门槛。',
    '六具时锁定本日强制结果；五具后增加不补触发。',
    'HSA 疯狂之夜只',
  ],
  [
    '发狂 × 军人保护／学者',
    'WM 正文 f7c96b28229536d3、WM FAQ 第5、6行',
    '在不同阶段记录 EX 三／四，比较日末死亡、军人保护以及提前结束后是否开始下一轮。',
    '日末及轮末分别读取实时 EX。保护可以挡死亡，不能保住剩余轮回。',
    'WM 发狂',
  ],
  [
    '同批死亡请求与替死',
    '从者 ff7a5b572d8e564f、死亡流程 308fc73ab869b7c4',
    '同时穷尽被保护角色和从者的护卫、不死、直接请求数及公开护卫／生死结果。',
    '每一组公开结果和后台身份一致地判为可行或排除。',
    '从者同批直接请求',
  ],

  [
    '仙人 × 阴谋活动',
    '仙人 96847c4f07faea8f，Promo FAQ 第11行',
    '仙人在神社。分别公开神社、学校或都市一人死亡，随后关闭事件。',
    '原处及顺时针相邻版图可保留，第三块版图排除，角色卡位置不变。',
    'MZ 仙人发动阴谋活动',
  ],
  [
    '大人物／UP 主 × 杀人狂',
    '角色 FAQ 第41行、UP 主 6ede728967268773',
    '本体独处，另一块版图只有死者。变更领地／EX 持有者，与同批死亡对照。',
    '死者在代理范围可保留，否则排除。以实际卡位置结算其他角色。',
    '大人物与 UP 主',
  ],
  [
    '鉴别员双向转移',
    '鉴别员 77b779d8ce1c4d20',
    '两目标分别只有一方持有护卫、双空、只收到一方报告，随后开始下一项行动。',
    '两份实际增减均应出现，双空可无变化，缺少第二份于下一项声明前定位。',
    '鉴别员双向移动',
  ],
  [
    '巫师 × 友好完成及拒绝',
    'WM FAQ 第21–24行、流程 308fc73ab869b7c4',
    '已知巫师执行能力，分别公告与缺失身份，另比较被拒绝后与完成后再使用。',
    '巫师存活且能力完成必须公开身份，被拒不消耗本次使用。',
    'WM 巫师友好',
  ],

  [
    '教主 × 阴谋活动 × 连续杀人／失踪',
    'MZ 正文 7b1d70acbf4521da、教主 04ec0d810cd9675c、官方剧本 7827cbf19e7f65a9',
    '教主先去都市，目标死亡。比较移动前死亡、版图密谋增量及已满三枚。',
    '先移动后杀害新区域目标可行。顺序相反、应增加的一枚缺失或增加两枚在闭合时矛盾。',
    '教主两次阴谋活动',
  ],
  [
    '区域死亡 × 从者 × 护卫',
    '从者 ff7a5b572d8e564f、保护流程 308fc73ab869b7c4',
    '医院密谋为一，大小姐与带一枚护卫的从者同在医院。',
    '从者承受直接与替代两项，护卫消耗后死亡。闭合时仍生存则矛盾。',
    '医院事故中从者',
  ],
  [
    'HSA 诅咒 × 杀人狂',
    'HSA 正文 f497855359fe9b6e、死亡流程 308fc73ab869b7c4',
    '三人同区，诅咒使第三人死亡，随后杀人狂与平民独处。',
    '闭合时必须有第二项处置；移除诅咒作对照则不会要求击杀。',
    'HSA 诅咒先杀死第三人',
  ],
  [
    '转校生友好能力 × 绝望',
    '转校生角色正文及角色 FAQ',
    '目标有绝望，实际密谋分别为零和一。',
    '零枚可无变化。一枚须替换为友好，接受且闭合后才能按缺失排除。',
    '转校生按实际密谋',
  ],
  [
    '周年事件 × 教主／黑猫',
    '周年追加规则、教主及黑猫角色正文',
    '发生希望之光，分别观察零枚、一枚、两枚实际希望。',
    '开窗保留替代来源，闭合后普通、黑猫、教主要求不同数量。',
    '周年事件希望之光',
  ],
  [
    '遗言 × 下一轮希望牌',
    'LL 正文 07a03c94050c1185、黑猫角色规则',
    '已发生遗言，进入非最终轮，检查是否有希望牌。',
    '黑猫替换会阻止遗言授牌。开窗不按缺失排除。',
    'LL 遗言',
  ],
  [
    'HSA 两条轮回开始诅咒能力',
    'HSA 模组正文；HSA FAQ「被诅咒的土地、魔女遗咒」',
    '没有放置、一张牌、相同牌号重复快照、第二及第三个新牌号',
    '没有放置不排除；一张给两条规则标问号，两张确定两条规则，第三张定位矛盾。',
    'HSA 轮回开始诅咒',
  ],
  [
    '自杀 × 不死、护卫、教主',
    'BTX 正文 6145e115e8bfb5ab；死亡与保护流程 308fc73ab869b7c4',
    '公开当事人，比较自杀结算前后的不死、护卫消费与存活',
    '普通当事人消费护卫并存活排除不死；教主两次执行时消费唯一护卫后仍然死亡。',
    'BTX 自杀先判断不死',
  ],
  [
    '神灵、转校生与暴徒名额',
    'FS 正文 13222d412f58d5ab；基础流程 156717aa7f6b1574',
    '两席、一日一轮，两名后台角色先后错过唯一登场窗口',
    '神灵窗口闭合时所有暴徒格为 ×；转校生窗口闭合时仅余两种完整分配。每个前缀与独立穷举对齐。',
    'FS 两席及两名后台角色',
  ],
  [
    '手下的友好能力与事件门槛',
    '角色 b48749824ce70ed9；角色 FAQ 第 23 行',
    '手下已公开为当事人，1 不安与 3 友好，分别有无接受声明',
    '同轮未接受能力时发生；接受后不发生。四种公告组合中两种矛盾。',
    '手下已达发生门槛',
  ],
  [
    '黑猫 × 猎奇杀人／银色子弹',
    '角色 FAQ 第 53、54 行；事件流程 308fc73ab869b7c4',
    'MC 事件宣布发生；分别追加 +1、普通专属增量，或直接闭合',
    '开放窗口保留两类来源；+1 确定黑猫，普通专属增量排除黑猫。闭合且未增加可排除猎奇杀人的全部解释。',
    'MC 猎奇杀人',
  ],
  [
    '伪造事件 × 军人保护',
    'MZ 正文 7b1d70acbf4521da；基础流程 156717aa7f6b1574；角色 FAQ 第 60 行',
    '公开名“校庆”，当事人的初始学校有 2 密谋；分别有无保护声明',
    '公告后保留，闭合时校对主人公死亡和存活。只接受与本轮已生效保护一致的两种记录。',
    'MZ 伪造事件读取',
  ],
];
const monitorFile = new URL('products/engine/solution3-monitor.jsonl', cwd);
const monitor: { start: string; end: string; suite: string; ok: boolean; output: string }[] =
  existsSync(monitorFile)
    ? readFileSync(monitorFile, 'utf8')
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
const latestReplay = monitor.filter((x) => x.suite === 'replay' && x.ok).at(-1);
const monitorSection = monitor.length
  ? '<h2>持续测试与交叉核对</h2><p>已记录时长 ' +
    ((Date.parse(monitor.at(-1)!.end) - Date.parse(monitor[0]!.start)) / 3600000).toFixed(2) +
    ' 小时。此表为生成报告时的快照。每次重跑均读取当时工作区内的代码。</p>' +
    table(
      ['测试组', '完成次数', '失败次数', '最近结束时间（UTC）'],
      ['cross', 'regression', 'replay'].map((suite) => {
        const group = monitor.filter((x) => x.suite === suite);
        return [
          suite,
          group.length,
          group.filter((x) => !x.ok).length,
          group.at(-1)?.end ?? '待运行',
        ];
      }),
    ) +
    table(
      ['曾失败的运行（UTC）', '首次失败用例', '后来同组通过时间（UTC）'],
      monitor
        .filter((r) => !r.ok)
        .map((r) => [
          r.start,
          (r.output.match(/^not ok[^\n]+/gm) ?? [r.suite]).join(' / '),
          monitor.find((x) => x.ok && x.suite === r.suite && x.start > r.end)?.end ?? '尚未复验',
        ]),
    ) +
    (latestReplay
      ? '<p>下表比较同一公开前缀中可见角色的配置身份范围。仅当求解器 1 的状态为 exact 时才计为精确对照，不完整结果之间的差异只作定位线索。</p>' +
        table(
          [
            '剧本',
            '前缀',
            '求解器 1 精确前缀',
            '两者投影不同的行次',
            '首次差异记录',
            '求解器 3 来源检查',
            '求解器 3 局部组合',
            '求解器 3 完整配置',
          ],
          latestReplay.output
            .trim()
            .split('\n')
            .map((line) => {
              const r = JSON.parse(line);
              return [
                r.scenario,
                r.prefixes,
                r.exact,
                r.differentRows,
                r.firstDifference?.through ?? '无',
                r.checks3,
                r.local3,
                r.configurations3,
              ];
            }),
        )
      : '')
  : '';
const latestCross = monitor.filter((x) => x.suite === 'cross' && x.ok).at(-1);
const crossRows =
  latestCross?.output
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l)) ?? [];
const comparableSection = crossRows.length
  ? '<h2>固定开局的独立验算</h2><p>FS 的 90 个阵容对照身份与主副线。其他每个模组各用一个固定公开前缀，对照所有可见身份及规则格。离线穷举包括剧作家在轮回开始可跳过的私有选择。WM 与 LL 的求解器 1 在这些输入达到候选上限。</p>' +
    table(
      [
        '模组',
        '公开输入数',
        '求解器 1 状态',
        '求解器 1 生成数',
        '求解器 3 局部尝试（开局＋追加）',
        '求解器 3 完整验证',
        '独立验算相容配置',
        '求解器 1 ms',
        '求解器 3 ms',
      ],
      crossRows.map((r) => [
        r.module ?? 'FS',
        r.cases ?? 1,
        r.status1 ?? 'exact',
        r.configurations1 ?? r.generated1,
        r.local3 ?? r.openingAttempts + r.incrementalAttempts,
        r.configurations3,
        r.oracleWitnesses ?? '印刷名额逐项核对',
        r.ms1.toFixed(1),
        r.ms3.toFixed(1),
      ]),
    )
  : '';
function savedPrefixes(name: string) {
  const plain = new URL('products/engine/' + name + '.jsonl', cwd);
  const zipped = new URL(plain.href + '.gz');
  const input = existsSync(plain)
    ? readFileSync(plain, 'utf8')
    : existsSync(zipped)
      ? gunzipSync(readFileSync(zipped)).toString('utf8')
      : '';
  return input
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}
const prefixRecords = savedPrefixes('solution3-cross-joint');
const prefixRows = [...new Map(prefixRecords.map((r) => [r.seed + '/' + r.through, r])).values()];
const exactRows = prefixRows.filter((r) => r.status1 === 'exact');
const sum = (rows: typeof exactRows, key: string) => rows.reduce((s, r) => s + Number(r[key]), 0);
const prefixSection =
  '<h2>两席 FS 完整对局逐前缀交叉测试</h2><p>轮回只有一天、两名学生、一次自杀。对每次公开记录变化，求解器 1 请求完整历史验证，求解器 3 递推。核对两行身份、主副线、真实事件和当事人。联合验证对四组主谋与当事人的有序对分别检查其能否满足求解器 3 保存的整组关系，并与求解器 1 的精确解集比对。此离线核对的时间单独排除。耗时为收到该次公开输入到得到结果的时间；含并行长测的机器负载。</p>' +
  table(
    [
      '种子',
      '结束前缀',
      '精确前缀',
      '其余前缀',
      '逐对验证的精确前缀',
      '精确前缀差异',
      '求解器1 ms 合计',
      '求解器3 ms 合计',
      '求解器3来源检查',
      '求解器3局部组合',
      '求解器3完整配置',
    ],
    [
      [
        new Set(prefixRows.map((r) => r.seed)).size,
        prefixRows.filter((r) => r.phase === 'finished').length,
        exactRows.length,
        prefixRows.length - exactRows.length,
        exactRows.filter((r) => r.allPairsVerified).length,
        exactRows.filter((r) => r.differences.length).length,
        sum(exactRows, 'ms1').toFixed(1),
        sum(exactRows, 'ms3').toFixed(1),
        sum(exactRows, 'sources3'),
        sum(exactRows, 'local3'),
        sum(exactRows, 'configurations3'),
      ],
    ],
  );
function crossSection(name: string, description: string, combinations: number) {
  const eventPrefixes = savedPrefixes(name);
  return (
    description +
    table(
      [
        '事件',
        '完整对局',
        '全部前缀',
        combinations + ' 组合精确核验',
        '预算内未精确',
        '差异前缀',
        '求解器1生成',
        '求解器1展开',
        '求解器1来源分支',
        '求解器1历史比较',
        '求解器3来源检查',
        '求解器3局部尝试',
        '求解器3完整配置',
        '求解器1 ms',
        '求解器3 ms',
      ],
      [...new Set(eventPrefixes.map((r) => String(r.eventName)))].map((name) => {
        const rows = eventPrefixes.filter((r) => r.eventName === name);
        const final = rows.filter((r) => r.phase === 'finished');
        return [
          name,
          final.length,
          rows.length,
          rows.filter((r) => r.status1 === 'exact' && r.allPairsVerified).length,
          rows.filter((r) => r.status1 !== 'exact').length,
          rows.filter((r) => r.differences.length).length,
          ...['generated1', 'expanded1', 'sourceBranches1', 'historyComparisons1'].map((k) =>
            sum(final, k),
          ),
          ...['sources3', 'local3', 'configurations3'].map((k) => sum(rows, k)),
          sum(rows, 'ms1').toFixed(1),
          sum(rows, 'ms3').toFixed(1),
        ];
      }),
    )
  );
}
const eventSection =
  crossSection(
    'solution3-cross-events',
    '<h2>FS 七种预定事件的四组合核验</h2><p>固定两席、一天一轮。每种预定事件重复同一组种子。自杀组与前表独立计时，两表不相加。求解器 1 的生成、展开、来源分支与历史比较均取每局最后的累计值；求解器 3 的来源、局部尝试及两者耗时按每次增量相加。一次来源分支与一次来源检查口径不同。</p>',
    4,
  ) +
  crossSection(
    'solution3-accept72',
    '<h2>三席 FS 七种事件与 72 种完整配置</h2><p>三名普通角色，一天一轮。按印刷名额独立列出四种主副线配置，每种允许六种身份排列与三种当事人选择。对每个精确前缀逐项比对四张表，再检验每个完整配置与已保存的全部关系是否相容。离线验收的配置检查不计入求解器运行。两张表的样本量、求解器 1 的预算中断和耗时分别统计。</p>',
    72,
  );
const extraCrosses = [
  ['BTX', 'solution3-BTX-cross'],
  ['HSA', 'solution3-HSA-final'],
  ['MC', 'solution3-MC-result'],
].flatMap(([module, file]) => {
  const rows = savedPrefixes(file!);
  if (!rows.length) return [];
  return [...new Set(rows.map((r) => r.eventName))].map((name) => {
    const event = rows.filter((r) => r.eventName === name),
      final = event.filter((r) => r.phase === 'finished');
    const aligned = event.filter((r) => r.sameCast === true && r.status1 === 'exact');
    return [
      module!,
      name,
      final.length,
      event.length,
      aligned.length,
      event.filter((r) => !r.sameCast).length,
      event.filter((r) => r.status1 !== 'exact').length,
      aligned.filter((r) => r.differences.length).length,
      aligned.filter((r) => r.allPairsVerified).length,
      sum(aligned, 'sources3'),
      sum(aligned, 'local3'),
      sum(aligned, 'configurations3'),
      sum(aligned, 'ms1').toFixed(1),
      sum(aligned, 'ms3').toFixed(1),
    ];
  });
});
const extraCrossSection =
  '<h2>BTX、HSA 两席及 MC 三席完整对局逐前缀对照</h2><p>独立列出印刷名额允许的主副线组合，BTX 与 HSA 分别检查两席身份排列和角色／群众当事人。MC 三席仅容纳黑暗学园、火药的味道与绝对意志；检查六种身份排列和三个当事人选项，强迫症须为唯一日程的当事人。神灵或转校生仍可配置的前缀中，求解器 3 还保留延迟登场分支；两套求解器的总体范围不一致，单列这些前缀。对齐后的每项身份、规则、事件与当事人，以及逐个制作组合均参与比对；耗时与运算量仅统计对齐且达到精确状态的前缀。</p>' +
  table(
    [
      '模组',
      '事件',
      '完整对局',
      '前缀',
      '范围对齐且精确',
      '延迟登场尚未排除',
      '求解器1预算未精确',
      '对齐前缀有差异',
      '已逐配置核对',
      '来源检查3',
      '局部尝试3',
      '完整验证3',
      '求解器1 ms',
      '求解器3 ms',
    ],
    extraCrosses,
  );
const alignedSummary = [
  'solution3-cross-events',
  'solution3-accept72',
  'solution3-BTX-cross',
  'solution3-HSA-final',
  'solution3-MC-result',
].map((file) => {
  const rows = savedPrefixes(file).filter(
    (r) => r.sameCast && r.status1 === 'exact' && r.allPairsVerified,
  );
  return [
    rows.length,
    rows.filter((r) => r.differences.length).length,
    ...['sources3', 'local3', 'configurations3', 'ms1', 'ms3'].map((k) => sum(rows, k)),
  ];
});
const totals = alignedSummary.reduce((a, r) => r.map((v, i) => v + (a[i] ?? 0)), [] as number[]);
const alignedOverview =
  '<h2>同范围精确交叉测试合计</h2><p>包括 FS 两席、FS 三席、BTX 与 HSA 两席及 MC 三席。每个前缀核对单项候选和全部固定席位制作组合。完整剧本的生成数与验证数是不同指标，求解器 1 未单独计量的验证次数不作推算。计时不含独立验收器逐项检查组合的时间。</p>' +
  table(
    [
      '对齐前缀',
      '有差异',
      '求解器 3 来源检查',
      '求解器 3 局部尝试',
      '求解器 3 完整配置验证',
      '求解器 1 累计秒',
      '求解器 3 累计秒',
    ],
    [[...totals.slice(0, 5), (totals[5]! / 1000).toFixed(2), (totals[6]! / 1000).toFixed(2)]],
  );
const campaigns = [
  'solution3-campaign.jsonl',
  'solution3-anniversary-campaign.jsonl',
  'solution3-mixed-campaign.jsonl',
  'solution3-varied-campaign.jsonl',
  'solution3-varied-joint.jsonl',
  'solution3-MC-verification.jsonl',
].flatMap((file) => {
  const data = savedPrefixes(file.slice(0, -6));
  if (!data.length) return [];
  return [...new Set(data.map((r) => r.scenario as string))].map((scenario) => {
    const group = [
        ...new Map(data.filter((r) => r.scenario === scenario).map((r) => [r.seed, r])).values(),
      ],
      done = group.filter((r) => r.status === 'finished');
    return [
      scenario +
        (file.includes('MC-verification')
          ? ' · MC 修复后专项复验'
          : file.includes('mixed')
            ? ' · 混合阵容'
            : file.includes('joint')
              ? ' · 变化剧本联合见证'
              : file.includes('varied')
                ? ' · 变化剧本'
                : ''),
      new Set(group.map((r) => r.seed)).size,
      done.length,
      group.length - done.length,
      group.reduce((n, r) => n + r.steps, 0),
      group.find((r) => r.knownDivergence)?.seed ?? '无',
      [...new Set(group.flatMap((r) => r.plots ?? []))].length || '固定',
      [...new Set(group.flatMap((r) => r.events ?? []))].length || '固定',
    ];
  });
});
const auditedCampaign = savedPrefixes('solution3-varied-joint');
const divergences = new Map<string, number>();
for (const r of auditedCampaign)
  if (r.knownDivergence) {
    const key = String(r.knownDivergence.kind ?? r.knownDivergence.ability);
    divergences.set(key, (divergences.get(key) ?? 0) + 1);
  }
const divergenceLabels: Record<string, string> = {
  'missing-anniversary-rumormonger': '周年追加的传谣人名额缺失',
  'divinity-incident': '神灵公开了其他日期的事件当事人',
  'detective-incident': '刑警公开了其他日期的事件当事人',
  'curse-without-board': '远方放置诅咒',
  'cat-isolation-movement': '黑猫取消孤守后仍发生移动',
  'stale-incident-area': '仙人移动后在先前区域放密谋',
  'inactive-alternate-loss': 'WM 替换的失败条件未满足仍失败',
};
const campaignSection =
  '<h2>随机公开对局与规则分歧</h2><p>每步由正向引擎给出合法选择。求解器仅收到主人公公开视野，逐步核对是否保留该局真实配置。次数按剧本与种子统计。混合阵容每个种子最多替换三名角色，并在正向制作验证通过后使用。变化剧本另外改变主副线、配置身份、真实事件和当事人；开局出现已知制作规则偏差的样本单列。遇已定位的引擎偏差时停止该局并单列，后续前缀不计入通过。变化剧本联合见证组使用离线可满足性检查逐前缀验证真实配置的全部已绑定项能同时成立。此组重用变化剧本的种子，样本数单列。</p>' +
  table(
    [
      '剧本',
      '不同种子',
      '完整走到结局',
      '正向偏差中止',
      '已执行命令数',
      '首个偏差种子',
      '覆盖主副线种数',
      '覆盖事件种数',
    ],
    campaigns,
  ) +
  table(
    ['定位', '规则依据', '预期与处理'],
    [
      [
        '刑警／神灵查看当事人，MZ-01G 种子 36 第 120 条声明、第 121 条下一行动',
        '刑警 a5fca13bda0eb9d9；runtime/engine.ts 的 environment',
        '选择第四日，正向引擎用当前第五日覆盖 day，缺少所选日期的公告。求解器在下一项独立行动闭合此前声明时报告矛盾。',
      ],
      [
        'HSA 混合阵容种子 95，第 4 条',
        'Promo FAQ 第 2、7 行与 HSA「被诅咒的土地」',
        'UP 主担任鬼魂，初始区域为远方。公开记录在远方放置地缚诅咒；远方没有版图，不能放牌。该记录按正向引擎偏差中止。',
      ],
      [
        '周年「超越世界线」遗漏传谣人名额',
        '周年正文 cddea332129b696d 的副线身份配置',
        '正向引擎周年副线身份资产为空。变化对局在首条指令前识别完全没有传谣人的配置，作为制作偏差中止；求解器 3 的名额传播另以固定输入回归。',
      ],
      [
        '周年无平民',
        'Wiki 基础 FAQ 2db1b5d63b2bcd80 第111行',
        '可以不转换。正向制作检查当前强制要求提供周年平民。独立固定输入已验收。',
      ],
      [
        '周年模仿犯直接复制因果残片',
        '在线基础 FAQ 第 83、84 行',
        '模仿犯在周年指定前复制原身份。它可以先复制平民，再由自己被指定为因果残片；其他角色被指定后，模仿犯不能复制该转换结果。',
      ],
      [
        '仙人移动后读取失踪的版图',
        'Promo FAQ 第11行；流程 308fc73ab869b7c4 第242行；事件正文先移动、随后读取所在版图',
        '正向引擎在事件入队时缓存位置。在 WM 混合种子 96 和 HSA 混合种子 226，仙人移动到学校后分别往神社或医院放置密谋；两者均不是学校或其顺时针版图都市。异常对局单列。',
      ],
      [
        'MC 周年变化剧本种子 303，第 124 条封锁公告',
        'MC 双胞胎正文及 MC FAQ 第 14、15 行',
        '住院患者在医院且为双胞胎；公告学校符合规则。已修正求解器 3 的区域匹配，使用固定输入和原种子复验。',
      ],
      [
        'MZ 变化剧本种子 866，第 51 条版图公告',
        '仙人正文、阴谋活动与失踪',
        '阴谋活动调用失踪。仙人从神社移动到医院，随后学校加密谋。医院及其顺时针邻区都不是学校；记录与失踪直接触发时相同的正向引擎偏差。',
      ],
      [
        'WM 周年变化剧本种子 515；第二轮第 227 条失败公告，第 229 条闭合',
        'WM 正文 f7c96b28229536d3 的疯狂的真相和达贡的福音书',
        '该轮起始 EX 为 2，轮末 EX 为 2、神社密谋为 0、巫师存活。正向结算把预设主线的失败能力直接入队，跳过条件；独立验收核对神社 0／2 与报告／未报告四种组合。',
      ],
      [
        'HSA 诅咒活化，种子 1 第32项公告，求解器 1 误删另一份合法剧本',
        'HSA 模组诅咒牌的地缚与附身；tests/engine/knowledge-curse-history.test.ts',
        '两个合法剧本各自重放至同一日末；学校上的第一张诅咒牌编号相差一，来自未公开的跳过机会。已修正求解器 1 的历史比较。逐张比较整段去向，交替交换两个目标仍能检出。',
      ],
      [
        '黑猫作孤守当事人',
        '流程正文 308fc73ab869b7c4 第239行；HSA FAQ 第38、41行',
        '黑猫替换事件文本；一般的从者跟随仍按同批选定的移动结算。正向资产将孤守移动列于事件完成后；求解器按替换后的文本处理。',
      ],
    ],
  );
const verificationFile = new URL('products/engine/solution3-final-verification.json', cwd);
const verification = existsSync(verificationFile)
  ? (JSON.parse(readFileSync(verificationFile, 'utf8')) as {
      recordedAt: string;
      uiSha256: string;
      checks: { command: string; passed: number; failed: number }[];
    })
  : undefined;
const verifiedSuites = verification
  ? '<h2>本次全量回归及离线浏览器验收</h2><p>记录时间 ' +
    esc(verification.recordedAt) +
    '（UTC）。受测单文件页面 SHA-256 为 <code>' +
    esc(verification.uiSha256) +
    '</code>。</p>' +
    table(
      ['命令', '通过', '失败'],
      verification.checks.map((r) => [r.command, r.passed, r.failed]),
    )
  : '';
const body =
  '<h1>求解器 3 验收记录</h1><p>适用 FS、BTX、MZ、MC、HSA、WM、LL 及适用周年追加。' +
  cases.filter((c) => c[1] === '通过').length +
  ' 项自动测试通过，' +
  cases.filter((c) => c[1] === '失败').length +
  ' 项失败。全规则联合完备性未验证，人工验收待完成。</p>' +
  resultSummary +
  verifiedSuites +
  '<h2>逐阶段验收</h2>' +
  table(['时点', '阶段', '公开输入', '窗口与预期', '固定用例或未验证范围'], phases) +
  '<h2>固定公开输入与联合预期</h2>' +
  table(
    ['共同适用规则', '规则依据（资料编号）', '公开记录', '窗口与预期输出', '测试名称及执行结果'],
    examples.map(([rule, source, input, expected, prefix]) => [
      rule!,
      source!,
      input!,
      expected!,
      cases.find(([n]) => n!.startsWith(prefix!))?.join(' · ') ?? '未验证',
    ]),
  ) +
  '<h2>单条、复合及递推验证</h2><p>固定输入与逐步断言在 <a href="../../tests/engine/solution3.test.ts">正式测试</a>。每条教程记录另按命令前缀验证真实制作配置能保留，见 <a href="../../tests/engine/solution3-replay.test.ts">重放测试</a>。</p>' +
  table(['固定用例', '执行结果'], cases) +
  '<h2>验收类别</h2>' +
  table(
    ['类别', '已验收范围（执行结果见上表）', '未验证'],
    [
      [
        '单条规则',
        '公开名称、门槛、顺位、实际与配置身份的固定输入',
        '全部能力的适用、不适用、合法选择和缺失结果',
      ],
      [
        '复合规则',
        '教主嵌套事件、从者替死与护卫、诅咒后杀人狂、周年事件及上表其余固定组合',
        '缺少历史绑定的大人物／UP 主代理区域、不能还原步骤的旧式合并快照，以及未逐项隔离的周年追加组合。需要记录或实现验证。',
      ],
      [
        '递推一致性',
        '两日当事人历史的追加与前缀重算；乱序到达的同批公告、预算恢复',
        '全部历史逐条与批次等价',
      ],
      [
        '联合正确性',
        'FS 两席和三席每前缀逐项核对四或 72 种制作组合，BTX 和 HSA 两席核对角色与群众，另有 14 条教程及变化剧本联合验收',
        '全部官方模组所有联合解释的可行性与四态投影完备性',
      ],
      [
        '计算开销',
        '开局不枚举完整剧本、重复证据零新增来源检查与组合尝试、局部无关角色对照',
        '全局同结论范围的性能对比',
      ],
      [
        'GUI',
        '自动验证' +
          gui +
          '。e2e/review/solution3.spec.ts 在断网浏览器检查可双击页、回看、证据及四态表',
        '人工验收待完成',
      ],
    ],
  ) +
  '<h2>同输入的限定范围对照</h2><p>FS-01G 的公开开局。比较结论仅限第 ' +
  day +
  ' 日真实事件为自杀，对齐检查' +
  (comparison ? '通过' : '失败') +
  '。毫秒为单次开局至首份结果，不含规则包编译，不代表全量同结论加速比。</p>' +
  table(
    ['实现', '来源检查', '局部组合', '完整配置', '耗时 ms'],
    [
      [
        '求解器 1',
        '未单列',
        '未单列',
        '生成 ' + first.value.generated + ' 个（独立计数口径）',
        first.ms,
      ],
      ['求解器 3', work.sources.length, work.combinations, work.configurations, third.ms],
    ],
  ) +
  '<p>求解器 3 的组合计数包含开局尝试的主副线组合，事件证据计数包含尝试的真实事件与当事人配对。关系传播单独计数，本次开局 ' +
  work.checks +
  ' 次。完整配置验证为实际进入整剧本验证的次数，正常路径无此入口。</p>' +
  secondComparison +
  prefixSection +
  alignedOverview +
  eventSection +
  extraCrossSection +
  campaignSection +
  '<p>变化剧本联合见证覆盖七个标准模组及六个适用周年变体。下表按首次可定位的正向记录偏差分类。后续 MC 专项复验与这些种子的重叠部分单列。</p>' +
  table(
    ['正向输入偏差', '联合见证中止对局数'],
    [...divergences].map(([k, v]) => [divergenceLabels[k] ?? k, v]),
  ) +
  comparableSection +
  monitorSection +
  '<details><summary>逐规则核对索引（正向资产，仅用于验收盘点）</summary>' +
  table(['模组', '类型', '对象', '时点', '项目', '依据', '验收状态'], inventory) +
  '</details>' +
  '<p>复现：pnpm report:solver3。离线测试入口：<a href="../../tragedy-test-ui.html">tragedy-test-ui.html</a>。</p>';
writeFileSync(
  new URL('products/engine/solution3-acceptance.html', cwd),
  '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>求解器 3 验收记录</title><style>body{font:16px/1.6 system-ui;margin:2em auto;max-width:1200px;padding:0 1em;color:#172939}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:.5em;border:1px solid #c1cbd1;text-align:left}th{background:#e8f0f4}summary{cursor:pointer;margin:1em 0}</style>' +
    body +
    '</html>',
);
console.log(cases.length + ' tests; comparable public event: ' + comparison);
if (!comparison) process.exitCode = 1;
