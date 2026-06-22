const LIST_SEPARATOR = /[、,，;；]/;
const TABS = [
  { key: "overview", label: "概况" },
  { key: "rules", label: "规则" },
  { key: "characters", label: "角色身份" },
  { key: "incidents", label: "事件" },
  { key: "public_incidents", label: "公开事件" },
  { key: "victory_conditions", label: "胜利条件" },
  { key: "text", label: "摘要" },
];

const state = {
  config: null,
  modules: [],
  characters: [],
  target: "",
  scenarios: [],
  activeIndex: 0,
  activeTab: "overview",
  dirty: false,
  busy: false,
  lightboxImage: null,
  message: "",
  error: "",
};

const app = document.querySelector("#scenario-app");

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.lightboxImage) {
    state.lightboxImage = null;
    render();
  }
});

init();

async function init() {
  try {
    state.config = await fetchJson("/api/scenarios/config");
    state.modules = (await fetchJson("/api/scenario-editor/modules")).modules ?? [];
    state.characters = (await fetchJson("/api/scenario-editor/characters")).characters ?? [];
    await loadScenarios();
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

async function loadScenarios() {
  if (state.dirty && !confirm("当前修改尚未保存。要放弃这些修改并重载剧本吗？")) {
    return;
  }
  state.busy = true;
  state.error = "";
  state.message = "";
  render();
  try {
    const payload = await fetchJson("/api/scenarios");
    state.scenarios = normalizeScenarios(payload.scenarios);
    state.scenarios.forEach((scenario) => sanitizeScenarioForModule(scenario));
    state.target = payload.target_file;
    state.activeIndex = Math.min(state.activeIndex, Math.max(state.scenarios.length - 1, 0));
    state.dirty = false;
  } catch (error) {
    state.error = String(error);
  } finally {
    state.busy = false;
    render();
  }
}

async function saveScenarios() {
  state.busy = true;
  state.error = "";
  state.message = "";
  render();
  try {
    const payload = await fetchJson("/api/scenarios", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenarios: state.scenarios }),
    });
    state.scenarios = normalizeScenarios(payload.scenarios);
    state.scenarios.forEach((scenario) => sanitizeScenarioForModule(scenario));
    state.target = payload.target_file;
    state.activeIndex = Math.min(state.activeIndex, Math.max(state.scenarios.length - 1, 0));
    state.dirty = false;
    state.message = "已保存";
  } catch (error) {
    state.error = String(error);
  } finally {
    state.busy = false;
    render();
  }
}

function normalizeScenarios(scenarios) {
  if (!Array.isArray(scenarios)) return [];
  return scenarios.map(normalizeScenario);
}

function normalizeScenario(scenario) {
  return {
    id: String(scenario?.id ?? "").trim(),
    order: String(scenario?.order ?? "").trim(),
    name: String(scenario?.name ?? "").trim(),
    author: String(scenario?.author ?? "").trim(),
    module: String(scenario?.module ?? moduleOptions()[0] ?? "").trim(),
    loop_options: String(scenario?.loop_options ?? "").trim(),
    days_per_loop: String(scenario?.days_per_loop ?? "").trim(),
    discussion: String(scenario?.discussion ?? "由剧作家决定").trim() || "由剧作家决定",
    difficulty: String(scenario?.difficulty ?? "").trim(),
    special_rules: String(scenario?.special_rules ?? "").trim(),
    page_image: String(scenario?.page_image ?? "").trim(),
    source_refs: normalizeList(scenario?.source_refs),
    feature: String(scenario?.feature ?? "").trim(),
    story: String(scenario?.story ?? "").trim(),
    mastermind_guide: String(scenario?.mastermind_guide ?? "").trim(),
    notes: String(scenario?.notes ?? "").trim(),
    rules: Array.isArray(scenario?.rules) ? scenario.rules.map(normalizeRule) : [],
    characters: Array.isArray(scenario?.characters) ? scenario.characters.map(normalizeCharacter) : [],
    incidents: Array.isArray(scenario?.incidents) ? scenario.incidents.map(normalizeIncident) : [],
    public_incidents: Array.isArray(scenario?.public_incidents)
      ? scenario.public_incidents.map(normalizePublicIncident)
      : [],
    victory_conditions: Array.isArray(scenario?.victory_conditions)
      ? scenario.victory_conditions.map(normalizeVictoryCondition)
      : [],
  };
}

