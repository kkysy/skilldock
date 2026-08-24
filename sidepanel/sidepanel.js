import {
  loadState,
  saveState,
  findProvider,
  deleteConversation,
  newConversation,
  upsertConversation
} from "../shared/storage.js";
import { renderMarkdown, conversationToMarkdown } from "../shared/markdown.js";
import { uid, fileToDataUrl, fileToText, isImageFile, isTextFile } from "../shared/utils.js";
import { isPdfFile, ingestPdf } from "../shared/pdf.js";
import { localizeDocument, normalizeLanguage, t } from "../shared/i18n.js";

const $ = (id) => document.getElementById(id);

// 自绘线性图标（24 视图框、1.8px 描边、圆角线帽），与头部图标同一套风格
const SVG_ATTRS = `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
const ICONS = {
  copy: `<svg ${SVG_ATTRS}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>`,
  edit: `<svg ${SVG_ATTRS}><path d="m4 16.5-.7 3.7 3.7-.7L18.6 7.9a2.5 2.5 0 0 0-3.5-3.5L4 16.5Z" /><path d="m13.8 6.2 4 4" /></svg>`,
  refresh: `<svg ${SVG_ATTRS}><path d="M20 11a8 8 0 1 0-2.2 6.2" /><path d="M20 5v6h-6" /></svg>`,
  export: `<svg ${SVG_ATTRS}><path d="M12 4v11" /><path d="M7 11l5 5 5-5" /><path d="M4 20h16" /></svg>`,
  text: `<svg ${SVG_ATTRS}><path d="M6 3.5h9l3 3V20.5H6z" /><path d="M9 11h6M9 15h6M9 7h2" /></svg>`,
  markdown: `<svg ${SVG_ATTRS}><path d="M5 5h14v14H5z" /><path d="m8 15 2-6 2 4 2-4 2 6M8 18h8" /></svg>`,
  pdf: `<svg ${SVG_ATTRS}><path d="M6 3.5h9l3 3V20.5H6z" /><path d="M9 15h6M10 11h2a1.5 1.5 0 0 0 0-3H10zM14.5 8v4" /></svg>`,
  trash: `<svg ${SVG_ATTRS}><path d="M5 7h14M10 11v6M14 11v6M6.5 7l.8 13h9.4l.8-13M9 7V4h6v3" /></svg>`,
  toTop: `<svg ${SVG_ATTRS}><path d="M12 19V5" /><path d="M5 12l7-7 7 7" /></svg>`
};
const els = {
  provider: $("provider"),
  model: $("model"),
  modelLabel: $("modelLabel"),
  btnModel: $("btnModel"),
  modelPicker: $("modelPicker"),
  modelPickerBody: $("modelPickerBody"),
  skill: $("skill"),
  btnSkillContext: $("btnSkillContext"),
  skillContextLabel: $("skillContextLabel"),
  skillTags: $("skillTags"),
  skillPicker: $("skillPicker"),
  messages: $("messages"),
  input: $("input"),
  includePage: $("includePage"),
  thinking: $("thinking"),
  chips: $("chips"),
  btnAdd: $("btnAdd"),
  attachmentMenu: $("attachmentMenu"),
  tabPicker: $("tabPicker"),
  slash: $("slash"),
  history: $("history"),
  historyList: $("historyList"),
  historySearch: $("historySearch"),
  perm: $("permission"),
  permText: $("permText"),
  btnSend: $("btnSend"),
  btnStop: $("btnStop")
};

let state;
let port;
let streaming = false;
let extraTabs = [];
let attachments = [];
let pendingPerm = null;
let activeId = null;
let editingMessageId = null;
let selectedSkillIds = [];
let historyExportId = null;
const popupTimers = new WeakMap();

function language() {
  return normalizeLanguage(state?.settings?.language);
}

function showPopup(element) {
  clearTimeout(popupTimers.get(element));
  element.classList.remove("hidden", "popup-leave");
  element.classList.remove("popup-enter");
  void element.offsetWidth;
  element.classList.add("popup-enter");
  element.addEventListener("animationend", () => element.classList.remove("popup-enter"), { once: true });
}

function hidePopup(element) {
  if (element.classList.contains("hidden") || element.classList.contains("popup-leave")) return;
  element.classList.remove("popup-enter");
  element.classList.add("popup-leave");
  popupTimers.set(element, setTimeout(() => {
    element.classList.add("hidden");
    element.classList.remove("popup-leave");
  }, 160));
}

function applyTheme() {
  const t = state.settings.theme || "system";
  document.documentElement.dataset.theme = t;
  document.documentElement.classList.toggle("system", t === "system");
  document.documentElement.style.fontSize = `${state.settings.fontSize || 14}px`;
  els.includePage.checked = state.settings.readPageByDefault !== false;
  els.thinking.checked = !!state.settings.thinkingDefault;
}

function fillProviders() {
  els.provider.innerHTML = state.providers
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join("");
  els.provider.value = state.settings.providerId;
  fillModels();
}

function fillModels() {
  const p = findProvider(state, els.provider.value);
  const models = p?.models?.length ? p.models : [state.settings.model];
  const current = p?.id === state.settings.providerId ? state.settings.model : models[0];
  els.model.innerHTML = models.map((m) => `<option value="${m}">${m}</option>`).join("");
  if (current && !models.includes(current)) {
    els.model.insertAdjacentHTML("afterbegin", `<option value="${current}">${current}</option>`);
  }
  els.model.value = current || models[0] || "";
  updateModelPicker();
}

function updateModelPicker() {
  const current = els.model.value || t("选择模型", language());
  els.modelLabel.textContent = current;
  els.btnModel.title = language() === "en" ? `Current model: ${current}. Click to switch.` : `当前模型：${current}。点击切换`;
  const providerId = els.provider.value;
  els.modelPickerBody.innerHTML = state.providers
    .map((p) => `<button class="provider-option ${p.id === providerId ? "selected" : ""}" type="button" data-provider="${escapeAttr(p.id)}">
      <span>${escapeAttr(p.name)}</span><span class="provider-option-meta">${p.id === providerId ? "✓" : ""}<span class="option-chevron">›</span></span>
    </button>`)
    .join("");
  els.modelPickerBody.querySelectorAll(".provider-option").forEach((button) => {
    button.addEventListener("click", () => openProviderModels(button.dataset.provider));
    button.addEventListener("mouseenter", () => openProviderModels(button.dataset.provider));
  });
}

function openProviderModels(providerId) {
  const provider = findProvider(state, providerId);
  if (!provider) return;
  const providerButton = els.modelPickerBody.querySelector(`.provider-option[data-provider="${CSS.escape(providerId)}"]`);
  const models = provider.models?.length ? provider.models : (provider.id === els.provider.value ? [els.model.value || state.settings.model].filter(Boolean) : []);
  els.modelPicker.querySelector(".model-submenu")?.remove();
  const submenu = document.createElement("div");
  submenu.className = "model-submenu";
  submenu.dataset.provider = providerId;
  submenu.innerHTML = `<div class="model-submenu-head"><span>${escapeAttr(provider.name)}</span><button type="button" aria-label="返回提供商列表">‹</button></div>${models.length
    ? models.map((m) => `<button class="model-option ${provider.id === els.provider.value && m === els.model.value ? "selected" : ""}" type="button" data-model="${escapeAttr(m)}"><span>${escapeAttr(m)}</span><span class="model-check">✓</span></button>`).join("")
    : `<div class="model-empty">${t("暂无模型，请在设置中添加或拉取", language())}</div>`}`;
  submenu.querySelector(".model-submenu-head button").addEventListener("click", () => submenu.remove());
  submenu.querySelectorAll(".model-option").forEach((button) => {
    button.addEventListener("click", async () => {
      els.provider.value = provider.id;
      fillModels();
      els.model.value = button.dataset.model;
      updateModelPicker();
      await persistSelection();
      closeModelPicker();
    });
  });
  els.modelPicker.appendChild(submenu);
  if (providerButton) {
    const providerRect = providerButton.getBoundingClientRect();
    const pickerRect = els.modelPicker.getBoundingClientRect();
    const margin = 12;
    const minHeight = 148;
    const preferredTop = providerRect.top;
    const top = Math.max(margin, Math.min(preferredTop, window.innerHeight - margin - minHeight));
    const maxHeight = Math.max(minHeight, Math.min(320, window.innerHeight - top - margin));
    submenu.style.top = `${Math.round(top - pickerRect.top)}px`;
    submenu.style.maxHeight = `${Math.round(maxHeight)}px`;
  }
}

function openModelPicker() {
  updateModelPicker();
  positionModelMenus();
  showPopup(els.modelPicker);
  els.btnModel.setAttribute("aria-expanded", "true");
}

function positionModelMenus() {
  const trigger = els.btnModel.getBoundingClientRect();
  const margin = 12;
  const gap = 7;
  const available = Math.max(360, window.innerWidth - margin * 2);
  const providerWidth = Math.min(348, Math.max(210, Math.round(available * 0.54)));
  const modelWidth = Math.max(170, available - providerWidth - gap);
  const totalWidth = providerWidth + gap + modelWidth;
  const left = Math.max(margin, Math.min(window.innerWidth - margin - totalWidth, trigger.right - providerWidth - 150));
  els.modelPicker.style.setProperty("--provider-menu-width", `${providerWidth}px`);
  els.modelPicker.style.setProperty("--model-menu-width", `${modelWidth}px`);
  els.modelPicker.style.left = `${Math.round(left - trigger.left)}px`;
  els.modelPicker.style.right = "auto";
}

function closeModelPicker() {
  els.modelPicker.querySelector(".model-submenu")?.remove();
  hidePopup(els.modelPicker);
  els.btnModel.setAttribute("aria-expanded", "false");
}

function fillSkills() {
  const skills = (state.skills || []).filter((s) => s.enabled !== false);
  selectedSkillIds = selectedSkillIds.filter((id) => skills.some((s) => s.id === id));
  els.skill.innerHTML =
    `<option value="">${t("不使用技能", language())}</option>` +
    skills.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  syncSkillSelect();
  renderSkillContext();
}

function selectedSkills() {
  return selectedSkillIds
    .map((id) => (state.skills || []).find((s) => s.id === id && s.enabled !== false))
    .filter(Boolean);
}

function syncSkillSelect() {
  els.skill.value = selectedSkillIds[0] || "";
}

function renderSkillContext() {
  const active = selectedSkills();
  els.skillContextLabel.textContent = active.length ? t("添加技能", language()) : t("技能", language());
  els.btnSkillContext.title = active.length ? (language() === "en" ? "Add or remove skills" : "添加或移除技能") : t("选择技能", language());
  els.skillTags.innerHTML = active.map((skill, i) => `<span class="skill-tag skill-tag-${i % 4}"><span>/${escapeAttr(skill.slash || skill.name)}</span><button type="button" data-remove-skill="${escapeAttr(skill.id)}" aria-label="移除 ${escapeAttr(skill.name)}">×</button></span>`).join("");
  els.skillTags.querySelectorAll("[data-remove-skill]").forEach((button) => button.addEventListener("click", () => removeSkill(button.dataset.removeSkill)));
  const skills = (state.skills || []).filter((s) => s.enabled !== false);
  els.skillPicker.innerHTML = [
    `<button class="skill-picker-option ${active.length ? "" : "selected"}" type="button" role="option" data-id=""><strong>${t("清空技能", language())}</strong><small>${t("直接与模型对话", language())}</small></button>`,
    ...skills.map((s) => `<button class="skill-picker-option ${selectedSkillIds.includes(s.id) ? "selected" : ""}" type="button" role="option" aria-selected="${selectedSkillIds.includes(s.id)}" data-id="${escapeAttr(s.id)}"><strong>/${escapeAttr(s.slash || s.name)}</strong><small>${escapeAttr(s.description || s.name)}</small><span class="skill-picker-check">✓</span></button>`)
  ].join("");
  els.skillPicker.querySelectorAll("[data-id]").forEach((button) => {
    button.addEventListener("click", () => toggleSkill(button.dataset.id));
  });
}

function updateSkillsAfterSelection({ focus = true, close = false } = {}) {
  syncSkillSelect();
  renderSkillContext();
  if (close) closeSkillPicker();
  if (focus) els.input.focus();
}

function selectSkill(id, { focus = true, close = true } = {}) {
  if (id && !selectedSkillIds.includes(id)) selectedSkillIds.push(id);
  updateSkillsAfterSelection({ focus, close });
}

function toggleSkill(id) {
  selectedSkillIds = id ? (selectedSkillIds.includes(id) ? selectedSkillIds.filter((item) => item !== id) : [...selectedSkillIds, id]) : [];
  updateSkillsAfterSelection({ focus: false });
}

function removeSkill(id) {
  selectedSkillIds = selectedSkillIds.filter((item) => item !== id);
  updateSkillsAfterSelection();
}

function skillPayload() {
  return { skillId: selectedSkillIds[0] || null, skillIds: [...selectedSkillIds] };
}

function openSkillPicker() {
  renderSkillContext();
  showPopup(els.skillPicker);
  els.btnSkillContext.setAttribute("aria-expanded", "true");
}

function closeSkillPicker() {
  hidePopup(els.skillPicker);
  els.btnSkillContext.setAttribute("aria-expanded", "false");
}

function connect() {
  port = chrome.runtime.connect({ name: "skilldock" });
  port.onMessage.addListener(onPort);
  port.onDisconnect.addListener(() => {
    port = null;
    streaming = false;
    setBusy(false);
  });
}

function ensurePort() {
  if (!port) connect();
  return port;
}

function setBusy(on) {
  streaming = on;
  els.btnSend.classList.toggle("hidden", on);
  els.btnStop.classList.toggle("hidden", !on);
  updateSendState();
}

function updateSendState() {
  els.btnSend.disabled = streaming || !els.input.value.trim();
}

function emptyView() {
  const quick = (state.skills || []).filter((s) => s.quick && s.enabled !== false);
  els.messages.innerHTML = `
    <div class="empty">
      <div class="empty-mark" aria-hidden="true">✦</div>
      <h2>${t("今天想做什么？", language())}</h2>
      <p>${t("直接提问，或选择一个技能开始。你的密钥和对话只保存在本机。", language())}</p>
      <div class="quick-skills">
        ${quick.map((s) => `<button data-skill="${s.id}">${s.name}</button>`).join("")}
      </div>
    </div>`;
  els.messages.querySelectorAll("[data-skill]").forEach((b) => {
    b.addEventListener("click", () => {
      selectSkill(b.dataset.skill, { focus: false });
      const hint = state.skills.find((s) => s.id === b.dataset.skill);
      els.input.value = hint?.name || "";
      els.input.focus();
    });
  });
}

function roleLabel(role) {
  if (role === "user") return t("你", language());
  if (role === "think") return t("思考", language());
  if (role === "tool") return t("工具", language());
  return "Skilldock";
}

function renderConv(conv) {
  if (!conv || !conv.messages?.length) {
    emptyView();
    return;
  }
  els.messages.innerHTML = "";
  const latestUserId = [...conv.messages].reverse().find((m) => m.role === "user")?.id;
  for (const m of conv.messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      addMsgEl({
        id: m.id,
        role: "tool",
        content: `${m.name} 完成：${String(m.content || "").slice(0, 120)}`
      });
      continue;
    }
    if (m.thinking) addMsgEl({ id: `think-${m.id}`, role: "think", content: m.thinking });
    if (m.role === "assistant" && !m.content && m.toolCalls?.length) continue;
    const el = addMsgEl(m);
    if (m.role === "user" || m.role === "assistant") attachMsgActions(el, m);
    if (m.role === "user") attachUserFooter(el, m, m.id === latestUserId);
    if (m.role === "assistant" && m.content && !m.toolCalls?.length) attachMsgFooter(el, m);
  }
  collapseTrace();
  els.messages.scrollTop = els.messages.scrollHeight;
}

function fmtElapsed(ms) {
  return ms < 10000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`;
}

