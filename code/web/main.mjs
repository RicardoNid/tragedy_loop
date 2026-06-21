import {
  PHASES,
  SIDES,
  TARGET_TYPES,
  VIEWERS,
  beginnerScript,
  locations,
  roles,
} from "./core/data.mjs";
import {
  RulesError,
  actionLimit,
  advancePhase,
  availableCards,
  availableMastermindAbilityActors,
  cardLabel,
  createGame,
  describeState,
  listLegalTargets,
  listMastermindAbilityTargets,
  phaseLabel,
  placeAction,
  placedActionCount,
  projectView,
  sideLabel,
  startNextLoop,
  submitFinalGuesses,
  useMastermindAbility,
} from "./core/engine.mjs";

let state = createGame();
let errorMessage = "";
let selectedCardId = null;
let selectedActorId = null;

const app = document.querySelector("#app");

function safeRun(operation) {
  try {
    errorMessage = "";
    state = operation(state);
    selectedCardId = null;
  } catch (error) {
    errorMessage = error instanceof RulesError ? error.message : String(error);
  }
  render();
}

function render() {
  const summary = describeState(state);
  const mastermindView = projectView(state, VIEWERS.MASTERMIND);
  const protagonistView = projectView(state, VIEWERS.PROTAGONISTS);

  app.innerHTML = `
    <header class="topbar">
      <div>
        <p class="eyebrow">${beginnerScript.moduleName}</p>
        <h1>${beginnerScript.name}</h1>
      </div>
      <div class="status-strip">
        <span>第 ${summary.loop} 轮</span>
        <span>第 ${summary.day} 天</span>
        <span>${summary.phaseLabel}</span>
        <span>${winnerLabel(summary.winner)}</span>
      </div>
    </header>

    <main class="shell">
      <section class="left-rail">
        ${renderControls()}
        ${renderPlacedActions()}
      </section>

      <section class="workspace">
        ${errorMessage ? `<div class="error">${escapeHtml(errorMessage)}</div>` : ""}
        ${renderScriptInfo(mastermindView.script, protagonistView.script)}
        <div class="views">
          ${renderBoard(mastermindView, "剧作家视图", true)}
          ${renderBoard(protagonistView, "主人公视图", false)}
        </div>
        <div class="logs">
          ${renderLog(mastermindView, "剧作家日志")}
          ${renderLog(protagonistView, "主人公日志")}
        </div>
      </section>
    </main>
  `;

  bindEvents();
}

function winnerLabel(winner) {
  if (!winner) return "进行中";
  return winner === SIDES.PROTAGONIST ? "主人公胜利" : "剧作家胜利";
}

function renderControls() {
  if (state.status === "loop_failed") {
    return `
      <section class="panel">
        <h2>轮回结束</h2>
        <button class="primary" data-action="next-loop">开始下一轮</button>
      </section>
    `;
  }

  if (state.phase === PHASES.FINAL_GUESS) {
    return renderFinalGuessPanel();
  }

  if (state.phase === PHASES.FINISHED) {
    return `
      <section class="panel">
        <h2>游戏结束</h2>
        <p class="result">${winnerLabel(state.winner)}</p>
        <button data-action="restart">重开</button>
      </section>
    `;
  }

  if (state.phase === PHASES.MASTERMIND_ACTION || state.phase === PHASES.PROTAGONIST_ACTION) {
    const side = state.phase === PHASES.MASTERMIND_ACTION ? SIDES.MASTERMIND : SIDES.PROTAGONIST;
    return renderActionPanel(side);
  }

  if (state.phase === PHASES.MASTERMIND_ABILITY) {
    return renderMastermindAbilityPanel();
  }

  return `
    <section class="panel">
      <h2>${phaseLabel(state.phase)}</h2>
      <button class="primary" data-action="advance">推进阶段</button>
      <button data-action="restart">重开</button>
    </section>
  `;
}