function normalizeRule(rule) {
  const slot = String(rule?.slot ?? "Rule X1").trim();
  return {
    slot: ruleSlotOptions().includes(slot) ? slot : "Rule X1",
    rule: String(rule?.rule ?? "").trim(),
    notes: String(rule?.notes ?? "").trim(),
  };
}

function normalizeCharacter(character) {
  return {
    character: String(character?.character ?? "").trim(),
    role: String(character?.role ?? "平民").trim() || "平民",
    notes: String(character?.notes ?? "").trim(),
  };
}

function normalizeIncident(incident) {
  return {
    day: String(incident?.day ?? "").trim(),
    incident: String(incident?.incident ?? "").trim(),
    culprit: String(incident?.culprit ?? "").trim(),
    notes: String(incident?.notes ?? "").trim(),
  };
}

function normalizePublicIncident(incident) {
  return {
    day: String(incident?.day ?? "").trim(),
    incident: String(incident?.incident ?? "").trim(),
    notes: String(incident?.notes ?? "").trim(),
  };
}

function normalizeVictoryCondition(condition) {
  return {
    condition: String(condition?.condition ?? "").trim(),
    methods: String(condition?.methods ?? "").trim(),
  };
}

function normalizeList(value) {
  const items = Array.isArray(value) ? value : String(value ?? "").split(LIST_SEPARATOR);
  return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))];
}

