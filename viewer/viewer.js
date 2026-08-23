import { openPdf, extractPdfText, renderPdfPages } from "../shared/pdf.js";

const $ = (id) => document.getElementById(id);
const els = {
  title: $("title"),
  pages: $("pages"),
  empty: $("empty"),
  pageInfo: $("pageInfo"),
  zoomLabel: $("zoomLabel"),
  zoomIn: $("zoomIn"),
  zoomOut: $("zoomOut"),
  btnAsk: $("btnAsk"),
  btnPick: $("btnPick"),
  fileInput: $("fileInput")
};

const MAX_PAGE_WIDTH = 1200;

let doc = null;
let rawBuffer = null;
let fileName = "document.pdf";
let zoom = 1;
let currentPage = 1;
const pageState = []; // { el, rendered, width, height }（尺寸为 scale=1 下的 CSS px）

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const num = Number(entry.target.dataset.page);
      if (entry.isIntersecting) {
        currentPage = num;
        updatePageInfo();
        if (!pageState[num - 1].rendered) renderPage(num);
      }
    }
  },
  { rootMargin: "400px 0px" }
);

function updatePageInfo() {
  els.pageInfo.textContent = doc ? `${currentPage} / ${doc.numPages}` : "";
}

function targetScale(viewport1) {
  const avail = Math.min(document.documentElement.clientWidth - 40, MAX_PAGE_WIDTH);
  return Math.min(Math.max((avail / viewport1.width) * zoom, 0.4), 4);
}

async function renderPage(num) {
  const st = pageState[num - 1];
  if (!st || st.rendered) return;
  st.rendered = true;
  st.el.classList.add("loading");
  st.el.textContent = `第 ${num} 页渲染中…`;
  try {
    const page = await doc.getPage(num);
    const viewport = page.getViewport({ scale: targetScale(page.getViewport({ scale: 1 })) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    st.el.textContent = "";
    st.el.classList.remove("loading");
    st.el.appendChild(canvas);
    page.cleanup();
  } catch (err) {
    st.el.textContent = `第 ${num} 页渲染失败：${err.message}`;
  }
}

function rebuildLayout() {
  observer.disconnect();
  els.pages.innerHTML = "";
  for (const st of pageState) st.rendered = false;
  pageState.forEach((st, i) => {
    const scale = targetScale({ width: st.width });
    const el = document.createElement("div");
    el.className = "page loading";
    el.dataset.page = String(i + 1);
    el.style.width = `${Math.floor(st.width * scale)}px`;
    el.style.minHeight = `${Math.floor(st.height * scale)}px`;
    el.textContent = `第 ${i + 1} 页`;
    st.el = el;
    els.pages.appendChild(el);
    observer.observe(el);
  });
}

function setZoom(next) {
  zoom = Math.min(Math.max(next, 0.5), 2.5);
  els.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  rebuildLayout();
}

async function loadPdf(buffer, name) {
  if (doc) {
    doc.destroy();
    doc = null;
  }
  rawBuffer = buffer;
  fileName = name || fileName;
  els.title.textContent = fileName;
  document.title = `${fileName} — Skilldock PDF 阅读器`;
  els.empty.classList.add("hidden");
  const status = document.createElement("div");
  status.className = "status";
  status.textContent = "正在打开 PDF…";
  els.pages.appendChild(status);
  try {
    // 传给 pdf.js 的 buffer 会被转移到 worker，原始副本留给「带去提问」
    doc = await openPdf({ data: buffer.slice(0) });
  } catch (err) {
    status.classList.add("error");
    status.textContent = /^file:/.test(location.search)
      ? `无法读取本地文件：请在 chrome://extensions 中为本扩展开启「允许访问文件网址」。（${err.message}）`
      : `打开失败：${err.message}`;
    return;
  }
  status.remove();
  pageState.length = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const v = page.getViewport({ scale: 1 });
    pageState.push({ el: null, rendered: false, width: v.width, height: v.height });
  }
  rebuildLayout();
  currentPage = 1;
  updatePageInfo();
  els.btnAsk.disabled = false;
}

async function askWithPdf() {
  if (!rawBuffer) return;
  els.btnAsk.disabled = true;
  els.btnAsk.textContent = "解析中…";
  try {
    const text = await extractPdfText(rawBuffer.slice(0));
    const scanned = text.charsPerPage < 20;
    const images = scanned ? await renderPdfPages(rawBuffer.slice(0)) : [];
    await chrome.runtime.sendMessage({
      type: "OPEN_SIDEPANEL_WITH_ATTACHMENT",
      attachment: {
        kind: "pdf",
        name: fileName,
        text: text.text,
        images,
        pageCount: text.pageCount,
        scanned,
        truncated: text.truncated
      }
    });
    els.btnAsk.textContent = "已放入侧边栏 ✓";
    setTimeout(() => {
      els.btnAsk.textContent = "带去提问";
      els.btnAsk.disabled = false;
    }, 1500);
  } catch (err) {
    els.btnAsk.textContent = `失败：${err.message}`;
    setTimeout(() => {
      els.btnAsk.textContent = "带去提问";
      els.btnAsk.disabled = false;
    }, 2000);
  }
}

function fileFromDrop(file) {
  if (!file) return;
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) return;
  file.arrayBuffer().then((buf) => loadPdf(buf, file.name));
}

async function init() {
  const src = new URLSearchParams(location.search).get("src");
  els.zoomIn.addEventListener("click", () => setZoom(zoom + 0.25));
  els.zoomOut.addEventListener("click", () => setZoom(zoom - 0.25));
  els.btnAsk.addEventListener("click", askWithPdf);
  els.btnPick.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", (e) => fileFromDrop(e.target.files[0]));
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    fileFromDrop(e.dataTransfer.files[0]);
  });
  if (!src) return;
  els.empty.classList.add("hidden");
  fileName = decodeURIComponent(src.split("/").pop().split("?")[0] || "document.pdf");
  els.title.textContent = fileName;
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    loadPdf(await res.arrayBuffer(), fileName);
  } catch (err) {
    els.pages.innerHTML = "";
    const status = document.createElement("div");
    status.className = "status error";
    status.textContent = src.startsWith("file:")
      ? `无法读取本地文件：请在 chrome://extensions 中为本扩展开启「允许访问文件网址」。（${err.message}）`
      : `加载失败：${err.message}。可能是目标站点禁止跨域读取，可先下载到本地再拖入本页。`;
    els.pages.appendChild(status);
  }
}

init();
