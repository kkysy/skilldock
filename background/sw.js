import {
  loadState,
  saveState,
  findProvider,
  findSkill,
  upsertConversation,
  newConversation
} from "../shared/storage.js";
import { streamChat, canonicalToolName, TOOL_DEFS } from "../shared/providers.js";
import { uid, truncate, matchSite, hostOf, safeJson } from "../shared/utils.js";
import { decodeHtml, extractReadableHtml, isSafePublicHttpUrl } from "../shared/web.js";

async function enablePanel() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await enablePanel();
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/index.html") });
  }
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "skilldock-ask",
      title: "用 Skilldock 询问",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: "skilldock-summarize",
      title: "Skilldock：总结此页",
      contexts: ["page"]
    });
    chrome.contextMenus.create({
      id: "skilldock-open-pdf",
      title: "用 Skilldock 阅读此 PDF",
      contexts: ["link"],
      targetUrlPatterns: ["*://*/*.pdf", "*://*/*.pdf?*", "*://*/*.pdf#*", "file://*/*.pdf"]
    });
  });
});

chrome.runtime.onStartup.addListener(enablePanel);

chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
});

async function queueContextAction(payload) {
  await chrome.storage.session.set({ pendingAction: payload });
  chrome.runtime.sendMessage({ type: "CONTEXT_ACTION", ...payload }).catch(() => {});
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === "skilldock-open-pdf" && info.linkUrl) {
    const viewer = chrome.runtime.getURL("viewer/index.html") + "?src=" + encodeURIComponent(info.linkUrl);
    await chrome.tabs.create({ url: viewer });
    return;
  }
  await chrome.sidePanel.open({ tabId: tab.id });
  const payload =
    info.menuItemId === "skilldock-summarize"
      ? { action: "summarize", text: "" }
      : { action: "ask", text: info.selectionText || "" };
  await queueContextAction(payload);
});

const sessions = new Map();
const PAGE_CHUNK_CHARS = 10000;
const MAX_INITIAL_PAGE_CHARS = 10000;
const MAX_TOTAL_PAGE_CHARS = 30000;
const MAX_SEARCH_RESULT_BYTES = 1_500_000;

function send(port, msg) {
  try {
    port.postMessage(msg);
  } catch {
    /* closed */
  }
}

function isRestrictedUrl(url = "") {
  return /^(chrome|edge|about|chrome-extension|devtools|view-source):/i.test(url)
    || url.startsWith("https://chrome.google.com/webstore")
    || url.startsWith("https://chromewebstore.google.com");
}

async function getTab(tabId) {
  if (tabId) {
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      /* ignore */
    }
  }
  const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (current && !isRestrictedUrl(current.url || "")) return current;
  const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return focused || current;
}

// executeScript 注入的自包含回退函数，逻辑需与 content/content.js 的 extractPage/grabPageImages/pageImageCandidates/getPageImage 保持同步
async function extractPageFn(withImages, start = 0, maxLength = 10000) {
  const root = [
    document.querySelector("main"),
    document.querySelector("article"),
    document.querySelector("#content"),
    document.querySelector(".content"),
    document.body,
    document.documentElement
  ].find(Boolean);
  if (!root) return { ok: false, error: "页面还没有正文" };
  const clone = root.cloneNode(true);
  clone.querySelectorAll("script,style,noscript,svg").forEach((n) => n.remove());
  if (root === document.body || root === document.documentElement) {
    clone.querySelectorAll("nav,header,footer").forEach((n) => n.remove());
  }
  const fullText = (clone.innerText || clone.textContent || "").replace(/\s+/g, " ").trim();
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
  if (withImages) {
    const imgToJpeg = async (src, maxDim = 1024) => {
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
    };
    const seen = new Set();
    const cands = [...document.images]
      .map((im) => ({
        src: im.currentSrc || im.src,
        alt: (im.alt || "").trim().slice(0, 120),
        w: im.naturalWidth,
        h: im.naturalHeight
      }))
      .filter((c) => c.w >= 200 && c.h >= 150 && /^https?:/.test(c.src) && !seen.has(c.src) && seen.add(c.src))
      .sort((a, b) => b.w * b.h - a.w * a.h)
      .slice(0, 4);
    const images = [];
    for (const c of cands) {
      try {
        const dataUrl = await imgToJpeg(c.src);
        if (dataUrl) images.push({ src: c.src, alt: c.alt, dataUrl });
      } catch {
        /* 拉不到的图跳过 */
      }
    }
    page.images = images;
  }
  // 与 content.js 同步：图片元数据（不含字节流）随手附上
  const seenMeta = new Set();
  page.imageList = [...document.images]
    .map((im) => ({
      src: im.currentSrc || im.src,
      alt: (im.alt || "").trim().slice(0, 120),
      w: im.naturalWidth,
      h: im.naturalHeight
    }))
    .filter((c) => c.w >= 200 && c.h >= 150 && /^https?:/.test(c.src) && !seenMeta.has(c.src) && seenMeta.add(c.src))
    .sort((a, b) => b.w * b.h - a.w * a.h)
    .slice(0, 10)
    .map((c, i) => ({ index: i, ...c }));
  return page;
}