function render() {
  app.innerHTML = `
    <header class="editor-topbar">
      <div>
        <p class="eyebrow">SCENARIO REVIEW</p>
        <h1>惨剧轮回剧本审阅编辑器</h1>
      </div>
      <div class="topbar-actions">
        <span class="target">${escapeHtml(state.target || "读取中")}</span>
        <a class="secondary-link" href="./editor.html">模组编辑器</a>
        <a class="secondary-link" href="./characters.html">角色卡</a>
        <a class="secondary-link" href="./index.html">游戏原型</a>
      </div>
    </header>

    <main class="character-shell">
      <aside class="sidebar">
        ${renderScenarioList()}
        ${renderElementSummary()}
      </aside>
      <section class="editor-main">
        ${renderStatus()}
        ${state.scenarios.length ? renderScenarioEditor(activeScenario()) : renderEmpty()}
      </section>
    </main>

    ${renderCharacterDatalist()}
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

function renderScenarioList() {
  return `
    <section class="panel">
      <div class="panel-heading">
        <h2>剧本</h2>
        <span>${state.scenarios.length}</span>
      </div>
      <nav class="module-list">
        ${state.scenarios
          .map(
            (scenario, index) => `
              <button class="module-button ${index === state.activeIndex ? "active" : ""}" data-scenario-index="${index}">
                <span>${escapeHtml(scenario.order ? `${scenario.order}. ${scenario.name || "未命名剧本"}` : scenario.name || "未命名剧本")}</span>
                <small>${escapeHtml(scenario.module || "无模组")}</small>
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
      <h2>未找到剧本目录</h2>
      <p>${escapeHtml(state.config?.absolute_target_file ?? "")}</p>
      <button class="primary" data-action="add-scenario">添加剧本</button>
    </section>
  `;
}

function renderScenarioEditor(scenario) {
  return `
    <section class="editor-card">
      <div class="editor-card-header">
        <div>
          <p class="eyebrow">${escapeHtml(scenario.module || "待补充模组")}</p>
          <h2>${escapeHtml(scenario.name || "未命名剧本")}</h2>
        </div>
        <div class="editor-header-actions">
          ${renderSourceActions(scenario)}
          <div class="button-row">
            <button class="secondary" data-action="reload" ${state.busy ? "disabled" : ""}>重载</button>
            <button class="secondary" data-action="add-scenario" ${state.busy ? "disabled" : ""}>添加剧本</button>
            <button class="secondary" data-action="delete-scenario" ${state.busy || !state.scenarios.length ? "disabled" : ""}>删除</button>
            <button class="primary" data-action="save" ${state.busy || !state.dirty ? "disabled" : ""}>保存</button>
          </div>
        </div>
      </div>

      <div class="tabs" role="tablist">
        ${TABS.map((tab) => renderTabButton(tab, scenario)).join("")}
      </div>

      ${renderActiveTab(scenario)}
    </section>
  `;
}

function renderTabButton(tab, scenario) {
  const count = tabCount(tab.key, scenario);
  return `
    <button class="${tab.key === state.activeTab ? "active" : ""}" data-tab="${escapeAttr(tab.key)}">
      ${escapeHtml(tab.label)}
      ${count === null ? "" : `<span>${count}</span>`}
    </button>
  `;
}

function tabCount(tab, scenario) {
  if (Array.isArray(scenario[tab])) return scenario[tab].length;
  if (tab === "text") return null;
  if (tab === "overview") return null;
  return 0;
}

function renderActiveTab(scenario) {
  if (state.activeTab === "overview") return renderOverview(scenario);
  if (state.activeTab === "rules") return renderRules(scenario);
  if (state.activeTab === "characters") return renderCharacters(scenario);
  if (state.activeTab === "incidents") return renderIncidents(scenario);
  if (state.activeTab === "public_incidents") return renderPublicIncidents(scenario);
  if (state.activeTab === "victory_conditions") return renderVictoryConditions(scenario);
  return renderTextSummaries(scenario);
}

function renderOverview(scenario) {
  return `
    <div class="scenario-form-grid">
      ${renderTextField("剧本ID", "id", scenario.id)}
      ${renderTextField("序号", "order", scenario.order)}
      ${renderTextField("剧本名", "name", scenario.name)}
      ${renderTextField("作者", "author", scenario.author)}
      ${renderSelectField("使用模组", "module", moduleOptions(), scenario.module)}
      ${renderTextField("轮回选项", "loop_options", scenario.loop_options)}
      ${renderTextField("每轮天数", "days_per_loop", scenario.days_per_loop)}
      ${renderSelectField("讨论", "discussion", discussionOptions(), scenario.discussion)}
      ${renderTextField("难度", "difficulty", scenario.difficulty)}
      ${renderTextField("页图", "page_image", scenario.page_image)}
      ${renderListField("来源", "source_refs", scenario.source_refs)}
    </div>
    <section class="character-section notes-section">
      <label>
        特有规则
        <textarea class="notes-textarea" data-scenario-field="special_rules">${escapeHtml(scenario.special_rules)}</textarea>
      </label>
    </section>
  `;
}

function renderTextField(label, field, value) {
  return `
    <label>
      ${escapeHtml(label)}
      <input data-scenario-field="${escapeAttr(field)}" value="${escapeAttr(value)}" />
    </label>
  `;
}

function renderSelectField(label, field, options, value) {
  return `
    <label>
      ${escapeHtml(label)}
      <select data-scenario-field="${escapeAttr(field)}">
        ${renderOptions(options, value)}
      </select>
    </label>
  `;
}

function renderListField(label, field, values) {
  return `
    <label>
      ${escapeHtml(label)}
      <input data-list-field="${escapeAttr(field)}" value="${escapeAttr((values ?? []).join("；"))}" />
    </label>
  `;
}

function renderRules(scenario) {
  return `
    <section class="character-section">
      ${renderTableToolbar("采用规则", "规则槽决定下拉内容：Rule Y 只能选择当前模组规则 Y；Rule X 可选当前模组规则 X 或“无”。", "add-rule", "添加规则")}
      <div class="table-scroll scenario-table-scroll">
        <table class="edit-table scenario-rules-table">
          <thead>
            <tr>
              <th>规则槽</th>
              <th>规则名</th>
              <th>备注</th>
              <th class="row-actions">操作</th>
            </tr>
          </thead>
          <tbody>${scenario.rules.map((rule, index) => renderRuleRow(scenario, rule, index)).join("")}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderRuleRow(scenario, rule, index) {
  return `
    <tr>
      <td class="scenario-select-cell">
        <select data-rule-field="slot" data-row="${index}">
          ${renderOptions(ruleSlotOptions(), rule.slot)}
        </select>
      </td>
      <td class="scenario-select-cell wide">
        <select data-rule-field="rule" data-row="${index}">
          ${renderOptions(ruleOptions(scenario, rule.slot), rule.rule)}
        </select>
      </td>
      <td>
        <textarea data-rule-field="notes" data-row="${index}">${escapeHtml(rule.notes)}</textarea>
      </td>
      ${renderRowActions(index, "rule")}
    </tr>
  `;
}

function renderCharacters(scenario) {
  return `
    <section class="character-section">
      ${renderTableToolbar("角色身份", "身份下拉由当前模组身份表决定，平民为通用占位身份。", "add-character", "添加角色")}
      <div class="table-scroll scenario-table-scroll">
        <table class="edit-table scenario-character-table">
          <thead>
            <tr>
              <th>人物</th>
              <th>身份</th>
              <th>备注</th>
              <th class="row-actions">操作</th>
            </tr>
          </thead>
          <tbody>${scenario.characters.map((character, index) => renderCharacterRow(scenario, character, index)).join("")}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderCharacterRow(scenario, character, index) {
  return `
    <tr>
      <td class="scenario-input-cell">
        <input list="scenario-character-options" data-character-field="character" data-row="${index}" value="${escapeAttr(character.character)}" />
      </td>
      <td class="scenario-select-cell wide">
        <select data-character-field="role" data-row="${index}">
          ${renderOptions(roleOptions(scenario), character.role)}
        </select>
      </td>
      <td>
        <textarea data-character-field="notes" data-row="${index}">${escapeHtml(character.notes)}</textarea>
      </td>
      ${renderRowActions(index, "character")}
    </tr>
  `;
}

function renderIncidents(scenario) {
  return `
    <section class="character-section">
      ${renderTableToolbar("事件", "事件下拉由当前模组事件表决定；当事人对主人公不可见。", "add-incident", "添加事件")}
      <div class="table-scroll scenario-table-scroll">
        <table class="edit-table scenario-incident-table">
          <thead>
            <tr>
              <th>日期</th>
              <th>事件</th>
              <th>当事人</th>
              <th>备注</th>
              <th class="row-actions">操作</th>
            </tr>
          </thead>
          <tbody>${scenario.incidents.map((incident, index) => renderIncidentRow(scenario, incident, index)).join("")}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderIncidentRow(scenario, incident, index) {
  return `
    <tr>
      <td class="scenario-input-cell compact">
        <input data-incident-field="day" data-row="${index}" value="${escapeAttr(incident.day)}" />
      </td>
      <td class="scenario-select-cell wide">
        <select data-incident-field="incident" data-row="${index}">
          ${renderOptions(incidentOptions(scenario), incident.incident)}
        </select>
      </td>
      <td class="scenario-input-cell">
        <input list="scenario-character-options" data-incident-field="culprit" data-row="${index}" value="${escapeAttr(incident.culprit)}" />
      </td>
      <td>
        <textarea data-incident-field="notes" data-row="${index}">${escapeHtml(incident.notes)}</textarea>
      </td>
      ${renderRowActions(index, "incident")}
    </tr>
  `;
}

function renderPublicIncidents(scenario) {
  return `
    <section class="character-section">
      ${renderTableToolbar("公开事件", "公开事件只记录主人公可见的日期与事件名。", "add-public-incident", "添加公开事件")}
      <div class="table-scroll scenario-table-scroll">
        <table class="edit-table scenario-public-incident-table">
          <thead>
            <tr>
              <th>日期</th>
              <th>事件</th>
              <th>备注</th>
              <th class="row-actions">操作</th>
            </tr>
          </thead>
          <tbody>${scenario.public_incidents
            .map((incident, index) => renderPublicIncidentRow(scenario, incident, index))
            .join("")}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderPublicIncidentRow(scenario, incident, index) {
  return `
    <tr>
      <td class="scenario-input-cell compact">
        <input data-public-incident-field="day" data-row="${index}" value="${escapeAttr(incident.day)}" />
      </td>
      <td class="scenario-select-cell wide">
        <select data-public-incident-field="incident" data-row="${index}">
          ${renderOptions(incidentOptions(scenario), incident.incident)}
        </select>
      </td>
      <td>
        <textarea data-public-incident-field="notes" data-row="${index}">${escapeHtml(incident.notes)}</textarea>
      </td>
      ${renderRowActions(index, "public-incident")}
    </tr>
  `;
}

function renderVictoryConditions(scenario) {
  return `
    <section class="character-section">
      ${renderTableToolbar("剧作家胜利条件", "按条件和可用手段提炼，不复制长篇指南原文。", "add-victory", "添加胜利条件")}
      <div class="table-scroll scenario-table-scroll">
        <table class="edit-table scenario-victory-table">
          <thead>
            <tr>
              <th>条件</th>
              <th>可用手段</th>
              <th class="row-actions">操作</th>
            </tr>
          </thead>
          <tbody>${scenario.victory_conditions
            .map((condition, index) => renderVictoryConditionRow(condition, index))
            .join("")}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderVictoryConditionRow(condition, index) {
  return `
    <tr>
      <td>
        <textarea data-victory-field="condition" data-row="${index}">${escapeHtml(condition.condition)}</textarea>
      </td>
      <td>
        <textarea data-victory-field="methods" data-row="${index}">${escapeHtml(condition.methods)}</textarea>
      </td>
      ${renderRowActions(index, "victory")}
    </tr>
  `;
}

function renderTextSummaries(scenario) {
  return `
    <section class="character-section notes-section scenario-text-section">
      <label>
        剧本特征
        <textarea class="notes-textarea" data-scenario-field="feature">${escapeHtml(scenario.feature)}</textarea>
      </label>
      <label>
        故事摘要
        <textarea class="notes-textarea" data-scenario-field="story">${escapeHtml(scenario.story)}</textarea>
      </label>
      <label>
        剧作家指引
        <textarea class="notes-textarea" data-scenario-field="mastermind_guide">${escapeHtml(scenario.mastermind_guide)}</textarea>
      </label>
      <label>
        备注
        <textarea class="notes-textarea" data-scenario-field="notes">${escapeHtml(scenario.notes)}</textarea>
      </label>
    </section>
  `;
}

function renderTableToolbar(title, description, action, buttonLabel) {
  return `
    <div class="table-toolbar ability-toolbar">
      <div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(description)}</p>
      </div>
      <button class="secondary" data-action="${escapeAttr(action)}">${escapeHtml(buttonLabel)}</button>
    </div>
  `;
}

function renderRowActions(index, type) {
  return `
    <td class="row-actions">
      <button title="上移" data-action="move-${type}" data-row="${index}" data-dir="-1">↑</button>
      <button title="下移" data-action="move-${type}" data-row="${index}" data-dir="1">↓</button>
      <button title="删除" data-action="delete-${type}" data-row="${index}">删</button>
    </td>
  `;
}

function renderSourceActions(scenario) {
  const imageUrl = scenario.page_image ? assetUrl(scenario.page_image) : "";
  return `
    <div class="source-actions" aria-label="原图">
      <span class="inline-label">信息表</span>
      ${
        imageUrl
          ? `<button class="secondary" data-action="open-image" data-image-src="${escapeAttr(
              imageUrl,
            )}" data-image-title="${escapeAttr(scenario.name || "剧本信息表")}">查看</button>`
          : `<span class="muted-hint">无图片</span>`
      }
      ${imageUrl ? `<a class="secondary-link" href="${imageUrl}" target="_blank" rel="noreferrer">新标签</a>` : ""}
    </div>
  `;
}

function renderCharacterDatalist() {
  const fromScenarios = state.scenarios.flatMap((scenario) => [
    ...scenario.characters.map((item) => item.character),
    ...scenario.incidents.map((item) => item.culprit),
  ]);
  const options = [...new Set([...state.characters, ...fromScenarios].map((item) => String(item).trim()).filter(Boolean))];
  return `
    <datalist id="scenario-character-options">
      ${options.map((option) => `<option value="${escapeAttr(option)}"></option>`).join("")}
    </datalist>
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
  const cleanOptions = [...new Set((options ?? []).map((option) => String(option).trim()).filter(Boolean))];
  const allOptions = cleanOptions.length ? cleanOptions : selectedValue ? [selectedValue] : [];
  return allOptions
    .map(
      (option) =>
        `<option value="${escapeAttr(option)}" ${option === selectedValue ? "selected" : ""}>${escapeHtml(option)}</option>`,
    )
    .join("");
}

function bindEvents() {
  document.querySelectorAll("[data-scenario-index]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeIndex = Number(button.dataset.scenarioIndex);
      render();
    });
  });

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab;
      render();
    });
  });

  document.querySelectorAll("[data-scenario-field]").forEach((field) => {
    field.addEventListener(field.tagName === "SELECT" ? "change" : "input", () => {
      activeScenario()[field.dataset.scenarioField] = field.value;
      if (field.dataset.scenarioField === "module") {
        sanitizeScenarioForModule(activeScenario());
        markDirty();
        render();
        return;
      }
      markDirty();
    });
  });

  document.querySelectorAll("[data-list-field]").forEach((field) => {
    field.addEventListener("input", () => {
      activeScenario()[field.dataset.listField] = normalizeList(field.value);
      markDirty();
    });
  });

  document.querySelectorAll("[data-rule-field]").forEach((field) => {
    field.addEventListener(field.tagName === "SELECT" ? "change" : "input", () => {
      const rule = activeScenario().rules[Number(field.dataset.row)];
      rule[field.dataset.ruleField] = field.value;
      if (field.dataset.ruleField === "slot") {
        rule.rule = defaultRuleForSlot(activeScenario(), rule.slot);
        markDirty();
        render();
        return;
      }
      markDirty();
    });
  });

  document.querySelectorAll("[data-character-field]").forEach((field) => {
    field.addEventListener(field.tagName === "SELECT" ? "change" : "input", () => {
      activeScenario().characters[Number(field.dataset.row)][field.dataset.characterField] = field.value;
      markDirty();
    });
  });

  document.querySelectorAll("[data-incident-field]").forEach((field) => {
    field.addEventListener(field.tagName === "SELECT" ? "change" : "input", () => {
      activeScenario().incidents[Number(field.dataset.row)][field.dataset.incidentField] = field.value;
      markDirty();
    });
  });

  document.querySelectorAll("[data-public-incident-field]").forEach((field) => {
    field.addEventListener(field.tagName === "SELECT" ? "change" : "input", () => {
      activeScenario().public_incidents[Number(field.dataset.row)][field.dataset.publicIncidentField] = field.value;
      markDirty();
    });
  });

  document.querySelectorAll("[data-victory-field]").forEach((field) => {
    field.addEventListener("input", () => {
      activeScenario().victory_conditions[Number(field.dataset.row)][field.dataset.victoryField] = field.value;
      markDirty();
    });
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", (event) => handleAction(button, event));
  });
}

