import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { resolve, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  completeObservationGroups,
  type GameSetup,
  type Observation,
} from '../../packages/contracts/src/game.js';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { advance, initializeDiscussion } from '../../packages/engine/src/runtime/engine.js';
import { LiveKnowledge } from '../../packages/engine/src/runtime/knowledge-live.js';
import { initialPlacementView } from '../../packages/engine/src/runtime/ports.js';
import { canonical } from '../../packages/engine/src/runtime/model.js';
import { choose, generator } from '../comprehensive/random-choices.js';
import { candidateKey, engineOracle, independentCandidates } from './solver1-oracle.js';

const directory = resolve(process.argv[3] ?? 'products/engine/solver1-oracle-20261123');
mkdirSync(directory, { recursive: true });
function save(name: string, value: unknown) {
  const path = resolve(directory, name);
  const temporary = path + '.writing-' + process.pid;
  writeFileSync(temporary, JSON.stringify(value, null, 2));
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(temporary, path);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '') || attempt === 9) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}
function sources() {
  const files: Record<string, string> = {};
  function walk(path: string) {
    for (const item of readdirSync(path, { withFileTypes: true })) {
      const full = resolve(path, item.name);
      if (item.isDirectory()) walk(full);
      else if (/\.(ts|json)$/.test(item.name))
        files[relative(process.cwd(), full)] = createHash('sha256')
          .update(readFileSync(full))
          .digest('hex');
    }
  }
  for (const path of [
    'packages/engine/src',
    'packages/content/src',
    'packages/contracts/src',
    'scripts/engine',
    'scripts/comprehensive',
    'tests/engine',
  ])
    walk(path);
  return { digest: createHash('sha256').update(canonical(files)).digest('hex'), files };
}
interface CaseResult {
  seed: number;
  module: string;
  status: 'running' | 'passed' | 'unknown' | 'different' | 'error';
  candidates: number;
  windows: number;
  exactWindows: number;
  comparisons: number;
  oracleUnknown: number;
  solverUnknown: number;
  expansions: number;
  possible: number;
  excluded: number;
  phases: string[];
  durationMs: number;
  evidence?: string;
  error?: string;
  digest: string;
  scope?: string;
  allowedPlots?: string[];
  budgets?: { jointMilliseconds: number; oracleExpansions: number; oracleMilliseconds: number };
}

