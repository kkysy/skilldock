import { safeJson } from "./utils.js";

export function mergeStreamText(prev, next) {
  const a = prev || "";
  const b = next || "";
  if (!b) return a;
  if (!a) return b;
  if (a === b) return a;
  if (b.startsWith(a)) return b;
  if (a.endsWith(b)) return a;
  if (a.includes(b)) return a;
  return a + b;
}

export function canonicalToolName(raw, allowed = []) {
  const name = String(raw || "").trim();
  if (!name) return name;
  const known = TOOL_DEFS.map((t) => t.name);
  const pool = allowed.length ? allowed : known;
  if (pool.includes(name)) return name;
  for (const n of [...pool, ...known]) {
    if (!n) continue;
    if (name === n) return n;
    if (n.length && name.length % n.length === 0 && name.length >= n.length * 2 && name.split(n).every((p) => p === "")) {
      return n;
    }
  }
  const hits = pool.filter((n) => name.includes(n) || n.includes(name));
  if (hits.length === 1) return hits[0];
  return name;
}

export const TOOL_DEFS = [
  {
    name: "read_page",
    description: "Read one sequential segment of the main text of the current (or specified) tab. The result includes start, end, total, hasMore, and nextStart; when hasMore is true, call read_page again with nextStart before answering questions that require the whole page.",
    parameters: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional Chrome tab id. Defaults to the active tab." },
        start: { type: "integer", description: "Starting character position from the previous result's nextStart. Defaults to 0." }
      }
    }
  },
  {
    name: "list_tabs",
    description: "List open tabs (title and URL).",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "extract_links",
    description: "Extract hyperlinks from the current page.",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "search_page",
    description: "Search the current page text for a query and return nearby snippets.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"]
    }
  },
  {
    name: "open_tab",
    description: "Open a URL in a new tab.",
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"]
    }
  },
  {
    name: "click_element",
    description: "Click an element on the page by CSS selector. Requires user permission.",
    parameters: {
      type: "object",
      properties: { selector: { type: "string" } },
      required: ["selector"]
    }
  },
  {
    name: "fill_element",
    description: "Fill an input/textarea by CSS selector. Requires user permission.",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string" },
        value: { type: "string" }
      },
      required: ["selector", "value"]
    }
  },
  {
    name: "scroll_page",
    description: "Scroll the page. direction: up|down|top|bottom.",
    parameters: {
      type: "object",
      properties: { direction: { type: "string" } },
      required: ["direction"]
    }
  },
  {
    name: "web_search",
    description: "Search the public web and return title, URL, and snippet results. To read a result page, call read_search_result with its URL; do not open a browser tab just to read it.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"]
    }
  },
  {
    name: "read_search_result",
    description: "Fetch one public HTTP(S) search-result page without opening a tab, and return a sequential readable-text segment. Use nextStart when hasMore is true.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "A URL returned by web_search." },
        start: { type: "integer", description: "Character position from the previous nextStart. Defaults to 0." }
      },
      required: ["url"]
    }
  },
  {
    name: "list_page_images",
    description: "List the images on the current (or specified) tab that can be sent to the chat: index, alt text, dimensions, and URL. Call this before send_page_image when you do not know which images the page has.",
    parameters: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional Chrome tab id. Defaults to the active tab." }
      }
    }
  },
  {
    name: "send_page_image",
    description: "Send one image from the current page into the chat so the user can see it; the image is also provided to you as visual input right after the tool result, so you can look at it and answer. Provide either the index from list_page_images or the image URL.",
    parameters: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional Chrome tab id. Defaults to the active tab." },
        index: { type: "integer", description: "Image index from list_page_images." },
        url: { type: "string", description: "Image URL as listed by list_page_images. Used when index is omitted." }
      }
    }
  }
];

function openaiTools(names) {
  const allow = new Set(names);
  return TOOL_DEFS.filter((t) => allow.has(t.name)).map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }
  }));
}

function anthropicTools(names) {
  const allow = new Set(names);
  return TOOL_DEFS.filter((t) => allow.has(t.name)).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters
  }));
}

function geminiTools(names) {
  const allow = new Set(names);
  const fns = TOOL_DEFS.filter((t) => allow.has(t.name)).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters
  }));
  return fns.length ? [{ functionDeclarations: fns }] : [];
}

async function* iterateSSE(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split("\n");
    buf = chunks.pop() || "";
    for (const line of chunks) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      const json = safeJson(data);
      if (json) yield json;
    }
  }
}

