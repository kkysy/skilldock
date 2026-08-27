const BASE = "https://api.hangzhale.com/v1";
const KEY = process.env.HZ_KEY;
const para = "The quick brown fox jumps over the lazy dog. Prompt caching reduces latency and cost by reusing a shared prefix across requests. ";
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
  const p = u.prompt_tokens ?? "?";
  console.log(`${tag} prompt=${p} cached=${u.prompt_tokens_details?.cached_tokens ?? 0}${(p !== "?" && p < 1000) ? " <- 故障响应,忽略" : ""}`);
}
async function scene(name, sys, n) {
  console.log(`--- ${name} (chars=${sys.length}) ---`);
  for (let i = 1; i <= n; i++) { await chat(`${name}#${i}`, sys); await new Promise(r => setTimeout(r, 2000)); }
}
(async () => {
  await scene("E-450段", "Doc E:\n" + para.repeat(450), 6);  // ~10800 tokens
  await scene("F-600段", "Doc F:\n" + para.repeat(600), 6);  // ~14400 tokens
})();