function extractLinksFn() {
  const links = [...document.querySelectorAll("a[href]")].map((a) => ({
    text: (a.innerText || a.getAttribute("aria-label") || "").trim().slice(0, 120),
    href: a.href
  })).filter((l) => l.href && !l.href.startsWith("javascript:"));
  return { ok: true, links };
}

function searchPageFn(query) {
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

function clickFn(selector) {
  const el = document.querySelector(selector);
  if (!el) return { ok: false, error: `找不到 ${selector}` };
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.click();
  return { ok: true };
}

function fillFn(selector, value) {
  const el = document.querySelector(selector);
  if (!el) return { ok: false, error: `找不到 ${selector}` };
  el.focus();
  if ("value" in el) {
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else el.textContent = value;
  return { ok: true };
}

function scrollFn(direction) {
  const map = { up: -window.innerHeight * 0.8, down: window.innerHeight * 0.8 };
  if (direction === "top") window.scrollTo({ top: 0, behavior: "smooth" });
  else if (direction === "bottom") window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  else window.scrollBy({ top: map[direction] || map.down, behavior: "smooth" });
  return { ok: true };
}

// 与 content/content.js 的 pageImageCandidates/listPageImages/getPageImage 保持同步
function listImagesFn() {
  const seen = new Set();
  const images = [...document.images]
    .map((im) => ({
      src: im.currentSrc || im.src,
      alt: (im.alt || "").trim().slice(0, 120),
      w: im.naturalWidth,
      h: im.naturalHeight
    }))
    .filter((c) => c.w >= 200 && c.h >= 150 && /^https?:/.test(c.src) && !seen.has(c.src) && seen.add(c.src))
    .sort((a, b) => b.w * b.h - a.w * a.h)
    .slice(0, 20)
    .map((c, i) => ({ index: i, ...c }));
  return { ok: true, images };
}

async function getImageFn(index, url) {
  const imgToJpeg = async (src, maxDim = 1024) => {
    const blob = await (await fetch(src)).blob();
    if (!blob.type.startsWith("image/") || blob.type.includes("svg")) return null;
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    return dataUrl.length <= 1200000 ? dataUrl : null;
  };
  const seen = new Set();
  const cands = [...document.images]
    .map((im) => ({
      src: im.currentSrc || im.src,
      alt: (im.alt || "").trim().slice(0, 120),
      w: im.naturalWidth,
      h: im.naturalHeight
    }))
    .filter((c) => c.w >= 200 && c.h >= 150 && /^https?:/.test(c.src) && !seen.has(c.src) && seen.add(c.src))
    .sort((a, b) => b.w * b.h - a.w * a.h)
    .slice(0, 50)
    .map((c, i) => ({ index: i, ...c }));
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

function pickBestPage(results) {
  const pages = (results || []).map((r) => r.result).filter((p) => p?.ok);
  if (!pages.length) return null;
  return pages.sort((a, b) => (b.text?.length || 0) - (a.text?.length || 0))[0];
}

async function injectContent(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/content.js"]
    });
    return true;
  } catch {
    return false;
  }
}

