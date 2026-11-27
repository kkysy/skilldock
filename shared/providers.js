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
    description: "Read one sequential segment of the main text of the current (or specified) tab. The result includes start, end, total, hasMore, nextStart and a page version; when hasMore is true, call read_page again with nextStart before answering questions that require the whole page. A 'start' returned by search_page can be passed here directly as long as the page version is unchanged.",
    parameters: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional Chrome tab id. Defaults to the tab switched to most recently in this turn." },
        start: { type: "integer", description: "Starting character position from the previous result's nextStart, or a match position returned by search_page. Defaults to 0." }
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
    description: "Extract hyperlinks, split into links inside the article body and other page links (navigation, footer). Deduplicated; prefer the body links for citations.",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "search_page",
    description: "Search the current page text (the same text read_page returns) and return matches with their character offsets, which can be passed to read_page(start=...) to jump straight there. Tries the exact phrase first, then falls back to keyword AND within a ±200 character window; unmatched keywords are reported so the query can be adjusted.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Phrase or space-separated keywords." } },
      required: ["query"]
    }
  },
  {
    name: "open_tab",
    description: "Open a URL in a background tab and make it this turn's working tab. If a tab with this URL is already open, it is activated instead of opening a duplicate. Tools without an explicit tabId read this tab afterwards.",
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"]
    }
  },
  {
    name: "switch_tab",
    description: "Activate an already-open tab and make it this turn's working tab, so later tools without an explicit tabId read it. Use this instead of open_tab when the page is already open.",
    parameters: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Tab id from list_tabs." },
        url: { type: "string", description: "URL of the tab to activate." }
      }
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
    description: "Search the public web and return title, URL, snippet and site. Set content=true to also receive the page text of the top 3 results (use it when you must quote or verify facts); that costs significant tokens. If the tool reports that search is unavailable, do not call it again in this turn.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        count: { type: "integer", description: "Number of results, 1-6 (at most 3 when content is true). Defaults to 5." },
        content: { type: "boolean", description: "Return the page text of the results (top 3 only). Defaults to false." }
      },
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

function sleepWithAbort(ms, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      const err = new Error("Aborted");
      err.name = "AbortError";
      reject(err);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const STREAM_TIMEOUT_MS = 90000;

function streamError(message, name = "StreamProtocolError") {
  const error = new Error(message);
  error.name = name;
  return error;
}

// 每次尝试独立计时和取消，不依赖 AbortSignal.any/timeout 的浏览器版本。
function createStreamRequest(signal) {
  const controller = new AbortController();
  let timer;
  let failure;
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const onAbort = () => {
    failure = new DOMException("已停止", "AbortError");
    controller.abort(failure);
    rejectAbort(failure);
  };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  // 即使在首次 wait 前取消，也不会产生未处理的 rejection。
  aborted.catch(() => {});
  const arm = (phase) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      failure = streamError(`${phase}超时（90 秒无新数据），请重试`, "StreamTimeoutError");
      controller.abort(failure);
      rejectAbort(failure);
    }, STREAM_TIMEOUT_MS);
  };
  const wait = (promise) => Promise.race([promise, aborted]);
  return {
    wait,
    activity: () => arm("流不活动"),
    async fetch(url, init) {
      if (failure) throw failure;
      arm("等待响应首包");
      let response;
      try {
        response = await wait(fetch(url, { ...init, signal: controller.signal }));
      } catch (error) {
        if (failure) throw failure;
        error.streamNetworkError = true;
        throw error;
      }
      arm("等待首个数据字节");
      return response;
    },
    close() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      controller.abort();
    }
  };
}

async function responseError(res, provider, request) {
  const text = await request.wait(res.text());
  const error = new Error(`${provider.name} ${res.status}: ${text.slice(0, 500)}`);
  error.status = res.status;
  return error;
}

function validateToolCalls(calls) {
  for (const call of calls) {
    // 空对象也是完整 JSON；空字符串或半截参数都不能降级成 {} 执行。
    const args = safeJson(call.arguments);
    if (!call.id || !call.name || !args || typeof args !== "object" || Array.isArray(args)) {
      throw streamError(`工具调用不完整或参数 JSON 无效：${call.name || "未知工具"}`);
    }
  }
  return calls;
}

