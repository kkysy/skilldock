// 缓存命中测试：对中转站同一模型连发 3 条前缀完全相同的请求，观察 cached tokens
const BASE = process.env.T_BASE || "https://api.hangzhale.com/v1";
const KEY = process.env.HZ_KEY;

// 构造约 2500+ tokens 的固定长 system prompt（Gemini Flash 隐式缓存门槛 1024 tokens）
const para = "The quick brown fox jumps over the lazy dog. Prompt caching reduces latency and cost by reusing a shared prefix across requests. ";
const sys = "You are a helpful assistant. Below is a long fixed reference document:\n\n" + para.repeat(300);

async function once(model, tag) {
  const body = {
    model,
    stream: false,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: "Reply with exactly: ok" }
    ]
  };
  const t0 = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body)
  });
  const ms = Date.now() - t0;
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch { console.log(`[${tag}] HTTP ${res.status} non-JSON: ${text.slice(0, 300)}`); return; }
  if (!res.ok) { console.log(`[${tag}] HTTP ${res.status}:`, text.slice(0, 400)); return; }
  const u = j.usage || {};
  console.log(`[${tag}] ${ms}ms usage=`, JSON.stringify(u));
}

async function testModel(model, rounds) {
  console.log(`\n=== ${model} @ ${BASE} (system prompt chars=${sys.length}) ===`);
  for (let i = 1; i <= rounds; i++) {
    await once(model, `${model} #${i}`);
    await new Promise(r => setTimeout(r, 2000));
  }
}

(async () => {
  const models = (process.env.T_MODELS || "gemini-3.7-flash").split(",");
  const rounds = parseInt(process.env.T_ROUNDS || "6", 10);
  for (const m of models) await testModel(m, rounds);
})();