async function callTab(tabId, message) {
  if (!tabId) return { ok: false, error: "没有可用的标签页。" };
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return { ok: false, error: "标签页不存在。" };
  }
  if (isRestrictedUrl(tab.url || tab.pendingUrl || "")) {
    return { ok: false, error: `无法读取系统页面。请切到普通网页后再问。` };
  }
  try {
    const r = await chrome.tabs.sendMessage(tabId, message);
    if (r) return r;
  } catch {
    /* content script missing, usually after reloading the extension */
  }
  await injectContent(tabId);
  try {
    const r = await chrome.tabs.sendMessage(tabId, message);
    if (r) return r;
  } catch {
    /* fall through to executeScript */
  }
  try {
    if (message.type === "EXTRACT_PAGE") {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: extractPageFn,
        args: [!!message.withImages, message.start || 0, message.maxLength ?? 10000]
      });
      const best = pickBestPage(results);
      if (best) return best;
    } else if (message.type === "EXTRACT_LINKS") {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: extractLinksFn
      });
      const links = (results || []).flatMap((r) => r.result?.links || []);
      if (links.length) return { ok: true, links };
    } else if (message.type === "SEARCH_PAGE") {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: searchPageFn,
        args: [message.query || ""]
      });
      const snippets = (results || []).flatMap((r) => r.result?.snippets || []);
      return { ok: true, snippets };
    } else if (message.type === "CLICK") {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId },
        func: clickFn,
        args: [message.selector]
      });
      return r?.result || { ok: false, error: "点击失败" };
    } else if (message.type === "FILL") {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId },
        func: fillFn,
        args: [message.selector, message.value]
      });
      return r?.result || { ok: false, error: "填写失败" };
    } else if (message.type === "SCROLL") {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId },
        func: scrollFn,
        args: [message.direction || "down"]
      });
      return r?.result || { ok: false, error: "滚动失败" };
    } else if (message.type === "LIST_IMAGES") {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId },
        func: listImagesFn
      });
      return r?.result || { ok: false, error: "列出图片失败" };
    } else if (message.type === "GET_IMAGE") {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId },
        func: getImageFn,
        args: [message.index ?? 0, message.url || ""]
      });
      return r?.result || { ok: false, error: "抓取图片失败" };
    }
  } catch (err) {
    return { ok: false, error: `无法读取此页：${err.message}` };
  }
  return { ok: false, error: "无法访问此页面。若刚重新加载了扩展，请先刷新这个网页。" };
}

async function webSearch(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 Skilldock" } });
  const html = await res.text();
  const results = [];
  const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/gi)]
    .map((x) => decodeHtml(x[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim());
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && results.length < 6) {
    let target;
    try {
      const href = new URL(m[1].replace(/&amp;/g, "&"), url);
      target = href.searchParams.get("uddg") || href.href;
    } catch {
      continue;
    }
    const title = decodeHtml(m[2].replace(/<[^>]+>/g, "")).trim();
    if (title) results.push({ title, url: target, snippet: snippets[results.length] || "" });
  }
  if (!results.length) {
    const re2 = /uddg=([^&"]+)/g;
    const titles = [...html.matchAll(/class="result__a"[^>]*>([\s\S]*?)<\/a>/gi)].map((x) =>
      x[1].replace(/<[^>]+>/g, "").trim()
    );
    let i = 0;
    let mm;
    while ((mm = re2.exec(html)) && results.length < 6) {
      results.push({ title: titles[i] || decodeURIComponent(mm[1]), url: decodeURIComponent(mm[1]), snippet: snippets[i++] || "" });
    }
  }
  return results;
}

async function readResponseText(response, maxBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) return (await response.text()).slice(0, maxBytes);
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: bytes < maxBytes });
    if (bytes >= maxBytes) return text;
  }
  return text + decoder.decode();
}

async function fetchSearchResultPage(rawUrl) {
  let current = rawUrl;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount++) {
    if (!isSafePublicHttpUrl(current)) return { error: "只允许读取公开 HTTP(S) 网页，已拒绝本机、私有地址或非常规端口。" };
    let response;
    try {
      response = await fetch(current, { credentials: "omit", redirect: "manual", referrerPolicy: "no-referrer" });
    } catch (error) {
      return { error: `读取搜索结果失败：${error.message}` };
    }
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next) return { error: "搜索结果页面重定向但未提供目标地址。" };
      current = new URL(next, current).href;
      continue;
    }
    if (!response.ok) return { error: `搜索结果页面返回 ${response.status}。` };
    const type = (response.headers.get("content-type") || "").toLowerCase();
    if (type && !type.includes("text/html") && !type.includes("application/xhtml+xml")) {
      return { error: `搜索结果不是可读取的 HTML 网页（${type.split(";")[0]}）。` };
    }
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_SEARCH_RESULT_BYTES) return { error: "搜索结果页面过大，未读取。" };
    const html = await readResponseText(response, MAX_SEARCH_RESULT_BYTES);
    return { url: current, ...extractReadableHtml(html, current) };
  }
  return { error: "搜索结果页面重定向次数过多。" };
}

const RISK_TOOLS = new Set(["click_element", "fill_element", "open_tab"]);