function fmtMessageTime(timestamp) {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "";
  if (language() === "en") return new Intl.DateTimeFormat("en", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  return `${weekdays[d.getDay()]} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text || "");
    button.classList.add("ok");
    button.title = t("已复制", language());
    button.setAttribute("aria-label", t("已复制", language()));
    setTimeout(() => {
      button.classList.remove("ok");
      button.title = t("复制", language());
      button.setAttribute("aria-label", t("复制", language()));
    }, 1200);
  } catch {
    button.title = t("复制失败", language());
  }
}

function attachUserFooter(el, m, canEdit) {
  if (el.querySelector(".user-foot")) return;
  const row = document.createElement("div");
  row.className = "msg-foot user-foot";
  const time = document.createElement("time");
  time.className = "message-time";
  if (m.createdAt) {
    time.dateTime = new Date(m.createdAt).toISOString();
    time.textContent = fmtMessageTime(m.createdAt);
    row.appendChild(time);
  }
  const mk = (icon, label, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = icon;
    b.title = label;
    b.setAttribute("aria-label", label);
    b.addEventListener("click", fn);
    return b;
  };
  row.appendChild(mk(ICONS.copy, t("复制", language()), (e) => copyText(m.display ?? m.content ?? "", e.currentTarget)));
  if (canEdit) row.appendChild(mk(ICONS.edit, t("编辑", language()), () => beginEdit(m)));
  el.appendChild(row);
}

// 助手消息尾部操作行：耗时 + 复制 / 重生成 / 导出（图标按钮，对标「轻量过程反馈」）
function attachMsgFooter(el, m) {
  if (el.querySelector(".msg-foot")) return;
  const row = document.createElement("div");
  row.className = "msg-foot";
  if (m.elapsedMs != null) {
    const t = document.createElement("span");
    t.className = "elapsed";
    t.textContent = fmtElapsed(m.elapsedMs);
    row.appendChild(t);
  }
  const mk = (icon, label, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = icon;
    b.title = label;
    b.setAttribute("aria-label", label);
    b.addEventListener("click", fn);
    return b;
  };
  row.appendChild(
    mk(ICONS.copy, t("复制", language()), async (e) => {
      await copyText(m.content || "", e.currentTarget);
    })
  );
  row.appendChild(mk(ICONS.refresh, t("重生成", language()), () => regenerate(m.id)));
  row.appendChild(
    mk(ICONS.export, t("导出此回答为 Markdown", language()), () => {
      const title = state.conversations.find((c) => c.id === activeId)?.title;
      downloadText(`${safeFileName(title)}-回答.md`, m.content || "");
    })
  );
  el.appendChild(row);
}

function beginEdit(m) {
  if (streaming) return;
  editingMessageId = m.id;
  els.input.value = m.display ?? m.content ?? "";
  els.input.focus();
  els.input.setSelectionRange(els.input.value.length, els.input.value.length);
  const context = document.querySelector(".composer-context");
  if (context) context.innerHTML = `<span class="context-dot"></span>${t("正在编辑上一条消息", language())}`;
  updateSendState();
}

function cancelEdit() {
  editingMessageId = null;
  const context = document.querySelector(".composer-context");
  if (context) context.innerHTML = `<span class="context-dot"></span>${t("准备好开始对话", language())}`;
  updateSendState();
}

// 重生成：本地先截断显示到提问处，后台真正截断会话并走正常管线重新提问
async function regenerate(messageId) {
  if (streaming) return;
  const conv = state.conversations.find((c) => c.id === activeId);
  if (!conv) return;
  const aidx = conv.messages.findIndex((m) => m.id === messageId && m.role === "assistant");
  if (aidx < 0) return;
  let uidx = -1;
  for (let i = aidx - 1; i >= 0; i--) {
    if (conv.messages[i].role === "user") {
      uidx = i;
      break;
    }
  }
  if (uidx < 0) return;
  const user = conv.messages[uidx];
  conv.messages = conv.messages.slice(0, uidx + 1);
  renderConv(conv);
  setBusy(true);
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  ensurePort().postMessage({
    type: "chat",
    regenerate: true,
    messageId,
    conversationId: conv.id,
    providerId: els.provider.value,
    model: els.model.value,
    ...skillPayload(),
    text: user.display || user.content,
    includePage: els.includePage.checked,
    thinking: els.thinking.checked,
    extraTabIds: [],
    attachments: (user.images || []).map((d) => ({ kind: "image", name: "原消息图片", dataUrl: d })),
    tabId: tab?.id
  });
}

function attachMsgActions(el, m) {
  const bar = document.createElement("div");
  bar.className = "msg-actions";
  const forkBtn = document.createElement("button");
  forkBtn.type = "button";
  forkBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="6" cy="5" r="2.2" /><circle cx="6" cy="19" r="2.2" /><circle cx="18" cy="8" r="2.2" />
    <path d="M6 7.2v9.6" /><path d="M18 10.2c0 3.6-3.4 4.8-6.8 4.8" />
  </svg>`;
  forkBtn.title = "分叉：把对话截断到这条消息，复制成一个新对话";
  forkBtn.setAttribute("aria-label", "分叉");
  forkBtn.addEventListener("click", () => forkFrom(m.id));
  bar.appendChild(forkBtn);
  el.appendChild(bar);
}

async function forkFrom(msgId) {
  if (streaming) return;
  const conv = state.conversations.find((c) => c.id === activeId);
  if (!conv) return;
  const idx = conv.messages.findIndex((m) => m.id === msgId);
  if (idx < 0) return;
  const fork = newConversation({
    title: `${conv.title || "对话"}（分叉）`,
    providerId: conv.providerId,
    model: conv.model,
    skillId: conv.skillId,
    skillIds: conv.skillIds || (conv.skillId ? [conv.skillId] : []),
    messages: JSON.parse(JSON.stringify(conv.messages.slice(0, idx + 1)))
  });
  await upsertConversation(fork);
  state = await loadState();
  activeId = fork.id;
  renderConv(fork);
  renderHistory();
  hidePopup(els.history);
}

function addMsgEl(m) {
  const el = document.createElement("article");
  el.className = `msg ${m.role}`;
  el.dataset.id = m.id;
  const shown = m.role === "user" && m.display != null ? m.display : m.content;
  const body = m.role === "assistant" ? renderMarkdown(shown || "") : escapeText(shown || "");
  const content = `<div class="who">${roleLabel(m.role)}</div><div class="body">${body}</div>`;
  el.innerHTML = m.role === "user" ? `<div class="user-bubble">${content}</div>` : content;
  els.messages.appendChild(el);
  els.messages.scrollTop = els.messages.scrollHeight;
  return el;
}

function escapeText(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML.replace(/\n/g, "<br>");
}

function upsertById(id, role, html) {
  if (els.messages.querySelector(".empty")) els.messages.innerHTML = "";
  let el = els.messages.querySelector(`[data-id="${id}"]`);
  if (!el) el = addMsgEl({ id, role, content: "" });
  if (role === "assistant") el.classList.add("streaming");
  el.querySelector(".body").innerHTML = html;
  els.messages.scrollTop = els.messages.scrollHeight;
  return el;
}

const streamBuf = { id: null, seq: 0, elId: null, text: "", thinking: "", afterTools: false };

function beginSegment() {
  streamBuf.seq += 1;
  streamBuf.elId = `${streamBuf.id}_${streamBuf.seq}`;
  streamBuf.text = "";
  streamBuf.thinking = "";
  streamBuf.afterTools = false;
  return streamBuf.elId;
}

function ensureSegment() {
  if (streamBuf.afterTools || !streamBuf.elId) beginSegment();
  return streamBuf.elId;
}

function collapseTrace(root = els.messages) {
  const kids = [...root.children].filter((el) => !el.classList.contains("trace"));
  let group = [];
  const flush = () => {
    if (!group.length) return;
    const wrap = document.createElement("details");
    wrap.className = "trace";
    const summary = document.createElement("summary");
    const thinkN = group.filter((el) => el.classList.contains("think")).length;
    const toolN = group.filter((el) => el.classList.contains("tool")).length;
    const bits = [];
    if (thinkN) bits.push(t("思考", language()));
    if (toolN) bits.push(language() === "en" ? `${toolN} tool ${toolN === 1 ? "call" : "calls"}` : (toolN === 1 ? "1 次工具" : `${toolN} 次工具`));
    summary.textContent = bits.join(" · ") || t("过程", language());
    wrap.appendChild(summary);
    group[0].before(wrap);
    for (const el of group) wrap.appendChild(el);
    group = [];
  };
  for (const el of kids) {
    if (el.classList.contains("think") || el.classList.contains("tool")) group.push(el);
    else flush();
  }
  flush();
}

function onPort(msg) {
  if (msg.type === "conversation") {
    activeId = msg.conversation.id;
    state.activeConversationId = activeId;
    const i = state.conversations.findIndex((c) => c.id === activeId);
    if (i >= 0) state.conversations[i] = msg.conversation;
    else state.conversations.unshift(msg.conversation);
    // 后台会在流式回答开始前回传带有真实消息 id 的会话。
    // 重新渲染可替换本地临时用户消息，确保最新消息的编辑按钮稳定挂载。
    renderConv(msg.conversation);
  }
  if (msg.type === "assistant_start") {
    streamBuf.id = msg.id;
    streamBuf.seq = 0;
    streamBuf.elId = null;
    streamBuf.text = "";
    streamBuf.thinking = "";
    streamBuf.afterTools = false;
    if (els.messages.querySelector(".empty")) els.messages.innerHTML = "";
  }
  if (msg.type === "delta") {
    const id = ensureSegment();
    streamBuf.text += msg.text;
    upsertById(id, "assistant", renderMarkdown(streamBuf.text));
  }
  if (msg.type === "thinking") {
    const id = ensureSegment();
    streamBuf.thinking += msg.text;
    upsertById(`think-${id}`, "think", escapeText(streamBuf.thinking));
    const thinkEl = els.messages.querySelector(`[data-id="think-${id}"]`);
    const answerEl = els.messages.querySelector(`[data-id="${id}"]`);
    if (thinkEl && answerEl && thinkEl.compareDocumentPosition(answerEl) & Node.DOCUMENT_POSITION_PRECEDING) {
      answerEl.before(thinkEl);
    }
  }
  if (msg.type === "tool") {
    streamBuf.afterTools = true;
    if (msg.cached) return;
    if (els.messages.querySelector(".empty")) els.messages.innerHTML = "";
    let el = els.messages.querySelector(`[data-tool-id="${msg.id}"]`);
    if (!el) {
      el = addMsgEl({ id: `tool-${msg.id}`, role: "tool", content: "" });
      el.dataset.toolId = msg.id;
    }
    const text =
      msg.status === "running"
        ? (language() === "en" ? `Calling ${msg.name}…` : `正在调用 ${msg.name}…`)
        : (language() === "en" ? `${msg.name} completed: ${String(msg.result || "").slice(0, 220)}` : `${msg.name} 完成：${String(msg.result || "").slice(0, 220)}`);
    el.querySelector(".body").textContent = text;
    els.messages.scrollTop = els.messages.scrollHeight;
  }
  if (msg.type === "permission") {
    pendingPerm = msg.id;
    els.permText.textContent = language() === "en" ? `The agent wants to run ${msg.name}: ${JSON.stringify(msg.args)}` : `智能体想执行 ${msg.name}：${JSON.stringify(msg.args)}`;
    showPopup(els.perm);
  }
  if (msg.type === "done" || msg.type === "stopped") {
    setBusy(false);
    collapseTrace();
    els.messages.querySelectorAll(".streaming").forEach((e) => e.classList.remove("streaming"));
    if (msg.conversation) {
      const i = state.conversations.findIndex((c) => c.id === msg.conversation.id);
      if (i >= 0) state.conversations[i] = msg.conversation;
      activeId = msg.conversation.id;
      const am = msg.conversation.messages.find((m) => m.id === msg.id);
      // 流式分段的元素 id 是 assistantId_seq，最终持久化消息 id 是 assistantId
      const elId = streamBuf.id === msg.id && streamBuf.elId ? streamBuf.elId : msg.id;
      const el =
        els.messages.querySelector(`[data-id="${elId}"]`) ||
        els.messages.querySelector(`[data-id="${msg.id}"]`);
      if (am?.role === "assistant" && am.content && el) attachMsgFooter(el, am);
    }
    renderHistory();
  }
  if (msg.type === "error") {
    setBusy(false);
    els.messages.querySelectorAll(".streaming").forEach((e) => e.classList.remove("streaming"));
    const el = document.createElement("div");
    el.className = "msg error";
    el.textContent = msg.error;
    els.messages.appendChild(el);
  }
}

function renderChips() {
  const chips = [];
  extraTabs.forEach((t) => chips.push({ id: `tab-${t.id}`, label: t.title || t.url, kind: "tab" }));
  attachments.forEach((a, i) => chips.push({ id: `file-${i}`, label: a.name, kind: "file" }));
  els.chips.innerHTML = chips
    .map(
      (c) =>
        `<span class="chip">${escapeAttr(c.label.slice(0, 28))}<button data-id="${c.id}">×</button></span>`
    )
    .join("");
  els.chips.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      const id = b.dataset.id;
      extraTabs = extraTabs.filter((t) => `tab-${t.id}` !== id);
      if (id.startsWith("file-")) attachments.splice(Number(id.slice(5)), 1);
      renderChips();
    });
  });
}

