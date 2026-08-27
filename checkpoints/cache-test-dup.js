const BASE = "https://api.hangzhale.com/v1";
const KEY = process.env.HZ_KEY;
const para = "The quick brown fox jumps over the lazy dog. Prompt caching reduces latency and cost by reusing a shared prefix across requests. ";
const sys = "You are a helpful assistant. Fixed reference document:\n\n" + para.repeat(300);
// 一个"三轮对话形态"的请求体，逐字节重复发送
const body = {
  model: "gemini-3.7-flash",
  stream: true,
  stream_options: { include_usage: true },
  messages: [
    { role: "system", content: sys },
    { role: "user", content: "第一轮：概括文档主题。" },
    { role: "assistant", content: "文档主题是提示词缓存机制。" },
    { role: "user", content: "第二轮：补充细节。" }
  ]
};
async function chat(tag) {
  const res = await fetch(`${BASE}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` }, body: JSON.stringify(body) });
  const text = await res.text();
  let usage = null;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const d = t.slice(5).trim();
    if (!d || d === "[DONE]") continue;
    try { const j = JSON.parse(d); if (j.usage) usage = j.usage; } catch {}
  }
  const u = usage || {};
  console.log(`${tag} prompt=${u.prompt_tokens} cached=${u.prompt_tokens_details?.cached_tokens ?? "无字段"}`);
}
(async () => {
  for (let i = 1; i <= 3; i++) { await chat(`dup#${i}`); await new Promise(r => setTimeout(r, 2000)); }
})();
