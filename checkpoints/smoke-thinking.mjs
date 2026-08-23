// 冒烟测试：stub fetch，验证思考开关在各 provider 下的请求体构造与降级重试
import { streamChat } from "../shared/providers.js";

let lastBody = null;
let fetchCalls = 0;

function sseResponse(lines) {
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(lines.map((l) => `data: ${l}\n`).join("") + "data: [DONE]\n"));
      c.close();
    }
  });
  return { ok: true, status: 200, body: { getReader: () => stream.getReader() } };
}

globalThis.fetch = async (url, opts) => {
  fetchCalls += 1;
  lastBody = JSON.parse(opts.body);
  if (globalThis.__failReasoningOnce && "reasoning_effort" in lastBody) {
    globalThis.__failReasoningOnce = false;
    return { ok: false, status: 400, text: async () => "Unsupported parameter: reasoning_effort" };
  }
  return sseResponse([]);
};

async function drain(opts) {
  const events = [];
  for await (const ev of streamChat(opts)) events.push(ev);
  return events;
}

const provider = { id: "openai", name: "OpenAI", kind: "openai", baseUrl: "https://x/v1", apiKey: "k" };

// 1. OpenAI 兼容口：思考开 → 带 reasoning_effort
await drain({ provider, model: "o4-mini", messages: [{ role: "user", content: "hi" }], toolNames: [], thinking: true });
console.assert(lastBody.reasoning_effort === "medium", "FAIL: 应带 reasoning_effort");
console.log("ok 1 OpenAI thinking on:", JSON.stringify(lastBody.reasoning_effort));

// 2. 思考关 → 不带
await drain({ provider, model: "gpt-4o", messages: [{ role: "user", content: "hi" }], toolNames: [], thinking: false });
console.assert(!("reasoning_effort" in lastBody), "FAIL: 不应带 reasoning_effort");
console.log("ok 2 OpenAI thinking off: no reasoning_effort");

// 3. 非推理模型拒绝 reasoning_effort → 自动降级重试
globalThis.__failReasoningOnce = true;
fetchCalls = 0;
await drain({ provider, model: "gpt-4o", messages: [{ role: "user", content: "hi" }], toolNames: [], thinking: true });
console.assert(fetchCalls === 2, "FAIL: 应重试一次");
console.assert(!("reasoning_effort" in lastBody), "FAIL: 重试应去掉 reasoning_effort");
console.log("ok 3 fallback retry:", fetchCalls, "calls, retried without reasoning_effort");

// 4. Anthropic：思考开 → thinking 参数 + max_tokens 提升；带签名的历史思考块排在首位
const anth = { id: "anthropic", name: "Anthropic", kind: "anthropic", baseUrl: "https://a", apiKey: "k" };
await drain({
  provider: anth,
  model: "claude-x",
  messages: [
    { role: "user", content: "hi" },
    { role: "assistant", content: "answer", toolCalls: [{ id: "t1", name: "read_page", arguments: "{}" }], thinking: "let me think", thinkingSignature: "sig123" },
    { role: "tool", toolCallId: "t1", content: "page text" }
  ],
  toolNames: [],
  thinking: true
});
console.assert(lastBody.thinking?.type === "enabled" && lastBody.thinking.budget_tokens >= 1024, "FAIL: Anthropic thinking 参数");
console.assert(lastBody.max_tokens > lastBody.thinking.budget_tokens, "FAIL: max_tokens 必须大于 budget");
const asst = lastBody.messages[1];
console.assert(asst.content[0].type === "thinking" && asst.content[0].signature === "sig123", "FAIL: 思考块应在 assistant 内容首位");
console.log("ok 4 Anthropic:", JSON.stringify(lastBody.thinking), "max_tokens", lastBody.max_tokens, "| 历史块首位:", asst.content[0].type);

// 5. Anthropic 思考关 → 无 thinking 参数
await drain({ provider: anth, model: "claude-x", messages: [{ role: "user", content: "hi" }], toolNames: [], thinking: false });
console.assert(!("thinking" in lastBody) && lastBody.max_tokens === 4096, "FAIL: 关闭时不应有 thinking 参数");
console.log("ok 5 Anthropic thinking off: max_tokens", lastBody.max_tokens);

// 6. Gemini：思考开 → includeThoughts；thought part 解析为 thinking 事件
const gem = { id: "gemini", name: "Gemini", kind: "gemini", baseUrl: "https://g/v1beta", apiKey: "k" };
globalThis.fetch = async (url, opts) => {
  lastBody = JSON.parse(opts.body);
  return sseResponse([JSON.stringify({ candidates: [{ content: { parts: [{ text: "想", thought: true }, { text: "答" }] } }] })]);
};
const events = await drain({ provider: gem, model: "gemini-2.5-flash", messages: [{ role: "user", content: "hi" }], toolNames: [], thinking: true });
console.assert(lastBody.generationConfig?.thinkingConfig?.includeThoughts === true, "FAIL: Gemini includeThoughts");
console.assert(events[0].type === "thinking" && events[1].type === "text", "FAIL: Gemini thought part 分类");
console.log("ok 6 Gemini:", JSON.stringify(lastBody.generationConfig.thinkingConfig), "| events:", events.map((e) => e.type).join(","));

console.log("\n全部通过");