function renderActionPanel(side) {
  const placed = placedActionCount(state, side);
  const limit = actionLimit(state, side);
  if (placed >= limit) {
    return `
      <section class="panel">
        <h2>${sideLabel(side)}行动</h2>
        <p class="muted">本阶段行动牌已放满：${placed}/${limit}。</p>
        <button class="primary" data-action="advance">推进阶段</button>
        <button data-action="restart">重开</button>
      </section>
    `;
  }

  const cards = availableCards(state, side);
  const usableCards = cards
    .map((entry) => ({
      ...entry,
      legalTargets: listLegalTargets(state, side, entry.card.id),
    }))
    .filter((entry) => !entry.disabled && entry.remainingThisPhase > 0 && entry.legalTargets.length > 0);
  const cardId = selectedCardId && usableCards.some((entry) => entry.card.id === selectedCardId)
    ? selectedCardId
    : usableCards[0]?.card.id;
  selectedCardId = cardId ?? null;
  const targets = usableCards.find((entry) => entry.card.id === cardId)?.legalTargets ?? [];

  return `
    <section class="panel">
      <h2>${sideLabel(side)}行动</h2>
      <p class="muted">已暗置 ${placed}/${limit} 张。</p>
      <form id="action-form" class="stack">
        <label>
          行动牌
          <select name="cardId" id="card-select">
            ${usableCards
              .map(
                (entry) =>
                  `<option value="${entry.card.id}" ${
                    entry.card.id === cardId ? "selected" : ""
                  }>${entry.name}${entry.quantity > 1 ? ` x${entry.remainingThisPhase}` : ""}</option>`,
              )
              .join("")}
          </select>
        </label>
        <label>
          目标
          <select name="target">
            ${targets
              .map(
                (target) =>
                  `<option value="${target.targetType}:${target.targetId}">${escapeHtml(
                    target.name,
                  )}</option>`,
              )
              .join("")}
          </select>
        </label>
        <button class="primary" ${cardId ? "" : "disabled"}>暗置</button>
      </form>
      <button data-action="advance">推进阶段</button>
      <button data-action="restart">重开</button>
    </section>
  `;
}

function renderMastermindAbilityPanel() {
  const actors = availableMastermindAbilityActors(state);
  if (actors.length === 0) {
    return `
      <section class="panel">
        <h2>剧作家能力</h2>
        <p class="muted">当前没有可发动的已实现剧作家能力，或可发动角色本日已经使用过能力。</p>
        <button class="primary" data-action="advance">跳过</button>
        <button data-action="restart">重开</button>
      </section>
    `;
  }

  const actorId = selectedActorId && actors.some((actor) => actor.id === selectedActorId)
    ? selectedActorId
    : actors[0]?.id;
  selectedActorId = actorId ?? null;
  const targets = actorId ? listMastermindAbilityTargets(state, actorId) : [];

  return `
    <section class="panel">
      <h2>剧作家能力</h2>
      <form id="ability-form" class="stack">
        <label>
          角色
          <select name="actorId" id="actor-select">
            ${actors
              .map(
                (candidate) =>
                  `<option value="${candidate.id}" ${
                    candidate.id === actorId ? "selected" : ""
                  }>${candidate.name} / ${roles[candidate.roleId].name}</option>`,
              )
              .join("")}
          </select>
        </label>
        <label>
          目标
          <select name="target">
            ${targets
              .map(
                (target) =>
                  `<option value="${target.targetType}:${target.targetId}">${escapeHtml(
                    target.name,
                  )}</option>`,
              )
              .join("")}
          </select>
        </label>
        <button class="primary" ${actorId ? "" : "disabled"}>使用能力</button>
      </form>
      <button data-action="advance">跳过</button>
      <button data-action="restart">重开</button>
    </section>
  `;
}

function renderFinalGuessPanel() {
  const roleOptions = Object.values(roles)
    .map((role) => `<option value="${role.id}">${role.name}</option>`)
    .join("");
  return `
    <section class="panel">
      <h2>最终决战</h2>
      <form id="guess-form" class="stack">
        ${Object.values(state.board.characters)
          .map(
            (character) => `
              <label>
                ${character.name}
                <select name="${character.id}">
                  ${roleOptions}
                </select>
              </label>
            `,
          )
          .join("")}
        <button class="primary">提交猜测</button>
      </form>
    </section>
  `;
}

function renderPlacedActions() {
  const actions = state.placedActions;
  return `
    <section class="panel compact">
      <h2>暗置区</h2>
      ${
        actions.length === 0
          ? `<p class="muted">空</p>`
          : `<ul class="action-list">
              ${actions
                .map(
                  (action) => `
                    <li>
                      <span>${sideLabel(action.side)}</span>
                      <strong>${cardLabel(action.cardId, action.side)}</strong>
                      <span>${targetDisplay(action)}</span>
                    </li>
                  `,
                )
                .join("")}
            </ul>`
      }
    </section>
  `;
}

function renderScriptInfo(mastermindScript, protagonistScript) {
  return `
    <section class="script-panel">
      ${renderScriptCard(mastermindScript, "剧作家剧本表", true)}
      ${renderScriptCard(protagonistScript, "主人公开剧本表", false)}
    </section>
  `;
}

