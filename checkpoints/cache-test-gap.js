const BASE = "https://api.hangzhale.com/v1";
const KEY = process.env.HZ_KEY;
const para = "The quick brown fox jumps over the lazy dog. Prompt caching reduces latency and cost by reusing a shared prefix across requests. ";
const sys = "You are a helpful assistant. Fixed reference document:\n\n" + para.repeat(300);
async function chat(messages) {
  const body = { model: "gemini-3.7-flash", messages, stream: true, stream_options: { include_usage: true } };
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
  return { usage, reply: reply.slice(0, 40) };
}
(async () => {
  const convo = [{ role: "system", content: sys }, { role: "user", content: "第一轮：概括文档主题。" }];
  for (let turn = 1; turn <= 3; turn++) {
    const r = await chat(convo);
    const u = r.usage || {};
    console.log(`turn${turn} prompt=${u.prompt_tokens} cached=${u.prompt_tokens_details?.cached_tokens ?? "无字段"}`);
    convo.push({ role: "assistant", content: r.reply || "ok" }, { role: "user", content: `第${turn + 1}轮：补充细节。` });
    if (turn < 3) { console.log("等待45s让缓存写入..."); await new Promise(rs => setTimeout(rs, 45000)); }
  }
})();