function handleAction(button, event) {
  const action = button.dataset.action;
  if (action === "save") return saveScenarios();
  if (action === "reload") return loadScenarios();
  if (action === "add-scenario") return addScenario();
  if (action === "delete-scenario") return deleteScenario();
  if (action === "add-rule") return addRule();
  if (action === "delete-rule") return deleteArrayItem(activeScenario().rules, Number(button.dataset.row));
  if (action === "move-rule") return moveArrayItem(activeScenario().rules, Number(button.dataset.row), Number(button.dataset.dir));
  if (action === "add-character") return addCharacter();
  if (action === "delete-character") return deleteArrayItem(activeScenario().characters, Number(button.dataset.row));
  if (action === "move-character")
    return moveArrayItem(activeScenario().characters, Number(button.dataset.row), Number(button.dataset.dir));
  if (action === "add-incident") return addIncident();
  if (action === "delete-incident") return deleteArrayItem(activeScenario().incidents, Number(button.dataset.row));
  if (action === "move-incident")
    return moveArrayItem(activeScenario().incidents, Number(button.dataset.row), Number(button.dataset.dir));
  if (action === "add-public-incident") return addPublicIncident();
  if (action === "delete-public-incident")
    return deleteArrayItem(activeScenario().public_incidents, Number(button.dataset.row));
  if (action === "move-public-incident")
    return moveArrayItem(activeScenario().public_incidents, Number(button.dataset.row), Number(button.dataset.dir));
  if (action === "add-victory") return addVictoryCondition();
  if (action === "delete-victory")
    return deleteArrayItem(activeScenario().victory_conditions, Number(button.dataset.row));
  if (action === "move-victory")
    return moveArrayItem(activeScenario().victory_conditions, Number(button.dataset.row), Number(button.dataset.dir));
  if (action === "open-image") {
    state.lightboxImage = {
      src: button.dataset.imageSrc,
      title: button.dataset.imageTitle || "剧本信息表",
    };
    render();
    return;
  }
  if (action === "close-lightbox" && (event.target === button || button.tagName === "BUTTON")) {
    state.lightboxImage = null;
    render();
  }
}