function toOpenAIMessages(messages) {
  return messages.map((m) => {
    if (m.role === "tool") {
      return {
        role: "tool",
        tool_call_id: m.toolCallId,
        content: m.content
      };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((t) => ({
          id: t.id,
          type: "function",
          function: { name: t.name, arguments: t.arguments || "{}" }
        }))
      };
    }
    if (m.images?.length) {
      const content = [
        { type: "text", text: m.content || "" },
        ...m.images.map((url) => ({
          type: "image_url",
          image_url: { url }
        }))
      ];
      return { role: m.role, content };
    }
    return { role: m.role, content: m.content || "" };
  });
}

async function* streamOpenAI({ provider, model, messages, toolNames, thinking, signal }) {
  const url = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const body = {
    model,
    messages: toOpenAIMessages(messages),
    stream: true
  };
  const tools = openaiTools(toolNames);
  if (tools.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey || "ollama"}`
  };
  if (provider.id === "openrouter") {
    headers["HTTP-Referer"] = "https://skilldock.local";
    headers["X-Title"] = "Skilldock";
  }
  async function post() {
    return fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
  }
  let res;
  if (thinking) {
    // 非推理模型（如 gpt-4o）会拒绝 reasoning_effort，此时降级重试一次
    body.reasoning_effort = "medium";
    res = await post();
    if (!res.ok) {
      const err = await res.text();
      if (!/reasoning/i.test(err)) {
        throw new Error(`${provider.name} ${res.status}: ${err.slice(0, 500)}`);
      }
      delete body.reasoning_effort;
      res = await post();
    }
  } else {
    res = await post();
  }
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${provider.name} ${res.status}: ${err.slice(0, 500)}`);
  }
  const toolAcc = {};
  for await (const ev of iterateSSE(res)) {
    const choice = ev.choices?.[0];
    const delta = choice?.delta || {};
    if (delta.content) yield { type: "text", text: delta.content };
    if (delta.reasoning || delta.reasoning_content) {
      yield { type: "thinking", text: delta.reasoning || delta.reasoning_content };
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolAcc[idx]) toolAcc[idx] = { id: "", name: "", arguments: "" };
        if (tc.id) toolAcc[idx].id = tc.id;
        if (tc.function?.name) {
          toolAcc[idx].name = mergeStreamText(toolAcc[idx].name, tc.function.name);
        }
        if (tc.function?.arguments) toolAcc[idx].arguments += tc.function.arguments;
      }
    }
  }
  const calls = Object.values(toolAcc)
    .filter((c) => c.name)
    .map((c) => ({
      ...c,
      name: canonicalToolName(c.name, toolNames)
    }));
  if (calls.length) yield { type: "tool_calls", calls };
}

function splitSystem(messages) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");
  return { system, rest };
}