function openAttachmentMenu() {
  showPopup(els.attachmentMenu);
  els.btnAdd.setAttribute("aria-expanded", "true");
}

function closeAttachmentMenu() {
  hidePopup(els.attachmentMenu);
  els.tabPicker.classList.add("hidden");
  els.btnAdd.setAttribute("aria-expanded", "false");
}

async function pickTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const choices = tabs.filter((t) => t.url && !t.url.startsWith("chrome") && !t.active);
  els.tabPicker.classList.remove("hidden");
  els.tabPicker.innerHTML = choices.length
    ? `<div class="tab-picker-head"><span>${t("选择要附加的标签页", language())}</span><span>${extraTabs.length}/8</span></div>${choices
        .slice(0, 8)
        .map((t) => {
          const selected = extraTabs.some((item) => item.id === t.id);
          return `<button class="tab-picker-option ${selected ? "selected" : ""}" type="button" data-tab-id="${t.id}" data-title="${escapeAttr(t.title || t.url)}" data-url="${escapeAttr(t.url)}"><span>${escapeAttr(t.title || t.url)}</span>${selected ? '<b class="tab-selected">✓</b>' : ""}</button>`;
        })
        .join("")}`
    : `<div class="tab-picker-empty">${t("没有可添加的其它标签页", language())}</div>`;
  els.tabPicker.querySelectorAll("[data-tab-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const tabId = Number(button.dataset.tabId);
      const index = extraTabs.findIndex((tab) => tab.id === tabId);
      if (index >= 0) extraTabs.splice(index, 1);
      else if (extraTabs.length < 8) extraTabs.push({ id: tabId, title: button.dataset.title, url: button.dataset.url });
      renderChips();
      pickTabs();
    });
  });
}

