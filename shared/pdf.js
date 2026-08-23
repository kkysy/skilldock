// PDF.js 懒加载封装：仅在真正处理 PDF 时才加载 vendor/pdfjs（约 1.8MB），
// 避免拖慢侧边栏启动。提取文本按页拼接；扫描件（几乎无文字层）回退为按页渲染图片。
import { extOf } from "./utils.js";

const MAX_TEXT_PAGES = 60;
const MAX_TEXT_CHARS = 120000;
const MAX_RENDER_PAGES = 8;
const RENDER_WIDTH = 1024;
// 每页平均字符数低于此值时视为扫描件
const SCANNED_CHARS_PER_PAGE = 20;

let pdfjsPromise = null;

export function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("../vendor/pdfjs/pdf.min.mjs").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
        "vendor/pdfjs/pdf.worker.min.mjs"
      );
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

export function isPdfFile(file) {
  return file.type === "application/pdf" || extOf(file.name) === "pdf";
}

async function openDoc(source) {
  const pdfjs = await loadPdfjs();
  const params = {
    cMapUrl: chrome.runtime.getURL("vendor/pdfjs/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: chrome.runtime.getURL("vendor/pdfjs/standard_fonts/"),
    isEvalSupported: false,
    // 压掉 "TT: undefined function" 这类良性字体警告（chrome://extensions 会收集 warn）
    verbosity: pdfjs.VerbosityLevel?.ERRORS ?? 0
  };
  const task = pdfjs.getDocument({ ...params, ...source });
  const doc = await task.promise;
  // pdf.js v6 起 destroy 在 loadingTask 上；挂到 doc 上让调用方不用区分
  doc.destroy = () => task.destroy();
  return doc;
}

// 查看器页使用：保持文档打开，由调用方负责 doc.destroy()。
// 注意 pdf.js 会把传入的 ArrayBuffer 转移给 worker，复用原始数据请传副本（buf.slice(0)）。
export function openPdf(source) {
  return openDoc(source);
}

function pageText(content) {
  let out = "";
  for (const item of content.items) {
    out += item.str;
    if (item.hasEOL) out += "\n";
  }
  return out.replace(/[ \t]+\n/g, "\n").trim();
}

export async function extractPdfText(data, { maxPages = MAX_TEXT_PAGES, maxChars = MAX_TEXT_CHARS } = {}) {
  const doc = await openDoc({ data });
  const total = doc.numPages;
  const parts = [];
  let chars = 0;
  const limit = Math.min(total, maxPages);
  for (let p = 1; p <= limit; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const text = pageText(content);
    if (text) {
      parts.push(`--- 第 ${p} 页 ---\n${text}`);
      chars += text.length;
    }
    if (chars >= maxChars) break;
  }
  await doc.destroy();
  return {
    text: parts.join("\n\n").slice(0, maxChars),
    pageCount: total,
    pagesRead: limit,
    charsPerPage: total ? chars / limit : 0,
    truncated: total > limit || chars >= maxChars
  };
}

export async function renderPdfPages(
  data,
  { maxPages = MAX_RENDER_PAGES, maxWidth = RENDER_WIDTH, quality = 0.75 } = {}
) {
  const doc = await openDoc({ data });
  const images = [];
  const limit = Math.min(doc.numPages, maxPages);
  for (let p = 1; p <= limit; p++) {
    const page = await doc.getPage(p);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(maxWidth / base.width, 2);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    images.push(canvas.toDataURL("image/jpeg", quality));
    page.cleanup();
  }
  await doc.destroy();
  return images;
}

// 统一入口：提取文本；若是扫描件则回退渲染页面图片，交给视觉模型。
export async function ingestPdf(data, name = "document.pdf") {
  const result = await extractPdfText(data);
  const scanned = result.charsPerPage < SCANNED_CHARS_PER_PAGE;
  const out = {
    name,
    text: result.text,
    pageCount: result.pageCount,
    truncated: result.truncated,
    scanned,
    images: []
  };
  if (scanned) {
    out.images = await renderPdfPages(data);
  }
  return out;
}
