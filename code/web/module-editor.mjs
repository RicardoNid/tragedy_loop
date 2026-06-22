const RULE_TYPE_FALLBACK = ["规则Y", "规则X"];
const COUNT_FALLBACK = ["1", "2", "3", "4", "5"];
const COUNT_RULE_FALLBACK = ["默认", "最多", "至少"];

const TABLES = {
  rules: {
    label: "规则表",
    columns: ["规则类型", "规则名", "登场身份", "追加规则"],
    addLabel: "添加规则",
  },
  roles: {
    label: "身份表",
    columns: ["身份名", "数量上限", "身份特性", "能力"],
    addLabel: "添加身份",
  },
  incidents: {
    label: "事件表",
    columns: ["事件名", "事件效果"],
    addLabel: "添加事件",
  },
};

const APPEARANCE_COLUMN = "登场身份";
const ROLE_TRAITS_COLUMN = "身份特性";

const state = {
  config: null,
  traits: [],
  modules: [],
  activeId: null,
  activeTable: "rules",
  activeModule: null,
  dirty: false,
  busy: false,
  imageMode: "annotated",
  lightboxImage: null,
  message: "",
  error: "",
};

const app = document.querySelector("#editor-app");

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.lightboxImage) {
    state.lightboxImage = null;
    render();
  }
});

init();

