import { loadState, saveState, exportBundle, importBundle, emptyState, DEFAULT_PROVIDERS } from "../shared/storage.js";
import { listRemoteModels } from "../shared/providers.js";
import { uid } from "../shared/utils.js";
import { localizeDocument, normalizeLanguage, t } from "../shared/i18n.js";
import { renderMarkdown } from "../shared/markdown.js";

const $ = (id) => document.getElementById(id);
let state;
let generalSaveTimer;

// 供视觉测试用：?theme=light|dark 直接覆盖主题，无需扩展环境
const previewTheme = new URLSearchParams(location.search).get("theme");
if (previewTheme) document.documentElement.dataset.theme = previewTheme;

function showTab(id) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("hidden", t.id !== id));
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("on", b.dataset.tab === id));
}

function applyTheme() {
  const t = state.settings.theme || "system";
  document.documentElement.dataset.theme = t;
  document.documentElement.classList.toggle("system", t === "system");
}

function syncFontSize(v) {
  $("fontSizeVal").textContent = v;
  // 让设置页正文也跟随字号滑块，而不只更新预览文字。
  document.documentElement.style.fontSize = `${v}px`;
  $("fontPreview").style.fontSize = "1rem";
}

function fillGeneral() {
  const s = state.settings;
  $("language").value = normalizeLanguage(s.language);
  $("theme").value = s.theme;
  $("fontSize").value = s.fontSize;
  syncFontSize(s.fontSize);
  $("selectionToolbar").checked = s.selectionToolbar;
  $("inputDot").checked = s.inputDot !== false;
  $("quickChat").checked = s.quickChat;
  $("browserControl").checked = s.browserControl;
  $("webSearchEnabled").checked = s.webSearchEnabled !== false;
  $("readPageByDefault").checked = s.readPageByDefault;
  $("thinkingDefault").checked = !!s.thinkingDefault;
  $("disabledSites").value = (s.disabledSites || []).join("\n");
  $("systemPrompt").value = s.systemPrompt || "";
}

function readGeneralSettings() {
  return {
    language: normalizeLanguage($("language").value),
    theme: $("theme").value,
    fontSize: Number($("fontSize").value) || 14,
    selectionToolbar: $("selectionToolbar").checked,
    inputDot: $("inputDot").checked,
    quickChat: $("quickChat").checked,
    browserControl: $("browserControl").checked,
    webSearchEnabled: $("webSearchEnabled").checked,
    readPageByDefault: $("readPageByDefault").checked,
    thinkingDefault: $("thinkingDefault").checked,
    disabledSites: $("disabledSites").value.split("\n").map((s) => s.trim()).filter(Boolean),
    systemPrompt: $("systemPrompt").value
  };
}

async function saveGeneralSettings() {
  clearTimeout(generalSaveTimer);
  generalSaveTimer = undefined;
  Object.assign(state.settings, readGeneralSettings());
  try {
    await saveState(state);
  } catch (error) {
    console.error("Failed to auto-save general settings", error);
  }
}

function scheduleGeneralSave() {
  clearTimeout(generalSaveTimer);
  generalSaveTimer = setTimeout(saveGeneralSettings, 300);
}

function language() {
  return normalizeLanguage(state.settings.language);
}

function applyLanguage() {
  localizeDocument(language());
  renderProviders();
  renderSkills();
}

function setSkillMarkdownView(view) {
  const previewing = view === "preview";
  const editor = $("sInst");
  const preview = $("sInstPreview");
  preview.classList.toggle("hidden", !previewing);
  editor.classList.toggle("hidden", previewing);
  if (previewing) preview.innerHTML = renderMarkdown(editor.value) || `<p class="muted">${t("还没有技能说明", language())}</p>`;
  document.querySelectorAll("[data-skill-markdown-view]").forEach((button) => {
    const selected = button.dataset.skillMarkdownView === view;
    button.classList.toggle("on", selected);
    button.setAttribute("aria-selected", String(selected));
  });
}

