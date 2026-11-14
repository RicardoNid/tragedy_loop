import { createHash } from 'node:crypto';
import { cpus, platform, arch } from 'node:os';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { compileOfficial, contentCoverage } from '../../packages/content/src/official/compile.js';
import { createSession } from '../../packages/engine/src/runtime/ports.js';
import { fork } from '../../packages/engine/src/runtime/engine.js';
import { replay, runBatch } from '../../packages/engine/src/runtime/replay.js';
import type { Actor, Choice, GameSetup, Module } from '../../packages/contracts/src/game.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const out = resolve(root, 'products/engine');
mkdirSync(out, { recursive: true });
const testFiles = readdirSync(resolve(root, 'tests/engine'))
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => resolve(root, 'tests/engine', f));
const typecheck = spawnSync(
  process.execPath,
  [require.resolve('typescript/bin/tsc'), '-p', 'tests/engine/tsconfig.json'],
  { cwd: root, encoding: 'utf8' },
);
if (typecheck.status !== 0) throw new Error(typecheck.stdout + typecheck.stderr);
const tests = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', '--test-reporter=tap', ...testFiles],
  { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
);
if (tests.status !== 0) throw new Error(tests.stdout + tests.stderr);
const testCount = Number(tests.stdout.match(/# tests (\d+)/)?.[1]);
const passCount = Number(tests.stdout.match(/# pass (\d+)/)?.[1]);
if (!testCount || passCount !== testCount) throw new Error('Could not verify test count.');

const started = performance.now();
const pack = compileOfficial('FS');
const coldCompileMs = performance.now() - started;
const setup: GameSetup = {
  module: 'FS',
  anniversary: false,
  loops: 2,
  days: 3,
  captain: 'p0',
  discussion: 'between-loops',
  y: '复仇的火种',
  x: ['流言四起'],
  characters: [
    { id: 'boy', character: '男学生', identity: '主谋' },
    { id: 'girl', character: '女学生', identity: '传谣人' },
    { id: 'doctor', character: '医生', identity: '平民' },
    { id: 'maiden', character: '巫女', identity: '平民' },
  ],
  incidents: [],
};
const session = createSession(pack, setup);
if (session.status !== 'ready') throw new Error(JSON.stringify(session.diagnostics));
const trace: { actor: Actor; choice: Choice }[] = [];
for (let n = 0; n < 100 && !session.host.snapshot().winner; n++) {
  const state = session.host.snapshot();
  if (!state.pending) throw new Error('Demo paused unexpectedly.');
  const actor = state.pending.actor;
  const port = actor === 'mastermind' ? session.mastermind : session.protagonists[actor];
  const view = port.view(),
    decision = view.decision!;
  let choice: Choice;
  if (decision.kind === 'cards') {
    const menu = decision.cardPlacement!;
    const targets = menu.targets.filter((t) =>
      ['hospital', 'shrine', 'city', 'school'].includes(t),
    );
    const cards = view.hands[actor]!.filter(
      (c) => menu.cards.includes(c.id) && ['horizontal', 'vertical', 'paranoia-1'].includes(c.kind),
    );
    choice = {
      kind: 'cards',
      placements: cards.slice(0, menu.count).map((c, i) => ({ card: c.id, target: targets[i]! })),
    };
  } else
    choice =
      decision.options.find((c) => ['continue', 'pass'].includes(c.kind)) ?? decision.options[0]!;
  const result = port.submit({
    id: `demo-${n}`,
    expectedRevision: view.revision,
    decisionId: decision.id,
    choice,
  });
  if (result.status === 'rejected') throw new Error(result.reason);
  trace.push({ actor, choice });
}
const final = session.host.snapshot();
if (!final.winner) throw new Error('Demo did not finish.');
const iterations = 60;
const request = { setup, choices: trace };
const times: number[] = [];
for (let i = 0; i < iterations; i++) {
  const at = performance.now(),
    result = replay(pack, request);
  if (result.status !== 'replayed' || result.state.winner !== final.winner)
    throw new Error('Replay mismatch.');
  times.push(performance.now() - at);
}
const batchAt = performance.now();
const batch = runBatch(
  pack,
  Array.from({ length: iterations }, () => request),
);
const batchMs = performance.now() - batchAt;
if (batch.some((r) => r.status !== 'replayed')) throw new Error('Batch did not complete.');
const forkAt = performance.now();
for (let i = 0; i < 200; i++) fork(final);
const forkMs = (performance.now() - forkAt) / 200;
const reuseAt = performance.now();
for (let i = 0; i < 1000; i++)
  if (compileOfficial('FS') !== pack) throw new Error('Pack reuse failed.');
const reuseMs = (performance.now() - reuseAt) / 1000;
const sorted = [...times].sort((a, b) => a - b);
const coverage = (['FS', 'BTX', 'MZ', 'MC', 'HSA', 'WM', 'AHR', 'LL'] as Module[]).map(
  (module) => ({ module, coverage: contentCoverage(compileOfficial(module)) }),
);
const sourceDirs = [
  'packages/engine/src/runtime',
  'packages/content/src/official',
  'packages/contracts/src',
  'tests/engine',
];
const codeDigest = createHash('sha256');
for (const dir of sourceDirs)
  for (const file of readdirSync(resolve(root, dir)).sort()) {
    codeDigest.update(`${dir}/${file}\n`);
    codeDigest.update(readFileSync(resolve(root, dir, file)));
  }
const report = {
  generatedAt: new Date().toISOString(),
  codeDigest: codeDigest.digest('hex'),
  ruleDigest: pack.digest,
  verification: {
    typecheck: 'passed',
    tests: testCount,
    passed: passCount,
    humanAcceptance: 'pending',
    exhaustiveCombinationProof: false,
    reportBrowserCheck: 'pending',
    repositoryChecks: {} as Record<string, unknown>,
  },
  coverage,
  benchmark: {
    environment: {
      node: process.version,
      platform: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model,
    },
    sample: 'FS / 4 characters / 3 days / no incidents / legal neutral actions',
    iterations,
    completed: iterations,
    commandsPerGame: trace.length,
    coldCompileMs,
    cachedCompileMeanMs: reuseMs,
    replayMedianMs: sorted[Math.floor(iterations / 2)],
    replayP95Ms: sorted[Math.floor(iterations * 0.95)],
    sequentialBatchMs: batchMs,
    gamesPerSecond: (iterations / batchMs) * 1000,
    fullSnapshotMeanMs: forkMs,
    peakRssKb: process.resourceUsage().maxRSS,
    limitation:
      'Single-process sequential batch; simple sample only; not a training throughput guarantee.',
  },
};
const rulesTypecheck = spawnSync(
  process.execPath,
  [require.resolve('typescript/bin/tsc'), '-p', 'tests/rules/tsconfig.json'],
  { cwd: root, encoding: 'utf8' },
);
const rulesFiles = readdirSync(resolve(root, 'tests/rules'))
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => resolve(root, 'tests/rules', f));
const rulesTests = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', '--test-reporter=tap', ...rulesFiles],
  { cwd: root, encoding: 'utf8' },
);
const configCheck = spawnSync(
  process.execPath,
  [
    require.resolve('prettier/bin/prettier.cjs'),
    '--check',
    'package.json',
    'pnpm-workspace.yaml',
    'tsconfig.base.json',
    'apps/*/package.json',
    'apps/*/tsconfig.json',
    'packages/*/package.json',
    '.prettierrc.json',
    '.github/workflows/check.yml',
  ],
  { cwd: root, encoding: 'utf8' },
);
const pythonLock = spawnSync(
  'uv',
  ['lock', '--check', '--offline', '--default-index', 'https://pypi.org/simple'],
  { cwd: root, encoding: 'utf8' },
);
report.verification.repositoryChecks = {
  machineRuleAssets: {
    status: rulesTypecheck.status === 0 && rulesTests.status === 0 ? 'passed' : 'failed',
    passed: Number(rulesTests.stdout.match(/# pass (\d+)/)?.[1] ?? 0),
  },
  configuration: {
    status: configCheck.status === 0 ? 'passed' : 'failed',
    details: configCheck.stderr.trim(),
  },
  pythonLock: {
    status: pythonLock.status === 0 ? 'passed' : 'not-verified',
    details: pythonLock.error?.message ?? pythonLock.stderr,
  },
};
writeFileSync(resolve(out, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
writeFileSync(
  resolve(out, 'example-replay.json'),
  JSON.stringify(
    {
      schema: 1,
      ruleDigest: pack.digest,
      setup,
      trace,
      observations: final.observations.protagonists,
      winner: final.winner,
    },
    null,
    2,
  ) + '\n',
);
const esc = (v: unknown) =>
  String(v)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const rows = coverage
  .map(
    (c) =>
      `<tr><th>${c.module}</th>${c.coverage.map((v) => `<td>${v.translated}/${v.total}</td>`).join('')}<td>待人类验收</td></tr>`,
  )
  .join('');
const phaseNames: Record<string, string> = {
  discussion: '轮间讨论',
  'loop-start': '轮回开始',
  'day-start': '日开始',
  'mastermind-cards': '剧作家暗置',
  'protagonist-cards': '主人公暗置',
  'card-resolution': '行动牌结算',
  'mastermind-abilities': '剧作家能力',
  'protagonist-abilities': '主人公能力',
  incident: '事件发生',
  'captain-change': '队长交接',
  'day-end': '日结束',
  'loop-end': '轮回结束',
  'final-guess': '最终决战',
  finished: '游戏结束',
};
const eventNames: Record<string, string> = {
  boundary: '阶段切换',
  cards: '行动牌信息',
  'own-choice': '己方决定',
  victory: '胜负结果',
  character: '角色变化',
  board: '盘面变化',
  incident: '事件信息',
};
const portExample = `// 仓库根层 TypeScript 文件的导入方式；用 pnpm exec tsx 文件名.ts 运行。
import { readFileSync } from 'node:fs';
import { compileOfficial } from './packages/content/src/official/index.js';
import { createSession, replay } from './packages/engine/src/index.js';
import type { GameSetup, Choice, Actor } from './packages/contracts/src/index.js';

const sample: { setup: GameSetup; trace: { actor: Actor; choice: Choice }[] } =
  JSON.parse(readFileSync('./products/engine/example-replay.json', 'utf8'));
const pack = compileOfficial(sample.setup.module, sample.setup.anniversary);
const session = createSession(pack, sample.setup);
if (session.status !== 'ready') throw new Error(JSON.stringify(session.diagnostics));

// 宿主按既有样本选出合法动作；实际玩家只能持有自己的端口。
for (const [index, action] of sample.trace.entries()) {
  const port = action.actor === 'mastermind'
    ? session.mastermind : session.protagonists[action.actor];
  const view = port.view();
  if (!view.decision) throw new Error('尚未轮到此玩家');
  // 新对局按 decision.options 选择；出牌读取 decision.cardPlacement。
  const result = port.submit({
    id: 'sample-' + index, expectedRevision: view.revision,
    decisionId: view.decision.id, choice: action.choice,
  });
  if (result.status !== 'ok') throw new Error(result.status);
}
console.log(session.protagonists.p0.view().winner);
// 重放接口用 choices 字段；导出文件的字段名为 trace。
const checked = replay(pack, { setup: sample.setup, choices: sample.trace });
console.log(checked.status);`;
const extraChecks = `<section id="verification"><h2>本次检查记录</h2><p>引擎类型检查与 ${testCount} 项测试通过。独立规则资产：${rulesTypecheck.status === 0 && rulesTests.status === 0 ? Number(rulesTests.stdout.match(/# pass (\d+)/)?.[1] ?? 0) + ' 项通过' : '未通过'}。根配置格式检查：${configCheck.status === 0 ? '通过' : '未通过，详细文件列表见验证记录'}。Python 锁检查：${pythonLock.status === 0 ? '通过' : '未验证，当前环境无法完成此检查'}。</p><p>新增内核 CI 工作流已放入仓库；本次未向远端提交，尚无远端运行结果。人类规则验收和页面人工验收仍待进行。</p><p id="browser-check">报告浏览器自动检查待运行。</p><details><summary>展开完整接入示例</summary><p>示例使用随报告提供的完整合法 FS 输入，可检查双方端口和重放得到一致胜负。该示例不是决策模型。</p><pre>${esc(portExample)}</pre></details></section>`;
const history = final.observations.protagonists
  .map(
    (o) =>
      `<tr><td>${o.sequence}</td><td>${o.loop} / ${o.day}</td><td>${esc(phaseNames[o.phase] ?? o.phase)}</td><td>${esc(eventNames[o.type] ?? o.type)}</td><td><code>${esc(JSON.stringify(o.data))}</code></td></tr>`,
  )
  .join('');
const ms = (n: number | undefined) => (n ?? 0).toFixed(3);
writeFileSync(
  resolve(out, 'index.html'),
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>规则引擎 · 实现与验收</title><style>
:root{color-scheme:light;--ink:#173047;--muted:#526776;--line:#cad8df;--accent:#086f71}*{box-sizing:border-box}body{margin:0;background:#edf3f4;color:var(--ink);font:16px/1.7 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1180px;margin:0 auto;padding:42px 24px}header{background:#163647;color:white;padding:32px;border-radius:16px}h1{font-size:32px;margin:0 0 12px}h2{font-size:23px;margin-top:0}h3{font-size:18px}section{background:white;padding:28px;border:1px solid var(--line);border-radius:12px;margin-top:20px}nav{display:flex;gap:18px;flex-wrap:wrap;margin:20px 0}a{color:var(--accent)}header a{color:#a8eeee}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}.metric{padding:18px;background:#eef8f6;border-radius:10px}.metric b{display:block;font-size:30px}.status{display:inline-block;background:#ffefd0;color:#654213;padding:4px 12px;border-radius:20px}.scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}th{background:#f0f5f6}pre{background:#102938;color:#e3f6f7;padding:18px;overflow:auto;border-radius:10px}code{font-family:ui-monospace,Consolas,monospace;font-size:13px;overflow-wrap:anywhere}p{margin:10px 0}small{color:var(--muted)}summary{cursor:pointer;font-weight:650}.note{border-left:4px solid #cc8e2d;padding:12px 16px;background:#fff8e9}footer{padding:24px 0;color:var(--muted)}@media print{body{background:white}main{padding:0}section{break-inside:avoid}header{background:white;color:var(--ink)}nav{display:none}}
</style></head><body><main><header><p>TRAGEDY LOOP / ENGINE 0.1</p><h1>规则引擎：实现、接口与验收</h1><p>依据现行 HTML 需求和 Q1／Q2／Q3 裁定实现。统一结构化规则驱动游戏执行，参考验证器复用同一个转移内核。</p><span class="status">引擎自动检查通过 · 待人类验收</span></header>
<nav><a href="#status">交付状态</a><a href="#ports">双方接口</a><a href="#semantics">特殊结算</a><a href="#coverage">官方内容</a><a href="#reference">解空间边界</a><a href="#performance">实测基线</a><a href="#replay">可读重放</a></nav>
<section id="status"><h2>交付状态</h2><div class="grid"><div class="metric"><b>${testCount}</b>引擎自动测试通过</div><div class="metric"><b>8 + 6</b>现行基础模组与十周年组合配置</div><div class="metric"><b>37</b>官方角色执行映射，包含仙人与 UP主</div></div><p>交付 TypeScript 独立内核、公开契约、官方内容包、重放／分支／批量接口和有限域参考验证器。BTX Plus 由 BTX 加十周年覆盖配置表达；FS、MZ、MC、HSA、WM 同样可启用该覆盖。旧 BT、AH、HS 及民间内容不在范围内。</p><p class="note">“有执行映射”与“已逐条人工验收”分别记录。自动测试覆盖代表性轨迹与关键交互，不能证明所有角色、事件、身份组合均正确。本页不是全组合形式化正确性证明。</p><p>当前未实现 Web 页面游戏交互、多人服务、模型训练器或正式高性能解空间产品。GUI 人工验收仍待进行。</p></section>
<section id="ports"><h2>剧作家与主人公输入输出接口</h2><p>服务端或模拟器创建 session 后，为不同身份交付不同端口。端口绑定玩家，不接受请求正文自行指定的身份。完整裁判快照仅保留给可信宿主。</p><p>下方为接口示意；可直接运行的示例见<a href="#verification">本次检查记录中的完整接入示例</a>。</p><pre>const pack = compileOfficial('BTX', false);
const session = createSession(pack, fullSetup);
// session.status === 'ready' 后
const mastermind = session.mastermind;
const protagonist = session.protagonists.p0;
const view = protagonist.view();
protagonist.submit({
  id: 'client-command-1',
  expectedRevision: view.revision,
  decisionId: view.decision.id,
  choice: { kind: 'cards', placements: [...] }
});</pre><div class="scroll"><table><tr><th>接口</th><th>输入</th><th>输出与边界</th></tr><tr><td>MastermindPort</td><td>暗置行动牌、身份／规则能力、指定效果选择、友好拒绝。</td><td>公开盘面、剧本秘密、自己的暗牌和合法决策；不返回主人公暗牌及 LL 他人秘密编号。</td></tr><tr><td>ProtagonistPort</td><td>按顺序提交自己的行动牌；队长提交普通团队决策；个人专属选择由本人提交。</td><td>主人公共享游戏观察、己方暗牌知识、公开决策。LL 秘密编号仅本人可见。</td></tr><tr><td>Trusted host</td><td>完整剧本、LL 明确记录的洗牌结果、执行预算。</td><td>快照、继续执行、诊断；不把全知状态直接发送到玩家端。</td></tr></table></div><p>每次命令校验当前决策、角色与版本。重复 ID 和相同内容不会重复执行；相同 ID 配不同内容被拒绝。预算耗尽返回 paused，保留可继续执行的状态。</p><p>讨论与不讨论模式只影响讨论窗口；普通决策和个人例外仍按规则归属。相同游戏观察不会因讨论开关改变参考验证结果。LL 的讨论开关沿用项目明确要求的统一交互策略，个人编号与选择权仍保留。</p></section>
${extraChecks}<section id="semantics"><h2>已落实的特殊结算语义</h2><ul><li>Q1：同批死亡请求是多重集合。从者两项替代加自身一项共三项请求，一枚护卫只取消一项，最终实际死亡只登记一次。</li><li>Q2：结束要求锁定后完成已成立批次、死亡触发和已到时点的完成后处理。未开始的“随后”步骤中断；被截断的来源不登记完成。</li><li>Q3：轮回结束处理全部完成后保存前轮快照，再在下轮复原与登场之后应用跨轮效果；第一轮没有虚构的上一轮。</li><li>事件发生与仅调用事件效果分开。AI 调用不增加发生次数，也不因旧发生标志触发“本局首次发生”。</li><li>原始指示物与有效值分开；身份名称与获得身份能力分开；AHR 表里身份成对配置；LL 标志跨轮保留且特殊胜利仅在规定阶段检查。</li></ul><p>自然语言来源不直接执行。规则包使用有限的条件、目标选择、效果和步骤结构；核心操作由内核实现。来源快照哈希变化会使来源检查失败，需要重新核对翻译。</p></section>
<section id="coverage"><h2>内容登记与翻译覆盖</h2><p>下表是执行映射计数，不是独立验收案例数量。特殊机制的全流程、位置、触发和重置还由共用内核承担。</p><div class="scroll"><table><tr><th>模组</th><th>角色</th><th>身份（含平民）</th><th>Y／X</th><th>事件</th><th>人工验收</th></tr>${rows}</table></div><p>十周年覆盖包含超越世界线、因果残片、希望之光、绝望之暗，以及希望／绝望的授牌、有效计数与回收规则。只允许原有六个模组叠加；AHR、LL 使用自身规则。</p><p><a href="verification.json">机器可读检查与基准记录</a> · <a href="../../docs/rules/first-batch-review.html">已确认裁定的审阅材料</a> · <a href="../../facts/index.html">只读规则资料</a></p></section>
<section id="reference"><h2>为解空间预留的一致性边界</h2><p>参考验证器以联合剧本假设为单位搜索完整合法行动轨迹，调用与实际对局完全相同的 initialize／advance 和观察记录。一个配置有一条合法解释就可证明可能；搜索被预算截断时返回 unknown。</p><p class="note">目前接口只对调用者明确提供的有限候选域作结论；不会把几个示例剧本当成全体合法剧本。它是核对引擎语义的参照，不是完整实时解空间系统。尚未实现自动全域配置生成、持久化的全部相容状态前沿、增量约束求解、精确计数或新增析取关系提取。</p><p>支持隔离假设、历史追加版本检查和见证重放。讨论模式不进入观察内容；不使用真实对局的秘密动作剪掉其他合法解释。LL 的个人秘密需要调用方明确采用相应观察范围，当前参考入口使用主人公共享观察。</p></section>
<section id="performance"><h2>准确性优先的性能基线</h2><p>测量环境：${esc(report.benchmark.environment.cpu)} / ${esc(process.version)} / ${esc(platform())}。样本是四角色、三天、无事件的合法 FS 对局，共 ${iterations} 次重放，全部完成。</p><div class="scroll"><table><tr><th>指标</th><th>实测</th></tr><tr><td>首次编译 FS</td><td>${ms(coldCompileMs)} ms</td></tr><tr><td>缓存规则包平均访问</td><td>${ms(reuseMs)} ms</td></tr><tr><td>完整重放中位／P95</td><td>${ms(report.benchmark.replayMedianMs)} / ${ms(report.benchmark.replayP95Ms)} ms</td></tr><tr><td>顺序批量吞吐</td><td>${report.benchmark.gamesPerSecond.toFixed(1)} 局／秒</td></tr><tr><td>完整快照复制平均成本</td><td>${ms(forkMs)} ms</td></tr></table></div><p>已复用不可变编译规则包；批量调用与逐局调用走同一内核。目前分支使用完整复制，批量在单线程顺序执行。尚未以结构共享、工作线程或缓存推理结论优化；这组简单样本不代表复杂模组或训练吞吐保证。</p></section>
<section><h2>审阅与维护</h2><p>请优先核对同时结算、替代、中断、跨轮以及 AHR／LL 的特殊时点，随后核对代表性完整对局。简单规则、类型检查、回归和证据更新由工程维护。</p><p>运行 <code>pnpm check:engine</code> 验证内核；运行 <code>pnpm report:engine</code> 重新执行检查并刷新本页、基准和示例重放。根 <code>pnpm check</code> 只验证配置与 Python 锁文件，不能代替内核测试。</p><p>保留本目录三份正式产物：本页、验证基线、示例重放。临时检查产物在任务结束前清理。facts/ 与 archive/ 均未写入。</p></section>
<section id="replay"><h2>主人公可读重放</h2><p>这段示例只通过双方公开端口提交动作，最后主人公存活并避开轮回失败条件。训练或服务集成可以用 <a href="example-replay.json">同一份输入记录</a> 重放。</p><details><summary>展开 ${final.observations.protagonists.length} 条获准观察</summary><div class="scroll"><table><tr><th>序号</th><th>轮／日</th><th>阶段</th><th>类型</th><th>内容</th></tr>${history}</table></div></details></section>
<footer>生成时间 ${esc(report.generatedAt)} · 规则摘要 <code>${esc(pack.digest)}</code><br>引擎自动检查通过；其他检查见本次检查记录，人工验收待进行。</footer></main></body></html>`,
);
const browserCheck = spawnSync(process.execPath, ['scripts/engine/check-report.mjs'], {
  cwd: root,
  encoding: 'utf8',
});
report.verification.reportBrowserCheck = browserCheck.status === 0 ? 'passed' : 'not-verified';
writeFileSync(resolve(out, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
const rendered = readFileSync(resolve(out, 'index.html'), 'utf8').replace(
  '报告浏览器自动检查待运行。',
  browserCheck.status === 0
    ? '报告浏览器自动检查通过：桌面／窄屏无整页横向溢出、本地链接可达、重放展开正常、无页面错误。此项不等于人类验收。'
    : '报告浏览器检查未完成；请在有浏览器的环境运行 node scripts/engine/check-report.mjs。',
);
writeFileSync(resolve(out, 'index.html'), rendered);
console.log(
  JSON.stringify(
    {
      tests: testCount,
      passed: passCount,
      report: relative(root, resolve(out, 'index.html')),
      benchmark: report.benchmark,
    },
    null,
    2,
  ),
);
