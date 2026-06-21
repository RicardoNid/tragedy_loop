const LIST_SEPARATOR = /[、,，;；]/;

const state = {
  config: null,
  target: "",
  cards: [],
  activeIndex: 0,
  dirty: false,
  busy: false,
  lightboxImage: null,
  message: "",
  error: "",
};

const app = document.querySelector("#character-app");

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.lightboxImage) {
    state.lightboxImage = null;
    render();
  }
});

init();

async function init() {
  try {
    state.config = await fetchJson("/api/character-cards/config");
    await loadCards();
  } catch (error) {
    state.error = String(error);
    render();
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function loadCards() {
  if (state.dirty && !confirm("当前修改尚未保存。要放弃这些修改并重载角色卡吗？")) {
    return;
  }
  state.busy = true;
  state.error = "";
  state.message = "";
  render();
  try {
    const payload = await fetchJson("/api/character-cards");
    state.cards = normalizeCards(payload.cards);
    state.target = payload.target_file;
    state.activeIndex = Math.min(state.activeIndex, Math.max(state.cards.length - 1, 0));
    state.dirty = false;
  } catch (error) {
    state.error = String(error);
  } finally {
    state.busy = false;
    render();
  }
}

async function saveCards() {
  state.busy = true;
  state.error = "";
  state.message = "";
  render();
  try {
    const payload = await fetchJson("/api/character-cards", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cards: state.cards }),
    });
    state.cards = normalizeCards(payload.cards);
    state.target = payload.target_file;
    state.activeIndex = Math.min(state.activeIndex, Math.max(state.cards.length - 1, 0));
    state.dirty = false;
    state.message = "已保存";
  } catch (error) {
    state.error = String(error);
  } finally {
    state.busy = false;
    render();
  }
}

function normalizeCards(cards) {
  if (!Array.isArray(cards)) return [];
  return cards.map(normalizeCard);
}

function normalizeCard(card) {
  let firstModule = String(card?.first_module ?? card?.source_batch ?? "").trim();
  if (firstModule === "新手本角色") firstModule = "first-steps";
  return {
    first_module: firstModule,
    page_code: String(card?.page_code ?? "").trim(),
    page_image: String(card?.page_image ?? "").trim(),
    name: String(card?.name ?? "").trim(),
    paranoia_limit: String(card?.paranoia_limit ?? "").trim(),
    goodwill_limit: String(card?.goodwill_limit ?? "").trim(),
    initial_location: String(card?.initial_location ?? "").trim(),
    forbidden_locations: normalizeList(card?.forbidden_locations),
    tags: normalizeList(card?.tags),
    abilities: Array.isArray(card?.abilities) ? card.abilities.map(normalizeAbility) : [],
    notes: String(card?.notes ?? "").trim(),
  };
}

function normalizeList(value) {
  const items = Array.isArray(value) ? value : String(value ?? "").split(LIST_SEPARATOR);
  return [...new Set(items.map((item) => String(item).trim()).filter((item) => item && item !== "无"))];
}

function normalizeAbility(ability) {
  return {
    required_goodwill: String(ability?.required_goodwill ?? "1").trim() || "1",
    frequency: String(ability?.frequency ?? "每天").trim() || "每天",
    timing: String(ability?.timing ?? "主人公能力阶段").trim() || "主人公能力阶段",
    actor: String(ability?.actor ?? "主人公").trim() || "主人公",
    effect: String(ability?.effect ?? "").trim(),
  };
}

function render() {
  app.innerHTML = `
    <header class="editor-topbar">
      <div>
        <p class="eyebrow">CHARACTER CARDS</p>
        <h1>惨剧轮回角色卡编辑器</h1>
      </div>
      <div class="topbar-actions">
        <span class="target">${escapeHtml(state.target || "读取中")}</span>
        <a class="secondary-link" href="./editor.html">模组编辑器</a>
        <a class="secondary-link" href="./traits.html">身份特性池</a>
        <a class="secondary-link" href="./index.html">游戏原型</a>
      </div>
    </header>

    <main class="character-shell">
      <aside class="sidebar">
        ${renderCharacterList()}
        ${renderElementSummary()}
      </aside>
      <section class="editor-main">
        ${renderStatus()}
        ${state.cards.length ? renderCardEditor(state.cards[state.activeIndex]) : renderEmpty()}
      </section>
    </main>

    ${renderLightbox()}
  `;

  bindEvents();
}