async function runCase(seed: number) {
  const started = performance.now();
  const jointMilliseconds = Number(process.env.SOLVER1_ORACLE_JOINT_MS ?? 30000);
  const oracleExpansions = Number(process.env.SOLVER1_ORACLE_EXPANSIONS ?? 20000);
  const oracleMilliseconds = Number(process.env.SOLVER1_ORACLE_MS ?? 3000);
  assert.ok(
    [jointMilliseconds, oracleExpansions, oracleMilliseconds].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    ),
  );
  const draw = generator(seed);
  const module = (['FS', 'BTX', 'MC', 'MZ'] as const)[seed % 4]!;
  const officialPack = compileOfficial(module);
  let pack = officialPack;
  const compound = process.env.SOLVER1_ORACLE_SCOPE === 'four-characters';
  const roster = [
    '女学生',
    '男学生',
    '巫女',
    '住院患者',
    '大小姐',
    '从者',
    '医生',
    '军人',
    '偶像',
    '刑警',
  ];
  const count = compound
    ? 4
    : module === 'FS' || module === 'BTX'
      ? 2 + (Math.floor(seed / 4) % 2)
      : 3;
  const characters = [];
  for (let i = 0; i < count; i++) {
    const character = roster.splice(draw(roster.length), 1)[0]!;
    characters.push({
      id: 'c' + i,
      character,
      identity: '平民',
      initialArea: pack.characters[character]!.initial[0]!,
    });
  }
  const days = 1 + (Math.floor(seed / 8) % 2);
  const loops = 1 + (Math.floor(seed / 16) % 2);
  const events = ['医院事故', '自杀', '邪气污染', '谋杀事件'].filter(
    (name) => pack.incidents[name],
  );
  const event = module === 'MZ' ? '自杀' : events[draw(events.length)]!;
  // Public template contains only ordinary visible characters and schedule.
  const template = {
    module,
    anniversary: false,
    loops,
    days,
    captain: 'p0',
    characters: characters.map((c) => ({
      id: c.id,
      character: c.character,
      area: c.initialArea,
      status: 'alive',
    })),
    incidents: [{ day: days, name: event }],
  } as unknown as Parameters<typeof independentCandidates>[1];
  const stamp = sources();
  if (!existsSync(resolve(directory, `source-${stamp.digest}.json`)))
    save(`source-${stamp.digest}.json`, stamp);
  const row: CaseResult = {
    seed,
    module,
    status: 'running',
    candidates: 0,
    windows: 0,
    exactWindows: 0,
    comparisons: 0,
    oracleUnknown: 0,
    solverUnknown: 0,
    expansions: 0,
    possible: 0,
    excluded: 0,
    phases: [],
    durationMs: 0,
    digest: stamp.digest,
    scope: compound ? 'four-characters-selected-plots' : 'small-roster-full-module',
    budgets: { jointMilliseconds, oracleExpansions, oracleMilliseconds },
  };
  const write = () => {
    row.durationMs = Math.round(performance.now() - started);
    save(`case-${seed}.json`, row);
  };
  write();
  try {
    let candidates: GameSetup[] = [];
    for (let attempt = 0; attempt < (compound ? 8 : 1); attempt++) {
      if (compound) {
        const ys = Object.values(officialPack.plots).filter((plot) => plot.type === 'Y');
        const xs = Object.values(officialPack.plots).filter((plot) => plot.type === 'X');
        const chosen = [ys[draw(ys.length)]!];
        for (let i = 0; i < officialPack.setupRules.xSlots; i++)
          chosen.push(xs.splice(draw(xs.length), 1)[0]!);
        pack = {
          ...officialPack,
          plots: Object.fromEntries(chosen.map((plot) => [plot.name, plot])),
        };
        row.allowedPlots = Object.keys(pack.plots);
      }
      candidates = independentCandidates(pack, template);
      if (candidates.length) break;
    }
    row.candidates = candidates.length;
    if (!candidates.length) {
      row.status = 'unknown';
      row.error = '本次公开角色组合没有合法剧本。';
      write();
      return;
    }
    const setup = candidates[draw(candidates.length)]!;
    const initialized = initializeDiscussion(pack, setup, 10000);
    assert.ok(initialized.state, JSON.stringify(initialized.diagnostics));
    let state = initialized.state;
    const opening = initialPlacementView(state);
    const local = new LiveKnowledge(pack, opening, 1000000);
    const exact = new LiveKnowledge(pack, opening, 1000000);
    const batched = new LiveKnowledge(pack, opening, 1000000);
    const trace: { actor: string; choice: unknown }[] = [];
    const eliminated = new Set<string>();
    let offset = 0;
    const phases = new Set<string>();
    let interrupted = false;
    const evidenceName = `evidence-${seed}.json`;
    function failure(
      kind: string,
      candidate: GameSetup | undefined,
      history: Observation[],
      details: unknown,
    ) {
      row.status = 'different';
      row.evidence = evidenceName;
      save(evidenceName, {
        kind,
        seed,
        digest: stamp.digest,
        allowedPlots: row.allowedPlots,
        setup,
        opening,
        candidate,
        window: {
          loop: history.at(-1)?.loop ?? 1,
          day: history.at(-1)?.day ?? 1,
          phase: history.at(-1)?.phase ?? 'discussion',
          through: history.length,
        },
        history,
        actualTrace: trace,
        details,
      });
      write();
      throw new Error('DIFFERENCE ' + kind);
    }
    for (let step = 0; step < 180; step++) {
      const deliveries = completeObservationGroups(state.observations.protagonists.slice(offset));
      if (step === 0) deliveries.unshift([]);
      for (const incoming of deliveries) {
        const through = incoming.at(-1)?.sequence ?? offset;
        const history = state.observations.protagonists.slice(0, through);
        for (const observation of incoming) {
          local.append([observation], observation.sequence - 1, observation.sequence);
          exact.append([observation], observation.sequence - 1, observation.sequence);
        }
        batched.update(history, history.length);
        offset = history.length;
        {
          row.windows++;
          phases.add(history.at(-1)?.phase ?? 'discussion');
          row.phases = [...phases];
          save(`current-${seed}.json`, { setup, opening, history, trace, phase: state.phase });
          const expected = new Set<string>();
          const verdicts = new Map<string, ReturnType<typeof engineOracle>>();
          for (const candidate of candidates) {
            const key = candidateKey(candidate);
            if (eliminated.has(key)) continue;
            const answer = engineOracle(
              pack,
              candidate,
              history,
              oracleExpansions,
              oracleMilliseconds,
            );
            row.expansions += answer.expansions;
            verdicts.set(key, answer);
            if (answer.verdict === 'unknown') row.oracleUnknown++;
            else if (answer.verdict === 'excluded') {
              eliminated.add(key);
              row.excluded++;
            } else {
              expected.add(key);
              row.possible++;
            }
          }
          const snapshot = local.snapshot();
          for (const candidate of candidates) {
            const key = candidateKey(candidate);
            const answer = verdicts.get(key);
            if (answer?.verdict !== 'possible') continue;
            for (const character of candidate.characters)
              if (!snapshot.identities[character.id]?.includes(character.identity))
                failure('实时身份投影误删', candidate, history, { answer, snapshot });
            for (const plot of [candidate.y, ...candidate.x])
              if (!snapshot.rules.includes(plot))
                failure('实时规则投影误删', candidate, history, { answer, snapshot });
            for (const incident of candidate.incidents)
              if (!snapshot.culprits[String(incident.day)]?.includes(incident.culprit))
                failure('实时犯人投影误删', candidate, history, { answer, snapshot });
          }
          exact.verifyCombinations();
          batched.verifyCombinations();
          const until = performance.now() + jointMilliseconds;
          while ((!exact.paused || !batched.paused) && performance.now() < until) {
            if (!exact.paused) exact.tick(10, 1000000);
            if (!batched.paused) batched.tick(10, 1000000);
          }
          const solutions = exact.jointSolutions();
          const batchSolutions = batched.jointSolutions();
          const actual = solutions && new Set(solutions.map(candidateKey));
          if (
            actual &&
            batchSolutions &&
            canonical([...actual].sort()) !==
              canonical([...new Set(batchSolutions.map(candidateKey))].sort())
          )
            failure('逐条追加与整段输入的联合解集不同', undefined, history, {
              actual: [...actual],
              batched: batchSolutions.map(candidateKey),
            });
          if (actual)
            for (const solution of solutions!)
              if (
                !candidates.some((candidate) => candidateKey(candidate) === candidateKey(solution))
              )
                failure('联合解含独立开局域之外的候选', solution, history, { actual: [...actual] });
          let complete = true;
          for (const candidate of candidates) {
            const key = candidateKey(candidate);
            const answer = verdicts.get(key) ?? { verdict: 'excluded' as const, expansions: 0 };
            if (answer.verdict === 'unknown') {
              complete = false;
              continue;
            }
            const verdict = actual
              ? actual.has(key)
                ? 'possible'
                : 'excluded'
              : exact.queryConfiguration(candidate);
            if (verdict === 'unknown') {
              row.solverUnknown++;
              complete = false;
              continue;
            }
            row.comparisons++;
            if (verdict !== answer.verdict)
              failure('引擎路径与求解器联合候选不同', candidate, history, {
                oracle: answer,
                solver: verdict,
                snapshot: exact.snapshot(),
              });
          }
          if (complete && actual && batchSolutions) {
            assert.equal(actual.size, expected.size);
            row.exactWindows++;
          } else {
            interrupted = true;
            appendFileSync(
              resolve(directory, `unresolved-${seed}.jsonl`),
              JSON.stringify({
                recordedAt: new Date().toISOString(),
                digest: stamp.digest,
                budgets: row.budgets,
                through: history.length,
                phase: history.at(-1)?.phase,
                expected: expected.size,
                exact: exact.snapshot(),
                batched: batched.snapshot(),
                unresolvedCandidates: [...verdicts]
                  .filter(([, answer]) => answer.verdict === 'unknown')
                  .map(([key]) => key),
              }) + '\n',
            );
          }
          write();
        }
      }
      if (state.winner || state.pending?.kind === 'guess') break;
      assert.ok(state.pending, '引擎停在无决策的非终局状态');
      const actor = state.pending.actor;
      const ordinary = state.pending.options.filter(
        (option) => option.kind !== 'request-final-guess' && option.kind !== 'vote-final-guess',
      );
      const choice =
        state.pending.kind === 'cards'
          ? choose(state, draw)
          : (ordinary.find((option) => option.kind === 'continue') ??
            ordinary[draw(ordinary.length)]!);
      const next = advance(
        pack,
        state,
        actor,
        {
          id: `campaign-${step}`,
          expectedRevision: state.revision,
          decisionId: state.pending.id,
          choice,
        },
        10000,
      );
      assert.equal(next.status, 'ok');
      state = next.state;
      trace.push({ actor, choice });
      if (step === 179) interrupted = true;
    }
    row.status = interrupted ? 'unknown' : 'passed';
    write();
  } catch (error) {
    if (row.status !== 'different') row.status = 'error';
    row.error = String(error instanceof Error ? error.stack : error);
    write();
  }
  console.log(JSON.stringify(row));
}

