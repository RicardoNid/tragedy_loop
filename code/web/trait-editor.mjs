const state = {
  traits: [],
  target: "",
  dirty: false,
  busy: false,
  message: "",
  error: "",
};

const app = document.querySelector("#trait-app");

init();

async function init() {
  await loadTraits();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function loadTraits() {
  state.busy = true;
  state.error = "";
  state.message = "";
  render();
  try {
    const payload = await fetchJson("/api/module-editor/traits");
    state.traits = normalizeTraits(payload.traits);
    state.target = payload.trait_pool_file;
    state.dirty = false;
  } catch (error) {
    state.error = String(error);
  } finally {
    state.busy = false;
    render();
  }
}

async function saveTraits() {
  state.busy = true;
  state.error = "";
  state.message = "";
  render();
  try {
    const payload = await fetchJson("/api/module-editor/traits", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ traits: state.traits }),
    });
    state.traits = normalizeTraits(payload.traits);
    state.target = payload.trait_pool_file;
    state.dirty = false;
    state.message = "已保存";
  } catch (error) {
    state.error = String(error);
  } finally {
    state.busy = false;
    render();
  }
}

function normalizeTraits(traits) {
  if (!Array.isArray(traits)) return [];
  return traits.map((trait) => ({
    name: String(trait?.name ?? trait?.名称 ?? "").trim(),
    description: String(trait?.description ?? trait?.解释 ?? "").trim(),
  }));
}

function render() {
  app.innerHTML = `
    <header class="editor-topbar">
      <div>
        <p class="eyebrow">TRAIT POOL</p>
        <h1>身份特性池</h1>
      </div>
      <div class="topbar-actions">
        <span class="target">${escapeHtml(state.target || "读取中")}</span>
        <a class="secondary-link" href="/site/characters.html">角色卡</a>
        <a class="secondary-link" href="/site/editor.html">模组编辑器</a>
        <a class="secondary-link" href="/site/">资料站</a>
      </div>
    </header>

    <main class="trait-shell">
      <section class="editor-main">
        ${renderStatus()}
        <section class="editor-card">
          <div class="editor-card-header">
            <div>
              <p class="eyebrow">名称 / 解释</p>
              <h2>公共身份特性</h2>
            </div>
            <div class="button-row">
              <button class="secondary" data-action="reload" ${state.busy ? "disabled" : ""}>重载</button>
              <button class="secondary" data-action="add-row" ${state.busy ? "disabled" : ""}>添加身份特性</button>
              <button class="primary" data-action="save" ${state.busy || !state.dirty ? "disabled" : ""}>保存</button>
            </div>
          </div>

          <div class="table-scroll trait-table-scroll">
            <table class="edit-table trait-pool-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>解释</th>
                  <th class="row-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                ${state.traits.map((trait, index) => renderTraitRow(trait, index)).join("")}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  `;

  bindEvents();
}

function renderStatus() {
  if (state.error) return `<div class="notice error">${escapeHtml(state.error)}</div>`;
  if (state.message) return `<div class="notice success">${escapeHtml(state.message)}</div>`;
  if (state.dirty) return `<div class="notice pending">有未保存修改</div>`;
  return "";
}

function renderTraitRow(trait, index) {
  return `
    <tr>
      <td class="trait-name-cell">
        <input data-trait-field="name" data-row="${index}" value="${escapeAttr(trait.name)}" />
      </td>
      <td>
        <textarea data-trait-field="description" data-row="${index}">${escapeHtml(trait.description)}</textarea>
      </td>
      <td class="row-actions">
        <button title="上移" data-action="move-row" data-row="${index}" data-dir="-1">↑</button>
        <button title="下移" data-action="move-row" data-row="${index}" data-dir="1">↓</button>
        <button title="删除" data-action="delete-row" data-row="${index}">删</button>
      </td>
    </tr>
  `;
}

function bindEvents() {
  document.querySelectorAll("[data-trait-field]").forEach((field) => {
    field.addEventListener("input", () => {
      state.traits[Number(field.dataset.row)][field.dataset.traitField] = field.value;
      markDirty();
    });
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleAction(button));
  });
}

function handleAction(button) {
  const action = button.dataset.action;
  if (action === "save") {
    saveTraits();
    return;
  }
  if (action === "reload") {
    loadTraits();
    return;
  }
  if (action === "add-row") {
    state.traits.push({ name: "", description: "" });
    markDirty();
    render();
    return;
  }
  if (action === "delete-row") {
    state.traits.splice(Number(button.dataset.row), 1);
    markDirty();
    render();
    return;
  }
  if (action === "move-row") {
    moveRow(Number(button.dataset.row), Number(button.dataset.dir));
  }
}

function moveRow(index, direction) {
  const target = index + direction;
  if (target < 0 || target >= state.traits.length) return;
  const [row] = state.traits.splice(index, 1);
  state.traits.splice(target, 0, row);
  markDirty();
  render();
}

function markDirty() {
  state.dirty = true;
  state.message = "";
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