async function* iterateSSE(response, request) {
  const reader = response.body?.getReader();
  if (!reader) throw streamError("模型响应没有可读取的数据流");
  const decoder = new TextDecoder();
  let buf = "";
  const parse = (chunk) => {
    const lines = chunk.split(/\r?\n/);
    const data = lines.filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, "")).join("\n").trim();
    if (!data) return null;
    if (data === "[DONE]") return { sseDone: true };
    const json = safeJson(data);
    if (!json || typeof json !== "object") throw streamError("模型返回了无效的 SSE JSON");
    if (json.error || json.type === "error" || lines.some((line) => /^event:\s*error\s*$/.test(line))) {
      throw streamError(`模型流错误：${json.error?.message || json.message || JSON.stringify(json.error || json)}`);
    }
    return json;
  };
  try {
    while (true) {
      let result;
      try {
        result = await request.wait(reader.read());
      } catch (error) {
        if (error.name !== "AbortError" && error.name !== "StreamTimeoutError") error.streamNetworkError = true;
        throw error;
      }
      const { value, done } = result;
      if (done) break;
      if (value?.byteLength) request.activity();
      buf += decoder.decode(value, { stream: true });
      const chunks = buf.split(/\r?\n\r?\n/);
      buf = chunks.pop() || "";
      for (const chunk of chunks) {
        const event = parse(chunk);
        if (event) yield event;
      }
    }
    buf += decoder.decode();
    if (buf.trim()) {
      const event = parse(buf);
      if (event) yield event;
    }
  } finally {
    // 超时/取消/提前退出均释放 reader；不等待可能已经损坏的连接完成关闭。
    reader.cancel().catch(() => {});
    reader.releaseLock();
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

async function* streamOpenAI({ provider, model, messages, toolNames, thinking, signal, request }) {
  const url = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const body = {
    model,
    messages: toOpenAIMessages(messages),
    stream: true,
    // 让上游在流末尾返回 usage（含 cached_tokens）；缺省时 Gemini 渠道不回 usage，中转站统计不到缓存命中
    stream_options: { include_usage: true }
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
  const post = () => request.fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (thinking) body.reasoning_effort = "medium";
  let res = await post();
  if (!res.ok) {
    const error = await responseError(res, provider, request);
    // 仅参数兼容错误降级，429 交给统一重试处理。
    if (!thinking || error.status === 429 || !/reasoning/i.test(error.message)) throw error;
    delete body.reasoning_effort;
    res = await post();
  }
  if (!res.ok) throw await responseError(res, provider, request);
  const toolAcc = {};
  let complete = false;
  for await (const ev of iterateSSE(res, request)) {
    // 不 continue：部分供应商（如 StepFun step_plan）在每个 chunk 都附带 usage，跳过会吞掉正文；
    // 只在末尾发 usage 的供应商其末尾 chunk choices 为空，下方 delta 分支自然跳过，无副作用
    if (ev.usage) {
      yield {
        type: "usage",
        usage: {
          prompt: ev.usage.prompt_tokens,
          completion: ev.usage.completion_tokens,
          cached: ev.usage.prompt_tokens_details?.cached_tokens || 0
        }
      };
    }
    if (ev.sseDone) { complete = true; break; }
    const choice = ev.choices?.[0];
    if (choice?.finish_reason) {
      if (!["stop", "tool_calls"].includes(choice.finish_reason)) {
        throw streamError(`模型输出未正常完成：${choice.finish_reason}`);
      }
      complete = true;
    }
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
  if (!complete) throw streamError("模型流被截断：未收到完成标记");
  const calls = Object.values(toolAcc)
    .map((c) => ({
      ...c,
      name: canonicalToolName(c.name, toolNames)
    }));
  if (calls.length) yield { type: "tool_calls", calls: validateToolCalls(calls) };
}

function splitSystem(messages) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");
  return { system, rest };
}

async function* streamAnthropic({ provider, model, messages, toolNames, thinking, signal, request }) {
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
  const res = await request.fetch(`${provider.baseUrl.replace(/\/$/, "")}/v1/messages`, {
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
  if (!res.ok) throw await responseError(res, provider, request);
  let complete = false;
  let toolUse = false;
  let currentTool = null;
  let thinkSig = "";
  const calls = [];
  const usageAcc = {};
  for await (const ev of iterateSSE(res, request)) {
    if (ev.type === "message_stop") { complete = true; break; }
    if (ev.type === "message_delta" && ev.delta?.stop_reason) {
      if (!["end_turn", "tool_use", "stop_sequence"].includes(ev.delta.stop_reason)) {
        throw streamError(`模型输出未正常完成：${ev.delta.stop_reason}`);
      }
      toolUse = ev.delta.stop_reason === "tool_use";
    }
    if (ev.type === "message_start" && ev.message?.usage) {
      const u = ev.message.usage;
      usageAcc.prompt = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      usageAcc.cached = u.cache_read_input_tokens || 0;
    }
    if (ev.type === "message_delta" && ev.usage) {
      usageAcc.completion = ev.usage.output_tokens;
    }
    if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
      currentTool = { id: ev.content_block.id, name: ev.content_block.name, arguments: "", input: ev.content_block.input };
    }
    if (ev.type === "content_block_delta") {
      if (ev.delta?.type === "text_delta" && ev.delta.text) yield { type: "text", text: ev.delta.text };
      if (ev.delta?.type === "thinking_delta" && ev.delta.thinking) yield { type: "thinking", text: ev.delta.thinking };
      if (ev.delta?.type === "signature_delta") thinkSig += ev.delta.signature || "";
      if (ev.delta?.type === "input_json_delta" && currentTool) currentTool.arguments += ev.delta.partial_json || "";
    }
    if (ev.type === "content_block_stop") {
      if (currentTool) {
        if (!currentTool.arguments) currentTool.arguments = JSON.stringify(currentTool.input || {});
        delete currentTool.input;
        calls.push(currentTool);
        currentTool = null;
      }
      if (thinkSig) {
        yield { type: "thinking_sig", signature: thinkSig };
        thinkSig = "";
      }
    }
  }
  if (!complete || currentTool) throw streamError("模型流被截断：未收到完整 message_stop");
  if (calls.length && !toolUse) throw streamError("工具调用缺少完整的 tool_use 结束状态");
  if (toolUse && calls.length) yield { type: "tool_calls", calls: validateToolCalls(calls) };
  if (usageAcc.prompt != null || usageAcc.completion != null) {
    yield { type: "usage", usage: { prompt: usageAcc.prompt, completion: usageAcc.completion, cached: usageAcc.cached || 0 } };
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

async function* streamGemini({ provider, model, messages, toolNames, thinking, signal, request }) {
  const { system } = splitSystem(messages);
  const url = `${provider.baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(provider.apiKey)}`;
  const body = { contents: toGeminiContents(messages) };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (thinking) body.generationConfig = { thinkingConfig: { includeThoughts: true } };
  const tools = geminiTools(toolNames);
  if (tools.length) body.tools = tools;
  const res = await request.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });
  if (!res.ok) throw await responseError(res, provider, request);
  let complete = false;
  const callAcc = new Map();
  const callPrefix = Math.random().toString(36).slice(2, 9);
  let nextCall = 0;
  for await (const ev of iterateSSE(res, request)) {
    if (ev.usageMetadata) {
      yield {
        type: "usage",
        usage: {
          prompt: ev.usageMetadata.promptTokenCount,
          completion: (ev.usageMetadata.candidatesTokenCount || 0) + (ev.usageMetadata.thoughtsTokenCount || 0),
          cached: ev.usageMetadata.cachedContentTokenCount || 0
        }
      };
    }
    const cand = ev.candidates?.[0];
    if (cand?.finishReason) {
      if (cand.finishReason !== "STOP") throw streamError(`模型输出未正常完成：${cand.finishReason}`);
      complete = true;
    }
    const parts = cand?.content?.parts || [];
    for (const p of parts) {
      if (p.text) yield { type: p.thought ? "thinking" : "text", text: p.text };
      if (p.functionCall) {
        const fc = p.functionCall;
        // 有 id 的增量/快照合并；无 id 时保留为独立调用，避免误吞同名工具。
        const id = fc.id || `call_${callPrefix}_${nextCall++}`;
        const previous = callAcc.get(id);
        if (fc.args != null && (typeof fc.args !== "object" || Array.isArray(fc.args))) {
          throw streamError("Gemini 工具参数必须是完整的 JSON 对象");
        }
        const args = { ...(previous ? JSON.parse(previous.arguments) : {}), ...(fc.args || {}) };
        callAcc.set(id, {
          id,
          name: fc.name || previous?.name,
          arguments: JSON.stringify(args)
        });
      }
    }
  }
  if (!complete) throw streamError("模型流被截断：未收到 finishReason");
  const calls = [...callAcc.values()];
  if (calls.length) yield { type: "tool_calls", calls: validateToolCalls(calls) };
}

export async function* streamChat(opts) {
  const kind = opts.provider.kind || "openai";
  const stream = kind === "anthropic" ? streamAnthropic : kind === "gemini" ? streamGemini : streamOpenAI;
  let published = false;
  for (let attempt = 0; ; attempt++) {
    const request = createStreamRequest(opts.signal);
    let retry = false;
    try {
      for await (const event of stream({ ...opts, request })) {
        if (["text", "thinking", "tool_calls"].includes(event.type)) published = true;
        yield event;
      }
      return;
    } catch (error) {
      // 已向上层输出内容后不得静默重放，否则会重复正文或工具操作。
      retry = !opts.signal?.aborted && !published && attempt < 3 &&
        (error.status === 429 || error.streamNetworkError === true || error.name === "StreamTimeoutError");
      if (!retry) throw error;
    } finally {
      request.close();
    }
    // 429、读流网络错误与超时共用最多三次指数退避，等待期间仍可停止。
    if (retry) await sleepWithAbort(800 * 2 ** attempt, opts.signal);
  }
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
