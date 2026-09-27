import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { SeatId, VisibleSessionSnapshot } from '@tragedy/contracts';
import { seats, label } from './labels.js';
import './style.css';

type StateResponse = { snapshot: VisibleSessionSnapshot; actor: SeatId | null };
async function api<T>(path: string, seat: SeatId, body?: unknown): Promise<T> {
  const response = await fetch(
    `/api/${path}?seat=${seat}`,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? data.code ?? '请求失败');
  return data as T;
}
function App() {
  const [seat, setSeat] = useState<SeatId>('protagonistA');
  const [state, setState] = useState<StateResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  async function refresh(nextSeat: SeatId = seat) {
    const data = await api<StateResponse>('state', nextSeat);
    setState(data);
    setSeat(nextSeat);
    setSelected(new Set());
  }
  async function perform(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh().catch((e) => setError(String(e.message)));
  }, []);
  if (!state)
    return (
      <main>
        <h1>{error ? '无法连接游戏' : '轮回'}</h1>
        <p>{error || '正在连接本地引擎…'}</p>
        {error && (
          <button data-testid="connection-retry" onClick={() => void perform(() => refresh())}>
            重新连接
          </button>
        )}
      </main>
    );
  const s = state.snapshot;
  const w = s.waiting;
  const reset = () => {
    if (confirm('结束当前对局并重新开始？'))
      void perform(async () => {
        await api('reset', seat, {});
        await refresh();
      });
  };
  const choose = () =>
    void perform(async () => {
      if (!w) return;
      await api('choose', seat, {
        protocolVersion: 2,
        sessionId: s.sessionId,
        branchId: s.branchId,
        commandId: crypto.randomUUID(),
        expectedRevision: w.revision,
        waitingInputId: w.id,
        command: { kind: 'choose', optionIds: [...selected] },
      });
      await refresh();
    });
  return (
    <>
      <header>
        <a data-testid="home-link" className="brand" href="/">
          ◈ <strong>轮回</strong>
          <span>TRAGEDY LOOP</span>
        </a>
        <div className="header-right">
          <a data-testid="reference-link" href="/site/">
            资料与规则
          </a>
          <span className="status">● 本地单机演示</span>
          <button data-testid="game-reset" disabled={busy} onClick={reset}>
            重新开局
          </button>
        </div>
      </header>
      <main>
        <section className="intro">
          <div>
            <div className="eyebrow">FIRST STEPS / 初始之章</div>
            <h1>每一次选择，都改变结局。</h1>
            <p>观察盘面，提交行动，让故事继续。</p>
          </div>
          <div className="clock" data-testid="game-clock">
            <div>
              <b>
                {s.loop}
                <small> / {s.publicScript.loops}</small>
              </b>
              <span>轮回</span>
            </div>
            <i />
            <div>
              <b>
                {s.day}
                <small> / {s.publicScript.daysPerLoop}</small>
              </b>
              <span>日</span>
            </div>
          </div>
        </section>
        <div
          className="phase"
          data-testid="game-status"
          aria-busy={busy}
          data-revision={s.revision}
        >
          <span>
            当前阶段 <strong data-testid="game-phase">{label(s.phase)}</strong>
          </span>
          <span>队长 · {seats[s.leader]}</span>
          <span>修订 {s.revision}</span>
        </div>
        <div className="layout">
          <section>
            <div className="section-heading">
              <h2>故事的舞台</h2>
              <span>四个地点 · {s.characters.length} 位角色</span>
            </div>
            <div className="board">
              {Object.keys(s.board).map((area, i) => (
                <article key={area} data-testid={`area-${area}`} className="area">
                  <div className="area-title">
                    <span className="area-number">0{i + 1}</span>
                    <h3>{label(area)}</h3>
                    <span className="subtle">密谋 {s.board[area]!.intrigue}</span>
                  </div>
                  <div className="characters">
                    {s.characters
                      .filter((c) => c.area === area)
                      .map((c) => (
                        <div
                          key={c.id}
                          data-testid={`character-${c.id}`}
                          className={`character ${c.alive ? '' : 'dead'}`}
                        >
                          <div className="avatar">{c.name.slice(0, 1)}</div>
                          <div className="character-body">
                            <strong>{c.name}</strong>
                            <span className="subtle">
                              {c.alive ? '存活' : '死亡'}
                              {c.identity ? ` · ${label(c.identity)}` : ''}
                            </span>
                            <div className="counters">
                              {Object.entries(c.counters)
                                .filter(
                                  ([k, v]) =>
                                    ['goodwill', 'anxiety', 'intrigue'].includes(k) || v !== 0,
                                )
                                .map(([k, v]) => (
                                  <span
                                    key={k}
                                    data-testid={`counter-${c.id}-${k}`}
                                    className={`counter ${k}`}
                                  >
                                    {label(k)} <b>{v}</b>
                                  </span>
                                ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    {!s.characters.some((c) => c.area === area) && (
                      <p className="empty">暂无角色</p>
                    )}
                  </div>
                </article>
              ))}
            </div>
            <section className="timeline">
              <div className="section-heading">
                <h2>预定事件</h2>
                <span>公开剧本信息</span>
              </div>
              <div className="incidents" data-testid="scheduled-incidents">
                {s.publicScript.incidents.map((incident) => (
                  <div key={`${incident.day}-${incident.name}`}>
                    <span>第 {incident.day} 日</span>
                    <strong>{incident.name}</strong>
                  </div>
                ))}
                {!s.publicScript.incidents.length && <p>暂无事件</p>}
              </div>
            </section>
          </section>
          <aside>
            <section className="decision">
              <div className="eyebrow">YOUR NEXT MOVE</div>
              <h2>{s.result ? '本局已结束' : '轮到你做出选择'}</h2>
              <label className="seat-label">
                查看席位{' '}
                <select
                  data-testid="seat-selector"
                  value={seat}
                  disabled={busy}
                  onChange={(e) => {
                    const next = e.target.value as SeatId;
                    void perform(() => refresh(next));
                  }}
                >
                  {Object.entries(seats).map(([id, name]) => (
                    <option key={id} data-testid={`seat-${id}`} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="hint">单机演示可切换所有席位；请勿用于保密对局。</p>
              {s.result ? (
                <div className="result" data-testid="game-result">
                  <h3>{s.result.winners.map((id) => seats[id]).join('、')} 获胜</h3>
                  <p>{s.result.reason}</p>
                </div>
              ) : w ? (
                <>
                  <div className="prompt" data-testid="choice-prompt">
                    {w.prompt}
                  </div>
                  <p className="hint">
                    请选择{' '}
                    {w.minSelections === w.maxSelections
                      ? w.minSelections
                      : `${w.minSelections}–${w.maxSelections}`}{' '}
                    项
                  </p>
                  <div className="options" data-testid="choice-options">
                    {w.options.map((o) => (
                      <button
                        key={o.id}
                        className={`option ${selected.has(o.id) ? 'selected' : ''}`}
                        data-option={o.id}
                        data-testid={`choice-${o.id}`}
                        aria-pressed={selected.has(o.id)}
                        disabled={busy}
                        onClick={() =>
                          setSelected((previous) => {
                            const next = new Set(previous);
                            if (next.has(o.id)) next.delete(o.id);
                            else {
                              if (w.maxSelections === 1) next.clear();
                              if (next.size < w.maxSelections) next.add(o.id);
                            }
                            return next;
                          })
                        }
                      >
                        <span className="radio">{selected.has(o.id) ? '●' : '○'}</span>
                        <span>
                          {label(o.label)}
                          {o.description && <small>{o.description}</small>}
                        </span>
                      </button>
                    ))}
                  </div>
                  <button
                    className="primary"
                    data-testid="choice-submit"
                    disabled={
                      busy || selected.size < w.minSelections || selected.size > w.maxSelections
                    }
                    onClick={choose}
                  >
                    确认选择 →
                  </button>
                </>
              ) : (
                <>
                  <div className="prompt" data-testid="choice-prompt">
                    等待{state.actor ? seats[state.actor] : '引擎'}操作
                  </div>
                  {state.actor ? (
                    <button
                      className="primary"
                      data-testid="seat-follow"
                      onClick={() => void perform(() => refresh(state.actor!))}
                    >
                      切换到当前行动席位 →
                    </button>
                  ) : (
                    <p>当前没有待提交的选择。</p>
                  )}
                </>
              )}
              <p data-testid="game-error" className="error" role="alert">
                {error}
              </p>
            </section>
            <section className="hand">
              <h3>本席手牌</h3>
              <div className="chips" data-testid="seat-hand">
                {s.hand.map((c) => (
                  <span key={c.id}>
                    {label(c.kind)} <small>{label(c.zone)}</small>
                  </span>
                ))}
                {!s.hand.length && <span className="subtle">暂无手牌</span>}
              </div>
            </section>
          </aside>
        </div>
        <section className="logs">
          <div className="section-heading">
            <h2>故事记录</h2>
            <span>公开日志 · 最新在前</span>
          </div>
          <div className="log-list" data-testid="public-log">
            {s.publicLog
              .slice()
              .reverse()
              .map((e) => (
                <div key={e.sequence}>
                  <span>{String(e.sequence).padStart(3, '0')}</span>
                  <p>{label(e.text)}</p>
                </div>
              ))}
            {!s.publicLog.length && <p className="subtle">故事尚未开始。</p>}
          </div>
        </section>
        <footer>
          轮回规则引擎 · First Steps 本地体验{' '}
          <span>进度保存在本地服务内存中，重启服务会重置。</span>
        </footer>
      </main>
    </>
  );
}
createRoot(document.getElementById('app')!).render(<App />);