function escapeAttr(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

async function send() {
  const text = els.input.value.trim();
  if (!text || streaming) return;
  const editId = editingMessageId;
  if (editId) {
    const conv = state.conversations.find((c) => c.id === activeId);
    const idx = conv?.messages.findIndex((m) => m.id === editId && m.role === "user") ?? -1;
    if (conv && idx >= 0) {
      conv.messages = conv.messages.slice(0, idx);
      renderConv(conv);
    }
  }
  if (els.messages.querySelector(".empty")) els.messages.innerHTML = "";
  const localUser = { id: uid("u"), role: "user", content: text, display: text, createdAt: Date.now() };
  const localEl = addMsgEl(localUser);
  attachUserFooter(localEl, localUser, true);
  els.input.value = "";
  updateSendState();
  hideSlash();
  cancelEdit();
  setBusy(true);
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  ensurePort().postMessage({
    type: "chat",
    conversationId: activeId,
    editMessageId: editId,
    providerId: els.provider.value,
    model: els.model.value,
    ...skillPayload(),
    text,
    includePage: els.includePage.checked,
    thinking: els.thinking.checked,
    extraTabIds: extraTabs.map((t) => t.id),
    attachments,
    tabId: tab?.id
  });
  attachments = [];
  extraTabs = [];
  renderChips();
}

function safeFileName(s) {
  const fallback = t("对话", language());
  return (s || fallback).replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 60) || fallback;
}

