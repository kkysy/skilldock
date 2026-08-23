// 冒烟测试：带图片的用户消息在各 provider 下的请求体是否包含图像部分
import { streamChat } from "../shared/providers.js";

let lastBody = null;
globalThis.fetch = async (url, opts) => {
  lastBody = JSON.parse(opts.body);
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("data: [DONE]\n")); c.close(); } });
  return { ok: true, status: 200, body: { getReader: () => stream.getReader() } };
};

const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
const messages = [{ role: "user", content: "描述这张图", images: [dataUrl] }];

async function run(kind, baseUrl) {
  for await (const _ of streamChat({ provider: { id: kind, name: kind, kind, baseUrl, apiKey: "k" }, model: "m", messages, toolNames: [], signal: undefined })) {}
}

await run("openai", "https://x/v1");
const oai = lastBody.messages[0].content;
console.assert(Array.isArray(oai) && oai.some((p) => p.type === "image_url" && p.image_url.url === dataUrl), "FAIL openai");
console.log("ok OpenAI:", JSON.stringify(oai.map((p) => p.type)));

await run("anthropic", "https://a");
const ant = lastBody.messages[0].content;
console.assert(Array.isArray(ant) && ant.some((p) => p.type === "image" && p.source.media_type === "image/png"), "FAIL anthropic");
console.log("ok Anthropic:", JSON.stringify(ant.map((p) => p.type)));

await run("gemini", "https://g/v1beta");
const gem = lastBody.contents[0].parts;
console.assert(Array.isArray(gem) && gem.some((p) => p.inlineData?.mimeType === "image/png"), "FAIL gemini");
console.log("ok Gemini:", JSON.stringify(gem.map((p) => (p.text ? "text" : "inlineData"))));

console.log("\n附件图片链路全部通过");
