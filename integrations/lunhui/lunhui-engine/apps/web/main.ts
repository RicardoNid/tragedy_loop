import type { SeatId, VisibleSessionSnapshot } from '../../packages/contracts/src/index.js';
import './style.css';
const app = document.querySelector<HTMLDivElement>('#app')!;
const seats: Record<SeatId, string> = {
  mastermind: '剧作家',
  protagonistA: '主人公 A',
  protagonistB: '主人公 B',
  protagonistC: '主人公 C',
};
const names: Record<string, string> = {
  hospital: '医院',
  shrine: '神社',
  city: '都市',
  school: '学校',
  goodwill: '友好',
  anxiety: '不安',
  intrigue: '密谋',
  setup: '开局',
  loop_start: '轮回开始',
  turn_start: '每日开始',
  mastermind_action: '剧作家行动',
  protagonist_action: '主人公行动',
  action_resolution: '行动结算',
  mastermind_ability: '剧作家能力',
  protagonist_ability: '主人公能力',
  incident: '事件',
  leader_rotation: '队长轮换',
  turn_end: '每日结束',
  loop_end: '轮回结束',
  final_showdown: '最终决战',
};
Object.assign(names, seats, {
  'move-horizontal': '横向移动',
  'move-vertical': '纵向移动',
  'move-diagonal': '斜向移动',
  'forbid-intrigue': '禁止密谋',
  'forbid-movement': '禁止移动',
  'forbid-goodwill': '禁止友好',
  'forbid-anxiety': '禁止不安',
  hand: '可用',
  used: '已使用',
  discard: '弃牌',
  civilian: '平民',
  key_person: '关键人物',
  killer: '杀手',
  cultist: '邪教徒',
});
const label = (text: string): string =>
  names[text] ??
  text.replace(
    /protagonist[ABC]|mastermind|goodwill|anxiety|intrigue|loop_start|turn_start|turn_end|loop_end/g,
    (token) => names[token] ?? token,
  );
const escape = (text: unknown) =>
  String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