function activeScenario() {
  return state.scenarios[state.activeIndex];
}

function addScenario() {
  const scenario = createEmptyScenario();
  sanitizeScenarioForModule(scenario);
  state.scenarios.push(scenario);
  state.activeIndex = state.scenarios.length - 1;
  state.activeTab = "overview";
  markDirty();
  render();
}

function deleteScenario() {
  state.scenarios.splice(state.activeIndex, 1);
  state.activeIndex = Math.min(state.activeIndex, Math.max(state.scenarios.length - 1, 0));
  markDirty();
  render();
}

function createEmptyScenario() {
  const module = moduleOptions()[0] ?? "first-steps";
  const scenario = {
    id: uniqueScenarioId(),
    order: String(state.scenarios.length + 1),
    name: "",
    author: "",
    module,
    loop_options: "",
    days_per_loop: "",
    discussion: "由剧作家决定",
    difficulty: "",
    special_rules: "",
    page_image: "",
    source_refs: [],
    feature: "",
    story: "",
    mastermind_guide: "",
    notes: "",
    rules: [],
    characters: [],
    incidents: [],
    public_incidents: [],
    victory_conditions: [],
  };
  scenario.rules = [
    { slot: "Rule Y", rule: defaultRuleForSlot(scenario, "Rule Y"), notes: "" },
    { slot: "Rule X1", rule: defaultRuleForSlot(scenario, "Rule X1"), notes: "" },
    { slot: "Rule X2", rule: noRuleOption(), notes: "" },
  ];
  return scenario;
}