async function runTool(name, args, ctx) {
  if (name === "web_search" && !ctx.webSearchEnabled) {
    return "联网搜索已在设置中关闭。请根据已有页面上下文作答。";
  }
  const tab = await getTab(ctx.tabId);
  const tabId = args.tabId || tab?.id;
  const resolved = canonicalToolName(name);
  switch (resolved) {
    case "read_page": {
      const start = Math.max(0, Number(args.start) || 0);
      const cacheKey = `page-segment:${tabId}:${start}`;
      if (ctx.cache?.has(cacheKey)) return ctx.cache.get(cacheKey);
      const page = await callTab(tabId, {
        type: "EXTRACT_PAGE",
        start,
        maxLength: PAGE_CHUNK_CHARS
      });
      if (!page?.ok) return page?.error || "读取页面失败";
      const info = page.contentInfo || {
        startPosition: start,
        endPosition: start + String(page.text || "").length,
        totalLength: start + String(page.text || "").length,
        hasMore: false,
        nextStart: start + String(page.text || "").length
      };
      const result = `页面：${page.title || "未命名页面"}\n位置：${info.startPosition}-${info.endPosition} / ${info.totalLength}\n还有后续内容：${info.hasMore ? "是" : "否"}\n下一段 start：${info.nextStart}\n\n${page.text || ""}`;
      ctx.cache?.set(cacheKey, result);
      return result;
    }
    case "list_tabs": {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      return tabs
        .filter((t) => t.url && !t.url.startsWith("chrome"))
        .map((t) => `- [${t.id}] ${t.title} — ${t.url}`)
        .join("\n");
    }
    case "extract_links": {
      const page = await callTab(tabId, { type: "EXTRACT_LINKS" });
      if (!page?.ok) return page?.error || "提取链接失败";
      return (page.links || []).slice(0, 80).map((l) => `- ${l.text}: ${l.href}`).join("\n") || "没有链接";
    }
    case "search_page": {
      const page = await callTab(tabId, { type: "SEARCH_PAGE", query: args.query || "" });
      if (!page?.ok) return page?.error || "搜索失败";
      return (page.snippets || []).join("\n---\n") || "没有匹配";
    }
    case "open_tab": {
      if (!args.url) return "缺少 url";
      await chrome.tabs.create({ url: args.url, active: false });
      return `已打开 ${args.url}`;
    }
    case "click_element": {
      const r = await callTab(tabId, { type: "CLICK", selector: args.selector });
      return r?.ok ? `已点击 ${args.selector}` : r?.error || "点击失败";
    }
    case "fill_element": {
      const r = await callTab(tabId, { type: "FILL", selector: args.selector, value: args.value });
      return r?.ok ? `已填入 ${args.selector}` : r?.error || "填写失败";
    }
    case "scroll_page": {
      const r = await callTab(tabId, { type: "SCROLL", direction: args.direction || "down" });
      return r?.ok ? `已滚动 ${args.direction || "down"}` : r?.error || "滚动失败";
    }
    case "list_page_images": {
      const page = await callTab(tabId, { type: "LIST_IMAGES" });
      if (!page?.ok) return page?.error || "列出页面图片失败";
      const list = page.images || [];
      if (!list.length) return "当前页面没有可调取的图片。";
      return list
        .map((im) => `[${im.index}] ${im.alt || "（无描述）"} — ${im.w}×${im.h} — ${truncate(im.src, 120)}`)
        .join("\n");
    }
    case "send_page_image": {
      const want = String(args.url || "").trim();
      if (args.index == null && !want) return "缺少参数：请提供 list_page_images 返回的图片序号 index，或图片 url。";
      const r = await callTab(tabId, { type: "GET_IMAGE", index: args.index, url: want });
      if (!r?.ok) return r?.error || "抓取页面图片失败";
      const label = r.alt || r.src;
      // 带 images 的返回值由工具循环特殊处理：图片会注入对话，模型与用户都能看到
      return {
        text: `已将页面图片发送到对话中（${truncate(label, 120)}，原始尺寸 ${r.w}×${r.h}）。图片内容见随后的图片消息，请直接看图作答。`,
        images: [r.dataUrl],
        label
      };
    }
    case "web_search": {
      const results = await webSearch(args.query || "");
      if (!results.length) return "没有搜索结果";
      return results.map((r, i) => `${i + 1}. ${r.title}\n${r.url}${r.snippet ? `\n摘要：${r.snippet}` : ""}`).join("\n\n");
    }
    case "read_search_result": {
      if (!args.url) return "缺少搜索结果 URL。";
      let url;
      try {
        url = new URL(args.url).href;
      } catch {
        return "搜索结果 URL 无效。";
      }
      const cacheKey = `search-result:${url}`;
      let page = ctx.cache?.get(cacheKey);
      if (!page) {
        page = await fetchSearchResultPage(url);
        if (!page.error) ctx.cache?.set(cacheKey, page);
      }
      if (page.error) return page.error;
      const fullText = page.text || page.description || "";
      const start = Math.max(0, Math.min(Number(args.start) || 0, fullText.length));
      const end = Math.min(start + PAGE_CHUNK_CHARS, fullText.length);
      return `搜索结果页面：${page.title}\n来源：${page.url}\n位置：${start}-${end} / ${fullText.length}\n还有后续内容：${end < fullText.length ? "是" : "否"}\n下一段 start：${end < fullText.length ? end : start}${page.description ? `\n摘要：${page.description}` : ""}\n\n${fullText.slice(start, end)}`;
    }
    default:
      return `未知工具 ${name}。可用工具：${TOOL_DEFS.map((t) => t.name).join(", ")}。请直接根据已有页面上下文作答，不要再调用不存在的工具。`;
  }
}