async function init() {
  try {
    state.config = await fetchJson("/api/module-editor/config");
    state.traits = (await fetchJson("/api/module-editor/traits")).traits;
    const response = await fetchJson("/api/module-editor/modules");
    state.modules = response.modules;
    state.activeId = state.modules[0]?.id ?? null;
    if (state.activeId) {
      await loadModule(state.activeId);
    }
  } catch (error) {
    state.error = String(error);
  }
  render();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function loadModule(id) {
  if (state.dirty && !confirm("当前修改尚未保存。要放弃这些修改并切换模组吗？")) {
    return;
  }
  state.busy = true;
  state.error = "";
  state.message = "";
  render();
  try {
    state.activeId = id;
    state.activeModule = normalizeModule(await fetchJson(`/api/module-editor/modules/${encodeURIComponent(id)}`));
    state.dirty = false;
  } catch (error) {
    state.error = String(error);
  } finally {
    state.busy = false;
    render();
  }
}

async function saveModule() {
  if (!state.activeModule) return;
  state.busy = true;
  state.error = "";
  state.message = "";
  render();
  try {
    state.activeModule = normalizeModule(
      await fetchJson(`/api/module-editor/modules/${encodeURIComponent(state.activeModule.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state.activeModule),
      }),
    );
    state.dirty = false;
    state.message = "已保存";
    const response = await fetchJson("/api/module-editor/modules");
    state.modules = response.modules;
  } catch (error) {
    state.error = String(error);
  } finally {
    state.busy = false;
    render();
  }
}

function normalizeModule(module) {
  module.tables ??= {};
  module.source_refs ??= {};
  for (const [key, table] of Object.entries(TABLES)) {
    module.tables[key] ??= [];
    module.tables[key] = module.tables[key].map((row) => normalizeRow(key, row));
    module.source_refs[key] ??= [];
    for (const column of table.columns) {
      for (const row of module.tables[key]) {
        row[column] ??= column === APPEARANCE_COLUMN || column === ROLE_TRAITS_COLUMN ? [] : "";
      }
    }
  }
  return module;
}

function normalizeRow(tableKey, row) {
  if (tableKey === "roles") {
    return {
      身份名: row["身份名"] || "",
      数量上限: row["数量上限"] || "",
      身份特性: normalizeTraits(row[ROLE_TRAITS_COLUMN]),
      能力: row["能力"] || "",
    };
  }
  if (tableKey !== "rules") return { ...row };
  return {
    规则类型: row["规则类型"] || "规则Y",
    规则名: row["规则名"] || "",
    登场身份: normalizeAppearances(row[APPEARANCE_COLUMN]),
    追加规则: row["追加规则"] || "",
  };
}

function normalizeAppearances(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => ({
        identity: String(item?.identity ?? item?.身份 ?? "").trim(),
        count: String(item?.count ?? item?.数量 ?? "1").trim(),
        count_rule: String(item?.count_rule ?? item?.数量规则 ?? "默认").trim(),
      }))
      .filter((item) => item.identity);
  }
  if (typeof value !== "string" || !value.trim() || value.startsWith("待校对")) return [];
  return value
    .split(/[;；]/)
    .map((part) => part.trim().match(/^(.+?)\s*[-:：]\s*([1-5])\s*[-:：]\s*(默认|最多|至少)$/))
    .filter(Boolean)
    .map((match) => ({ identity: match[1].trim(), count: match[2], count_rule: match[3] }));
}

function normalizeTraits(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))];
  }
  if (typeof value !== "string" || !value.trim()) return [];
  return [
    ...new Set(
      value
        .split(/[、,，;；]/)
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
}

function render() {
  app.innerHTML = `
    <header class="editor-topbar">
      <div>
        <p class="eyebrow">MODULE REVIEW</p>
        <h1>惨剧轮回模组审阅编辑器</h1>
      </div>
      <div class="topbar-actions">
        <span class="target">${escapeHtml(state.config?.target_directory ?? "读取中")}</span>
        <a class="secondary-link" href="/site/characters.html">角色卡</a>
        <a class="secondary-link" href="/site/traits.html">身份特性池</a>
        <a class="secondary-link" href="/site/">资料站</a>
        <a class="secondary-link" href="/prototype/">游戏原型</a>
      </div>
    </header>

    <main class="editor-shell">
      <aside class="sidebar">
        ${renderModuleList()}
        ${renderElementSummary()}
      </aside>
      <section class="editor-main">
        ${renderStatus()}
        ${state.activeModule ? renderEditor() : renderEmpty()}
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

function renderModuleList() {
  return `
    <section class="panel">
      <div class="panel-heading">
        <h2>模组</h2>
        <span>${state.modules.length}</span>
      </div>
      <nav class="module-list">
        ${state.modules
          .map(
            (module) => `
              <button class="module-button ${module.id === state.activeId ? "active" : ""}"
                data-module-id="${escapeAttr(module.id)}">
                <span>${escapeHtml(titleName(module.title))}</span>
                <small>${module.counts.rules}/${module.counts.roles}/${module.counts.incidents}</small>
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
      <h2>未找到模组审阅稿</h2>
      <p>${escapeHtml(state.config?.absolute_target_directory ?? "")}</p>
    </section>
  `;
}

function renderEditor() {
  const module = state.activeModule;
  const table = TABLES[state.activeTable];
  const rows = module.tables[state.activeTable] ?? [];
  return `
    <section class="editor-card">
      <div class="editor-card-header">
        <div>
          <p class="eyebrow">${escapeHtml(module.filename)}</p>
          <h2>${escapeHtml(module.title)}</h2>
        </div>
        <div class="editor-header-actions">
          ${renderReferenceActions(module)}
          <div class="button-row">
            <button class="secondary" data-action="reload" ${state.busy ? "disabled" : ""}>重载</button>
            <button class="primary" data-action="save" ${state.busy || !state.dirty ? "disabled" : ""}>保存</button>
          </div>
        </div>
      </div>

      <div class="meta-grid">
        <label>
          状态
          <input data-meta="status" value="${escapeAttr(module.status ?? "")}" />
        </label>
        <label>
          页图
          <input data-meta="page_image" value="${escapeAttr(module.page_image ?? "")}" />
        </label>
        <label>
          标注图
          <input data-meta="annotated_image" value="${escapeAttr(module.annotated_image ?? "")}" />
        </label>
      </div>

      <div class="tabs" role="tablist">
        ${Object.entries(TABLES)
          .map(
            ([key, candidate]) => `
              <button class="${key === state.activeTable ? "active" : ""}" data-table="${key}">
                ${candidate.label}
                <span>${(module.tables[key] ?? []).length}</span>
              </button>
            `,
          )
          .join("")}
      </div>

      <div class="table-toolbar">
        <div>
          <h3>${table.label}</h3>
          <p>出处：${escapeHtml((module.source_refs[state.activeTable] ?? []).join(", ") || "待补充")}</p>
        </div>
        <button class="secondary" data-action="add-row">${table.addLabel}</button>
      </div>

      <div class="table-scroll">
        <table class="edit-table ${state.activeTable === "rules" ? "rules-table" : ""} ${
          state.activeTable === "roles" ? "roles-table" : ""
        }">
          <thead>
            <tr>
              ${table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}
              <th class="row-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row, rowIndex) => renderRow(row, rowIndex, table.columns)).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderRow(row, rowIndex, columns) {
  if (state.activeTable === "rules") return renderRuleRow(row, rowIndex);
  if (state.activeTable === "roles") return renderRoleRow(row, rowIndex);
  return `
    <tr>
      ${columns
        .map(
          (column) => `
            <td>
              <textarea data-cell-row="${rowIndex}" data-column="${escapeAttr(column)}">${escapeHtml(
                row[column] ?? "",
              )}</textarea>
            </td>
          `,
        )
        .join("")}
      ${renderRowActions(rowIndex)}
    </tr>
  `;
}

function renderRoleRow(row, rowIndex) {
  return `
    <tr>
      <td>
        <textarea data-cell-row="${rowIndex}" data-column="身份名">${escapeHtml(row["身份名"] ?? "")}</textarea>
      </td>
      <td class="compact-cell">
        <textarea data-cell-row="${rowIndex}" data-column="数量上限">${escapeHtml(row["数量上限"] ?? "")}</textarea>
      </td>
      <td class="trait-cell">
        ${renderTraitPicker(row, rowIndex)}
      </td>
      <td>
        <textarea data-cell-row="${rowIndex}" data-column="能力">${escapeHtml(row["能力"] ?? "")}</textarea>
      </td>
      ${renderRowActions(rowIndex)}
    </tr>
  `;
}

function renderRuleRow(row, rowIndex) {
  return `
    <tr>
      <td class="compact-cell">
        <select data-rule-field="规则类型" data-row="${rowIndex}">
          ${renderOptions(ruleTypes(), row["规则类型"] || "规则Y")}
        </select>
      </td>
      <td>
        <textarea data-cell-row="${rowIndex}" data-column="规则名">${escapeHtml(row["规则名"] ?? "")}</textarea>
      </td>
      <td class="appearance-cell">
        ${renderAppearanceEditor(row, rowIndex)}
      </td>
      <td>
        <textarea data-cell-row="${rowIndex}" data-column="追加规则">${escapeHtml(row["追加规则"] ?? "")}</textarea>
      </td>
      ${renderRowActions(rowIndex)}
    </tr>
  `;
}

function renderTraitPicker(row, rowIndex) {
  const selectedTraits = normalizeTraits(row[ROLE_TRAITS_COLUMN]);
  const options = traitOptions();
  return `
    <div class="trait-list">
      ${
        selectedTraits.length
          ? selectedTraits
              .map(
                (trait, traitIndex) => `
                  <div class="trait-row">
                    <select title="身份特性" data-role-trait-row="${rowIndex}" data-role-trait-index="${traitIndex}">
                      ${renderOptions(options, trait)}
                    </select>
                    <button title="删除身份特性" data-action="delete-role-trait" data-row="${rowIndex}"
                      data-role-trait-index="${traitIndex}">删</button>
                  </div>
                `,
              )
              .join("")
          : `<p class="muted-hint">未登记身份特性</p>`
      }
      <button class="mini-button" data-action="add-role-trait" data-row="${rowIndex}" ${options.length ? "" : "disabled"}>
        添加身份特性
      </button>
    </div>
  `;
}

function renderAppearanceEditor(row, rowIndex) {
  const appearances = normalizeAppearances(row[APPEARANCE_COLUMN]);
  const roles = roleOptions();
  return `
    <div class="appearance-list">
      ${
        appearances.length
          ? appearances
              .map(
                (appearance, appearanceIndex) => `
                  <div class="appearance-row">
                    <select title="身份" data-appearance-field="identity" data-row="${rowIndex}"
                      data-appearance-index="${appearanceIndex}">
                      ${renderOptions(roles, appearance.identity)}
                    </select>
                    <select title="数量" data-appearance-field="count" data-row="${rowIndex}"
                      data-appearance-index="${appearanceIndex}">
                      ${renderOptions(countOptions(), appearance.count || "1")}
                    </select>
                    <select title="数量规则" data-appearance-field="count_rule" data-row="${rowIndex}"
                      data-appearance-index="${appearanceIndex}">
                      ${renderOptions(countRules(), appearance.count_rule || "默认")}
                    </select>
                    <button title="删除登场身份" data-action="delete-appearance" data-row="${rowIndex}"
                      data-appearance-index="${appearanceIndex}">删</button>
                  </div>
                `,
              )
              .join("")
          : `<p class="muted-hint">未登记登场身份</p>`
      }
      <button class="mini-button" data-action="add-appearance" data-row="${rowIndex}" ${roles.length ? "" : "disabled"}>
        添加登场身份
      </button>
    </div>
  `;
}

function renderRowActions(rowIndex) {
  return `
    <td class="row-actions">
      <button title="上移" data-action="move-row" data-row="${rowIndex}" data-dir="-1">↑</button>
      <button title="下移" data-action="move-row" data-row="${rowIndex}" data-dir="1">↓</button>
      <button title="删除" data-action="delete-row" data-row="${rowIndex}">删</button>
    </td>
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

function renderReferenceActions(module) {
  const imagePath = state.imageMode === "page" ? module.page_image : module.annotated_image;
  const imageUrl = imagePath ? assetUrl(imagePath) : "";
  return `
    <div class="source-actions" aria-label="原图">
      <span class="inline-label">原图</span>
      <div class="segmented">
        <button class="${state.imageMode === "annotated" ? "active" : ""}" data-image-mode="annotated">
          编号
        </button>
        <button class="${state.imageMode === "page" ? "active" : ""}" data-image-mode="page">
          原页
        </button>
      </div>
      ${imageUrl ? `<button class="secondary" data-action="open-image" data-image-src="${escapeAttr(
        imageUrl,
      )}" data-image-title="${escapeAttr(module.title)}">查看</button>` : `<span class="muted-hint">无图片</span>`}
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

function bindEvents() {
  document.querySelectorAll("[data-module-id]").forEach((button) => {
    button.addEventListener("click", () => loadModule(button.dataset.moduleId));
  });

  document.querySelectorAll("[data-table]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTable = button.dataset.table;
      render();
    });
  });

  document.querySelectorAll("[data-image-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.imageMode = button.dataset.imageMode;
      render();
    });
  });

  document.querySelectorAll("[data-meta]").forEach((input) => {
    input.addEventListener("input", () => {
      state.activeModule[input.dataset.meta] = input.value;
      markDirty();
    });
  });

  document.querySelectorAll("[data-cell-row]").forEach((field) => {
    field.addEventListener("input", () => {
      const rows = state.activeModule.tables[state.activeTable];
      rows[Number(field.dataset.cellRow)][field.dataset.column] = field.value;
      markDirty();
    });
  });

  document.querySelectorAll("[data-rule-field]").forEach((field) => {
    field.addEventListener("change", () => {
      const rows = state.activeModule.tables.rules;
      rows[Number(field.dataset.row)][field.dataset.ruleField] = field.value;
      markDirty();
    });
  });

  document.querySelectorAll("[data-appearance-field]").forEach((field) => {
    field.addEventListener("change", () => {
      const row = state.activeModule.tables.rules[Number(field.dataset.row)];
      const appearances = ensureAppearances(row);
      appearances[Number(field.dataset.appearanceIndex)][field.dataset.appearanceField] = field.value;
      markDirty();
    });
  });

  document.querySelectorAll("[data-role-trait-row]").forEach((field) => {
    field.addEventListener("change", () => {
      const row = state.activeModule.tables.roles[Number(field.dataset.roleTraitRow)];
      const traits = ensureRoleTraits(row);
      traits[Number(field.dataset.roleTraitIndex)] = field.value;
      row[ROLE_TRAITS_COLUMN] = [...new Set(traits.filter(Boolean))];
      markDirty();
      render();
    });
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", (event) => handleAction(button, event));
  });
}