function uniqueScenarioId() {
  let index = state.scenarios.length + 1;
  let candidate = `scenario-${String(index).padStart(2, "0")}`;
  const used = new Set(state.scenarios.map((scenario) => scenario.id));
  while (used.has(candidate)) {
    index += 1;
    candidate = `scenario-${String(index).padStart(2, "0")}`;
  }
  return candidate;
}

function addRule() {
  activeScenario().rules.push({ slot: "Rule X1", rule: defaultRuleForSlot(activeScenario(), "Rule X1"), notes: "" });
  markDirty();
  render();
}

function addCharacter() {
  activeScenario().characters.push({
    character: "",
    role: roleOptions(activeScenario())[0] ?? "平民",
    notes: "",
  });
  markDirty();
  render();
}

function addIncident() {
  activeScenario().incidents.push({
    day: "",
    incident: incidentOptions(activeScenario())[0] ?? "",
    culprit: "",
    notes: "",
  });
  markDirty();
  render();
}

function addPublicIncident() {
  activeScenario().public_incidents.push({
    day: "",
    incident: incidentOptions(activeScenario())[0] ?? "",
    notes: "",
  });
  markDirty();
  render();
}

function addVictoryCondition() {
  activeScenario().victory_conditions.push({ condition: "", methods: "" });
  markDirty();
  render();
}