function downloadText(filename, text, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function exportMarkdown(id) {
  const conv = state.conversations.find((c) => c.id === id);
  if (!conv) return;
  downloadText(`${safeFileName(conv.title)}.md`, conversationToMarkdown(conv));
}

function conversationToText(conv) {
  const sections = [`${conv.title || t("对话", language())}`, ""];
  for (const message of conv.messages || []) {
    if (message.role === "system") continue;
    if (message.role === "user") sections.push(`${t("你", language())}:`, message.display ?? message.content ?? "", "");
    if (message.role === "assistant") {
      if (message.thinking) sections.push(`${t("过程", language())}:`, message.thinking, "");
      if (message.content) sections.push(`${t("助手", language())}:`, message.content, "");
    }
    if (message.role === "tool") sections.push(`${t("工具", language())} ${message.name || ""}:`, message.content || "", "");
  }
  return sections.join("\n");
}

function exportText(id) {
  const conv = state.conversations.find((c) => c.id === id);
  if (!conv) return;
  downloadText(`${safeFileName(conv.title)}.txt`, conversationToText(conv), "text/plain");
}

function exportPdf(id) {
  chrome.tabs.create({ url: `${chrome.runtime.getURL("print/print.html")}?id=${id}` });
}

function renderHistory() {
  const q = (els.historySearch.value || "").toLowerCase();
  const list = (state.conversations || []).filter((c) => !q || (c.title || "").toLowerCase().includes(q));
  els.historyList.innerHTML = list
    .map(
      (c) => `<div class="hist" data-id="${c.id}">
        <div>${escapeAttr(c.title || t("未命名", language()))}</div>
        <div class="meta hist-meta"><span>${new Date(c.updatedAt || c.createdAt).toLocaleString(language() === "en" ? "en" : "zh-CN")}</span>
          <div class="hist-actions">
            <button class="hist-action" type="button" data-export="${c.id}" aria-expanded="${historyExportId === c.id}" title="${t("导出", language())}">${ICONS.export}<span>${t("导出", language())}</span></button>
            <button class="hist-action hist-action-danger" type="button" data-del="${c.id}" title="${t("删除", language())}">${ICONS.trash}<span>${t("删除", language())}</span></button>
          </div>
        </div>
        ${historyExportId === c.id ? `<div class="history-export-menu" role="group" aria-label="${t("导出格式", language())}">
          <button type="button" data-export-format="txt" data-id="${c.id}" title="${t("导出为 TXT", language())}">${ICONS.text}<span>TXT</span></button>
          <button type="button" data-export-format="md" data-id="${c.id}" title="${t("导出为 Markdown", language())}">${ICONS.markdown}<span>Markdown</span></button>
          <button type="button" data-export-format="pdf" data-id="${c.id}" title="${t("导出为 PDF", language())}">${ICONS.pdf}<span>PDF</span></button>
        </div>` : ""}
      </div>`
    )
    .join("") || `<div class="hist">${t("还没有对话", language())}</div>`;
  els.historyList.querySelectorAll(".hist[data-id]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      const conv = state.conversations.find((c) => c.id === el.dataset.id);
      activeId = conv.id;
      renderConv(conv);
      hidePopup(els.history);
    });
  });
  els.historyList.querySelectorAll("[data-export]").forEach((button) => {
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      historyExportId = historyExportId === button.dataset.export ? null : button.dataset.export;
      renderHistory();
    });
  });
  els.historyList.querySelectorAll("[data-export-format]").forEach((button) => {
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      if (button.dataset.exportFormat === "txt") exportText(button.dataset.id);
      if (button.dataset.exportFormat === "md") exportMarkdown(button.dataset.id);
      if (button.dataset.exportFormat === "pdf") exportPdf(button.dataset.id);
      historyExportId = null;
      renderHistory();
    });
  });
  els.historyList.querySelectorAll("[data-del]").forEach((button) => {
    button.addEventListener("click", async (e) => {
      e.stopPropagation();
      await deleteConversation(button.dataset.del);
      state = await loadState();
      if (activeId === button.dataset.del) {
        activeId = state.activeConversationId;
        const conv = state.conversations.find((c) => c.id === activeId);
        renderConv(conv);
      }
      if (historyExportId === button.dataset.del) historyExportId = null;
      renderHistory();
    });
  });
}

