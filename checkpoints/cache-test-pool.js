const BASE = "https://api.hangzhale.com/v1";
const KEY = process.env.HZ_KEY;
const para = "The quick brown fox jumps over the lazy dog. Prompt caching reduces latency and cost by reusing a shared prefix across requests. ";
const sys = "You are a helpful assistant. Fixed reference document:\n\n" + para.repeat(300);
const body = {
  model: "gemini-3.7-flash",
  stream: true,
  stream_options: { include_usage: true },
  messages: [{ role: "system", content: sys }, { role: "user", content: "Reply with exactly: ok" }]
};
async function chat(i) {
  const t0 = Date.now();
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
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  console.log(`#${String(i).padStart(2)} ${Date.now() - t0}ms prompt=${u.prompt_tokens} cached=${cached} ${cached > 0 ? "HIT" : "MISS"}`);
}
(async () => { for (let i = 1; i <= 20; i++) { await chat(i); await new Promise(r => setTimeout(r, 1000)); } })();