async function* streamAnthropic({ provider, model, messages, toolNames, thinking, signal }) {
  const { system, rest } = splitSystem(messages);
  const converted = [];
  for (const m of rest) {
    if (m.role === "tool") {
      converted.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }]
      });
      continue;
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      const content = [];
      if (m.thinking && m.thinkingSignature) {
        content.push({ type: "thinking", thinking: m.thinking, signature: m.thinkingSignature });
      }
      if (m.content) content.push({ type: "text", text: m.content });
      for (const t of m.toolCalls) {
        content.push({
          type: "tool_use",
          id: t.id,
          name: t.name,
          input: safeJson(t.arguments) || {}
        });
      }
      converted.push({ role: "assistant", content });
      continue;
    }
    if (m.images?.length) {
      const content = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const url of m.images) {
        const mimetype = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/)?.[1] || "image/png";
        const data = url.split(",")[1];
        content.push({ type: "image", source: { type: "base64", media_type: mimetype, data } });
      }
      converted.push({ role: m.role, content });
      continue;
    }
    converted.push({ role: m.role, content: m.content || "" });
  }
  // Anthropic 要求 user/assistant 严格交替：tool_result 和工具注入的图片消息都是 user 角色，
  // 连续的同角色消息必须合并成一条，content 统一为 block 数组
  const merged = [];
  for (const m of converted) {
    const parts = Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content || "" }];
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content.push(...parts);
    else merged.push({ role: m.role, content: [...parts] });
  }
  const body = {
    model,
    max_tokens: thinking ? 8192 : 4096,
    stream: true,
    messages: merged
  };
  if (system) body.system = system;
  if (thinking) body.thinking = { type: "enabled", budget_tokens: 4000 };
  const tools = anthropicTools(toolNames);
  if (tools.length) body.tools = tools;
  const res = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify(body),
    signal
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${provider.name} ${res.status}: ${err.slice(0, 500)}`);
  }
  let currentTool = null;
  let thinkSig = "";
  const calls = [];
  for await (const ev of iterateSSE(res)) {
    if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
      currentTool = { id: ev.content_block.id, name: ev.content_block.name, arguments: "" };
    }
    if (ev.type === "content_block_delta") {
      if (ev.delta?.type === "text_delta" && ev.delta.text) yield { type: "text", text: ev.delta.text };
      if (ev.delta?.type === "thinking_delta" && ev.delta.thinking) yield { type: "thinking", text: ev.delta.thinking };
      if (ev.delta?.type === "signature_delta") thinkSig += ev.delta.signature || "";
      if (ev.delta?.type === "input_json_delta" && currentTool) currentTool.arguments += ev.delta.partial_json || "";
    }
    if (ev.type === "content_block_stop") {
      if (currentTool) {
        calls.push(currentTool);
        currentTool = null;
      }
      if (thinkSig) {
        yield { type: "thinking_sig", signature: thinkSig };
        thinkSig = "";
      }
    }
    if (ev.type === "message_delta" && ev.delta?.stop_reason === "tool_use") {
      yield { type: "tool_calls", calls };
    }
  }
}

function toGeminiContents(messages) {
  const contents = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      contents.push({
        role: "user",
        parts: [{ functionResponse: { name: m.name, response: { result: m.content } } }]
      });
      continue;
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      const parts = [];
      if (m.content) parts.push({ text: m.content });
      for (const t of m.toolCalls) {
        parts.push({ functionCall: { name: t.name, args: safeJson(t.arguments) || {} } });
      }
      contents.push({ role: "model", parts });
      continue;
    }
    const parts = [];
    if (m.content) parts.push({ text: m.content });
    if (m.images?.length) {
      for (const url of m.images) {
        const mime = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/)?.[1] || "image/png";
        const data = url.split(",")[1];
        parts.push({ inlineData: { mimeType: mime, data } });
      }
    }
    contents.push({ role: m.role === "assistant" ? "model" : "user", parts });
  }
  // Gemini 多轮请求要求 user/model 交替：functionResponse 与工具注入的图片消息同为 user，
  // 连续同角色条目合并为一条
  const merged = [];
  for (const c of contents) {
    const last = merged[merged.length - 1];
    if (last && last.role === c.role) last.parts.push(...c.parts);
    else merged.push({ role: c.role, parts: [...c.parts] });
  }
  return merged;
}

async function* streamGemini({ provider, model, messages, toolNames, thinking, signal }) {
  const { system } = splitSystem(messages);
  const url = `${provider.baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(provider.apiKey)}`;
  const body = { contents: toGeminiContents(messages) };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (thinking) body.generationConfig = { thinkingConfig: { includeThoughts: true } };
  const tools = geminiTools(toolNames);
  if (tools.length) body.tools = tools;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${provider.name} ${res.status}: ${err.slice(0, 500)}`);
  }
  for await (const ev of iterateSSE(res)) {
    const cand = ev.candidates?.[0];
    const parts = cand?.content?.parts || [];
    const calls = [];
    for (const p of parts) {
      if (p.text) yield { type: p.thought ? "thinking" : "text", text: p.text };
      if (p.functionCall) {
        calls.push({
          id: `call_${p.functionCall.name}_${Math.random().toString(36).slice(2, 7)}`,
          name: p.functionCall.name,
          arguments: JSON.stringify(p.functionCall.args || {})
        });
      }
    }
    if (calls.length) yield { type: "tool_calls", calls };
  }
}

export async function* streamChat(opts) {
  const kind = opts.provider.kind || "openai";
  if (kind === "anthropic") {
    yield* streamAnthropic(opts);
    return;
  }
  if (kind === "gemini") {
    yield* streamGemini(opts);
    return;
  }
  yield* streamOpenAI(opts);
}

export async function listRemoteModels(provider) {
  const kind = provider.kind || "openai";
  if (kind === "openai") {
    const url = `${provider.baseUrl.replace(/\/$/, "")}${provider.modelsUrl || "/models"}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${provider.apiKey || "ollama"}` }
    });
    if (!res.ok) throw new Error(`无法拉取模型列表: ${res.status}`);
    const data = await res.json();
    const ids = (data.data || data.models || []).map((m) => m.id || m.name).filter(Boolean);
    return [...new Set(ids)];
  }
  if (kind === "gemini") {
    const url = `${provider.baseUrl.replace(/\/$/, "")}/models?key=${encodeURIComponent(provider.apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`无法拉取模型列表: ${res.status}`);
    const data = await res.json();
    return (data.models || [])
      .map((m) => (m.name || "").replace(/^models\//, ""))
      .filter((n) => n.includes("gemini"));
  }
  return provider.models || [];
}