function renderProviders() {
  $("providerList").innerHTML = state.providers
    .map(
      (p) => `<div class="card" data-id="${p.id}">
        <strong>${p.name}</strong>
        <div class="muted">${p.kind} · ${p.baseUrl}</div>
        <label>API Key <input data-key="${p.id}" type="password" value="${p.apiKey || ""}" placeholder="${p.id === "ollama" ? t("可留空", language()) : "sk-..."}" /></label>
        <label>Base URL <input data-url="${p.id}" value="${p.baseUrl || ""}" /></label>
        <label>${t("模型", language())} (${t("多个模型用逗号分隔", language())}) <input data-models="${p.id}" value="${(p.models || []).join(", ")}" /></label>
        <div class="row">
          <button class="action-button" data-reload="${p.id}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.6" /><path d="M20 5v6h-6" /></svg><span>${t("拉取模型列表", language())}</span></button>
          ${DEFAULT_PROVIDERS.some((d) => d.id === p.id) ? "" : `<button class="action-button danger-action" data-delp="${p.id}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M6.5 7l.8 13h9.4l.8-13M9 7V4h6v3" /></svg><span>${t("删除", language())}</span></button>`}
        </div>
      </div>`
    )
    .join("");
  $("providerList").querySelectorAll("[data-key]").forEach((i) =>
    i.addEventListener("change", () => {
      const p = state.providers.find((x) => x.id === i.dataset.key);
      p.apiKey = i.value.trim();
      saveState(state);
    })
  );
  $("providerList").querySelectorAll("[data-url]").forEach((i) =>
    i.addEventListener("change", () => {
      const p = state.providers.find((x) => x.id === i.dataset.url);
      p.baseUrl = i.value.trim();
      saveState(state);
    })
  );
  $("providerList").querySelectorAll("[data-models]").forEach((i) =>
    i.addEventListener("change", () => {
      const p = state.providers.find((x) => x.id === i.dataset.models);
      p.models = i.value.split(",").map((s) => s.trim()).filter(Boolean);
      saveState(state);
    })
  );
  $("providerList").querySelectorAll("[data-reload]").forEach((b) =>
    b.addEventListener("click", async () => {
      const p = state.providers.find((x) => x.id === b.dataset.reload);
      const label = b.querySelector("span");
      if (label) label.textContent = t("拉取中…", language());
      try {
        const models = await listRemoteModels(p);
        if (models.length) p.models = models.slice(0, 80);
        await saveState(state);
        renderProviders();
      } catch (e) {
        if (label) label.textContent = e.message;
      }
    })
  );
  $("providerList").querySelectorAll("[data-delp]").forEach((b) =>
    b.addEventListener("click", async () => {
      state.providers = state.providers.filter((p) => p.id !== b.dataset.delp);
      await saveState(state);
      renderProviders();
    })
  );
}

let editingSkillId = null;

function editSkill(id) {
  const s = state.skills.find((x) => x.id === id);
  if (!s) return;
  editingSkillId = id;
  $("sName").value = s.name;
  $("sSlash").value = s.slash || "";
  $("sDesc").value = s.description || "";
  $("sInst").value = s.instructions || "";
  setSkillMarkdownView("edit");
  $("sRead").checked = s.tools?.readPage !== false;
  $("sBrowser").checked = !!s.tools?.browser;
  $("sSearch").checked = !!s.tools?.webSearch;
  $("addSkill").dataset.edit = s.id;
  $("addSkill").textContent = t("更新技能", language());
  $("skillFormTitle").textContent = t("编辑技能", language());
  renderSkills();
}

function resetSkillForm() {
  editingSkillId = null;
  $("sName").value = $("sSlash").value = $("sDesc").value = $("sInst").value = "";
  setSkillMarkdownView("edit");
  $("sRead").checked = true;
  $("sBrowser").checked = false;
  $("sSearch").checked = false;
  $("addSkill").dataset.edit = "";
  $("addSkill").textContent = t("保存技能", language());
  $("skillFormTitle").textContent = t("新建技能", language());
  renderSkills();
}

function renderSkills() {
  $("skillList").innerHTML = (state.skills || [])
    .map(
      (s) => {
        const disabled = s.enabled === false;
        return `<div class="card skill-card ${disabled ? "is-disabled" : "is-enabled"} ${editingSkillId === s.id ? "is-editing" : ""}" data-card="${s.id}" tabindex="0" role="button" aria-label="${t("编辑技能", language())}">
        <div class="skill-card-head">
          <div class="skill-card-title"><strong>${s.name}</strong> <span class="muted">/${s.slash || ""}</span></div>
          <label class="skill-enabled-switch" title="${t(disabled ? "启用技能" : "禁用技能", language())}">
            <input class="skill-master-switch" type="checkbox" data-toggles="${s.id}" ${disabled ? "" : "checked"} aria-label="${t(disabled ? "启用技能" : "禁用技能", language())}" />
          </label>
        </div>
        <div class="muted">${s.description || ""}</div>
        <div class="row skill-actions">
          <button class="skill-action skill-action-danger" data-dels="${s.id}" title="${t("删除技能", language())}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M6.5 7l.8 13h9.4l.8-13M9 7V4h6v3" /></svg><span>${t("删除", language())}</span></button>
        </div>
      </div>`;
      }
    )
    .join("") || `<p>${t("还没有技能", language())}</p>`;
  $("skillList").querySelectorAll("[data-card]").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest(".skill-enabled-switch") || event.target.closest("[data-dels]")) return;
      editSkill(card.dataset.card);
    });
    card.addEventListener("keydown", (event) => {
      if (event.target !== card || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      editSkill(card.dataset.card);
    });
  });
  $("skillList").querySelectorAll("[data-dels]").forEach((b) =>
    b.addEventListener("click", async () => {
      state.skills = state.skills.filter((s) => s.id !== b.dataset.dels);
      await saveState(state);
      if (editingSkillId === b.dataset.dels) resetSkillForm();
      else renderSkills();
    })
  );
  $("skillList").querySelectorAll("[data-toggles]").forEach((input) =>
    input.addEventListener("change", async () => {
      const s = state.skills.find((x) => x.id === input.dataset.toggles);
      s.enabled = input.checked;
      await saveState(state);
      renderSkills();
    })
  );
}

