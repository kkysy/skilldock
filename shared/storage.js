import { uid, now } from "./utils.js";

const KEY = "skilldock_v1";

export const DEFAULT_PROVIDERS = [
  {
    id: "openai",
    name: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    modelsUrl: "/models",
    models: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini", "o4-mini"]
  },
  {
    id: "anthropic",
    name: "Anthropic",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKey: "",
    models: ["claude-sonnet-4-20250514", "claude-3-5-haiku-20241022"]
  },
  {
    id: "gemini",
    name: "Google Gemini",
    kind: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKey: "",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"]
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "",
    models: [
      "openai/gpt-4o-mini",
      "anthropic/claude-sonnet-4",
      "google/gemini-2.5-flash",
      "qwen/qwen3-235b-a22b"
    ]
  },
  {
    id: "ollama",
    name: "Ollama",
    kind: "openai",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "ollama",
    modelsUrl: "/models",
    models: []
  }
];

export function isCustomProvider(p) {
  return !DEFAULT_PROVIDERS.some((d) => d.id === p.id);
}

// 用户自加的供应商排在内置之前，组内保持原有顺序
export function sortProviders(providers) {
  return [...(providers || [])].sort((a, b) => Number(isCustomProvider(b)) - Number(isCustomProvider(a)));
}

export function defaultSkills() {
  return [
    {
      id: "sk_summarize",
      name: "总结当前页",
      slash: "summarize",
      description: "提炼页面要点、结论和待办。",
      instructions: "阅读当前页面内容，用简洁中文输出：1) 一句话摘要 2) 关键要点列表 3) 结论或行动项。不要编造页面里没有的信息。",
      enabled: true,
      tools: { readPage: true, browser: false, webSearch: false }
    },
    {
      id: "sk_translate",
      name: "翻译",
      slash: "translate",
      description: "中英互译所选文本或当前页。",
      instructions: "把用户给出的内容翻译成另一种语言：中文译英文，其它语言译中文。术语准确，保留原文的格式（Markdown、代码块、换行）与语气。只输出译文，不加解释或注释，除非用户要求。",
      enabled: true,
      tools: { readPage: false, browser: false, webSearch: false }
    },
    {
      id: "sk_explain",
      name: "解释",
      slash: "explain",
      description: "用浅显语言解释选中内容。",
      instructions: "解释用户选中的文本或当前页中难懂的部分，假设读者没有相关背景：先给一句直观解释，再按需展开关键术语和必要背景。",
      enabled: true,
      tools: { readPage: true, browser: false, webSearch: false }
    },
    {
      id: "sk_rewrite",
      name: "润色",
      slash: "rewrite",
      description: "改进措辞，保持原意。",
      instructions: "润色用户提供的文本：让它更清晰、流畅、得体，保留原意、语气、语言和格式（Markdown、代码、换行）。只输出润色后的文本，不加前言或说明；用户追问改了什么时再解释。",
      enabled: true,
      tools: { readPage: false, browser: false, webSearch: false }
    },
    {
      id: "sk_fix",
      name: "纠错",
      slash: "fix",
      description: "修正语法和拼写。",
      instructions: "修正文本中的语法、拼写、标点与用词问题，尽量少动措辞，保留原意、语气、语言和格式（Markdown、代码、换行）。只输出修正后的全文，不加任何解释。",
      enabled: true,
      tools: { readPage: false, browser: false, webSearch: false }
    },
    {
      id: "sk_shorten",
      name: "缩写",
      slash: "shorten",
      description: "压缩篇幅，保留要点。",
      instructions: "把用户提供的文本改得更短更精炼：删掉冗余表达和重复信息，保留核心意思、关键细节、语气与格式（Markdown、代码、换行）。只输出缩写后的文本，不加说明。",
      enabled: true,
      tools: { readPage: false, browser: false, webSearch: false }
    },
    {
      id: "sk_expand",
      name: "扩写",
      slash: "expand",
      description: "补充细节，写得更充实。",
      instructions: "把用户提供的文本写得更充实：补充必要的背景、过渡和细节，让表达更完整流畅，保留原意、语气与格式（Markdown、代码、换行）。只输出扩写后的文本，不加说明。",
      enabled: true,
      tools: { readPage: false, browser: false, webSearch: false }
    },
    {
      id: "sk_reply",
      name: "写回复",
      slash: "reply",
      description: "根据页面或选中邮件/评论起草回复。",
      instructions: "根据当前页面或选中文本起草一则得体回复。默认中文、语气专业克制。给出 1 个主回复，必要时再给更短/更礼貌的备选。",
      enabled: true,
      tools: { readPage: true, browser: false, webSearch: false }
    },
    {
      id: "sk_extract",
      name: "提取要点",
      slash: "extract",
      description: "抽出链接、日期、人名、数据。",
      instructions: "从当前页或附件中提取结构化信息：人名、组织、日期、链接、数字、待办。用 Markdown 表格或列表。没有的字段不要编。",
      enabled: true,
      tools: { readPage: true, browser: false, webSearch: false }
    }
  ];
}

