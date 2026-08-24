(() => {
  if (window.top !== window) return;
  if (window.__skilldockContent) return;
  window.__skilldockContent = true;

  const ROOT_ID = "skilldock-root";
  let settings = { selectionToolbar: true, quickChat: true, disabledSites: [] };
  let toolbar;
  let quick;
  let selectedText = "";
  const english = () => settings.language === "en";
  const ui = (zh, en) => english() ? en : zh;

  function hostOf(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  }

  function disabled() {
    const host = location.hostname.toLowerCase();
    return (settings.disabledSites || []).some((p) => {
      const s = String(p).trim().toLowerCase();
      if (!s) return false;
      return host === s || host.endsWith(`.${s}`) || location.href.toLowerCase().includes(s);
    });
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;
    root = document.createElement("div");
    root.id = ROOT_ID;
    document.documentElement.appendChild(root);
    return root;
  }

  // 跨域图直接 drawImage 会污染 canvas；走 fetch 字节流 + createImageBitmap 则不受 CORS 限制（host_permissions 已覆盖）
  async function imgToJpeg(src, maxDim = 1024) {
    const blob = await (await fetch(src)).blob();
    if (!blob.type.startsWith("image/") || blob.type.includes("svg")) return null;
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const url = canvas.toDataURL("image/jpeg", 0.8);
    return url.length <= 1200000 ? url : null;
  }

  function pageImageCandidates(limit = 20) {
    const seen = new Set();
    return [...document.images]
      .map((im) => ({
        src: im.currentSrc || im.src,
        alt: (im.alt || "").trim().slice(0, 120),
        w: im.naturalWidth,
        h: im.naturalHeight
      }))
      .filter((c) => c.w >= 200 && c.h >= 150 && /^https?:/.test(c.src) && !seen.has(c.src) && seen.add(c.src))
      .sort((a, b) => b.w * b.h - a.w * a.h)
      .slice(0, limit)
      .map((c, i) => ({ index: i, ...c }));
  }

  async function grabPageImages(limit = 4) {
    const out = [];
    for (const c of pageImageCandidates(limit)) {
      try {
        const dataUrl = await imgToJpeg(c.src);
        if (dataUrl) out.push({ src: c.src, alt: c.alt, dataUrl });
      } catch {
        /* 拉不到的图跳过 */
      }
    }
    return out;
  }

  function listPageImages() {
    return { ok: true, images: pageImageCandidates(20) };
  }

  async function getPageImage(index, url) {
    const cands = pageImageCandidates(50);
    const want = String(url || "").trim();
    const cand = want ? cands.find((c) => c.src === want) : cands[Number(index) || 0];
    if (!cand) return { ok: false, error: want ? "页面上找不到这张图片。" : "页面上没有这个序号的图片，请先列出页面图片。" };
    try {
      const dataUrl = await imgToJpeg(cand.src);
      if (!dataUrl) return { ok: false, error: "图片无法读取或体积过大。" };
      return { ok: true, dataUrl, src: cand.src, alt: cand.alt, w: cand.w, h: cand.h };
    } catch (err) {
      return { ok: false, error: `图片抓取失败：${err.message}` };
    }
  }

  function readableRoot() {
    return [
      document.querySelector("main"),
      document.querySelector("article"),
      document.querySelector("#content"),
      document.querySelector(".content"),
      document.body,
      document.documentElement
    ].find(Boolean);
  }

  function extractPageText() {
    const root = readableRoot();
    const clone = root.cloneNode(true);
    clone.querySelectorAll("script,style,noscript,svg").forEach((n) => n.remove());
    if (root === document.body || root === document.documentElement) {
      clone.querySelectorAll("nav,header,footer").forEach((n) => n.remove());
    }
    return (clone.innerText || clone.textContent || "").replace(/\s+/g, " ").trim();
  }

  async function extractPage(withImages, start = 0, maxLength = 10000) {
    const fullText = extractPageText();
    const totalLength = fullText.length;
    const begin = Math.max(0, Math.min(Number(start) || 0, totalLength));
    const end = maxLength === 0 ? totalLength : Math.min(begin + Math.max(1, Number(maxLength) || 10000), totalLength);
    const text = fullText.slice(begin, end);
    const page = {
      ok: true,
      title: document.title,
      url: location.href,
      text,
      selection: window.getSelection()?.toString() || "",
      contentInfo: {
        isPartial: begin > 0 || end < totalLength,
        startPosition: begin,
        endPosition: end,
        totalLength,
        hasMore: end < totalLength,
        nextStart: end < totalLength ? end : begin
      }
    };
    if (withImages) page.images = await grabPageImages(4);
    // 图片元数据（不含字节流）随手附上，供背景页告知模型本页有哪些图可按需调取
    page.imageList = pageImageCandidates(10);
    return page;
  }

  function extractLinks() {
    const links = [...document.querySelectorAll("a[href]")].map((a) => ({
      text: (a.innerText || a.getAttribute("aria-label") || "").trim().slice(0, 120),
      href: a.href
    })).filter((l) => l.href && !l.href.startsWith("javascript:"));
    return { ok: true, links };
  }

  function searchPage(query) {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const q = normalize(query);
    if (!q) return { ok: true, snippets: [] };
    const text = normalize(document.body?.innerText || "");
    const lower = text.toLowerCase();
    const needle = q.toLowerCase();
    const snippets = [];
    let from = 0;
    while (snippets.length < 8) {
      const i = lower.indexOf(needle, from);
      if (i < 0) break;
      snippets.push(text.slice(Math.max(0, i - 120), i + q.length + 180).replace(/\s+/g, " "));
      from = i + q.length;
    }
    return { ok: true, snippets };
  }

  function clickSel(selector) {
    const el = document.querySelector(selector);
    if (!el) return { ok: false, error: `找不到 ${selector}` };
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.click();
    return { ok: true };
  }

  function fillSel(selector, value) {
    const el = document.querySelector(selector);
    if (!el) return { ok: false, error: `找不到 ${selector}` };
    el.focus();
    if ("value" in el) {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      el.textContent = value;
    }
    return { ok: true };
  }

  function scrollDir(direction) {
    const map = { up: -window.innerHeight * 0.8, down: window.innerHeight * 0.8 };
    if (direction === "top") window.scrollTo({ top: 0, behavior: "smooth" });
    else if (direction === "bottom") window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    else window.scrollBy({ top: map[direction] || map.down, behavior: "smooth" });
    return { ok: true };
  }

  function hideToolbar() {
    if (toolbar) toolbar.style.display = "none";
  }

  function showToolbar(x, y) {
    if (!settings.selectionToolbar || disabled()) return;
    const root = ensureRoot();
    if (!toolbar) {
      toolbar = document.createElement("div");
      toolbar.className = "sd-toolbar";
      const actions = [
        [ui("总结", "Summarize"), "summarize"],
        [ui("翻译", "Translate"), "translate"],
        [ui("解释", "Explain"), "explain"],
        [ui("润色", "Rewrite"), "rewrite"],
        [ui("询问", "Ask"), "ask"]
      ];
      for (const [label, action] of actions) {
        const b = document.createElement("button");
        b.textContent = label;
        b.addEventListener("mousedown", (e) => e.preventDefault());
        b.addEventListener("click", () => runAction(action, selectedText));
        toolbar.appendChild(b);
      }
      root.appendChild(toolbar);
    }
    toolbar.style.display = "flex";
    toolbar.style.left = `${Math.min(window.innerWidth - 320, Math.max(8, x))}px`;
    toolbar.style.top = `${Math.min(window.innerHeight - 48, Math.max(8, y))}px`;
  }

  async function runAction(action, text) {
    hideToolbar();
    await chrome.runtime.sendMessage({ type: "OPEN_SIDEPANEL" });
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: "CONTEXT_ACTION", action, text }).catch(() => {});
    }, 200);
  }

  function toggleQuick(force) {
    if (!settings.quickChat || disabled()) return;
    const root = ensureRoot();
    if (!quick) {
      quick = document.createElement("div");
      quick.className = "sd-quick hidden";
      quick.innerHTML = `
        <div class="sd-quick-hd"><span>${ui("Skilldock 快捷问", "Skilldock Quick Chat")}</span><button type="button" data-x>${ui("关闭", "Close")}</button></div>
        <textarea placeholder="${ui("问当前页，或粘贴问题…", "Ask about this page, or paste a question…")}"></textarea>
        <div class="sd-quick-ft"><button type="button" data-go>${ui("发送到侧边栏", "Send to side panel")}</button></div>`;
      quick.querySelector("[data-x]").addEventListener("click", () => quick.classList.add("hidden"));
      quick.querySelector("[data-go]").addEventListener("click", async () => {
        const text = quick.querySelector("textarea").value.trim();
        if (!text) return;
        await runAction("ask", text);
        quick.classList.add("hidden");
      });
      root.appendChild(quick);
    }
    const show = force === true || (force !== false && quick.classList.contains("hidden"));
    quick.classList.toggle("hidden", !show);
    if (show) quick.querySelector("textarea").focus();
  }

  document.addEventListener("mouseup", (e) => {
    if (disabled()) return;
    const t = window.getSelection()?.toString().trim() || "";
    selectedText = t;
    if (t && t.length > 1) {
      showToolbar(e.clientX + 8, e.clientY + 10);
    } else hideToolbar();
  });
  document.addEventListener("mousedown", (e) => {
    if (toolbar && !toolbar.contains(e.target)) hideToolbar();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hideToolbar();
      if (quick) quick.classList.add("hidden");
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    try {
      if (msg.type === "EXTRACT_PAGE") {
        extractPage(!!msg.withImages, msg.start, msg.maxLength).then(sendResponse, (err) => sendResponse({ ok: false, error: err.message }));
        return true;
      }
      if (msg.type === "EXTRACT_LINKS") return sendResponse(extractLinks());
      if (msg.type === "LIST_IMAGES") return sendResponse(listPageImages());
      if (msg.type === "GET_IMAGE") {
        getPageImage(msg.index, msg.url).then(sendResponse, (err) => sendResponse({ ok: false, error: err.message }));
        return true;
      }
      if (msg.type === "SEARCH_PAGE") return sendResponse(searchPage(msg.query));
      if (msg.type === "CLICK") return sendResponse(clickSel(msg.selector));
      if (msg.type === "FILL") return sendResponse(fillSel(msg.selector, msg.value));
      if (msg.type === "SCROLL") return sendResponse(scrollDir(msg.direction));
      if (msg.type === "TOGGLE_QUICK_CHAT") {
        toggleQuick();
        return sendResponse({ ok: true });
      }
      if (msg.type === "GET_SELECTION") return sendResponse({ ok: true, text: window.getSelection()?.toString() || "" });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
    return false;
  });

  chrome.runtime.sendMessage({ type: "GET_SETTINGS" }).then((r) => {
    if (r?.ok) settings = { ...settings, ...r.settings };
  }).catch(() => {});
  chrome.storage?.onChanged?.addListener((changes, area) => {
    const next = changes.skilldock_v1?.newValue?.settings;
    if (area !== "local" || !next) return;
    const languageChanged = next.language !== settings.language;
    settings = { ...settings, ...next };
    if (languageChanged) {
      toolbar?.remove(); quick?.remove();
      toolbar = quick = null;
    }
  });
})();