function handleAction(button, event) {
  const action = button.dataset.action;
  if (action === "save") {
    saveModule();
    return;
  }
  if (action === "reload") {
    loadModule(state.activeId);
    return;
  }
  if (action === "add-row") {
    state.activeModule.tables[state.activeTable].push(createEmptyRow(state.activeTable));
    markDirty();
    render();
    return;
  }
  if (action === "delete-row") {
    state.activeModule.tables[state.activeTable].splice(Number(button.dataset.row), 1);
    markDirty();
    render();
    return;
  }
  if (action === "move-row") {
    moveRow(Number(button.dataset.row), Number(button.dataset.dir));
    return;
  }
  if (action === "add-appearance") {
    addAppearance(Number(button.dataset.row));
    return;
  }
  if (action === "delete-appearance") {
    deleteAppearance(Number(button.dataset.row), Number(button.dataset.appearanceIndex));
    return;
  }
  if (action === "add-role-trait") {
    addRoleTrait(Number(button.dataset.row));
    return;
  }
  if (action === "delete-role-trait") {
    deleteRoleTrait(Number(button.dataset.row), Number(button.dataset.roleTraitIndex));
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

function createEmptyRow(tableKey) {
  if (tableKey === "rules") {
    return { 规则类型: "规则Y", 规则名: "", 登场身份: [], 追加规则: "" };
  }
  if (tableKey === "roles") {
    return { 身份名: "", 数量上限: "", 身份特性: [], 能力: "" };
  }
  return Object.fromEntries(TABLES[tableKey].columns.map((column) => [column, ""]));
}

function addAppearance(rowIndex) {
  const row = state.activeModule.tables.rules[rowIndex];
  const appearances = ensureAppearances(row);
  const roles = roleOptions();
  if (!roles.length) return;
  appearances.push({ identity: roles[0], count: "1", count_rule: "默认" });
  markDirty();
  render();
}

function deleteAppearance(rowIndex, appearanceIndex) {
  const row = state.activeModule.tables.rules[rowIndex];
  ensureAppearances(row).splice(appearanceIndex, 1);
  markDirty();
  render();
}

function ensureAppearances(row) {
  row[APPEARANCE_COLUMN] = normalizeAppearances(row[APPEARANCE_COLUMN]);
  return row[APPEARANCE_COLUMN];
}

function addRoleTrait(rowIndex) {
  const row = state.activeModule.tables.roles[rowIndex];
  const traits = ensureRoleTraits(row);
  const options = traitOptions();
  const next = options.find((trait) => !traits.includes(trait));
  if (!next) return;
  traits.push(next);
  markDirty();
  render();
}

function deleteRoleTrait(rowIndex, traitIndex) {
  const row = state.activeModule.tables.roles[rowIndex];
  ensureRoleTraits(row).splice(traitIndex, 1);
  markDirty();
  render();
}

function ensureRoleTraits(row) {
  row[ROLE_TRAITS_COLUMN] = normalizeTraits(row[ROLE_TRAITS_COLUMN]);
  return row[ROLE_TRAITS_COLUMN];
}

function moveRow(index, direction) {
  const rows = state.activeModule.tables[state.activeTable];
  const target = index + direction;
  if (target < 0 || target >= rows.length) return;
  const [row] = rows.splice(index, 1);
  rows.splice(target, 0, row);
  markDirty();
  render();
}

function roleOptions() {
  const fromRoleTable = (state.activeModule?.tables.roles ?? [])
    .map((row) => String(row["身份名"] ?? "").trim())
    .filter(Boolean);
  const fromAppearances = (state.activeModule?.tables.rules ?? [])
    .flatMap((row) => normalizeAppearances(row[APPEARANCE_COLUMN]).map((item) => item.identity))
    .filter(Boolean);
  return [...new Set([...fromRoleTable, ...fromAppearances])];
}

function traitOptions() {
  const fromPool = (state.traits ?? []).map((trait) => String(trait.name ?? "").trim()).filter(Boolean);
  const fromRoles = (state.activeModule?.tables.roles ?? [])
    .flatMap((row) => normalizeTraits(row[ROLE_TRAITS_COLUMN]))
    .filter(Boolean);
  return [...new Set([...fromPool, ...fromRoles])].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function ruleTypes() {
  return state.config?.rule_types ?? RULE_TYPE_FALLBACK;
}

function countOptions() {
  return state.config?.appearance_count_options ?? COUNT_FALLBACK;
}

function countRules() {
  return state.config?.appearance_count_rules ?? COUNT_RULE_FALLBACK;
}

function markDirty() {
  state.dirty = true;
  state.message = "";
}

function titleName(title) {
  return title.replace(" - 模组信息审阅稿", "");
}

function assetUrl(path) {
  let normalized = path.replace(/^`|`$/g, "").replace(/^(\.\.\/)+/, "");
  normalized = normalized.replace(/^facts\/source_material\/reference\/module\//, "");
  return `/module-assets/${normalized.split("/").map(encodeURIComponent).join("/")}`;
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