function report(deadline: string, started: string, status: string) {
  const cases = readdirSync(directory)
    .filter((name) => /^case-\d+\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(resolve(directory, name), 'utf8')) as CaseResult);
  const totals = {
    cases: cases.length,
    passed: 0,
    unknown: 0,
    different: 0,
    error: 0,
    running: 0,
    windows: 0,
    exactWindows: 0,
    comparisons: 0,
    expansions: 0,
    oracleUnknown: 0,
    solverUnknown: 0,
  };
  for (const row of cases) {
    totals[row.status]++;
    for (const key of [
      'windows',
      'exactWindows',
      'comparisons',
      'expansions',
      'oracleUnknown',
      'solverUnknown',
    ] as const)
      totals[key] += row[key];
  }
  const noLegalSetup = cases.filter((row) => row.error === '本次公开角色组合没有合法剧本。').length;
  const summary = {
    started,
    deadline,
    updated: new Date().toISOString(),
    status,
    totals,
    noLegalSetup,
    cases,
  };
  save('summary.json', summary);
  const escape = (value: unknown) =>
    String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const labels = {
    passed: '通过',
    unknown: '未决',
    different: '发现差异',
    error: '执行异常',
    running: '运行中',
  };
  const rows = cases
    .map(
      (row) => `<tr><td><a href="case-${row.seed}.json">${row.seed}</a></td><td>${row.module}</td>
    <td>${row.error === '本次公开角色组合没有合法剧本。' ? '无合法剧本' : labels[row.status]}</td>
    <td>${row.candidates}</td><td>${row.exactWindows}/${row.windows}</td><td>${row.comparisons}</td>
    <td>${row.oracleUnknown}/${row.solverUnknown}</td><td>${row.evidence ? `<a href="${row.evidence}">首次差异</a>` : escape(row.error?.split('\n')[0] ?? '')}</td></tr>`,
    )
    .join('');
  const compound = cases.some((row) => row.scope === 'four-characters-selected-plots');
  const scope = compound
    ? '每例使用 4 名普通角色，并限定为记录中的主副线集合。完整枚举该范围内的身份分配和事件犯人。每个种子的 allowedPlots 字段记录限制。'
    : '每例使用 2–3 名普通角色，枚举相应模组全部主副线组合、身份分配和事件犯人。';
  const localTime = (time: string) =>
    new Date(time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const companionPath = resolve(directory, 'compound/summary.json');
  let companion = '';
  if (existsSync(companionPath)) {
    const extra = JSON.parse(readFileSync(companionPath, 'utf8')) as {
      totals: typeof totals;
      cases: CaseResult[];
    };
    const empty = extra.cases.filter(
      (row) => row.error === '本次公开角色组合没有合法剧本。',
    ).length;
    companion = `<h2>两组测试汇总</h2><table><thead><tr><th>范围</th><th>通过样本</th><th>未决样本</th><th>无合法配置</th><th>差异</th><th>完整解集检查点</th><th>候选比较</th></tr></thead><tbody>
      <tr><td>2–3 人，完整模组候选</td><td>${totals.passed}</td><td>${totals.unknown - noLegalSetup}</td><td>${noLegalSetup}</td><td>${totals.different}</td><td>${totals.exactWindows}</td><td>${totals.comparisons}</td></tr>
      <tr><td><a href="compound/report.html">4 人，限定主副线</a></td><td>${extra.totals.passed}</td><td>${extra.totals.unknown - empty}</td><td>${empty}</td><td>${extra.totals.different}</td><td>${extra.totals.exactWindows}</td><td>${extra.totals.comparisons}</td></tr>
      </tbody></table><p>下方逐项列表展示 2–3 人测试，四人测试可通过表中链接查看。两组的候选范围分别列明。</p>`;
  }
  const verificationPath = resolve(directory, 'verification.json');
  let verification = '';
  if (existsSync(verificationPath)) {
    const details = JSON.parse(readFileSync(verificationPath, 'utf8')) as {
      started: string;
      ended: string;
      checks: { name: string; passed: number; failed: number; skipped: number }[];
      notes: string[];
    };
    verification = `<p>整体测试时段为北京时间 ${localTime(details.started)} 至 ${localTime(details.ended)}。</p>
      <h2>回归与复核</h2><ul>${details.checks.map((check) => `<li>${escape(check.name)}，通过 ${check.passed}，失败 ${check.failed}，跳过 ${check.skipped}。</li>`).join('')}</ul>
      ${details.notes.map((note) => `<p>${escape(note)}</p>`).join('')}<p><a href="verification.json">验证记录</a></p>`;
  }
  writeFileSync(
    resolve(directory, 'report.html'),
    `<!doctype html>
<html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>求解器1引擎参照测试</title>
<style>body{font:16px system-ui;max-width:1400px;margin:40px auto;padding:0 24px;color:#18252e}
table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left}
td:last-child{max-width:400px;overflow-wrap:anywhere}.table{overflow-x:auto}p{line-height:1.7}</style>
<h1>求解器1引擎参照测试${compound ? ' · 四人复合局面' : ''}</h1>
${companion}${verification}
<p>北京时间 ${localTime(started)} 开始，${localTime(deadline)} 截止。${status === 'complete' ? '测试已结束' : '测试运行中'}。</p>
<p>可信参照为规则引擎。独立笛卡尔积枚举剧本，依引擎制作校验筛选。每个候选从公开开局搜索与公告相容的合法路径，预算或时间截断记为未决。</p>
<p>范围为 FS、BTX、MC、MZ，1–2 天、1–2 轮，一个事件，无周年追加。${scope}其他角色、模组和规模属于未覆盖范围。</p>
<p>每个完整公告组都是一个检查点，包含同一阶段中的多个检查点。核对联合候选与实时投影，并比较逐条追加和整段输入。通过要求每个已检查点的两种输入方式均返回完整联合解集，且与引擎参照一致。</p>
<p>通过 ${totals.passed} 个样本，发现差异 ${totals.different} 个，未决 ${totals.unknown - noLegalSetup} 个，执行异常 ${totals.error} 个。另有 ${noLegalSetup} 个抽样角色或规则组合无法构成合法剧本，未进入求解测试。</p>
<p>完整联合解集检查点 ${totals.exactWindows.toLocaleString()} / ${totals.windows.toLocaleString()}，候选判断比较 ${totals.comparisons.toLocaleString()} 次，引擎路径展开 ${totals.expansions.toLocaleString()} 次。种子之间可能重复部分开局和候选。</p>
<div class="table"><table><thead><tr><th>种子及记录</th><th>模组</th><th>结果</th><th>候选</th><th>精确/检查点</th><th>候选比较</th><th>引擎/求解器单候选未决</th><th>证据或异常</th></tr></thead><tbody>${rows}</tbody></table></div></html>`,
  );
  return summary;
}

