import {
  PHASES,
  PROTAGONIST_DECKS,
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
  availableProtagonistAbilities,
  availableCards,
  availableMastermindAbilities,
  cardLabel,
  createGame,
  describeState,
  listLegalTargets,
  listProtagonistAbilityTargets,
  phaseLabel,
  placeAction,
  placedActionCount,
  projectView,
  sideLabel,
  startNextLoop,
  submitFinalGuesses,
  requestProtagonistAbility,
  respondProtagonistAbility,
  useMastermindAbility,
} from "./core/engine.mjs";

const STORAGE_KEY = "tragedy-loop:shared-state:v2";
const SESSION_KEY = "tragedy-loop:session-id:v1";
const CHANNEL_NAME = "tragedy-loop:shared-session";
const LOG_ENDPOINT = "/api/prototype-log";
const PAGE_MODES = {
  DUAL: "dual",
  MASTERMIND: "mastermind",
  PROTAGONISTS: "protagonists",
};

const query = new URLSearchParams(window.location.search);
const pageMode = normalizePageMode(query.get("view"));
const channel = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL_NAME) : null;
const sessionId = getSessionId();

let state = loadStoredState() ?? createGame();
let errorMessage = "";
let selectedCardId = null;
let selectedMastermindAbilityKey = null;
let selectedProtagonistAbilityKey = null;
let lastLogSignature = "";

const app = document.querySelector("#app");

function safeRun(operation) {
  try {
    errorMessage = "";
    state = operation(state);
    selectedCardId = null;
    selectedMastermindAbilityKey = null;
    selectedProtagonistAbilityKey = null;
    publishState();
  } catch (error) {
    errorMessage = error instanceof RulesError ? error.message : String(error);
  }
  render();
}

function render() {
  const summary = describeState(state);
  const mastermindView = projectView(state, VIEWERS.MASTERMIND);
  const protagonistView = projectView(state, VIEWERS.PROTAGONISTS);
  const panels = visiblePanels(mastermindView, protagonistView);
  const sidebarView = pageMode === PAGE_MODES.PROTAGONISTS ? protagonistView : mastermindView;
  const workspaceClass = panels.length === 1 ? "workspace single-view" : "workspace";

  app.innerHTML = `
    <header class="topbar">
      <div class="topbar-title">
        <p class="eyebrow">${beginnerScript.moduleName}</p>
        <h1>${beginnerScript.name}</h1>
      </div>
      ${renderTopbarScriptInfo(panels)}
      <div class="topbar-right">
        <nav class="view-tabs" aria-label="视图">
          ${renderViewLink("双视图", PAGE_MODES.DUAL)}
          ${renderViewLink("剧作家", PAGE_MODES.MASTERMIND)}
          ${renderViewLink("主人公", PAGE_MODES.PROTAGONISTS)}
        </nav>
        <div class="status-strip">
          <span>第 ${summary.loop} 轮</span>
          <span>第 ${summary.day} 天</span>
          <span>${summary.phaseLabel}</span>
          <span>${winnerLabel(summary.winner)}</span>
        </div>
      </div>
    </header>

    <main class="shell">
      <section class="left-rail">
        ${renderControls()}
        ${renderPlacedActions(sidebarView)}
        ${renderDiscardPiles(sidebarView)}
      </section>

      <section class="log-rail">
        ${panels.map((panel) => renderLog(panel.view, panel.logTitle)).join("")}
      </section>

      <section class="${workspaceClass}">
        ${errorMessage ? `<div class="error">${escapeHtml(errorMessage)}</div>` : ""}
        <div class="views">
          ${panels.map((panel) => renderBoard(panel.view, panel.boardTitle, panel.showPrivate)).join("")}
        </div>
      </section>
    </main>
  `;

  bindEvents();
  scrollLogsToBottom();
}

function winnerLabel(winner) {
  if (!winner) return "进行中";
  return winner === SIDES.PROTAGONIST ? "主人公胜利" : "剧作家胜利";
}

function normalizePageMode(value) {
  if (value === PAGE_MODES.MASTERMIND) return PAGE_MODES.MASTERMIND;
  if (value === PAGE_MODES.PROTAGONISTS || value === "protagonist") {
    return PAGE_MODES.PROTAGONISTS;
  }
  return PAGE_MODES.DUAL;
}

