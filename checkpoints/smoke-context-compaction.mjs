// 冒烟测试：超过估算上下文限制时，较早消息应被摘要替代，近期消息保留原文。
globalThis.chrome = {
  sidePanel: { setPanelBehavior: async () => {} },
  runtime: {
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onConnect: { addListener: () => {} },
    onMessage: { addListener: () => {} },
    onMessageExternal: { addListener: () => {} }
  },
  action: { onClicked: { addListener: () => {} } },
  contextMenus: { removeAll: () => {}, create: () => {}, onClicked: { addListener: () => {} } }
};

const { compactConversation, estimateTextTokens } = await import("../background/sw.js");

function sseResponse(text) {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n`));
      controller.close();
    }
  });
  return { ok: true, status: 200, body: { getReader: () => stream.getReader() } };
}

globalThis.fetch = async () => sseResponse("- 已压缩的早期事实\n- 待办事项");

const messages = Array.from({ length: 7 }, (_, i) => ({
  id: `u${i}`,
  role: "user",
  content: `问题 ${i}：${"内容 ".repeat(2400)}`
}));
messages.push({ id: "recent", role: "user", content: "请继续处理最后一个问题。" });
const conv = { messages };
const provider = { id: "test", name: "Test", kind: "openai", baseUrl: "https://example.test/v1", apiKey: "key" };

let compactionStarted = false;
const compacted = await compactConversation({
  conv,
  systemContent: "你是测试助手。",
  toolNames: [],
  provider,
  model: "test-model",
  limit: 16000,
  onStart: () => { compactionStarted = true; }
});

console.assert(compacted, "FAIL: 超限时应执行压缩");
console.assert(compactionStarted, "FAIL: 超限时应发送压缩开始信号");
console.assert(conv.compaction?.summary.includes("已压缩的早期事实"), "FAIL: 应保存模型生成的摘要");
console.assert(conv.messages.some((message) => message.compacted), "FAIL: 应标记已压缩的旧消息");
console.assert(!conv.messages.find((message) => message.id === "recent").compacted, "FAIL: 应保留近期消息原文");
console.assert(estimateTextTokens("中文 English") > 0, "FAIL: token 估算应返回正数");
console.log("上下文压缩冒烟测试通过");