export function emptyState() {
  return {
    settings: {
      theme: "system",
      fontSize: 14,
      language: "zh-CN",
      selectionToolbar: true,
      sidepanelStartup: "recent",
      browserControl: true,
      webSearchEnabled: true,
      readPageByDefault: true,
      thinkingDefault: false,
      contextTokenLimit: 200000,
      disabledSites: [],
      systemPrompt: "你是 Skilldock，一个运行在用户浏览器里的本地助手。优先依据用户提供的页面、附件和技能说明作答。不要假装能访问用户没给你的内容。用用户的语言回答。",
      providerId: "openai",
      model: "gpt-4o-mini"
    },
    providers: DEFAULT_PROVIDERS,
    skills: defaultSkills(),
    conversations: [],
    activeConversationId: null
  };
}

function migrate(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== "object") return base;
  return {
    settings: { ...base.settings, ...(raw.settings || {}) },
    providers: Array.isArray(raw.providers) && raw.providers.length ? raw.providers : base.providers,
    skills: Array.isArray(raw.skills) ? raw.skills : base.skills,
    conversations: Array.isArray(raw.conversations) ? raw.conversations : [],
    activeConversationId: raw.activeConversationId || null
  };
}

export async function loadState() {
  const bag = await chrome.storage.local.get(KEY);
  return migrate(bag[KEY]);
}

export async function saveState(state) {
  await chrome.storage.local.set({ [KEY]: state });
  return state;
}

export async function updateState(mutator) {
  const state = await loadState();
  const next = await mutator(state) || state;
  await saveState(next);
  return next;
}

export async function getSettings() {
  return (await loadState()).settings;
}

export function findProvider(state, id) {
  return (state.providers || []).find((p) => p.id === id) || null;
}

export function findSkill(state, id) {
  return (state.skills || []).find((s) => s.id === id) || null;
}

export function findConversation(state, id) {
  return (state.conversations || []).find((c) => c.id === id) || null;
}

export function newConversation(partial = {}) {
  const t = now();
  return {
    id: uid("conv"),
    title: partial.title || "新对话",
    createdAt: t,
    updatedAt: t,
    providerId: partial.providerId || null,
    model: partial.model || null,
    skillId: partial.skillId || null,
    skillIds: Array.isArray(partial.skillIds) ? partial.skillIds : (partial.skillId ? [partial.skillId] : []),
    messages: partial.messages || []
  };
}

export async function upsertConversation(conv) {
  return updateState((state) => {
    const i = state.conversations.findIndex((c) => c.id === conv.id);
    conv.updatedAt = now();
    if (i >= 0) state.conversations[i] = conv;
    else state.conversations.unshift(conv);
    if (state.conversations.length > 200) {
      state.conversations = state.conversations.slice(0, 200);
    }
    state.activeConversationId = conv.id;
    return state;
  });
}

export async function deleteConversation(id) {
  return updateState((state) => {
    state.conversations = state.conversations.filter((c) => c.id !== id);
    if (state.activeConversationId === id) {
      state.activeConversationId = state.conversations[0]?.id || null;
    }
    return state;
  });
}

export function exportBundle(state) {
  // 对话导出只保留侧栏中可见的用户/助手文本与助手思考，避免把网页上下文、
  // 附件、截图 Base64、工具调用和服务商返回的运行元数据写入备份。
  const conversations = (state.conversations || []).map((conv) => ({
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    providerId: conv.providerId,
    model: conv.model,
    skillId: conv.skillId,
    skillIds: conv.skillIds || (conv.skillId ? [conv.skillId] : []),
    messages: (conv.messages || []).flatMap((message) => {
      if (message.role === "user") {
        return [{
          id: message.id,
          role: "user",
          // display 是侧栏聊天框显示的原始提问；没有时才回退到 content。
          content: message.display ?? message.content ?? "",
          createdAt: message.createdAt
        }];
      }
      if (message.role === "assistant") {
        const content = message.content || "";
        const thinking = message.thinking || "";
        if (!content && !thinking) return [];
        return [{
          id: message.id,
          role: "assistant",
          content,
          ...(thinking ? { thinking } : {}),
          createdAt: message.createdAt,
          ...(message.elapsedMs != null ? { elapsedMs: message.elapsedMs } : {})
        }];
      }
      return [];
    })
  }));
  return {
    skilldock: 1,
    conversationExport: "visible-text-and-thinking-v1",
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    providers: state.providers,
    skills: state.skills,
    conversations
  };
}

export function importBundle(state, bundle) {
  if (!bundle || bundle.skilldock !== 1) throw new Error("无效的 Skilldock 备份文件");
  if (bundle.settings) state.settings = { ...state.settings, ...bundle.settings };
  if (Array.isArray(bundle.providers)) state.providers = bundle.providers;
  if (Array.isArray(bundle.skills)) state.skills = bundle.skills;
  if (Array.isArray(bundle.conversations)) state.conversations = bundle.conversations;
  return state;
}