function renderViewLink(label, mode) {
  const href = mode === PAGE_MODES.DUAL ? "./" : `./?view=${mode}`;
  const active = pageMode === mode ? "active" : "";
  return `<a class="${active}" href="${href}" target="_blank" rel="noreferrer">${label}</a>`;
}

function visiblePanels(mastermindView, protagonistView) {
  if (pageMode === PAGE_MODES.MASTERMIND) {
    return [
      {
        view: mastermindView,
        scriptTitle: "剧作家剧本表",
        boardTitle: "剧作家视图",
        logTitle: "剧作家日志",
        showPrivate: true,
      },
    ];
  }

  if (pageMode === PAGE_MODES.PROTAGONISTS) {
    return [
      {
        view: protagonistView,
        scriptTitle: "主人公开剧本表",
        boardTitle: "主人公视图",
        logTitle: "主人公日志",
        showPrivate: false,
      },
    ];
  }

  return [
    {
      view: mastermindView,
      scriptTitle: "剧作家剧本表",
      boardTitle: "剧作家视图",
      logTitle: "剧作家日志",
      showPrivate: true,
    },
    {
      view: protagonistView,
      scriptTitle: "主人公开剧本表",
      boardTitle: "主人公视图",
      logTitle: "主人公日志",
      showPrivate: false,
    },
  ];
}