async function init() {
  // 非扩展环境（如本地预览）下 chrome.storage 不可用，退回默认状态保证页面可看
  state = await loadState().catch(() => emptyState());
  applyTheme();
  fillGeneral();
  applyLanguage();

  $("theme").addEventListener("change", () => {
    state.settings.theme = $("theme").value;
    applyTheme();
    saveGeneralSettings();
  });
  $("language").addEventListener("change", () => {
    state.settings.language = normalizeLanguage($("language").value);
    applyLanguage();
    saveGeneralSettings();
  });
  $("fontSize").addEventListener("input", () => {
    syncFontSize(Number($("fontSize").value));
    scheduleGeneralSave();
  });
  $("fontSize").addEventListener("change", saveGeneralSettings);
  ["selectionToolbar", "inputDot", "quickChat", "browserControl", "webSearchEnabled", "readPageByDefault", "thinkingDefault"].forEach((id) => {
    $(id).addEventListener("change", saveGeneralSettings);
  });
  ["disabledSites", "systemPrompt"].forEach((id) => {
    $(id).addEventListener("input", scheduleGeneralSave);
    $(id).addEventListener("change", saveGeneralSettings);
  });
  window.addEventListener("pagehide", () => {
    if (generalSaveTimer) saveGeneralSettings();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && generalSaveTimer) saveGeneralSettings();
  });
  renderProviders();
  renderSkills();

  document.querySelectorAll("[data-skill-markdown-view]").forEach((button) =>
    button.addEventListener("click", () => setSkillMarkdownView(button.dataset.skillMarkdownView))
  );

  document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

  $("addCustom").addEventListener("click", async () => {
    const name = $("cName").value.trim();
    const baseUrl = $("cUrl").value.trim();
    if (!name || !baseUrl) return;
    state.providers.push({
      id: uid("prov"),
      name,
      kind: "openai",
      baseUrl,
      apiKey: $("cKey").value.trim(),
      models: $("cModels").value.split(",").map((s) => s.trim()).filter(Boolean)
    });
    await saveState(state);
    $("cName").value = $("cUrl").value = $("cKey").value = $("cModels").value = "";
    renderProviders();
  });

  $("newSkill").addEventListener("click", () => {
    resetSkillForm();
    $("sName").focus();
  });

  $("addSkill").addEventListener("click", async () => {
    const name = $("sName").value.trim();
    if (!name) return;
    const editId = $("addSkill").dataset.edit;
    const payload = {
      name,
      slash: $("sSlash").value.trim() || name.toLowerCase().replace(/\s+/g, "-"),
      description: $("sDesc").value.trim(),
      instructions: $("sInst").value.trim(),
      enabled: editId ? state.skills.find((s) => s.id === editId)?.enabled !== false : true,
      tools: {
        readPage: $("sRead").checked,
        browser: $("sBrowser").checked,
        webSearch: $("sSearch").checked
      }
    };
    if (editId) {
      const s = state.skills.find((x) => x.id === editId);
      if (s) Object.assign(s, payload);
    } else {
      state.skills.push({ id: uid("sk"), ...payload });
    }
    await saveState(state);
    resetSkillForm();
  });

  $("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(exportBundle(state), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `skilldock-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  });
  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const bundle = JSON.parse(await file.text());
      importBundle(state, bundle);
      await saveState(state);
      fillGeneral();
      renderProviders();
      renderSkills();
      $("dataMsg").textContent = t("导入完成", language());
    } catch (err) {
      $("dataMsg").textContent = err.message;
    }
  });
}

init();
