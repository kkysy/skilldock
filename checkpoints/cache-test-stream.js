// 流式缓存测试：复刻插件行为(stream:true, 无 stream_options) vs 加 include_usage
const BASE = process.env.T_BASE || "https://api.hangzhale.com/v1";
const KEY = process.env.HZ_KEY;

const para = "The quick brown fox jumps over the lazy dog. Prompt caching reduces latency and cost by reusing a shared prefix across requests. ";
const sys = "You are a helpful assistant. Below is a long fixed reference document:\n\n" + para.repeat(300);

async function streamOnce(model, tag, includeUsage) {
  const body = {
    model,
    stream: true,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: "Reply with exactly: ok" }
    ]
  };
  if (includeUsage) body.stream_options = { include_usage: true };
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) { console.log(`[${tag}] HTTP ${res.status}:`, (await res.text()).slice(0, 300)); return; }
  const text = await res.text();
  let usageSeen = null, chunks = 0, contentLen = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const data = t.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const j = JSON.parse(data);
      chunks++;
      if (j.usage) usageSeen = j.usage;
      const c = j.choices?.[0]?.delta?.content;
      if (c) contentLen += c.length;
    } catch {}
  }
  console.log(`[${tag}] chunks=${chunks} contentLen=${contentLen} usage=`, usageSeen ? JSON.stringify(usageSeen) : "流中无 usage");
}

(async () => {
  const model = process.env.T_MODELS || "gemini-3.7-flash";
  console.log(`=== ${model} @ ${BASE} ===`);
  console.log("--- A. 复刻插件: stream:true, 无 stream_options ---");
  for (let i = 1; i <= 3; i++) { await streamOnce(model, `A#${i}`, false); await new Promise(r => setTimeout(r, 1500)); }
  console.log("--- B. stream:true + stream_options.include_usage ---");
  for (let i = 1; i <= 2; i++) { await streamOnce(model, `B#${i}`, true); await new Promise(r => setTimeout(r, 1500)); }
})();