async function campaign() {
  const manifestPath = resolve(directory, 'campaign.json');
  const manifest = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as { started: string; deadline: string })
    : {
        started: new Date().toISOString(),
        deadline: process.argv[4] ?? new Date(Date.now() + 8 * 3600000).toISOString(),
      };
  save('campaign.json', manifest);
  let seed = 202611230;
  const script = fileURLToPath(import.meta.url);
  while (Date.now() < Date.parse(manifest.deadline)) {
    while (existsSync(resolve(directory, `case-${seed}.json`))) seed++;
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', script, 'case', directory, String(seed)],
      { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const timeoutMs = Math.min(10 * 60000, Date.parse(manifest.deadline) - Date.now());
    let tail = '';
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk) => {
        tail = (tail + String(chunk)).slice(-12000);
      });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    const exit = await new Promise<number | null>((resolveExit) => child.on('exit', resolveExit));
    clearTimeout(timer);
    const path = resolve(directory, `case-${seed}.json`);
    if (existsSync(path)) {
      const row = JSON.parse(readFileSync(path, 'utf8')) as CaseResult;
      if (row.status === 'running') {
        row.status = 'unknown';
        row.error = '工作进程到达 10 分钟或总截止时间，未完成部分保持未决。';
        save(`case-${seed}.json`, row);
      }
    } else
      appendFileSync(
        resolve(directory, 'worker-errors.jsonl'),
        JSON.stringify({ seed, exit, tail }) + '\n',
      );
    const summary = report(manifest.deadline, manifest.started, 'running');
    console.log(JSON.stringify({ seed, exit, totals: summary.totals, updated: summary.updated }));
    seed++;
  }
  console.log(JSON.stringify(report(manifest.deadline, manifest.started, 'complete').totals));
}

if (process.argv[2] === 'case') await runCase(Number(process.argv[4]));
else if (process.argv[2] === 'run') await campaign();
else if (process.argv[2] === 'report') {
  const manifest = JSON.parse(readFileSync(resolve(directory, 'campaign.json'), 'utf8'));
  console.log(
    JSON.stringify(
      report(
        manifest.deadline,
        manifest.started,
        Date.now() >= Date.parse(manifest.deadline) ? 'complete' : 'running',
      ).totals,
    ),
  );
} else throw Error('Usage: solver1-oracle-campaign.ts run|case|report [directory] [deadline|seed]');
