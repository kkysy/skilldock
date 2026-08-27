const BASE = "https://api.hangzhale.com/v1";
const KEY = process.env.HZ_KEY;
const para = "The quick brown fox jumps over the lazy dog. Prompt caching reduces latency and cost by reusing a shared prefix across requests. ";
const para2 = "Gemini context caching stores prefixes server side and subsequent requests reuse them transparently without extra configuration. ";

async function chat(tag, sys) {
  const body = { model: "gemini-3.7-flash", stream: true, stream_options: { include_usage: true },
    messages: [{ role: "system", content: sys }, { role: "user", content: "Reply with exactly: ok" }] };
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
  console.log(`${tag} prompt=${u.prompt_tokens} cached=${u.prompt_tokens_details?.cached_tokens ?? 0}`);
}

// 每个场景发3次(去重窗口内应至少命中一次)，场景间内容不同
async function scene(name, sys) {
  console.log(`--- ${name} (chars=${sys.length}) ---`);
  for (let i = 1; i <= 3; i++) { await chat(`${name}#${i}`, sys); await new Promise(r => setTimeout(r, 1500)); }
}
(async () => {
  await scene("A-150段",  "Doc A:\n" + para.repeat(150));   // ~3600 tokens
  await scene("B-300段",  "Doc B:\n" + para.repeat(300));   // ~7200 tokens (基准)
  await scene("C-600段",  "Doc C:\n" + para.repeat(600));   // ~14400 tokens
  await scene("D-300段不同文本", "Doc D:\n" + para2.repeat(300)); // 同长度不同内容
})();
