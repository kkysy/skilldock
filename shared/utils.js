export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function now() {
  return Date.now();
}

export function truncate(text, max = 80000) {
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[... truncated ${text.length - max} chars ...]`;
}

export function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function matchSite(pattern, url) {
  if (!pattern) return false;
  const p = pattern.trim().toLowerCase();
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (p.startsWith("http")) return url.toLowerCase().startsWith(p);
    return host === p || host.endsWith(`.${p}`);
  } catch {
    return url.toLowerCase().includes(p);
  }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export function guessLang() {
  const lang = chrome.i18n?.getUILanguage?.() || navigator.language || "zh-CN";
  return lang.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export const TEXT_EXTS = new Set([
  "txt", "md", "markdown", "json", "csv", "tsv", "html", "htm", "css", "js",
  "ts", "tsx", "jsx", "py", "rs", "go", "java", "c", "cpp", "h", "xml", "yml",
  "yaml", "toml", "ini", "log", "sql"
]);

export function extOf(name = "") {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function isImageFile(file) {
  return file.type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(extOf(file.name));
}

export function isTextFile(file) {
  if (file.type.startsWith("text/")) return true;
  if (file.type === "application/json") return true;
  return TEXT_EXTS.has(extOf(file.name));
}