function toolNamesFor(settings, skills = []) {
  const hasSkills = skills.length > 0;
  const allows = (tool, fallback) => hasSkills ? skills.some((skill) => skill?.tools?.[tool]) : fallback;
  const names = [];
  const read = allows("readPage", settings.readPageByDefault);
  if (read) names.push("read_page", "list_tabs", "extract_links", "search_page", "list_page_images", "send_page_image");
  const canSearchWeb = settings.webSearchEnabled !== false && allows("webSearch", true);
  if (canSearchWeb) names.push("web_search", "read_search_result");
  if (settings.browserControl && allows("browser", settings.browserControl)) {
    names.push("click_element", "fill_element", "scroll_page", "open_tab");
  }
  return [...new Set(names)];
}

function waitPermission(port, call) {
  return new Promise((resolve) => {
    const id = call.id;
    const timer = setTimeout(() => resolve(false), 120000);
    const handler = (msg) => {
      if (msg.type !== "permission_result" || msg.id !== id) return;
      clearTimeout(timer);
      port.onMessage.removeListener(handler);
      resolve(!!msg.allowed);
    };
    port.onMessage.addListener(handler);
    send(port, {
      type: "permission",
      id,
      name: call.name,
      args: safeJson(call.arguments) || {}
    });
  });
}

async function collectContext(tabId, extraTabIds = [], cache) {
  const blocks = [];
  let remaining = MAX_TOTAL_PAGE_CHARS;
  const ids = [...new Set([tabId, ...extraTabIds].filter(Boolean))];
  for (const id of ids) {
    const page = await callTab(id, {
      type: "EXTRACT_PAGE",
      start: 0,
      maxLength: MAX_INITIAL_PAGE_CHARS
    });
    if (page?.ok) {
      if (remaining <= 0) break;
      const budget = Math.min(MAX_INITIAL_PAGE_CHARS, remaining);
      const title = page.title || "未命名页面";
      const url = page.url || "";
      const info = page.contentInfo || {};
      let block = `### ${title}\nURL: ${url}\n[页面预览：${info.startPosition ?? 0}-${info.endPosition ?? String(page.text || "").length} / ${info.totalLength ?? String(page.text || "").length}；${info.hasMore ? `还有后续内容，下一段 start=${info.nextStart}` : "已是全文"}]\n\n${truncate(page.text || "", Math.max(0, budget - title.length - url.length - 100))}`;
      // 页面图片默认不随消息发送（省 token），只告知有哪些图，模型按需用工具调取
      if (page.imageList?.length) {
        const names = page.imageList.map((im) => im.alt || im.src).join("；");
        block += `\n\n（本页还有 ${page.imageList.length} 张图片，未随消息发送：${truncate(names, 300)}）`;
      }
      blocks.push({ key: page.url || page.title || "", text: block });
      remaining -= block.length;
    }
  }
  return { blocks };
}