function showSlash(filter) {
  const q = (filter || "").toLowerCase();
  const skills = (state.skills || []).filter(
    (s) => s.enabled !== false && (!q || s.name.toLowerCase().includes(q) || (s.slash || "").includes(q))
  );
  if (!skills.length) {
    hideSlash();
    return;
  }
  showPopup(els.slash);
  els.slash.innerHTML = skills
    .map(
      (s, i) =>
        `<div class="${i === 0 ? "active" : ""}" data-id="${s.id}"><strong>/${s.slash || s.name}</strong> · ${s.description || ""}</div>`
    )
    .join("");
  els.slash.querySelectorAll("div").forEach((d) => {
    d.addEventListener("click", () => pickSkill(d.dataset.id));
  });
}

function hideSlash() {
  hidePopup(els.slash);
}

function pickSkill(id) {
  selectSkill(id, { focus: false });
  els.input.value = "";
  hideSlash();
  els.input.focus();
  updateSendState();
}

async function addFiles(files) {
  for (const file of files) {
    if (isPdfFile(file)) {
      const chip = { kind: "pdf", name: `${file.name}（解析中…）` };
      attachments.push(chip);
      renderChips();
      try {
        const data = await file.arrayBuffer();
        const pdf = await ingestPdf(data, file.name);
        if (!pdf.text && !pdf.images.length) throw new Error("未能提取内容");
        const at = attachments.indexOf(chip);
        if (at < 0) continue;
        attachments[at] = {
          kind: "pdf",
          name: file.name,
          text: pdf.text,
          images: pdf.images,
          pageCount: pdf.pageCount,
          scanned: pdf.scanned,
          truncated: pdf.truncated
        };
      } catch (err) {
        const at = attachments.indexOf(chip);
        if (at < 0) continue;
        attachments[at] = {
          kind: "text",
          name: `${file.name}（解析失败：${err.message}）`,
          text: ""
        };
      }
    } else if (isImageFile(file)) {
      attachments.push({ kind: "image", name: file.name, dataUrl: await fileToDataUrl(file) });
    } else if (isTextFile(file)) {
      attachments.push({ kind: "text", name: file.name, text: await fileToText(file) });
    }
  }
  renderChips();
}

