// 多轮流式矩阵测试：复刻插件请求形态，隔离破坏缓存的变量
const BASE = process.env.T_BASE || "https://api.hangzhale.com/v1";
const KEY = process.env.HZ_KEY;

const para = "The quick brown fox jumps over the lazy dog. Prompt caching reduces latency and cost by reusing a shared prefix across requests. ";
const sys = "You are a helpful assistant. Below is a long fixed reference document:\n\n" + para.repeat(300);

const TOOLS = [{
  type: "function",
  function: { name: "read_page", description: "Read current page content", parameters: { type: "object", properties: { start: { type: "number" } } } }
}];

async function streamChat(model, messages, { thinking = false, tools = false } = {}) {
  const body = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true }
  };
  if (thinking) body.reasoning_effort = "medium";
  if (tools) { body.tools = TOOLS; body.tool_choice = "auto"; }
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) return { err: `${res.status}: ${(await res.text()).slice(0, 200)}` };
  const text = await res.text();
  let usage = null, reply = "";
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const d = t.slice(5).trim();
    if (!d || d === "[DONE]") continue;
    try {
      const j = JSON.parse(d);
      if (j.usage) usage = j.usage;
      const c = j.choices?.[0]?.delta?.content;
      if (c) reply += c;
    } catch {}
  }
  return { usage, reply: reply.slice(0, 50) };
}

async function scenario(name, opts) {
  console.log(`\n=== ${name} ===`);
  const convo = [
    { role: "system", content: sys },
    { role: "user", content: "第一轮：用一句话概括文档主题。" }
  ];
  for (let turn = 1; turn <= 4; turn++) {
    const r = await streamChat("gemini-3.7-flash", convo, opts);
    if (r.err) { console.log(`turn${turn} ERR`, r.err); return; }
    const u = r.usage || {};
    console.log(`turn${turn} prompt=${u.prompt_tokens} cached=${u.prompt_tokens_details?.cached_tokens ?? "无字段"} completion=${u.completion_tokens}`);
    convo.push({ role: "assistant", content: r.reply || "ok" });
    convo.push({ role: "user", content: `第${turn + 1}轮：继续补充一点细节。` });
    await new Promise(rs => setTimeout(rs, 1500));
  }
}

(async () => {
  await scenario("S1 纯多轮(流式+include_usage)", {});
  await scenario("S2 多轮+思考(reasoning_effort=medium)", { thinking: true });
  await scenario("S3 多轮+工具定义", { tools: true });
  await scenario("S4 多轮+思考+工具(完整复刻插件)", { thinking: true, tools: true });
})();