function deleteArrayItem(items, index) {
  items.splice(index, 1);
  markDirty();
  render();
}

function moveArrayItem(items, index, direction) {
  const target = index + direction;
  if (target < 0 || target >= items.length) return;
  const [item] = items.splice(index, 1);
  items.splice(target, 0, item);
  markDirty();
  render();
}

function sanitizeScenarioForModule(scenario) {
  const detail = moduleDetails(scenario.module);
  if (!detail) return;
  for (const rule of scenario.rules) {
    const options = ruleOptions(scenario, rule.slot);
    if (options.length && !options.includes(rule.rule)) {
      rule.rule = defaultRuleForSlot(scenario, rule.slot);
    }
  }
  const roles = roleOptions(scenario);
  for (const character of scenario.characters) {
    if (roles.length && !roles.includes(character.role)) character.role = roles[0];
  }
  const incidents = incidentOptions(scenario);
  for (const incident of scenario.incidents) {
    if (incidents.length && !incidents.includes(incident.incident)) incident.incident = incidents[0];
  }
  for (const incident of scenario.public_incidents) {
    if (incidents.length && !incidents.includes(incident.incident)) incident.incident = incidents[0];
  }
}

function moduleDetails(moduleId) {
  return state.modules.find((module) => module.id === moduleId);
}