function renderScriptCard(script, title, showPrivate) {
  return `
    <article class="script-card">
      <div class="section-head">
        <h2>${title}</h2>
        <span>${showPrivate ? "Closed" : "Open"}</span>
      </div>
      <div class="script-body">
        <div>
          <h3>采用规则</h3>
          <ul class="plain-list">
            ${script.rules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}
          </ul>
        </div>
        <div>
          <h3>事件与当事人</h3>
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>事件</th>
                <th>当事人</th>
              </tr>
            </thead>
            <tbody>
              ${script.incidents
                .map(
                  (incident) => `
                    <tr>
                      <td>第 ${incident.day} 天</td>
                      <td>${escapeHtml(incident.name)}</td>
                      <td>${escapeHtml(incident.culpritName)}</td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    </article>
  `;
}

function renderBoard(view, title, showPrivate) {
  return `
    <section class="board-panel">
      <div class="section-head">
        <h2>${title}</h2>
        <span>${showPrivate ? "Closed" : "Open"}</span>
      </div>
      <div class="board-grid">
        ${Object.values(locations)
          .map((location) => renderLocation(view, location))
          .join("")}
      </div>
    </section>
  `;
}

function renderLocation(view, location) {
  const characters = Object.values(view.board.characters).filter(
    (character) => character.locationId === location.id,
  );
  const locationState = view.board.locations[location.id];
  return `
    <div class="location">
      <div class="location-head">
        <h3>${location.name}</h3>
        <span>密谋 ${locationState.intrigue}</span>
      </div>
      <div class="character-list">
        ${characters.map((character) => renderCharacter(character)).join("")}
      </div>
    </div>
  `;
}

function renderCharacter(character) {
  return `
    <article class="character ${character.alive ? "" : "dead"}">
      <div class="character-main">
        <strong>${character.name}</strong>
        <span>${character.alive ? "生存" : "死亡"}</span>
      </div>
      <div class="role-line">${escapeHtml(character.roleName ?? roles[character.roleId]?.name ?? "")}</div>
      <div class="character-meta">
        <span>${character.attributes.map(escapeHtml).join(" / ")}</span>
        ${
          character.publicTraits.length > 0
            ? `<span>${character.publicTraits.map(escapeHtml).join(" ")}</span>`
            : ""
        }
      </div>
      <div class="tokens">
        <span>友 ${character.goodwill}/${limitLabel(character.goodwillLimit)}</span>
        <span>不 ${character.paranoia}/${character.paranoiaLimit}</span>
        <span>密 ${character.intrigue}</span>
      </div>
      <ul class="skill-list">
        ${character.skills.map((skill) => renderSkill(skill)).join("")}
      </ul>
    </article>
  `;
}

function renderSkill(skill) {
  return `
    <li>
      <div>
        <span class="skill-cost">友好 ${limitLabel(skill.requiredGoodwill)}</span>
        ${skill.oncePerLoop ? `<span class="skill-tag">每轮 1 次</span>` : ""}
        ${skill.frequency === "per_day" ? `<span class="skill-tag">每日 1 次</span>` : ""}
      </div>
      <strong>${escapeHtml(skill.name)}</strong>
      <p>${escapeHtml(skill.effect)}</p>
      ${
        skill.additionalUsers?.length
          ? `<p class="skill-exception">${skill.additionalUsers
              .map((exception) => `${exception.timing}：${exception.condition}`)
              .map(escapeHtml)
              .join(" ")}</p>`
          : ""
      }
    </li>
  `;
}

function limitLabel(value) {
  return value == null ? "?" : String(value);
}

function renderLog(view, title) {
  return `
    <section class="log-panel">
      <h2>${title}</h2>
      <ol>
        ${view.eventLog
          .slice()
          .reverse()
          .slice(0, 18)
          .map((event) => `<li><span>#${event.id}</span>${escapeHtml(event.message)}</li>`)
          .join("")}
      </ol>
    </section>
  `;
}

function targetDisplay(action) {
  if (action.targetType === TARGET_TYPES.CHARACTER) {
    return state.board.characters[action.targetId].name;
  }
  return locations[action.targetId].name;
}

function bindEvents() {
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (action === "advance") safeRun((current) => advancePhase(current));
      if (action === "next-loop") safeRun((current) => startNextLoop(current));
      if (action === "restart") {
        state = createGame();
        errorMessage = "";
        selectedCardId = null;
        selectedActorId = null;
        render();
      }
    });
  });

  document.querySelector("#card-select")?.addEventListener("change", (event) => {
    selectedCardId = event.target.value;
    render();
  });

  document.querySelector("#actor-select")?.addEventListener("change", (event) => {
    selectedActorId = event.target.value;
    render();
  });

  document.querySelector("#action-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const side = state.phase === PHASES.MASTERMIND_ACTION ? SIDES.MASTERMIND : SIDES.PROTAGONIST;
    const [targetType, targetId] = String(form.get("target")).split(":");
    safeRun((current) =>
      placeAction(current, {
        side,
        cardId: String(form.get("cardId")),
        targetType,
        targetId,
      }),
    );
  });

  document.querySelector("#ability-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const [targetType, targetId] = String(form.get("target")).split(":");
    safeRun((current) =>
      useMastermindAbility(current, {
        actorId: String(form.get("actorId")),
        targetType,
        targetId,
      }),
    );
  });

  document.querySelector("#guess-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const guesses = {};
    for (const character of Object.values(state.board.characters)) {
      guesses[character.id] = String(form.get(character.id));
    }
    safeRun((current) => submitFinalGuesses(current, guesses));
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

render();