async function handleChat(port, req) {
  const state = await loadState();
  const settings = state.settings;
  const provider = findProvider(state, req.providerId || settings.providerId);
  if (!provider) throw new Error("未选择模型提供方");
  if (provider.id !== "ollama" && !provider.apiKey) {
    throw new Error(`请先在设置里填写 ${provider.name} 的 API Key`);
  }
  const model = req.model || settings.model;
  const requestedSkillIds = Array.isArray(req.skillIds)
    ? req.skillIds
    : req.skillId ? [req.skillId] : [];
  const skills = [...new Set(requestedSkillIds)]
    .map((id) => findSkill(state, id))
    .filter((skill) => skill?.enabled !== false);
  const skill = skills[0] || null;
  const tab = await getTab(req.tabId);
  if (tab?.url && (settings.disabledSites || []).some((p) => matchSite(p, tab.url))) {
    throw new Error(`已在 ${hostOf(tab.url)} 禁用 Skilldock`);
  }

  let conv = (state.conversations || []).find((c) => c.id === req.conversationId);
  if (!conv) {
    conv = newConversation({
      providerId: provider.id,
      model,
      skillId: skill?.id || null,
      skillIds: skills.map((item) => item.id),
      title: (req.text || skill?.name || "新对话").slice(0, 40)
    });
  }

  // 编辑最近一条用户消息：删掉原消息及其后的回答，下面的正常管线会追加新内容。
  if (req.editMessageId) {
    const eidx = conv.messages.findIndex((m) => m.id === req.editMessageId && m.role === "user");
    if (eidx < 0) throw new Error("找不到要编辑的消息");
    conv.messages.length = eidx;
  }

  // 重生成：删掉目标回答及其后的所有消息（含它前面的那条提问，提问会由下方正常管线重新追加）
  if (req.regenerate) {
    const aidx = conv.messages.findIndex((m) => m.id === req.messageId && m.role === "assistant");
    if (aidx < 0) throw new Error("找不到要重生成的回答");
    let uidx = -1;
    for (let i = aidx - 1; i >= 0; i--) {
      if (conv.messages[i].role === "user") { uidx = i; break; }
    }
    if (uidx < 0) throw new Error("这条回答前面没有提问，无法重生成");
    conv.messages.length = uidx;
  }

  const images = (req.attachments || [])
    .flatMap((a) => (a.kind === "image" ? [a.dataUrl] : a.kind === "pdf" ? a.images || [] : []));
  const fileNotes = (req.attachments || [])
    .filter((a) => a.kind === "text" || a.kind === "pdf")
    .map((a) => {
      const head = a.kind === "pdf"
        ? `### PDF 文件 ${a.name}（共 ${a.pageCount || "?"} 页${a.scanned ? "，扫描件已附页面截图" : ""}${a.truncated ? "，内容有截断" : ""}）`
        : `### 文件 ${a.name}`;
      return a.text ? `${head}\n${truncate(a.text, 60000)}` : head;
    })
    .join("\n\n");

  let userText = req.text || "";
  if (skills.length) userText = `【技能：${skills.map((item) => item.name).join("、")}】\n${userText}`.trim();
  if (fileNotes) userText += `\n\n${fileNotes}`;

  const toolCache = new Map();
  const includePage = req.includePage !== false && (skills.length ? skills.some((item) => item.tools?.readPage) : settings.readPageByDefault);
  const toolNames = toolNamesFor(settings, skills);
  if (includePage && tab?.id) {
    const ctx = await collectContext(tab.id, req.extraTabIds || [], toolCache);
    // 每个页面在会话里只附一次：历史消息里已含该 URL 的上下文块则跳过，
    // 页面有更新时模型可自行调 read_page 重读
    const prior = conv.messages.map((m) => m.content || "").join("\n");
    const fresh = ctx.blocks.filter((b) => !b.key || !prior.includes(`URL: ${b.key}`));
    if (fresh.length) {
      userText += `\n\n---\n当前页面上下文（每个页面只在首次进入对话时附带一次，后续提问不再重复）：\n${fresh.map((b) => b.text).join("\n\n")}`;
    }
  }
  if (req.selection) {
    userText += `\n\n---\n用户选中的文本：\n${req.selection}`;
  }

  conv.messages.push({
    id: uid("msg"),
    role: "user",
    content: userText,
    // display 是用户实际输入的原文；content 拼了文件和页面上下文，仅供发给模型
    // 空输入直接发技能时，用 /技能名 占位，与侧边栏本地预览保持一致
    display: req.text || (skills.length ? skills.map((item) => `/${item.slash || item.name}`).join(" ") : ""),
    images,
    createdAt: Date.now()
  });

  const systemParts = [settings.systemPrompt || ""];
  skills.forEach((item) => {
    if (item.instructions) systemParts.push(`技能「${item.name}」说明：\n${item.instructions}`);
  });
  if (includePage) {
    systemParts.push(`页面上下文规则：每个页面只在首次进入对话时附带一次首段预览（不是全文），之后的提问不会重复附带；预览可能在本轮用户消息里，也可能在更早的消息里。若问题涉及全文、文献、事件经过或预览中未出现的内容，或页面可能已更新，必须调用 read_page 重新读取；根据结果中的‘下一段 start’连续读取后续分段，直到‘还有后续内容：否’或已有足够证据。不要重复读取相同 start。只可调用以下工具：${toolNames.join("、")}。不要拼接或重复工具名。`);
  }
  if (toolNames.includes("read_search_result")) {
    systemParts.push("联网检索后，如需依据某个结果页回答，应调用 read_search_result 并传入 web_search 返回的 URL；它会直接返回网页正文，不要为读取内容而调用 open_tab。若结果有后续内容，使用其 nextStart 继续读取。");
  }
  if (toolNames.includes("send_page_image")) {
    systemParts.push("页面图片：默认不随用户消息发送，页面上下文里只列出了图片的名称/URL。若问题涉及页面上的图片、或需要向用户展示某张图片，先调用 list_page_images 获取图片列表（序号、描述、尺寸），再调用 send_page_image 传入序号或图片 URL；发送后图片会出现在对话中，你也能直接看到图片内容。");
  }
  const llmMessages = [
    { role: "system", content: systemParts.filter(Boolean).join("\n\n") },
    ...conv.messages.map((m) => ({
      role: m.role,
      content: m.content,
      // fromTool 图片只在注入的那一轮请求里可见（roundMessages 直传），
      // 后续轮次从模型输入剔除以省 token；用户手动附件保持每轮可见
      images: m.fromTool ? undefined : m.images,
      toolCalls: m.toolCalls,
      toolCallId: m.toolCallId,
      name: m.name,
      thinking: m.thinking,
      thinkingSignature: m.thinkingSignature
    }))
  ];

  const assistantId = uid("msg");
  const t0 = Date.now();
  send(port, { type: "conversation", conversation: conv });
  send(port, { type: "assistant_start", id: assistantId });

  let full = "";
  let thinking = "";
  let roundThinking = "";
  let roundSig = "";
  const maxRounds = 12;
  let roundMessages = llmMessages;
  const failedTools = new Set();
  let usedTools = false;

  async function consumeStream(names) {
    roundThinking = "";
    roundSig = "";
    let toolCalls = [];
    for await (const ev of streamChat({
      provider,
      model,
      messages: roundMessages,
      toolNames: names,
      thinking: req.thinking === true,
      signal: sessions.get(port)?.abort.signal
    })) {
      if (ev.type === "text") {
        full += ev.text;
        send(port, { type: "delta", id: assistantId, text: ev.text });
      } else if (ev.type === "thinking") {
        thinking += ev.text;
        roundThinking += ev.text;
        send(port, { type: "thinking", id: assistantId, text: ev.text });
      } else if (ev.type === "thinking_sig") {
        roundSig = ev.signature;
      } else if (ev.type === "tool_calls") {
        toolCalls = ev.calls || [];
      }
    }
    return toolCalls;
  }

  try {
    for (let round = 0; round < maxRounds; round++) {
      const toolCalls = await consumeStream(toolNames);
      if (!toolCalls.length) break;
      usedTools = true;

      const normalized = toolCalls.map((call) => ({
        ...call,
        name: canonicalToolName(call.name, toolNames)
      }));

      conv.messages.push({
        id: assistantId + `_r${round}`,
        role: "assistant",
        content: full,
        toolCalls: normalized,
        thinking: roundThinking || undefined,
        thinkingSignature: roundSig || undefined,
        createdAt: Date.now()
      });
      roundMessages.push({
        role: "assistant",
        content: full,
        toolCalls: normalized,
        thinking: roundThinking || undefined,
        thinkingSignature: roundSig || undefined
      });

      let allFailed = true;
      const resultCache = new Map();
      for (const call of normalized) {
        const args = safeJson(call.arguments) || {};
        const cacheKey = `${call.name}|${JSON.stringify(args)}`;
        const cached = resultCache.has(cacheKey);
        if (!cached) {
          send(port, { type: "tool", id: call.id, name: call.name, args: call.arguments, status: "running" });
        }
        let allowed = true;
        if (!cached && RISK_TOOLS.has(call.name) && settings.browserControl) {
          allowed = await waitPermission(port, call);
        }
        let result;
        try {
          if (cached) {
            result = resultCache.get(cacheKey);
          } else if (failedTools.has(call.name) && !TOOL_DEFS.some((t) => t.name === call.name)) {
            result = `已拒绝重复调用未知工具 ${call.name}。请根据已有上下文直接作答。`;
          } else {
            result = allowed ? await runTool(call.name, args, { tabId: tab?.id, cache: toolCache, webSearchEnabled: settings.webSearchEnabled !== false }) : "用户拒绝了此操作";
          }
        } catch (e) {
          result = `工具失败: ${e.message}`;
        }
        resultCache.set(cacheKey, result);
        // runTool 可能返回 { text, images, label }（如 send_page_image），统一归一化
        const resObj = typeof result === "string" ? { text: result } : result || { text: "" };
        const resText = String(resObj.text ?? "");
        if (!resText.startsWith("未知工具") && !resText.startsWith("已拒绝") && !resText.startsWith("无法")) allFailed = false;
        if (resText.startsWith("未知工具")) failedTools.add(call.name);
        send(port, {
          type: "tool",
          id: call.id,
          name: call.name,
          args: call.arguments,
          status: "done",
          result: resText,
          cached
        });
        const toolMsg = {
          id: uid("tool"),
          role: "tool",
          name: call.name,
          toolCallId: call.id,
          content: resText,
          createdAt: Date.now()
        };
        conv.messages.push(toolMsg);
        roundMessages.push(toolMsg);
        if (resObj.images?.length) {
          // 图片以 user 消息注入：三家 provider 都已支持 user 多模态输入，
          // 模型本轮及后续轮次都能看到图；UI 按 fromTool 渲染为图片卡片
          const imgMsg = {
            id: uid("msg"),
            role: "user",
            content: `（系统注入：这是模型调用 ${call.name} 发送的页面图片${resObj.label ? `：${resObj.label}` : ""}。）`,
            // display 供导出使用（UI 对 fromTool 消息渲染图片卡片，不读 display）
            display: `（模型发送的页面图片${resObj.label ? `：${resObj.label}` : ""}）`,
            images: resObj.images,
            fromTool: call.name,
            createdAt: Date.now()
          };
          conv.messages.push(imgMsg);
          roundMessages.push(imgMsg);
          send(port, { type: "toolimg", id: imgMsg.id, images: resObj.images });
        }
      }
      full = "";
      if (allFailed) {
        roundMessages.push({
          role: "user",
          content: "工具不可用或已提供页面内容。请不要再调用工具，直接根据用户消息里的页面上下文完成技能任务。"
        });
        await consumeStream([]);
        break;
      }
    }
    if (usedTools && !full.trim()) {
      roundMessages.push({
        role: "user",
        content: "请不要再调用工具，直接输出最终回答。"
      });
      await consumeStream([]);
    }
  } catch (err) {
    if (err.name === "AbortError") {
      conv.messages.push({
        id: assistantId,
        role: "assistant",
        content: full || "(已停止)",
        createdAt: Date.now(),
        elapsedMs: Date.now() - t0
      });
      await upsertConversation(conv);
      send(port, { type: "stopped", id: assistantId, text: full, conversation: conv });
      return;
    }
    throw err;
  }

  conv.messages.push({
    id: assistantId,
    role: "assistant",
    content: full,
    thinking,
    createdAt: Date.now(),
    elapsedMs: Date.now() - t0
  });
  if (conv.title === "新对话" || conv.title.length < 8) {
    conv.title = (req.text || conv.title).replace(/\s+/g, " ").slice(0, 36) || conv.title;
  }
  conv.providerId = provider.id;
  conv.model = model;
  conv.skillId = skill?.id || null;
  conv.skillIds = skills.map((item) => item.id);
  await upsertConversation(conv);
  send(port, { type: "done", id: assistantId, conversation: conv });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "skilldock") return;
  sessions.set(port, { abort: new AbortController() });
  port.onMessage.addListener(async (msg) => {
    if (msg.type === "stop") {
      sessions.get(port)?.abort.abort();
      sessions.set(port, { abort: new AbortController() });
      return;
    }
    if (msg.type === "chat") {
      sessions.get(port)?.abort.abort();
      sessions.set(port, { abort: new AbortController() });
      try {
        await handleChat(port, msg);
      } catch (err) {
        send(port, { type: "error", error: err.message || String(err) });
      }
    }
  });
  port.onDisconnect.addListener(() => {
    sessions.get(port)?.abort.abort();
    sessions.delete(port);
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_SETTINGS") {
    loadState().then((s) => sendResponse({ ok: true, settings: s.settings })).catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === "OPEN_SIDEPANEL") {
    const tabId = sender.tab?.id;
    if (tabId) {
      chrome.sidePanel.open({ tabId }).then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: e.message }));
    } else sendResponse({ ok: false });
    return true;
  }
  if (msg.type === "CONTEXT_ACTION") {
    queueContextAction({ action: msg.action, text: msg.text || "" }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === "OPEN_SIDEPANEL_WITH_ATTACHMENT") {
    const tabId = sender.tab?.id;
    chrome.storage.session
      .set({ pendingAttachment: msg.attachment || null })
      .then(async () => {
        if (tabId) await chrome.sidePanel.open({ tabId }).catch(() => {});
        sendResponse({ ok: true });
      })
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === "TAKE_PENDING_ATTACHMENT") {
    chrome.storage.session.get("pendingAttachment").then(async (bag) => {
      await chrome.storage.session.remove("pendingAttachment");
      sendResponse({ ok: true, attachment: bag.pendingAttachment || null });
    });
    return true;
  }
  if (msg.type === "TAKE_PENDING_ACTION") {
    chrome.storage.session.get("pendingAction").then(async (bag) => {
      await chrome.storage.session.remove("pendingAction");
      sendResponse({ ok: true, action: bag.pendingAction || null });
    });
    return true;
  }
});