let seat: SeatId = 'protagonistA';
let snapshot: VisibleSessionSnapshot;
let actor: SeatId | null = null;
let selected = new Set<string>();
let busy = false;
let error = '';
async function api(path: string, body?: unknown) {
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
  return data;
}
async function refresh() {
  const data = await api('state');
  snapshot = data.snapshot;
  actor = data.actor;
  selected.clear();
  render();
}
async function perform(action: () => Promise<void>) {
  if (busy) return;
  busy = true;
  error = '';
  render();
  try {
    await action();
  } catch (e) {
    error = e instanceof Error ? e.message : '操作失败';
  } finally {
    busy = false;
    render();
  }
}
function render() {
  if (!snapshot) {
    app.innerHTML = '<main><h1>轮回</h1><p>正在连接本地引擎…</p></main>';
    return;
  }
  const s = snapshot;
  const w = s.waiting;
  app.innerHTML = `
    <header><a data-testid="home-link" class="brand" href="/">◈ <strong>轮回</strong><span>TRAGEDY LOOP</span></a><div class="header-right"><span class="status">● 本地单机演示</span><button id="reset" data-testid="game-reset" ${busy ? 'disabled' : ''}>重新开局</button></div></header>
    <main><section class="intro"><div><div class="eyebrow">FIRST STEPS / 初始之章</div><h1>每一次选择，都改变结局。</h1><p>观察盘面，提交行动，让故事继续。</p></div><div class="clock" data-testid="game-clock"><div><b>${s.loop}<small> / ${s.publicScript.loops}</small></b><span>轮回</span></div><i></i><div><b>${s.day}<small> / ${s.publicScript.daysPerLoop}</small></b><span>日</span></div></div></section>
    <div class="phase" data-testid="game-status" aria-busy="${busy}" data-revision="${s.revision}"><span>当前阶段 <strong data-testid="game-phase">${escape(label(s.phase))}</strong></span><span>队长 · ${seats[s.leader]}</span><span>修订 ${s.revision}</span></div>
    <div class="layout"><section><div class="section-heading"><h2>故事的舞台</h2><span>四个地点 · ${s.characters.length} 位角色</span></div><div class="board">${Object.keys(
      s.board,
    )
      .map(
        (area, i) =>
          `<article data-testid="area-${escape(area)}" class="area"><div class="area-title"><span class="area-number">0${i + 1}</span><h3>${escape(label(area))}</h3><span class="subtle">密谋 ${s.board[area]!.intrigue}</span></div><div class="characters">${
            s.characters
              .filter((c) => c.area === area)
              .map(
                (c) =>
                  `<div data-testid="character-${escape(c.id)}" class="character ${c.alive ? '' : 'dead'}"><div class="avatar">${escape(c.name.slice(0, 1))}</div><div class="character-body"><strong>${escape(c.name)}</strong><span class="subtle">${c.alive ? '存活' : '死亡'}${c.identity ? ` · ${escape(label(c.identity))}` : ''}</span><div class="counters">${Object.entries(
                    c.counters,
                  )
                    .filter(([k, v]) => ['goodwill', 'anxiety', 'intrigue'].includes(k) || v !== 0)
                    .map(
                      ([k, v]) =>
                        `<span data-testid="counter-${escape(c.id)}-${escape(k)}" class="counter ${escape(k)}">${escape(label(k))} <b>${v}</b></span>`,
                    )
                    .join('')}</div></div></div>`,
              )
              .join('') || '<p class="empty">暂无角色</p>'
          }</div></article>`,
      )
      .join('')}</div>
    <section class="timeline"><div class="section-heading"><h2>预定事件</h2><span>公开剧本信息</span></div><div class="incidents" data-testid="scheduled-incidents">${s.publicScript.incidents.map((i) => `<div><span>第 ${i.day} 日</span><strong>${escape(i.name)}</strong></div>`).join('') || '<p>暂无事件</p>'}</div></section></section>
    <aside><section class="decision"><div class="eyebrow">YOUR NEXT MOVE</div><h2>${s.result ? '本局已结束' : '轮到你做出选择'}</h2><label class="seat-label">查看席位 <select id="seat" data-testid="seat-selector" ${busy ? 'disabled' : ''}>${Object.entries(
      seats,
    )
      .map(
        ([id, name]) =>
          `<option data-testid="seat-${id}" value="${id}" ${id === seat ? 'selected' : ''}>${name}</option>`,
      )
      .join('')}</select></label><p class="hint">单机演示可切换所有席位；请勿用于保密对局。</p>
    ${s.result ? `<div class="result" data-testid="game-result"><h3>${s.result.winners.map((id) => seats[id]).join('、')} 获胜</h3><p>${escape(s.result.reason)}</p></div>` : w ? `<div class="prompt" data-testid="choice-prompt">${escape(w.prompt)}</div><p class="hint">请选择 ${w.minSelections === w.maxSelections ? w.minSelections : `${w.minSelections}–${w.maxSelections}`} 项</p><div class="options" data-testid="choice-options">${w.options.map((o) => `<button class="option ${selected.has(o.id) ? 'selected' : ''}" data-option="${escape(o.id)}" data-testid="choice-${escape(o.id)}" aria-pressed="${selected.has(o.id)}" ${busy ? 'disabled' : ''}><span class="radio">${selected.has(o.id) ? '●' : '○'}</span><span>${escape(label(o.label))}${o.description ? `<small>${escape(o.description)}</small>` : ''}</span></button>`).join('')}</div><button class="primary" id="submit" data-testid="choice-submit" ${busy || selected.size < w.minSelections || selected.size > w.maxSelections ? 'disabled' : ''}>确认选择 →</button>` : `<div class="prompt" data-testid="choice-prompt">等待${actor ? seats[actor] : '引擎'}操作</div>${actor ? '<button class="primary" id="switch" data-testid="seat-follow">切换到当前行动席位 →</button>' : '<p>当前没有待提交的选择。</p>'}`}
    <p data-testid="game-error" class="error" role="alert">${escape(error)}</p></section><section class="hand"><h3>本席手牌</h3><div class="chips" data-testid="seat-hand">${s.hand.map((c) => `<span>${escape(label(c.kind))} <small>${escape(label(c.zone))}</small></span>`).join('') || '<span class="subtle">暂无手牌</span>'}</div></section></aside></div>
    <section class="logs"><div class="section-heading"><h2>故事记录</h2><span>公开日志 · 最新在前</span></div><div class="log-list" data-testid="public-log">${
      s.publicLog
        .slice()
        .reverse()
        .map(
          (e) =>
            `<div><span>${String(e.sequence).padStart(3, '0')}</span><p>${escape(label(e.text))}</p></div>`,
        )
        .join('') || '<p class="subtle">故事尚未开始。</p>'
    }</div></section><footer>轮回规则引擎 · First Steps 本地体验 <span>进度保存在本地服务内存中，重启服务会重置。</span></footer></main>`;
  document.querySelector<HTMLSelectElement>('#seat')!.onchange = (e) =>
    void perform(async () => {
      seat = (e.target as HTMLSelectElement).value as SeatId;
      await refresh();
    });
  document.querySelector('#switch')?.addEventListener(
    'click',
    () =>
      void perform(async () => {
        seat = actor!;
        await refresh();
      }),
  );
  document.querySelector('#reset')?.addEventListener('click', () => {
    if (confirm('结束当前对局并重新开始？'))
      void perform(async () => {
        await api('reset', {});
        await refresh();
      });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-option]').forEach(
    (button) =>
      (button.onclick = () => {
        const id = button.dataset.option!;
        if (selected.has(id)) selected.delete(id);
        else {
          if (w!.maxSelections === 1) selected.clear();
          if (selected.size < w!.maxSelections) selected.add(id);
        }
        render();
      }),
  );
  document.querySelector('#submit')?.addEventListener(
    'click',
    () =>
      void perform(async () => {
        await api('choose', {
          protocolVersion: 2,
          sessionId: s.sessionId,
          branchId: s.branchId,
          commandId: crypto.randomUUID(),
          expectedRevision: w!.revision,
          waitingInputId: w!.id,
          command: { kind: 'choose', optionIds: [...selected] },
        });
        await refresh();
      }),
  );
}
render();
refresh().catch((e) => {
  app.innerHTML = `<main><h1>无法连接游戏</h1><p>${escape(e.message)}</p><button data-testid="connection-retry" onclick="location.reload()">重新连接</button></main>`;
});
