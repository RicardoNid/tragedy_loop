import { awaitingFirstPlacement, completeObservationGroups } from '../../../packages/contracts/src/game';
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Choice, GameSetup, PlayerView, Actor } from '../../../packages/contracts/src/game.js';
import type { MastermindReviewView } from '../../../packages/contracts/src/review';
import { ScriptBoard } from './ScriptBoard';
import { api } from './api';
import { Knowledge } from './Knowledge';
import { recordEngine, recordSolver, exportLog } from './review-log';
import { choiceLabel, label, name, readable } from './labels';
import './style.css';

function Actions({
  view,
  submit,
  disabled,
}: {
  view: PlayerView;
  submit: (choice: Choice) => void;
  disabled: boolean;
}) {
  const d = view.decision;
  const [placements, setPlacements] = useState<Record<number, { card: string; target: string }>>(
    {},
  );
  const [target, setTarget] = useState('');
  const [identity, setIdentity] = useState(''),
    [reverseIdentity, setReverseIdentity] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  if (!d)
    return (
      <p className="muted">
        {view.winner
          ? '本局已结束，可查看记录或重新开始。'
          : '此席位当前无需操作，请切换到当前操作方。'}
      </p>
    );
  const menu = d.cardPlacement;
  const selected = Array.from(
    { length: menu?.count ?? 0 },
    (_, i) => placements[i] ?? { card: menu?.cards[i] ?? '', target: menu?.targets[i] ?? '' },
  );
  const valid =
    selected.every((p) => p.card && p.target) &&
    new Set(selected.map((p) => p.card)).size === selected.length &&
    new Set(selected.map((p) => p.target)).size === selected.length;
  return (
    <fieldset disabled={disabled}>
      {menu && (
        <div className="card-choices">
          <p>请选择 {menu.count} 张行动牌及各自目标。</p>
          {selected.map((p, i) => (
            <div className="action-form" key={i}>
              <label>
                行动牌{menu.count > 1 ? ` ${i + 1}` : ''}
                <select
                  value={p.card}
                  onChange={(e) =>
                    setPlacements({ ...placements, [i]: { ...p, card: e.target.value } })
                  }
                >
                  {menu.cards.map((id) => (
                    <option key={id} value={id}>
                      {label(view.hands[d.actor]?.find((c) => c.id === id)?.kind ?? id)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                目标{menu.count > 1 ? ` ${i + 1}` : ''}
                <select
                  value={p.target}
                  onChange={(e) =>
                    setPlacements({ ...placements, [i]: { ...p, target: e.target.value } })
                  }
                >
                  {menu.targets.map((t) => (
                    <option key={t} value={t}>
                      {name(t, view)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
          {!valid && <p>请为每一行选择不同的行动牌和目标。</p>}
          <button
            className="primary"
            disabled={!valid}
            onClick={() => submit({ kind: 'cards', placements: selected })}
          >
            {menu.count > 1 ? '提交剧作家行动牌' : '盖放行动牌'}
          </button>
        </div>
      )}
      <div className="choices">
        {d.options.map((c, i) => (
          <button key={i} onClick={() => submit(c)}>
            {choiceLabel(c, view)}
          </button>
        ))}
      </div>
      {d.kind === 'guess' && d.answerKind !== 'culprits' && (
        <div className="action-form">
          <label>
            角色
            <select
              value={target || view.characters[0]?.id || ''}
              onChange={(e) => setTarget(e.target.value)}
            >
              {view.characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.character}
                </option>
              ))}
            </select>
          </label>
          <label>
            身份
            <input
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
              placeholder="填写身份名称"
            />
          </label>
          {view.module === 'AHR' && (
            <label>
              反面身份
              <input value={reverseIdentity} onChange={(e) => setReverseIdentity(e.target.value)} />
            </label>
          )}
          <button
            disabled={!identity.trim()}
            onClick={() =>
              submit({
                kind: 'guess',
                character: target || view.characters[0]!.id,
                identity: identity.trim(),
                ...(reverseIdentity.trim() ? { reverseIdentity: reverseIdentity.trim() } : {}),
              })
            }
          >
            提交回答
          </button>
        </div>
      )}
      {d.kind === 'guess' && d.answerKind === 'culprits' && (
        <div>
          {view.incidents.map((event, i) => (
            <label key={i}>
              第 {event.day} 日 · {event.name}
              <select
                value={answers[String(event.day)] ?? ''}
                onChange={(e) => setAnswers({ ...answers, [String(event.day)]: e.target.value })}
              >
                <option value="">选择犯人</option>
                {view.characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.character}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button onClick={() => submit({ kind: 'guess-culprits', answers })}>提交犯人回答</button>
        </div>
      )}
    </fieldset>
  );
}

function App() {
  const [id, setId] = useState(''),
    [seat, setSeat] = useState<Actor>('p0');
  const [view, setView] = useState<PlayerView>(),
    [history, setHistory] = useState<PlayerView[]>([]),
    [at, setAt] = useState(-1);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [script, setScript] = useState(''),
    [notes, setNotes] = useState('');
  const [setup, setSetup] = useState<GameSetup>();
  const [turn, setTurn] = useState<Awaited<ReturnType<typeof api.turn>>>();
  const [profile, setProfile] = useState<'FS' | 'BTX'>('FS');
  const seatHistory = useRef<Partial<Record<Actor, PlayerView[]>>>({});
  // Revisions are observer-specific. Keep the matching public projection for
  // each snapshot, including mastermind history, without feeding secrets to Knowledge.
  const publicViews = useRef(new WeakMap<PlayerView, PlayerView>());
  const importer = useRef<HTMLDetailsElement>(null);
  const [logError, setLogError] = useState('');
  async function saveTrace(gameId: string) {
    try {
      await recordEngine(gameId, await api.engineTrace(gameId));
      await recordSolver(gameId, await api.knowledge(gameId));
      setLogError('');
    } catch (e) { setLogError('诊断记录写入失败：' + String(e)); }
  }
  const shown = at >= 0 ? history[at] : view;
  const masterBoard =
    seat === 'mastermind' && shown && 'secret' in shown
      ? (shown as MastermindReviewView)
      : undefined;
  const identities = new Map(masterBoard?.secret.roster.map((c) => [c.id, c.identity]));
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function accept(v: PlayerView) {
    await saveTrace(id);
    publicViews.current.set(v, 'secret' in v ? await api.view(id, 'p0') : v);
    setTurn(await api.turn(id));
    setView(v);
    setHistory((h) => {
      const next = [...h, v];
      seatHistory.current[seat] = next;
      return next;
    });
    setAt(-1);
  }
  async function start(custom?: GameSetup, selectedProfile: 'FS' | 'BTX' = 'FS') {
    const result = await api.create(custom, selectedProfile);
    await saveTrace(result.id);
    setProfile(selectedProfile);
    setId(result.id);
    setTurn(await api.turn(result.id));
    setSeat('p0');
    setSetup(custom);
    publicViews.current = new WeakMap([[result.view, result.view]]);
    setView(result.view);
    seatHistory.current = { p0: [result.view] };
    setHistory([result.view]);
    setAt(-1);
    setNotes('');
    setScript('');
    if (importer.current) importer.current.open = false;
  }
  function submit(choice: Choice) {
    if (!view?.decision) return;
    void run(async () =>
      accept(
        await api.submit(id, seat, {
          id: crypto.randomUUID(),
          expectedRevision: view.revision,
          decisionId: view.decision!.id,
          choice,
        }),
      ),
    );
  }
  async function switchSeat(s: Actor) {
    const v = await api.view(id, s);
    publicViews.current.set(v, s === 'mastermind' ? await api.view(id, 'p0') : v);
    setTurn(await api.turn(id));
    setSeat(s);
    setView(v);
    const snapshots = [...(seatHistory.current[s] ?? []), v];
    seatHistory.current[s] = snapshots;
    setHistory(snapshots);
    setAt(-1);
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              seat,
              histories: Object.fromEntries(
                Object.entries(seatHistory.current).filter(([s]) =>
                  seat === 'mastermind' ? s === 'mastermind' : s !== 'mastermind',
                ),
              ),
              notes,
            },
            null,
            2,
          ),
        ],
        {
          type: 'application/json',
        },
      ),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = seat === 'mastermind' ? '剧作家审阅记录.json' : '主人公审阅记录.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <header>
        <div>
          <span className="eyebrow">TRAGEDY LOOP</span>
          <h1>
            惨剧轮回 <span>盘面审阅</span>
          </h1>
        </div>
        <span className="badge">待人类验收</span>
      </header>
      <main>
        <section className="toolbar">
          <div className="bar">
            <button className="primary" disabled={busy} onClick={() => void run(() => start())}>
              新建 FS 测试对局
            </button>
            <button disabled={busy} onClick={() => void run(() => start(undefined, 'BTX'))}>
              新建 BTX 测试对局
            </button>
            {view && (
              <>
                <button disabled={busy} onClick={() => void run(() => start(setup, profile))}>
                  重新开始
                </button>
                <button onClick={download}>导出审阅记录</button>
              </>
            )}
            {(!view || seat === 'mastermind') && (
              <button disabled={busy} onClick={() => void run(() => exportLog(id || undefined))}>
                {view ? '导出完整诊断（含剧透）' : '导出最近诊断（含剧透）'}
              </button>
            )}
          </div>
          <details ref={importer}>
            <summary>导入测试剧本</summary>
            <p className="muted">使用当前规则内核的 GameSetup JSON。导入后从初始盘面开始。</p>
            <label className="file-input">
              从 JSON 文件读取
              <input
                type="file"
                accept=".json,application/json"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file)
                    void run(async () => {
                      if (file.size > 128 * 1024) throw new Error('剧本文件过大。');
                      setScript(await file.text());
                    });
                }}
              />
            </label>
            <textarea
              aria-label="剧本 JSON"
              value={script}
              onChange={(e) => setScript(e.target.value)}
            />
            <button
              disabled={busy || !script.trim()}
              onClick={() => void run(() => start(JSON.parse(script)))}
            >
              校验并开局
            </button>
          </details>
        </section>
        <p className="notice" role="status">
          {error || logError || (busy ? '正在更新盘面…' : '')}
        </p>
        {!shown ? (
          <section className="empty">
            <h2>准备好审阅一局游戏</h2>
            <p>新建测试对局后，按当前操作方提示切换剧作家或主人公席位，完成整局游戏。</p>
          </section>
        ) : (
          <>
            <section className="clock">
              <div>
                <span className="eyebrow">
                  {shown.module} · 第 {shown.loop} / {shown.loops} 轮
                </span>
                <h2>
                  第 {shown.day} / {shown.days} 日 <span>／ {label(shown.phase)}</span>
                </h2>
              </div>
              <div className="bar">
                <span className="badge">队长 · {label(shown.captain)}</span>
                <span>{shown.discussionAllowed ? '可以讨论' : '本阶段不可讨论'}</span>
              </div>
            </section>
            <div className="game-workspace">
              <section className="panel turn-panel" aria-label="对局操作">
                <h2>
                  当前操作方：
                  {turn?.actor ? label(turn.actor) : turn?.finished ? '对局结束' : '等待结算'}
                </h2>
                <p>
                  当前查看：{label(seat)} · {label(shown.phase)}
                  {at >= 0 ? ' · 正在回看历史，暂不可操作' : ''}
                </p>
                {turn?.actor && turn.actor !== seat && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void run(() => switchSeat(turn.actor!))}
                  >
                    切换到{label(turn.actor)}操作
                  </button>
                )}
                {seat === 'mastermind' && (
                  <p className="muted">剧作家视角包含非公开信息；交给主人公前请切换席位。</p>
                )}
                <Actions
                  key={`${seat}-${shown.decision?.id}-${at}`}
                  view={shown}
                  submit={submit}
                  disabled={busy || at >= 0}
                />
              </section>
              <Knowledge
                key={id}
                id={id}
                shown={publicViews.current.get(shown)!}
                liveRevision={publicViews.current.get(view!)!.revision}
              />
              {shown.winner && (
                <div className="result" role="status">
                  {(shown.winners?.length ? shown.winners : [shown.winner]).map(label).join('、')}
                  获胜 · 对局结束
                </div>
              )}
              <div className="layout">
                <section className="panel">
                  <div className="section-heading">
                    <h2>游戏盘面</h2>
                    <span className="muted">
                      {seat === 'mastermind' ? '剧作家视角' : '主人公可见信息'}
                    </span>
                  </div>
                  <div className="seats" role="group" aria-label="盘面视角">
                    {(['mastermind', 'p0', 'p1', 'p2'] as Actor[]).map((s) => (
                      <button
                        className={seat === s ? 'active' : ''}
                        aria-pressed={seat === s}
                        disabled={busy}
                        key={s}
                        onClick={() => void run(() => switchSeat(s))}
                      >
                        {label(s)}
                      </button>
                    ))}
                  </div>
                  {shown.ex !== undefined && <p>EX · {shown.ex}</p>}
                  {awaitingFirstPlacement(shown) && !masterBoard && (
                    <p className="muted">第一轮讨论结束、轮回开始时放置首批角色。后续角色在各自的登场时点公开。</p>
                  )}
                  {!!shown.publicSpecialRules?.length && (
                    <section aria-label="公开特殊规则">
                      <h3>公开特殊规则</h3>
                      <ul>
                        {shown.publicSpecialRules.map((rule, i) => (
                          <li key={i}>{rule}</li>
                        ))}
                      </ul>
                    </section>
                  )}
                  <div className="board">
                    {[
                      'hospital',
                      'shrine',
                      'city',
                      'school',
                      ...(shown.characters.some((c) => c.area === 'far') ? ['far'] : []),
                    ].map((area) => (
                      <section className={`location ${area}`} key={area}>
                        <div className="section-heading">
                          <h3>
                            {label(area)}
                            {shown.territory === area && ' · 大人物领地'}
                          </h3>
                          {area !== 'far' && (
                            <span className="counter intrigue">
                              密谋 {shown.boards[area as keyof typeof shown.boards]}
                            </span>
                          )}
                        </div>
                        {shown.placements
                          .filter((p) => p.target === area)
                          .map((p, i) => (
                            <p className="placed" key={i}>
                              {label(p.owner)} · {p.kind ? label(p.kind) : '暗置牌'}
                            </p>
                          ))}
                        <div className="characters">
                          {shown.characters
                            .filter(
                              (c) => c.area === area && !(masterBoard && c.status === 'absent'),
                            )
                            .map((c) => (
                              <article className={`character ${c.status}`} key={c.id}>
                                <div className="section-heading">
                                  <strong>{c.character}</strong>
                                  <small>{label(c.status)}</small>
                                </div>
                                {masterBoard && (
                                  <p className="board-identity">身份 · {identities.get(c.id)}</p>
                                )}
                                <div className="counters">
                                  {Object.entries(c.counters)
                                    .filter(
                                      ([k, n]) =>
                                        ['goodwill', 'paranoia', 'intrigue'].includes(k) || n > 0,
                                    )
                                    .map(([k, n]) => (
                                      <span className={`counter ${k}`} key={k}>
                                        {label(k)} {n}
                                      </span>
                                    ))}
                                </div>
                                {shown.placements
                                  .filter((p) => p.target === c.id)
                                  .map((p, i) => (
                                    <p className="placed" key={i}>
                                      {label(p.owner)} · {p.kind ? label(p.kind) : '暗置牌'}
                                    </p>
                                  ))}
                              </article>
                            ))}
                        </div>
                      </section>
                    ))}
                  </div>
                  {!!shown.curses?.length && (
                    <p>诅咒：{shown.curses.map((c) => name(c.target, shown)).join('、')}</p>
                  )}
                  {shown.markers && (
                    <p>
                      交流标记：
                      {shown.markers.communicated.map((c) => name(c, shown)).join('、') || '无'} ·
                      死亡标记：{shown.markers.died.map((c) => name(c, shown)).join('、') || '无'}
                    </p>
                  )}
                  {masterBoard ? (
                    <ScriptBoard view={masterBoard} />
                  ) : (
                    <div className="schedule">
                      <h3>公开事件日程</h3>
                      {shown.incidents.length ? (
                        shown.incidents.map((e, i) => (
                          <span className="badge" key={i}>
                            第 {e.day} 日 · {e.name}
                          </span>
                        ))
                      ) : (
                        <span className="muted">本剧本无预定事件</span>
                      )}
                    </div>
                  )}
                </section>
                <aside className="panel">
                  <h2>手牌</h2>
                  {at >= 0 && <p className="reviewing">正在回看，返回当前盘面后可继续操作。</p>}
                  {shown.personalRole && <p className="badge">个人角色 · {shown.personalRole}</p>}
                  {(masterBoard ? (['mastermind', 'p0', 'p1', 'p2'] as const) : [seat]).map(
                    (owner) => (
                      <React.Fragment key={owner}>
                        <h3>{masterBoard ? label(owner) + ' · 行动牌' : '行动牌'}</h3>
                        <div className="hand">
                          {shown.hands[owner]?.map((c) => (
                            <div className={`hand-card ${c.status}`} key={c.id}>
                              <span>{label(c.kind)}</span>
                              <small>{label(c.status)}</small>
                            </div>
                          ))}
                        </div>
                      </React.Fragment>
                    ),
                  )}
                  <details className="fixture">
                    <summary>测试推进</summary>
                    <p className="muted">
                      剧作家按固定测试动作推进，不代表策略对手。每次只处理一次待决操作。
                    </p>
                    <button
                      disabled={busy || at >= 0 || !!shown.winner || seat === 'mastermind'}
                      onClick={() =>
                        void run(async () =>
                          accept(
                            await api.fixture(
                              id,
                              seat === 'mastermind' ? 'p0' : seat,
                              view!.revision,
                            ),
                          ),
                        )
                      }
                    >
                      推进剧作家测试回合
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void run(async () => accept(await api.view(id, seat)))}
                    >
                      刷新盘面
                    </button>
                  </details>
                </aside>
              </div>
            </div>
            <section className="panel history">
              <div className="section-heading">
                <h2>{seat === 'mastermind' ? '剧作家记录' : '公开记录'}</h2>
                <div className="bar">
                  <button
                    disabled={history.length < 2 || at === 0}
                    onClick={() => setAt(at < 0 ? history.length - 2 : Math.max(0, at - 1))}
                  >
                    上一步
                  </button>
                  <button
                    disabled={at < 0}
                    onClick={() => setAt(at >= history.length - 2 ? -1 : at + 1)}
                  >
                    下一步
                  </button>
                  <button disabled={at < 0} onClick={() => setAt(-1)}>
                    返回当前
                  </button>
                </div>
              </div>
              <div className="log">
                {completeObservationGroups(shown.observations).reverse().map((group) => {
                  const first = group[0]!;
                  return (
                    <article key={first.sequence}>
                      <small>第 {first.loop} 轮 · 第 {first.day} 日</small>
                      <strong>{group.length > 1 ? '同时发生' : label(first.type)}</strong>
                      {group.length > 1 ? (
                        <ul>{group.map((o) => (
                          <li key={o.sequence}>{label(o.type)} · {readable(o.data, shown)}</li>
                        ))}</ul>
                      ) : <span>{readable(first.data, shown)}</span>}
                    </article>
                  );
                })}
              </div>
            </section>
            <section className="panel notes">
              <h2>审阅笔记</h2>
              <textarea
                aria-label="审阅笔记"
                placeholder="记录盘面、操作或显示问题；导出审阅记录时一并保存。"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </section>
          </>
        )}
      </main>
      <footer>本地人类测试 · 剧作家与主人公完整对局</footer>
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
