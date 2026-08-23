import { loadState } from "../shared/storage.js";
import { renderMarkdown } from "../shared/markdown.js";

function esc(s) {
  const d = document.createElement("div");
  d.textContent = String(s ?? "");
  return d.innerHTML;
}

async function main() {
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  const state = await loadState();
  const conv = (state.conversations || []).find((c) => c.id === id);
  const doc = document.getElementById("doc");
  if (!conv) {
    doc.innerHTML = "<p>找不到这条对话，可能已被删除。</p>";
    return;
  }

  const title = conv.title || "Skilldock 对话";
  document.title = title;
  document.getElementById("docTitle").textContent = title;

  const parts = [`<h1 class="title">${esc(title)}</h1>`];
  const meta = [];
  if (conv.createdAt) meta.push(new Date(conv.createdAt).toLocaleString());
  if (conv.model) meta.push(conv.model);
  meta.push("由 Skilldock 导出");
  parts.push(`<div class="meta">${esc(meta.join(" · "))}</div>`);

  for (const m of conv.messages || []) {
    if (m.role === "system") continue;
    if (m.role === "user") {
      const imgs = m.images?.length ? `附带 ${m.images.length} 张图片` : "";
      const ctx = m.display != null && (m.content || "").length > m.display.length ? "发送时附带了页面 / 文件上下文" : "";
      const note = [imgs, ctx].filter(Boolean).join("；");
      parts.push(
        `<section class="m user"><div class="who">用户</div><div class="body">${renderMarkdown(m.display ?? m.content ?? "")}${note ? `<p class="meta">[${esc(note)}]</p>` : ""}</div></section>`
      );
      continue;
    }
    if (m.role === "tool") {
      parts.push(
        `<details class="m tool"><summary>工具 ${esc(m.name || "")}</summary><pre class="code"><code>${esc(m.content)}</code></pre></details>`
      );
      continue;
    }
    if (m.role === "assistant") {
      if (m.thinking) {
        parts.push(
          `<details class="m think"><summary>思考过程</summary><div class="body">${renderMarkdown(m.thinking)}</div></details>`
        );
      }
      if (m.content) {
        parts.push(
          `<section class="m assistant"><div class="who">助手</div><div class="body">${renderMarkdown(m.content)}</div></section>`
        );
      }
    }
  }
  doc.innerHTML = parts.join("");

  document.getElementById("btnPrint").addEventListener("click", () => window.print());
  if (params.get("print") !== "0") {
    try {
      await document.fonts?.ready;
    } catch {
      /* fonts API 不可用时直接打印 */
    }
    setTimeout(() => window.print(), 300);
  }
}

main();