function newChat() {
  activeId = null;
  cancelEdit();
  extraTabs = [];
  attachments = [];
  renderChips();
  emptyView();
}

async function persistSelection() {
  state.settings.providerId = els.provider.value;
  state.settings.model = els.model.value;
  await saveState(state);
}

async function init() {
  state = await loadState();
  activeId = state.activeConversationId;
  applyTheme();
  localizeDocument(language());
  fillProviders();
  fillSkills();
  updateSendState();
  connect();
  const conv = state.conversations.find((c) => c.id === activeId);
  renderConv(conv);
  renderHistory();

  $("btnNew").addEventListener("click", newChat);
  $("btnHistory").addEventListener("click", () => {
    if (els.history.classList.contains("hidden")) showPopup(els.history);
    else hidePopup(els.history);
  });
  $("btnSettings").addEventListener("click", () => chrome.runtime.openOptionsPage());
  els.btnModel.addEventListener("click", () => {
    if (els.modelPicker.classList.contains("hidden")) openModelPicker();
    else closeModelPicker();
  });
  window.addEventListener("resize", () => {
    if (!els.modelPicker.classList.contains("hidden")) {
      positionModelMenus();
      const activeProvider = els.modelPicker.querySelector(".model-submenu")?.dataset.provider;
      if (activeProvider) openProviderModels(activeProvider);
    }
  });
  $("btnCloseModel").addEventListener("click", closeModelPicker);
  els.btnSkillContext.addEventListener("click", () => {
    if (els.skillPicker.classList.contains("hidden")) openSkillPicker();
    else closeSkillPicker();
  });
  els.btnAdd.addEventListener("click", () => {
    if (els.attachmentMenu.classList.contains("hidden")) openAttachmentMenu();
    else closeAttachmentMenu();
  });
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".model-picker-wrap")) closeModelPicker();
    if (!e.target.closest(".composer-inline-row")) closeSkillPicker();
    if (!e.target.closest(".attachment-menu") && !e.target.closest("#btnAdd")) closeAttachmentMenu();
  });
  $("btnSend").addEventListener("click", send);
  $("btnStop").addEventListener("click", () => ensurePort().postMessage({ type: "stop" }));
  $("btnTabs").addEventListener("click", pickTabs);
  $("btnFiles").addEventListener("click", () => {
    $("fileInput").click();
    closeAttachmentMenu();
  });
  $("fileInput").addEventListener("change", (e) => addFiles([...e.target.files]));
  els.provider.addEventListener("change", () => {
    fillModels();
    persistSelection();
  });
  els.model.addEventListener("change", persistSelection);
  els.thinking.addEventListener("change", () => {
    state.settings.thinkingDefault = els.thinking.checked;
    saveState(state);
  });
  els.includePage.addEventListener("change", () => {
    state.settings.readPageByDefault = els.includePage.checked;
    saveState(state);
  });
  els.historySearch.addEventListener("input", renderHistory);
  chrome.storage.onChanged.addListener((changes, area) => {
    const next = changes.skilldock_v1?.newValue;
    if (area !== "local" || !next?.settings || next.settings.language === state.settings.language) return;
    state.settings = { ...state.settings, ...next.settings };
    applyTheme();
    localizeDocument(language());
    fillProviders();
    fillSkills();
    renderConv(state.conversations.find((c) => c.id === activeId));
    renderHistory();
  });

  // 回到顶部悬浮钮：长对话滚离顶部后出现
  const toTop = document.createElement("button");
  toTop.type = "button";
  toTop.className = "to-top hidden";
  toTop.innerHTML = ICONS.toTop;
  toTop.title = t("回到顶部", language());
  toTop.setAttribute("aria-label", t("回到顶部", language()));
  toTop.addEventListener("click", () => els.messages.scrollTo({ top: 0, behavior: "smooth" }));
  $("app").appendChild(toTop);
  els.messages.addEventListener("scroll", () => {
    toTop.classList.toggle("hidden", els.messages.scrollTop < 300);
  });
  $("permAllow").addEventListener("click", () => {
    ensurePort().postMessage({ type: "permission_result", id: pendingPerm, allowed: true });
    hidePopup(els.perm);
  });
  $("permDeny").addEventListener("click", () => {
    ensurePort().postMessage({ type: "permission_result", id: pendingPerm, allowed: false });
    hidePopup(els.perm);
  });
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && editingMessageId) {
      e.preventDefault();
      els.input.value = "";
      cancelEdit();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !els.slash.classList.contains("hidden")) {
      const active = els.slash.querySelector(".active[data-id]") || els.slash.querySelector("[data-id]");
      if (active) {
        e.preventDefault();
        pickSkill(active.dataset.id);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  els.input.addEventListener("input", () => {
    const v = els.input.value;
    if (v.startsWith("/")) showSlash(v.slice(1));
    else hideSlash();
    updateSendState();
  });
  // 剪贴板截图/图片直接粘进输入框，走附件管线；纯文本粘贴不受影响
  els.input.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.items || [])]
      .filter((it) => it.kind === "file")
      .map((it) => it.getAsFile())
      .filter(Boolean);
    if (!files.length) return;
    e.preventDefault();
    addFiles(
      files.map((f) => {
        if (f.name && f.name !== "image.png") return f;
        const ext = f.type.split("/")[1] || "png";
        const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, "");
        return new File([f], `截图-${stamp}.${ext}`, { type: f.type });
      })
    );
  });

  let lastActionKey = "";
  function applyContextAction(action, text) {
    const key = `${action}|${text || ""}`;
    if (key === lastActionKey) return;
    lastActionKey = key;
    setTimeout(() => {
      if (lastActionKey === key) lastActionKey = "";
    }, 1500);
    const map = {
      summarize: "sk_summarize",
      translate: "sk_translate",
      explain: "sk_explain",
      rewrite: "sk_rewrite",
      shorten: "sk_shorten",
      ask: ""
    };
    if (map[action]) selectSkill(map[action], { focus: false });
    if (action === "summarize" && !text) els.input.value = "请总结当前页面。";
    else if (text) els.input.value = text;
    updateSendState();
    if (els.input.value) send();
  }

  const pending = await chrome.runtime.sendMessage({ type: "TAKE_PENDING_ACTION" }).catch(() => null);
  if (pending?.action) applyContextAction(pending.action.action, pending.action.text);

  const pendingAtt = await chrome.runtime
    .sendMessage({ type: "TAKE_PENDING_ATTACHMENT" })
    .catch(() => null);
  if (pendingAtt?.attachment) {
    attachments.push(pendingAtt.attachment);
    renderChips();
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== "CONTEXT_ACTION") return;
    applyContextAction(msg.action, msg.text);
  });
}

init();
