(() => {
  if (window.top !== window) return;
  if (window.__skilldockContent) return;
  window.__skilldockContent = true;

  const ROOT_ID = "skilldock-root";
  let settings = { selectionToolbar: true, disabledSites: [] };
  let toolbar;
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

  // 图片候选：list_page_images 与 send_page_image 共用同一套规则，序号才不会漂移。
  // 懒加载图的 naturalWidth 常为 0，尺寸优先取布局尺寸；srcset 取最大一档拿高清。
  const UI_IMAGE_RE = /(^|[^a-z])(qr|qrcode|app[-_ ]?store|google[-_ ]?play|logo|icon|avatar|emoji|badge|sprite)([^a-z]|$)/i;

  function largestFromSrcset(srcset) {
    let best = "";
    let bestW = -1;
    for (const part of String(srcset || "").split(",")) {
      const [url, desc] = part.trim().split(/\s+/);
      if (!url) continue;
      const w = Number(String(desc || "").replace(/[^\d.]/g, "")) || 0;
      if (w > bestW) {
        bestW = w;
        best = url;
      }
    }
    return best;
  }

  function imageCandidates(limit = 20) {
    const root = readableRoot();
    const seen = new Set();
    const out = [];
    for (const im of document.images) {
      const raw = largestFromSrcset(im.getAttribute("srcset")) || im.currentSrc || im.src || im.getAttribute("data-src") || "";
      let src = "";
      try {
        src = new URL(raw, location.href).href;
      } catch {
        continue;
      }
      if (!/^https?:/i.test(src) || seen.has(src)) continue;
      const rect = im.getBoundingClientRect();
      const w = Math.round(rect.width) || im.naturalWidth || Number(im.getAttribute("width")) || 0;
      const h = Math.round(rect.height) || im.naturalHeight || Number(im.getAttribute("height")) || 0;
      const alt = (im.alt || "").trim().slice(0, 120);
      const inArticle = !!(root && root !== document.body && root.contains(im));
      const likelyUi = UI_IMAGE_RE.test(`${alt} ${im.className || ""} ${src}`);
      // 0×0 + 无 alt + 无懒加载属性 + 不在正文里：多半是统计/广告像素。
      // 懒加载图带 data-src / srcset，正文图 inArticle 为真，都不会被误判
      const lazy = !!(im.getAttribute("data-src") || im.getAttribute("data-srcset") || im.getAttribute("srcset"));
      const likelyPixel = !likelyUi && w === 0 && h === 0 && !alt && !inArticle && !lazy;
      // 界面装饰图降权，但仍保留（避免过滤掉真正需要的图）
      if (!likelyUi && w > 0 && h > 0 && (w < 120 || h < 80)) continue;
      seen.add(src);
      out.push({ index: 0, src, alt, w, h, likelyUi, likelyPixel, inArticle });
    }
    out.sort(
      (a, b) =>
        Number(b.inArticle) - Number(a.inArticle) ||
        Number(a.likelyPixel) - Number(b.likelyPixel) ||
        Number(a.likelyUi) - Number(b.likelyUi) ||
        b.w * b.h - a.w * a.h
    );
    return out.slice(0, limit).map((c, i) => ({ ...c, index: i }));
  }

  async function grabPageImages(limit = 4) {
    const out = [];
    for (const c of imageCandidates(limit)) {
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
    return { ok: true, version: pageSnapshot().version, images: imageCandidates(20) };
  }

  async function getPageImage(index, url) {
    const cands = imageCandidates(50);
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

  // 页面文本快照：read_page 与 search_page 必须基于同一份文本，
  // 搜索给出的 start 才能直接用于 read_page(start=...)。版本号用于标记内容是否已变。
  const SNAPSHOT_TTL_MS = 5000;
  let snapshot = null;

  function invalidateSnapshot() {
    snapshot = null;
  }
  window.addEventListener("load", invalidateSnapshot);
  window.addEventListener("popstate", invalidateSnapshot);
  window.addEventListener("hashchange", invalidateSnapshot);

  function hashText(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 7) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function pageSnapshot() {
    const now = Date.now();
    if (snapshot && snapshot.href === location.href && now - snapshot.at < SNAPSHOT_TTL_MS) return snapshot;
    const text = extractPageText();
    snapshot = {
      text,
      href: location.href,
      at: now,
      version: `${text.length.toString(36)}-${hashText(text)}`
    };
    return snapshot;
  }

  async function extractPage(withImages, start = 0, maxLength = 10000) {
    const snap = pageSnapshot();
    const fullText = snap.text;
    const totalLength = fullText.length;
    const begin = Math.max(0, Math.min(Number(start) || 0, totalLength));
    const end = maxLength === 0 ? totalLength : Math.min(begin + Math.max(1, Number(maxLength) || 10000), totalLength);
    const text = fullText.slice(begin, end);
    const page = {
      ok: true,
      title: document.title,
      url: location.href,
      version: snap.version,
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
    page.imageList = imageCandidates(10);
    return page;
  }

  const TRACKING_PARAM_RE = /^(utm_\w+|xtor|fbclid|gclid|yclid|msclkid|at_medium|at_ptr_name|at_campaign|spm|ref_src|ref_url|igshid|mc_cid|mc_eid)$/i;

  // 去重键：只去掉 fragment 与明确的跟踪参数，保留可能决定资源身份的 query
  function linkKey(href) {
    try {
      const u = new URL(href);
      u.hash = "";
      for (const key of [...u.searchParams.keys()]) {
        if (TRACKING_PARAM_RE.test(key)) u.searchParams.delete(key);
      }
      return u.href.replace(/\/+$/, "");
    } catch {
      return href;
    }
  }

  function extractLinks() {
    const root = readableRoot();
    const seen = new Set();
    const inside = [];
    const others = [];
    const collect = (nodes, bucket) => {
      for (const a of nodes) {
        const raw = a.getAttribute("href") || "";
        if (!raw || raw.startsWith("#") || /^javascript:/i.test(raw)) continue;
        const href = a.href;
        if (!/^https?:/i.test(href)) continue;
        const text = (a.innerText || a.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 120);
        if (!text) continue;
        const key = linkKey(href);
        if (seen.has(key)) continue;
        seen.add(key);
        bucket.push({ text, href });
      }
    };
    if (root && root !== document.body && root !== document.documentElement) {
      collect(root.querySelectorAll("a[href]"), inside);
    }
    collect(document.querySelectorAll("a[href]"), others);
    return { ok: true, inside: inside.slice(0, 30), others: others.slice(0, 20), insideTotal: inside.length, othersTotal: others.length };
  }

  // 检索：短语优先，失败退回「关键词 AND + 邻近窗口」，并给出可跳读的字符偏移。
  const SEARCH_STOPWORDS = new Set([
    "the", "a", "an", "of", "in", "on", "at", "to", "for", "and", "or", "is", "are", "was", "were",
    "be", "been", "being", "by", "with", "from", "that", "this", "these", "those", "it", "its", "as",
    "they", "we", "you", "i", "has", "have", "had", "not", "but", "so", "if", "then", "than", "into",
    "over", "after", "before", "about", "his", "her", "their", "our", "your", "who", "which", "what"
  ]);

  // 长度 1:1 的归一化：只做字符替换与大小写，偏移仍对应原文
  function searchHaystack(text) {
    return String(text || "")
      .replace(/[\u2018\u2019\u201c\u201d"'()[\]{}<>;:!?,]/g, " ")
      .toLowerCase();
  }

  function occurrences(hay, token, cap) {
    const list = [];
    let from = 0;
    while (list.length < cap) {
      const i = hay.indexOf(token, from);
      if (i < 0) break;
      list.push(i);
      from = i + token.length;
    }
    return list;
  }

  // 短语匹配允许词间任意空白：标点已被替换成空格，硬 indexOf 会把 "a, b" 判成不匹配
  function phraseMatches(hay, needle, cap) {
    const parts = needle.split(" ").filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!parts.length) return [];
    const re = new RegExp(parts.join("\\s+"), "g");
    const out = [];
    let m;
    while (out.length < cap && (m = re.exec(hay))) {
      out.push({ start: m.index, length: m[0].length });
      if (!m[0].length) re.lastIndex += 1;
    }
    return out;
  }

  function searchPage(query) {
    const snap = pageSnapshot();
    const text = snap.text;
    const raw = String(query || "").replace(/\s+/g, " ").trim();
    const base = { ok: true, version: snap.version, totalLength: text.length };
    if (!raw) return { ...base, mode: "none", matches: [], missed: [], scattered: [] };

    const hay = searchHaystack(text);
    const needle = searchHaystack(raw).replace(/\s+/g, " ").trim();
    const clip = (start, length, before) => {
      const from = Math.max(0, start - (before ?? 120));
      const to = Math.min(text.length, start + length + 200);
      return { start, end: to, text: text.slice(from, to).trim() };
    };

    // 1) 连续短语
    const phrase = phraseMatches(hay, needle, 5);
    if (phrase.length) {
      return {
        ...base,
        mode: "phrase",
        matches: phrase.map((p) => clip(p.start, p.length)),
        missed: [],
        scattered: []
      };
    }

    // 2) 关键词 AND + 邻近窗口（±200 字符）
    const tokens = [...new Set(needle.split(" ").filter((t) => t.length > 1))];
    if (!tokens.length) return { ...base, mode: "none", matches: [], missed: [], scattered: [] };
    const positions = new Map(tokens.map((t) => [t, occurrences(hay, t, 300)]));
    const required = tokens.filter((t) => !SEARCH_STOPWORDS.has(t));
    const need = required.length ? required : tokens;
    const missed = need.filter((t) => (positions.get(t) || []).length === 0);
    const scattered = tokens
      .filter((t) => (positions.get(t) || []).length)
      .map((t) => ({ token: t, start: positions.get(t)[0] }))
      .slice(0, 5);

    const rarest = need
      .filter((t) => (positions.get(t) || []).length)
      .sort((a, b) => positions.get(a).length - positions.get(b).length)[0];
    const matches = [];
    if (rarest) {
      for (const center of positions.get(rarest)) {
        if (matches.length >= 5) break;
        const lo = Math.max(0, center - 200);
        const hi = Math.min(hay.length, center + 200);
        const complete = need.every((t) => (positions.get(t) || []).some((x) => x >= lo && x <= hi));
        if (!complete) continue;
        if (matches.some((m) => Math.abs(m.start - lo) < 150)) continue;
        matches.push(clip(lo, 200, 0));
      }
    }
    if (matches.length) return { ...base, mode: "and", matches, missed, scattered: [] };
    if (!missed.length) return { ...base, mode: "scattered", matches: [], missed, scattered };
    return { ...base, mode: "none", matches: [], missed, scattered };
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
    if (e.key === "Escape") hideToolbar();
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
      toolbar?.remove();
      toolbar = null;
    }
  });
})();