function renderStatus() {
  if (state.error) return `<div class="notice error">${escapeHtml(state.error)}</div>`;
  if (state.message) return `<div class="notice success">${escapeHtml(state.message)}</div>`;
  if (state.dirty) return `<div class="notice pending">有未保存修改</div>`;
  return "";
}

function renderCharacterList() {
  return `
    <section class="panel">
      <div class="panel-heading">
        <h2>角色卡</h2>
        <span>${state.cards.length}</span>
      </div>
      <nav class="module-list">
        ${state.cards
          .map(
            (card, index) => `
              <button class="module-button ${index === state.activeIndex ? "active" : ""}" data-character-index="${index}">
                <span>${escapeHtml(card.name || "未命名角色")}</span>
                <small>${escapeHtml(card.page_code || "无页码")}</small>
              </button>
            `,
          )
          .join("")}
      </nav>
    </section>
  `;
}

function renderElementSummary() {
  const elements = state.config?.elements ?? [];
  return `
    <section class="panel">
      <div class="panel-heading">
        <h2>要素</h2>
      </div>
      <div class="element-list">
        ${elements
          .map(
            (element) => `
              <div class="element-item">
                <strong>${escapeHtml(element.name)}</strong>
                <p>${escapeHtml(element.purpose)}</p>
                <small>${element.fields.map(escapeHtml).join(" / ")}</small>
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderEmpty() {
  return `
    <section class="empty-state">
      <h2>未找到角色卡目录</h2>
      <p>${escapeHtml(state.config?.absolute_target_file ?? "")}</p>
      <button class="primary" data-action="add-card">添加角色卡</button>
    </section>
  `;
}

function renderCardEditor(card) {
  return `
    <section class="editor-card">
      <div class="editor-card-header">
        <div>
          <p class="eyebrow">${escapeHtml(card.first_module || "待补充模组")}</p>
          <h2>${escapeHtml(card.name || "未命名角色")}</h2>
        </div>
        <div class="editor-header-actions">
          ${renderSourceActions(card)}
          <div class="button-row">
            <button class="secondary" data-action="reload" ${state.busy ? "disabled" : ""}>重载</button>
            <button class="secondary" data-action="add-card" ${state.busy ? "disabled" : ""}>添加角色</button>
            <button class="secondary" data-action="delete-card" ${state.busy || !state.cards.length ? "disabled" : ""}>删除</button>
            <button class="primary" data-action="save" ${state.busy || !state.dirty ? "disabled" : ""}>保存</button>
          </div>
        </div>
      </div>

      <div class="character-form-grid">
        ${renderSelectField("首次引入模组", "first_module", moduleOptions(), card.first_module)}
        ${renderTextField("页码", "page_code", card.page_code)}
        ${renderTextField("页图", "page_image", card.page_image)}
        ${renderTextField("角色名", "name", card.name)}
        ${renderSelectField("不安限度", "paranoia_limit", limitOptions(), card.paranoia_limit)}
        ${renderSelectField("友好限度", "goodwill_limit", goodwillOptions(), card.goodwill_limit)}
        ${renderSelectField("出生点", "initial_location", locationOptions(), card.initial_location)}
        ${renderForbiddenLocationField(card.forbidden_locations)}
        ${renderListField("标签", "tags", card.tags)}
      </div>

      <section class="character-section">
        <div class="table-toolbar ability-toolbar">
          <div>
            <h3>友好能力</h3>
            <p>每行对应一项卡面能力，保存时会写回 Markdown 的“友好能力”单元格。</p>
          </div>
          <button class="secondary" data-action="add-ability">添加能力</button>
        </div>
        <div class="table-scroll ability-table-scroll">
          <table class="edit-table ability-table">
            <thead>
              <tr>
                <th>友好</th>
                <th>频率</th>
                <th>阶段</th>
                <th>使用方</th>
                <th>效果</th>
                <th class="row-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              ${card.abilities.map((ability, index) => renderAbilityRow(ability, index)).join("")}
            </tbody>
          </table>
        </div>
      </section>

      <section class="character-section notes-section">
        <label>
          备注
          <textarea class="notes-textarea" data-card-field="notes">${escapeHtml(card.notes)}</textarea>
        </label>
      </section>
    </section>
  `;
}

function renderTextField(label, field, value) {
  return `
    <label>
      ${escapeHtml(label)}
      <input data-card-field="${escapeAttr(field)}" value="${escapeAttr(value)}" />
    </label>
  `;
}

function renderSelectField(label, field, options, value) {
  return `
    <label>
      ${escapeHtml(label)}
      <select data-card-field="${escapeAttr(field)}">
        ${renderOptions(options, value)}
      </select>
    </label>
  `;
}

function renderListField(label, field, values) {
  return `
    <label>
      ${escapeHtml(label)}
      <input data-list-field="${escapeAttr(field)}" value="${escapeAttr(values.join("；"))}" />
    </label>
  `;
}

function renderForbiddenLocationField(values) {
  const value = values[0] ?? "无";
  return `
    <label>
      禁行区域
      <select data-forbidden-location>
        ${renderOptions(locationOptions(), value)}
      </select>
    </label>
  `;
}

function renderAbilityRow(ability, index) {
  return `
    <tr>
      <td class="ability-select-cell">
        <select data-ability-field="required_goodwill" data-ability-index="${index}">
          ${renderOptions(goodwillOptions(), ability.required_goodwill)}
        </select>
      </td>
      <td class="ability-select-cell">
        <select data-ability-field="frequency" data-ability-index="${index}">
          ${renderOptions(frequencyOptions(), ability.frequency)}
        </select>
      </td>
      <td class="ability-select-cell">
        <select data-ability-field="timing" data-ability-index="${index}">
          ${renderOptions(timingOptions(), ability.timing)}
        </select>
      </td>
      <td class="ability-select-cell">
        <select data-ability-field="actor" data-ability-index="${index}">
          ${renderOptions(actorOptions(), ability.actor)}
        </select>
      </td>
      <td>
        <textarea data-ability-field="effect" data-ability-index="${index}">${escapeHtml(ability.effect)}</textarea>
      </td>
      <td class="row-actions">
        <button title="上移" data-action="move-ability" data-ability-index="${index}" data-dir="-1">↑</button>
        <button title="下移" data-action="move-ability" data-ability-index="${index}" data-dir="1">↓</button>
        <button title="删除" data-action="delete-ability" data-ability-index="${index}">删</button>
      </td>
    </tr>
  `;
}

function renderSourceActions(card) {
  const imageUrl = card.page_image ? assetUrl(card.page_image) : "";
  return `
    <div class="source-actions" aria-label="原图">
      <span class="inline-label">原图</span>
      ${
        imageUrl
          ? `<button class="secondary" data-action="open-image" data-image-src="${escapeAttr(
              imageUrl,
            )}" data-image-title="${escapeAttr(card.name || "角色卡原图")}">查看</button>`
          : `<span class="muted-hint">无图片</span>`
      }
      ${imageUrl ? `<a class="secondary-link" href="${imageUrl}" target="_blank" rel="noreferrer">新标签</a>` : ""}
    </div>
  `;
}

function renderLightbox() {
  if (!state.lightboxImage) return "";
  return `
    <div class="lightbox" data-action="close-lightbox">
      <div class="lightbox-content">
        <div class="lightbox-bar">
          <span>${escapeHtml(state.lightboxImage.title)}</span>
          <button data-action="close-lightbox">关闭</button>
        </div>
        <img src="${escapeAttr(state.lightboxImage.src)}" alt="${escapeAttr(state.lightboxImage.title)}" />
      </div>
    </div>
  `;
}

function renderOptions(options, selected) {
  const selectedValue = String(selected ?? "");
  const allOptions = options.includes(selectedValue) || !selectedValue ? options : [selectedValue, ...options];
  return allOptions
    .map(
      (option) =>
        `<option value="${escapeAttr(option)}" ${option === selectedValue ? "selected" : ""}>${escapeHtml(option)}</option>`,
    )
    .join("");
}

function bindEvents() {
  document.querySelectorAll("[data-character-index]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeIndex = Number(button.dataset.characterIndex);
      render();
    });
  });

  document.querySelectorAll("[data-card-field]").forEach((field) => {
    field.addEventListener(field.tagName === "SELECT" ? "change" : "input", () => {
      activeCard()[field.dataset.cardField] = field.value;
      markDirty();
    });
  });

  document.querySelectorAll("[data-list-field]").forEach((field) => {
    field.addEventListener("input", () => {
      activeCard()[field.dataset.listField] = normalizeList(field.value);
      markDirty();
    });
  });

  document.querySelectorAll("[data-forbidden-location]").forEach((field) => {
    field.addEventListener("change", () => {
      activeCard().forbidden_locations = field.value === "无" ? [] : [field.value];
      markDirty();
    });
  });

  document.querySelectorAll("[data-ability-field]").forEach((field) => {
    field.addEventListener(field.tagName === "SELECT" ? "change" : "input", () => {
      activeCard().abilities[Number(field.dataset.abilityIndex)][field.dataset.abilityField] = field.value;
      markDirty();
    });
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", (event) => handleAction(button, event));
  });
}

function handleAction(button, event) {
  const action = button.dataset.action;
  if (action === "save") {
    saveCards();
    return;
  }
  if (action === "reload") {
    loadCards();
    return;
  }
  if (action === "add-card") {
    state.cards.push(createEmptyCard());
    state.activeIndex = state.cards.length - 1;
    markDirty();
    render();
    return;
  }
  if (action === "delete-card") {
    state.cards.splice(state.activeIndex, 1);
    state.activeIndex = Math.min(state.activeIndex, Math.max(state.cards.length - 1, 0));
    markDirty();
    render();
    return;
  }
  if (action === "add-ability") {
    activeCard().abilities.push(createEmptyAbility());
    markDirty();
    render();
    return;
  }
  if (action === "delete-ability") {
    activeCard().abilities.splice(Number(button.dataset.abilityIndex), 1);
    markDirty();
    render();
    return;
  }
  if (action === "move-ability") {
    moveAbility(Number(button.dataset.abilityIndex), Number(button.dataset.dir));
    return;
  }
  if (action === "open-image") {
    state.lightboxImage = {
      src: button.dataset.imageSrc,
      title: button.dataset.imageTitle || "原图",
    };
    render();
    return;
  }
  if (action === "close-lightbox" && (event.target === button || button.tagName === "BUTTON")) {
    state.lightboxImage = null;
    render();
  }
}

function activeCard() {
  return state.cards[state.activeIndex];
}

function createEmptyCard() {
  return {
    first_module: moduleOptions()[0] ?? "first-steps",
    page_code: "",
    page_image: "",
    name: "",
    paranoia_limit: "1",
    goodwill_limit: "",
    initial_location: "",
    forbidden_locations: [],
    tags: [],
    abilities: [],
    notes: "",
  };
}

function createEmptyAbility() {
  return {
    required_goodwill: "1",
    frequency: "每天",
    timing: "主人公能力阶段",
    actor: "主人公",
    effect: "",
  };
}

function moveAbility(index, direction) {
  const abilities = activeCard().abilities;
  const target = index + direction;
  if (target < 0 || target >= abilities.length) return;
  const [ability] = abilities.splice(index, 1);
  abilities.splice(target, 0, ability);
  markDirty();
  render();
}

function goodwillOptions() {
  return state.config?.goodwill_options ?? ["1", "2", "3", "4", "5"];
}

function limitOptions() {
  return state.config?.limit_options ?? ["1", "2", "3", "4", "5"];
}

function moduleOptions() {
  return state.config?.modules ?? ["first-steps"];
}

function locationOptions() {
  return state.config?.locations ?? ["学校", "神社", "都市", "医院", "无"];
}

function frequencyOptions() {
  return state.config?.frequencies ?? ["每天", "每轮限 1 次", "待校对"];
}

function timingOptions() {
  return state.config?.timings ?? ["主人公能力阶段", "剧作家能力阶段", "待校对"];
}

function actorOptions() {
  return state.config?.actors ?? ["主人公", "剧作家", "待校对"];
}

function markDirty() {
  state.dirty = true;
  state.message = "";
}

function assetUrl(path) {
  let normalized = path.replace(/^`|`$/g, "").replace(/^(\.\/)+/, "");
  normalized = normalized.replace(/^facts\/source_material\/reference\/character-cards\//, "");
  return `/character-assets/${normalized.split("/").map(encodeURIComponent).join("/")}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