function moduleOptions() {
  return state.modules.map((module) => module.id);
}

function ruleSlotOptions() {
  return state.config?.rule_slots ?? ["Rule Y", "Rule X1", "Rule X2"];
}

function discussionOptions() {
  return state.config?.discussion_options ?? ["由剧作家决定", "可", "不可", "待校对"];
}

function noRuleOption() {
  return state.config?.no_rule ?? "无";
}

function ruleOptions(scenario, slot) {
  const detail = moduleDetails(scenario.module);
  if (!detail) return [];
  if (slot === "Rule Y") return detail.rules?.["Rule Y"] ?? [];
  return [...(detail.rules?.["Rule X"] ?? []), noRuleOption()];
}

function defaultRuleForSlot(scenario, slot) {
  if (slot !== "Rule Y" && slot !== "Rule X1") return noRuleOption();
  return ruleOptions(scenario, slot)[0] ?? (slot === "Rule Y" ? "" : noRuleOption());
}

function roleOptions(scenario) {
  const common = state.config?.common_roles ?? ["平民"];
  const detail = moduleDetails(scenario.module);
  return [...new Set([...common, ...(detail?.roles ?? [])])];
}

function incidentOptions(scenario) {
  return moduleDetails(scenario.module)?.incidents ?? [];
}

function markDirty() {
  state.dirty = true;
  state.message = "";
}

function assetUrl(path) {
  let normalized = path.replace(/^`|`$/g, "").replace(/^(\.\/)+/, "");
  normalized = normalized.replace(/^facts\/source_material\/reference\//, "");
  return `/scenario-assets/${normalized.split("/").map(encodeURIComponent).join("/")}`;
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
