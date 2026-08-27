const BASE = "https://api.hangzhale.com/v1";
const KEY = process.env.HZ_KEY;
const para = "The quick brown fox jumps over the lazy dog. Prompt caching reduces latency and cost by reusing a shared prefix across requests. ";
async function chat(tag, sys) {
  const body = { model: "gemini-3.7-flash", stream: true, stream_options: { include_usage: true },
    messages: [{ role: "system", content: sys }, { role: "user", content: "Reply with exactly: ok" }] };
  const res = await fetch(`${BASE}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` }, body: JSON.stringify(body) });
  const text = await res.text();
  let usage = null, reply = "";
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const d = t.slice(5).trim();
    if (!d || d === "[DONE]") continue;
    try { const j = JSON.parse(d); if (j.usage) usage = j.usage; const c = j.choices?.[0]?.delta?.content; if (c) reply += c; } catch {}
  }
  const u = usage || {};
  console.log(`${tag} HTTP=${res.status} prompt=${u.prompt_tokens} cached=${u.prompt_tokens_details?.cached_tokens ?? 0} completion=${u.completion_tokens} reply="${reply.slice(0, 60)}"`);
}
(async () => {
  const sys = "Diag:\n" + para.repeat(150);
  for (let i = 1; i <= 6; i++) { await chat(`150段#${i}`, sys); await new Promise(r => setTimeout(r, 2000)); }
})();