function renderControls() {
  if (state.pendingDecision?.type === "protagonist_ability_approval") {
    if (canControlSide(SIDES.MASTERMIND)) return renderProtagonistAbilityApprovalPanel();
    return renderWaitingPanel("剧作家审批能力");
  }

  if (state.status === "loop_failed") {
    return `
      <section class="panel">
        <h2>轮回结束</h2>
        ${canControlCurrentPhase() ? `<button class="primary" data-action="next-loop">开始下一轮</button>` : ""}
        <button data-action="restart">重开</button>
        ${canControlCurrentPhase() ? "" : `<p class="muted">等待剧作家页面开始下一轮。</p>`}
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
    if (!canControlSide(side)) {
      return renderWaitingPanel(sideLabel(side));
    }
    return renderActionPanel(side);
  }

  if (state.phase === PHASES.MASTERMIND_ABILITY) {
    if (!canControlSide(SIDES.MASTERMIND)) {
      return renderWaitingPanel("剧作家");
    }
    return renderMastermindAbilityPanel();
  }

  if (state.phase === PHASES.PROTAGONIST_ABILITY) {
    if (!canControlSide(SIDES.PROTAGONIST)) {
      return renderWaitingPanel("主人公");
    }
    return renderProtagonistAbilityPanel();
  }

  if (!canControlCurrentPhase()) {
    return renderWaitingPanel(neutralControllerLabel());
  }

  return `
    <section class="panel">
      <h2>${phaseLabel(state.phase)}</h2>
      <button class="primary" data-action="advance">推进阶段</button>
      <button data-action="restart">重开</button>
    </section>
  `;
}

function canControlSide(side) {
  if (pageMode === PAGE_MODES.DUAL) return true;
  if (side === SIDES.MASTERMIND) return pageMode === PAGE_MODES.MASTERMIND;
  if (side === SIDES.PROTAGONIST) return pageMode === PAGE_MODES.PROTAGONISTS;
  return false;
}

function canControlCurrentPhase() {
  if (pageMode === PAGE_MODES.DUAL) return true;
  if (
    state.phase === PHASES.PROTAGONIST_ACTION ||
    state.phase === PHASES.PROTAGONIST_ABILITY ||
    state.phase === PHASES.FINAL_GUESS
  ) {
    return pageMode === PAGE_MODES.PROTAGONISTS;
  }
  return pageMode === PAGE_MODES.MASTERMIND;
}

function neutralControllerLabel() {
  if (
    state.phase === PHASES.PROTAGONIST_ACTION ||
    state.phase === PHASES.PROTAGONIST_ABILITY ||
    state.phase === PHASES.FINAL_GUESS
  ) {
    return "主人公";
  }
  return "剧作家";
}

function renderWaitingPanel(controller) {
  return `
    <section class="panel">
      <h2>${phaseLabel(state.phase)}</h2>
      <p class="muted">等待${controller}页面操作。</p>
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

  const deckId = side === SIDES.PROTAGONIST ? currentProtagonistDeckId() : null;
  const cards = availableCards(state, side, deckId);
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
    <section class="panel action-panel ${deckId ? `deck-frame-${deckId}` : ""}">
      <h2>${sideLabel(side)}行动${deckId ? renderDeckBadge(deckId) : ""}</h2>
      <p class="muted">已暗置 ${placed}/${limit} 张。</p>
      <form id="action-form" class="stack">
        ${
          side === SIDES.PROTAGONIST
            ? `<input type="hidden" name="deckId" value="${deckId}" />
              <p class="turn-color">当前行动牌颜色：${renderDeckBadge(deckId)}${escapeHtml(
                protagonistDeckName(deckId),
              )}</p>`
            : ""
        }
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

function currentProtagonistDeckId() {
  return (
    PROTAGONIST_DECKS.find((deck) => !protagonistDeckPlaced(deck.id))?.id ??
    PROTAGONIST_DECKS[PROTAGONIST_DECKS.length - 1].id
  );
}

function protagonistDeckPlaced(deckId) {
  return state.placedActions.some(
    (action) => action.side === SIDES.PROTAGONIST && action.deckId === deckId,
  );
}

function protagonistDeckName(deckId) {
  return PROTAGONIST_DECKS.find((deck) => deck.id === deckId)?.name ?? "";
}

function renderMastermindAbilityPanel() {
  const abilities = availableMastermindAbilities(state);
  if (abilities.length === 0) {
    return `
      <section class="panel">
        <h2>剧作家能力</h2>
        <p class="muted">当前没有可发动的已实现剧作家能力，或可发动角色本日已经使用过能力。</p>
        <button class="primary" data-action="advance">跳过</button>
        <button data-action="restart">重开</button>
      </section>
    `;
  }

  const abilityKey =
    selectedMastermindAbilityKey &&
    abilities.some((ability) => mastermindAbilityKeyOf(ability) === selectedMastermindAbilityKey)
      ? selectedMastermindAbilityKey
      : mastermindAbilityKeyOf(abilities[0]);
  selectedMastermindAbilityKey = abilityKey;
  const selectedAbility =
    abilities.find((ability) => mastermindAbilityKeyOf(ability) === abilityKey) ?? abilities[0];
  const targets = selectedAbility.targets;

  return `
    <section class="panel">
      <h2>剧作家能力</h2>
      <form id="ability-form" class="stack">
        <label>
          能力
          <select name="abilityKey" id="mastermind-ability-select">
            ${abilities
              .map(
                (ability) =>
                  `<option value="${mastermindAbilityKeyOf(ability)}" ${
                    mastermindAbilityKeyOf(ability) === abilityKey ? "selected" : ""
                  }>${escapeHtml(ability.actorName)} / ${escapeHtml(ability.abilityName)}</option>`,
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
        ${
          selectedAbility.requiresOption
            ? `<label>
                处理
                <select name="option">
                  ${selectedAbility.options
                    .map(
                      (option) =>
                        `<option value="${option.value}">${escapeHtml(option.label)}</option>`,
                    )
                    .join("")}
                </select>
              </label>`
            : ""
        }
        <button class="primary" ${selectedAbility ? "" : "disabled"}>使用能力</button>
      </form>
      <button data-action="advance">跳过</button>
      <button data-action="restart">重开</button>
    </section>
  `;
}

function mastermindAbilityKeyOf(ability) {
  return `${ability.actorId}:${ability.abilityId}`;
}

function renderProtagonistAbilityPanel() {
  const abilities = availableProtagonistAbilities(state);
  if (abilities.length === 0) {
    return `
      <section class="panel">
        <h2>主人公能力</h2>
        <p class="muted">当前没有满足友好门槛且存在可选对象的能力。</p>
        <button class="primary" data-action="advance">跳过</button>
        <button data-action="restart">重开</button>
      </section>
    `;
  }

  const abilityKey =
    selectedProtagonistAbilityKey && abilities.some((ability) => abilityKeyOf(ability) === selectedProtagonistAbilityKey)
      ? selectedProtagonistAbilityKey
      : abilityKeyOf(abilities[0]);
  selectedProtagonistAbilityKey = abilityKey;
  const selectedAbility = abilities.find((ability) => abilityKeyOf(ability) === abilityKey) ?? abilities[0];
  const targets = listProtagonistAbilityTargets(
    state,
    selectedAbility.actorId,
    selectedAbility.skillId,
  );

  return `
    <section class="panel">
      <h2>主人公能力</h2>
      <form id="protagonist-ability-form" class="stack">
        <label>
          能力
          <select name="abilityKey" id="protagonist-ability-select">
            ${abilities
              .map(
                (ability) =>
                  `<option value="${abilityKeyOf(ability)}" ${
                    abilityKeyOf(ability) === abilityKey ? "selected" : ""
                  }>${escapeHtml(ability.actorName)} / ${escapeHtml(ability.skillName)}（友好 ${
                    ability.requiredGoodwill
                  }）</option>`,
              )
              .join("")}
          </select>
        </label>
        <label>
          对象
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
        ${
          selectedAbility.skillId === "doctor_adjust_paranoia"
            ? `<label>
                处理
                <select name="option">
                  <option value="remove_paranoia">移除 1 枚不安</option>
                  <option value="add_paranoia">放置 1 枚不安</option>
                </select>
              </label>`
            : ""
        }
        <button class="primary">宣告发动</button>
      </form>
      <button data-action="advance">结束能力阶段</button>
      <button data-action="restart">重开</button>
    </section>
  `;
}

function renderProtagonistAbilityApprovalPanel() {
  const request = state.pendingDecision;
  const actor = state.board.characters[request.actorId];
  const skill = actor.skills.find((candidate) => candidate.id === request.skillId);
  return `
    <section class="panel">
      <h2>能力审批</h2>
      <p class="muted">主人公宣告发动 ${escapeHtml(actor.name)} 的「${escapeHtml(skill.name)}」。</p>
      <p class="muted">对象：${escapeHtml(targetDisplay(request, state))}</p>
      <button class="primary" data-action="approve-protagonist-ability">接受并结算</button>
      <button data-action="reject-protagonist-ability">拒绝</button>
    </section>
  `;
}

function abilityKeyOf(ability) {
  return `${ability.actorId}:${ability.skillId}`;
}

function renderFinalGuessPanel() {
  if (!canControlCurrentPhase()) {
    return renderWaitingPanel("主人公");
  }

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

function renderPlacedActions(view) {
  const actions = view.placedActions;
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
                      <span>${sideLabel(action.side)}${renderDeckBadge(action.deckId)}</span>
                      <strong>${action.cardId === "hidden" ? "暗置牌隐藏" : cardLabel(action.cardId, action.side)}</strong>
                      <span>${targetDisplay(action, view)}</span>
                    </li>
                  `,
                )
                .join("")}
            </ul>`
      }
    </section>
  `;
}

function renderDiscardPiles(view) {
  const mastermindDiscards = view.discardPiles?.[SIDES.MASTERMIND] ?? [];
  const protagonistDiscards = view.discardPiles?.[SIDES.PROTAGONIST] ?? [];
  return `
    <section class="panel compact">
      <h2>本轮弃牌堆</h2>
      ${renderDiscardGroup("剧作家", mastermindDiscards)}
      ${renderDiscardGroup("主人公", protagonistDiscards)}
    </section>
  `;
}

function renderDiscardGroup(title, cards) {
  return `
    <div class="discard-group">
      <h3>${title}</h3>
      ${
        cards.length === 0
          ? `<p class="muted">空</p>`
          : `<ul class="discard-list">
              ${cards
                .map(
                  (card) => `
                    <li>
                      ${renderDeckBadge(card.deckId)}
                      <span>${escapeHtml(card.name)}</span>
                    </li>
                  `,
                )
                .join("")}
            </ul>`
      }
    </div>
  `;
}

function renderTopbarScriptInfo(panels) {
  return `
    <section class="topbar-script">
      ${panels
        .map((panel) => renderScriptMiniCard(panel.view.script, panel.scriptTitle, panel.showPrivate))
        .join("")}
    </section>
  `;
}

function renderScriptMiniCard(script, title, showPrivate) {
  return `
    <article class="script-mini-card">
      <div class="script-mini-head">
        <strong>${title}</strong>
        <span>${showPrivate ? "Closed" : "Open"}</span>
      </div>
      <div class="script-mini-body">
        <ul class="script-mini-rules">
          ${script.rules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}
        </ul>
        <table class="script-mini-table">
          <tbody>
            ${script.incidents
              .map(
                (incident) => `
                  <tr>
                    <td>D${incident.day}</td>
                    <td>${escapeHtml(incident.name)}</td>
                    <td>${escapeHtml(incident.culpritName)}</td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </article>
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
  const markers = actionMarkersForTarget(view, TARGET_TYPES.LOCATION, location.id);
  return `
    <div class="location">
      <div class="location-head">
        <h3>${location.name}</h3>
        <div class="location-status">
          ${renderActionMarkers(markers)}
          ${renderTokenBoxes("intrigue", locationState.intrigue)}
        </div>
      </div>
      <div class="character-list">
        ${characters.map((character) => renderCharacter(character, view)).join("")}
      </div>
    </div>
  `;
}

function renderCharacter(character, view) {
  const markers = actionMarkersForTarget(view, TARGET_TYPES.CHARACTER, character.id);
  return `
    <article class="character ${character.alive ? "" : "dead"}">
      <div class="character-main">
        <strong>${character.name}</strong>
        ${renderTokenBoxes("paranoia", character.paranoia, character.paranoiaLimit)}
      </div>
      ${renderActionMarkers(markers)}
      <div class="role-line">${escapeHtml(character.roleName ?? roles[character.roleId]?.name ?? "")}</div>
      <div class="character-meta">
        <span>${character.attributes.map(escapeHtml).join(" / ")}</span>
        ${
          character.publicTraits.length > 0
            ? `<span>${character.publicTraits.map(escapeHtml).join(" ")}</span>`
            : ""
        }
      </div>
      <div class="intrigue-line">
        ${renderTokenBoxes("intrigue", character.intrigue)}
      </div>
      <ul class="skill-list">
        ${character.skills.map((skill) => renderSkill(skill, character)).join("")}
      </ul>
    </article>
  `;
}

function renderSkill(skill, character) {
  return `
    <li>
      <div class="skill-head">
        ${renderTokenBoxes("goodwill", character.goodwill, skill.requiredGoodwill)}
        <span class="skill-cost">需 ${limitLabel(skill.requiredGoodwill)}</span>
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

function actionMarkersForTarget(view, targetType, targetId) {
  return view.placedActions.filter(
    (action) => action.targetType === targetType && action.targetId === targetId,
  );
}

function renderActionMarkers(actions) {
  if (actions.length === 0) return "";
  return `
    <div class="action-markers" aria-label="暗置行动牌">
      ${actions
        .map((action) => {
          if (action.side === SIDES.MASTERMIND) {
            return `<span class="action-marker marker-mastermind" title="剧作家暗置">剧</span>`;
          }
          return `<span class="action-marker marker-${action.deckId}" title="主人公${protagonistDeckName(
            action.deckId,
          )}暗置">${PROTAGONIST_DECKS.find((deck) => deck.id === action.deckId)?.shortName ?? "主"}</span>`;
        })
        .join("")}
    </div>
  `;
}

function renderTokenBoxes(kind, current, limit = null) {
  const bounded = typeof limit === "number" && limit > 0;
  const total = bounded ? limit : Math.max(1, current);
  const label = { goodwill: "友", paranoia: "不", intrigue: "密" }[kind] ?? "";
  return `
    <span class="token-boxes token-${kind}" title="${label} ${current}${
      bounded ? `/${limit}` : ""
    }">
      <span class="token-label">${label}</span>
      ${Array.from({ length: total }, (_, index) => {
        const filled = index < current;
        return `<span class="token-box ${filled ? "filled" : ""} ${bounded ? "bounded" : ""}"></span>`;
      }).join("")}
      ${!bounded && current > total ? `<span class="token-count">x${current}</span>` : ""}
    </span>
  `;
}

function limitLabel(value) {
  return value == null ? "?" : String(value);
}

function renderLog(view, title) {
  return `
    <section class="log-panel">
      <h2>${title}</h2>
      <ol class="terminal-log">
        ${view.eventLog
          .slice()
          .slice(-80)
          .map((event) => `<li><span>#${event.id}</span>${escapeHtml(event.message)}</li>`)
          .join("")}
      </ol>
    </section>
  `;
}

function scrollLogsToBottom() {
  document.querySelectorAll(".terminal-log").forEach((log) => {
    log.scrollTop = log.scrollHeight;
  });
}

function targetDisplay(action, view) {
  if (action.targetType === TARGET_TYPES.CHARACTER) {
    return view.board.characters[action.targetId]?.name ?? "未知角色";
  }
  return locations[action.targetId]?.name ?? "未知版图";
}

function renderDeckBadge(deckId) {
  if (!deckId) return "";
  const deck = PROTAGONIST_DECKS.find((candidate) => candidate.id === deckId);
  if (!deck) return "";
  return `<span class="deck-badge deck-${deck.id}">${deck.shortName}</span>`;
}

function bindEvents() {
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (action === "advance") safeRun((current) => advancePhase(current));
      if (action === "next-loop") safeRun((current) => startNextLoop(current));
      if (action === "approve-protagonist-ability") {
        safeRun((current) => respondProtagonistAbility(current, { approved: true }));
      }
      if (action === "reject-protagonist-ability") {
        safeRun((current) => respondProtagonistAbility(current, { approved: false }));
      }
      if (action === "restart") {
        state = createGame();
        errorMessage = "";
        selectedCardId = null;
        selectedMastermindAbilityKey = null;
        selectedProtagonistAbilityKey = null;
        publishState();
        render();
      }
    });
  });

  document.querySelector("#card-select")?.addEventListener("change", (event) => {
    selectedCardId = event.target.value;
    render();
  });

  document.querySelector("#mastermind-ability-select")?.addEventListener("change", (event) => {
    selectedMastermindAbilityKey = event.target.value;
    render();
  });

  document.querySelector("#protagonist-ability-select")?.addEventListener("change", (event) => {
    selectedProtagonistAbilityKey = event.target.value;
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
        deckId: side === SIDES.PROTAGONIST ? String(form.get("deckId")) : null,
        cardId: String(form.get("cardId")),
        targetType,
        targetId,
      }),
    );
  });

  document.querySelector("#ability-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const [actorId, abilityId] = String(form.get("abilityKey")).split(":");
    const [targetType, targetId] = String(form.get("target")).split(":");
    safeRun((current) =>
      useMastermindAbility(current, {
        actorId,
        abilityId,
        targetType,
        targetId,
        option: form.get("option") ? String(form.get("option")) : null,
      }),
    );
  });

  document.querySelector("#protagonist-ability-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const [actorId, skillId] = String(form.get("abilityKey")).split(":");
    const [targetType, targetId] = String(form.get("target")).split(":");
    safeRun((current) =>
      requestProtagonistAbility(current, {
        actorId,
        skillId,
        targetType,
        targetId,
        option: form.get("option") ? String(form.get("option")) : null,
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

function loadStoredState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw);
    if (!stored || stored.version !== 2 || stored.scriptId !== beginnerScript.id) return null;
    return stored;
  } catch {
    return null;
  }
}

function publishState() {
  const payload = {
    source: window.name || "tragedy-loop-page",
    state,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  channel?.postMessage(payload);
  sendPrototypeLog("state_published");
}

function receiveSharedState(nextState) {
  if (!nextState || nextState.scriptId !== beginnerScript.id) return;
  if (JSON.stringify(nextState) === JSON.stringify(state)) return;
  state = nextState;
  errorMessage = "";
  selectedCardId = null;
  selectedMastermindAbilityKey = null;
  selectedProtagonistAbilityKey = null;
  render();
}

function getSessionId() {
  const existing = localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const bytes = new Uint32Array(2);
  globalThis.crypto?.getRandomValues?.(bytes);
  const generated = bytes.some(Boolean)
    ? `${Date.now().toString(36)}-${Array.from(bytes, (part) => part.toString(36)).join("-")}`
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(SESSION_KEY, generated);
  return generated;
}

function sendPrototypeLog(reason) {
  const latestEvent = state.eventLog.at(-1) ?? null;
  const signature = `${state.scriptId}:${state.eventSeq}:${state.loop}:${state.day}:${state.phase}:${state.status}:${pageMode}`;
  if (signature === lastLogSignature) return;
  lastLogSignature = signature;

  const payload = {
    sessionId,
    reason,
    pageMode,
    href: window.location.href,
    scriptId: state.scriptId,
    loop: state.loop,
    day: state.day,
    phase: state.phase,
    status: state.status,
    winner: state.winner,
    eventSeq: state.eventSeq,
    latestEvent,
    state,
  };
  const body = JSON.stringify(payload);
  if (navigator.sendBeacon) {
    navigator.sendBeacon(LOG_ENDPOINT, new Blob([body], { type: "application/json" }));
    return;
  }
  fetch(LOG_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // Logging is best-effort and should never interrupt play.
  });
}

channel?.addEventListener("message", (event) => {
  receiveSharedState(event.data?.state);
});

window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  try {
    receiveSharedState(JSON.parse(event.newValue));
  } catch {
    // Ignore malformed cross-tab state.
  }
});

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

publishState();
render();
