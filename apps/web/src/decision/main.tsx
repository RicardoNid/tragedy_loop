import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  DecisionAnalysis,
  PolicyNode,
  Scenario,
} from '../../../../packages/contracts/src/decision.js';
import { actor, phases, reasons, target } from './labels.js';
import { Board } from './Board.js';
import { Policy } from './Policy.js';
import { ImportDialog } from './ImportDialog.js';
import { Investigation } from './Investigation.js';
import type { InvestigationOptions } from '../../../../packages/contracts/src/investigation.js';
import './style.css';

type Source = { scenario: string } | { question: unknown; name: string };
type Mode = 'inspect' | 'solve' | 'verify' | 'investigate';
const number = (n: number) => n.toLocaleString('zh-CN');
function save(policy: PolicyNode) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(policy, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'tragedy-loop-policy.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const verdict = {
  guaranteed: '存在保证策略',
  'no-guaranteed-policy': '没有保证策略',
  unknown: '尚无法判定',
  'no-candidates': '没有相容候选',
};
const verification = {
  verified: '策略通过复核',
  counterexample: '发现反例',
  unknown: '复核尚无定论',
  'no-candidates': '没有相容候选',
};
function App() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [source, setSource] = useState<Source>({ scenario: 'game-policy' });
  const [data, setData] = useState<DecisionAnalysis>();
  const [policy, setPolicy] = useState<PolicyNode>();
  const [busy, setBusy] = useState<Mode>();
  const [error, setError] = useState('');
  const [budget, setBudget] = useState('');
  const [dialog, setDialog] = useState<'问题' | '策略'>();
  const [version, setVersion] = useState(0);
  const active = useRef<AbortController | null>(null);
  const scenario =
    'scenario' in source ? scenarios.find((s) => s.id === source.scenario) : undefined;
  async function run(
    mode: Mode,
    input = source,
    chosen = policy,
    limit = budget,
    investigation?: InvestigationOptions,
  ) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(mode);
    setError('');
    if (mode === 'solve') {
      setPolicy(undefined);
      setData((d) => d && { ...d, advice: undefined, verification: undefined });
    }
    if (mode === 'verify') setData((d) => d && { ...d, verification: undefined });
    if (mode === 'investigate') setData((d) => d && { ...d, investigation: undefined });
    try {
      if (limit && (!/^\d+$/.test(limit) || Number(limit) > 1000000))
        throw Error('正向预算需要是 0 至 1000000 的整数。');
      const body = {
        mode,
        ...('scenario' in input ? { scenario: input.scenario } : { question: input.question }),
        ...(limit && { workLimit: Number(limit) }),
        ...(mode === 'verify' && { policy: chosen }),
        ...(investigation && { investigation }),
      };
      const res = await fetch('/api/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const result = await res.json();
      if (!res.ok) throw Error(result.error ?? '局面请求失败');
      if (active.current !== controller) return;
      const next = result as DecisionAnalysis;
      setData((old) => ({ ...old, ...next }));
      if (mode === 'solve') {
        setPolicy(next.advice?.policy);
        setVersion((v) => v + 1);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '本地服务连接失败');
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(undefined);
      }
    }
  }
  function select(input: Source) {
    setSource(input);
    setData(undefined);
    setPolicy(undefined);
    setBudget('');
    setVersion((v) => v + 1);
    void run('inspect', input, undefined, '');
  }
  useEffect(() => {
    let mounted = true;
    fetch('/api/scenarios')
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((items: Scenario[]) => {
        if (mounted) {
          setScenarios(items);
          void run('inspect', { scenario: 'game-policy' }, undefined, '');
        }
      })
      .catch(() => {
        if (mounted) setError('示例读取失败，请刷新本页。');
      });
    return () => {
      mounted = false;
      active.current?.abort();
    };
  }, []);
  const view = data?.view;
  const goal = data?.goal;
  const goalName =
    goal?.kind === 'survival'
      ? '当日保护' + target(goal.target, view)
      : goal?.kind === 'seat-win'
        ? actor(goal.seat) + '个人获胜'
        : '主人公整局获胜';
  const checked = data?.verification;
  return (
    <>
      <header className="mast">
        <div className="mark" aria-hidden="true">
          回
        </div>
        <strong>惨剧轮回</strong>
        <span className="mast-divider" />
        <span>决策工作台</span>
        <span className="local">
          <i />
          本地运行
        </span>
      </header>
      <main>
        <aside>
          <h2>局面库</h2>
          <nav aria-label="示例局面">
            {scenarios.map((s) => (
              <button
                key={s.id}
                aria-current={scenario?.id === s.id ? 'true' : undefined}
                disabled={!!busy}
                onClick={() => select({ scenario: s.id })}
              >
                <b>{s.module}</b>
                <span>{s.title}</span>
              </button>
            ))}
          </nav>
          <button className="import-button" disabled={!!busy} onClick={() => setDialog('问题')}>
            ＋ 导入问题
          </button>
        </aside>
        <div className="workspace">
          <div className="title-row">
            <div>
              <p className="module">{data?.module ?? scenario?.module ?? '自定义局面'}</p>
              <h1>{scenario?.title ?? ('name' in source ? source.name : '学校的最后一张牌')}</h1>
            </div>
          </div>
          <p className="intro">{scenario?.description ?? '使用导入的候选范围与观察进行推演。'}</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {view && <Board view={view} sheet={data?.sheet} />}
          {data && view?.phase === 'protagonist-abilities' && view.menu.kind === 'ability' && (
            <Investigation
              data={data}
              busy={!!busy}
              submit={(options) => void run('investigate', source, undefined, budget, options)}
            />
          )}
          <section className="panel analysis">
            <div className="panel-heading">
              <h2>决策分析</h2>
              {goal && <span>{goalName}</span>}
            </div>
            {data && (
              <div className="metrics">
                <div>
                  <b>{number(data.worlds)}</b>
                  <span>相容世界</span>
                </div>
                <div>
                  <b>{data.exhaustive ? '完整' : '部分'}</b>
                  <span>给定范围覆盖</span>
                </div>
                {data.generatedSetups !== undefined && (
                  <div>
                    <b>{number(data.generatedSetups)}</b>
                    <span>生成剧本</span>
                  </div>
                )}
                {data.advice && (
                  <div>
                    <b>{number(data.advice.work)}</b>
                    <span>求解步数</span>
                  </div>
                )}
              </div>
            )}
            {data?.historyReason && <p>{reasons[data.historyReason] ?? data.historyReason}</p>}
            {!!data?.dayEndPruning?.excluded && (
              <details className="observations">
                <summary>日末静默排除 {number(data.dayEndPruning.excluded)} 条历史</summary>
                <ul>
                  {data.dayEndPruning.windows.map((w) => (
                    <li key={w.firstReport}>
                      第 {w.loop} 轮回第 {w.day} 天 · 观察 {w.firstReport} 至 {w.lastReport} · 排除{' '}
                      {w.branches} 条
                      <p>
                        排除示例　
                        {Object.entries(w.example.roles)
                          .map(([id, role]) => target(id, view) + '为' + role)
                          .join('、')}
                        （{w.example.ability}）
                      </p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {data?.scriptPruning && (
              <details className="observations">
                <summary>剧本剪枝依据（{data.scriptPruning.sources.length}）</summary>
                <p>
                  生成时跳过 {number(data.scriptPruning.skippedChoices)} 个取值，历史重放前排除{' '}
                  {number(data.scriptPruning.skippedSetups)} 个剧本。
                </p>
                <ul>
                  {data.scriptPruning.sources.map((f, i) => (
                    <li key={i}>
                      {f.report ? '观察 ' + f.report + ' · ' : ''}
                      {
                        {
                          culprit: '事件当事人公告',
                          'culprit-answers': '整组当事人回答',
                          'initial-answer': '最终决战身份裁定',
                          'personal-role': '本人 Ex',
                          'incident-outcome': f.occurred ? '事件宣告发生' : '事件宣告未发生',
                        }[f.kind]
                      }
                    </li>
                  ))}
                  {data.scriptPruning.incidentExamples?.map((e) => (
                    <li key={e.report + '/' + e.culprit}>
                      若当事人是{target(e.culprit, view)}，事件必然{e.predicted ? '发生' : '不发生'}
                      ，与观察 {e.report} 矛盾。
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="controls">
              <button
                className="primary"
                disabled={!!busy || !data}
                onClick={() => void run('solve')}
              >
                {busy === 'solve' ? '正在求解…' : '求解策略'}
              </button>
              <label>
                正向预算
                <input
                  aria-label="正向预算"
                  type="number"
                  min="0"
                  max="1000000"
                  placeholder="使用问题默认值"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
              </label>
            </div>
            <div role="status" aria-live="polite">
              {busy &&
                (busy === 'inspect'
                  ? '正在读取局面…'
                  : busy === 'verify'
                    ? '正在逐分支复核…'
                    : '正在推演候选…')}
            </div>
            {data?.advice && (
              <div className="verdict">
                <strong>{verdict[data.advice.status]}</strong>
                {data.advice.reason && <p>{reasons[data.advice.reason]}</p>}
              </div>
            )}
            {data?.advice?.policy && (
              <Policy key={version} policy={data.advice.policy} rootView={view} />
            )}
            <div className="tools">
              <button disabled={!!busy || !data} onClick={() => setDialog('策略')}>
                导入策略复核
              </button>
              {policy && (
                <>
                  <button disabled={!!busy} onClick={() => void run('verify')}>
                    独立复核
                  </button>
                  <button onClick={() => save(policy)}>下载策略</button>
                </>
              )}
            </div>
            {checked && (
              <div className="verdict" role="status">
                <strong>{verification[checked.status]}</strong>
                <p>
                  {number(checked.work)} 步 · {number(checked.winningLeaves)} 个已验证达标分支
                </p>
                {checked.reason && <p>{reasons[checked.reason] ?? checked.reason}</p>}
                {checked.counterexample && (
                  <details>
                    <summary>
                      查看反例 · 第 {checked.counterexample.at.loop} 轮回第{' '}
                      {checked.counterexample.at.day} 天 · {phases[checked.counterexample.at.phase]}
                    </summary>
                    <pre>{JSON.stringify(checked.counterexample, null, 2)}</pre>
                  </details>
                )}
              </div>
            )}
          </section>
        </div>
      </main>
      {dialog && (
        <ImportDialog
          kind={dialog}
          close={() => setDialog(undefined)}
          submit={(value, name) => {
            if (dialog === '问题') {
              setDialog(undefined);
              select({ question: value, name });
            } else {
              const raw = value as {
                advice?: { policy?: PolicyNode };
                policy?: PolicyNode;
              } & Partial<PolicyNode>;
              const chosen = raw.advice?.policy ?? raw.policy ?? raw;
              if (!chosen.choice || !Array.isArray(chosen.responses)) {
                setDialog(undefined);
                setError('文件中没有可复核的策略树。');
                return;
              }
              setDialog(undefined);
              setPolicy(chosen as PolicyNode);
              setVersion((v) => v + 1);
              setData((d) => d && { ...d, advice: undefined });
              void run('verify', source, chosen as PolicyNode);
            }
          }}
        />
      )}
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
