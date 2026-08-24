const COPY = {
  en: {
    "Skilldock 设置": "Skilldock Settings",
    "密钥只存在本机。没有账户、订阅或广告。": "Your keys stay on this device. No account, subscription, or ads.",
    "常规": "General", "模型": "Models", "技能": "Skills", "数据": "Data",
    "外观": "Appearance", "主题": "Theme", "侧边栏与设置页的配色": "Color scheme for the side panel and settings.",
    "跟随系统": "System", "深色": "Dark", "浅色": "Light", "语言": "Language", "界面显示语言": "Interface display language", "中文": "Chinese",
    "字号": "Font size", "调整设置页与侧边栏里的文字大小": "Adjust text size in settings and the side panel.",
    "功能与权限": "Features & permissions", "划词工具条": "Selection toolbar", "选中网页文字后浮出快捷操作。需要读取页面内容才能工作。": "Show quick actions when you select page text. Requires access to page content.",
    "输入框蓝点": "Writing assistant", "网页文本框聚焦时，在输入框边缘浮出写作助手入口（润色、续写、翻译）。": "Show writing actions (rewrite, continue, translate) beside focused text fields.",
    "快捷问（Alt+Q）": "Quick chat (Alt+Q)", "在任意页面用快捷键唤起侧边栏提问。": "Open the side panel from any page with a shortcut.",
    "允许浏览器操作": "Allow browser control", "允许 AI 点击、填写、滚动网页。敏感操作前会再次征求你的同意，请留意确认弹窗。": "Allow AI to click, fill, and scroll pages. Sensitive actions always require your approval.",
    "允许联网搜索": "Allow web search", "允许 AI 通过 DuckDuckGo 搜索公开网页。关闭后，所有技能都不能使用网络搜索。": "Allow AI to search the public web through DuckDuckGo. When off, no skill can use web search.",
    "默认附带当前页内容": "Include current page by default", "每次提问自动读取当前标签页正文。页面内容会随请求发送给你配置的模型服务商。": "Read the current tab with every question. Its content is sent to your configured model provider.",
    "默认开启思考模式": "Enable thinking by default", "仅对支持推理的模型生效，可能增加响应耗时与 token 费用。": "Only applies to reasoning-capable models and may increase latency and token costs.",
    "高级": "Advanced", "禁用站点": "Disabled sites", "每行一个域名，这些站点上不显示划词工具条和输入框蓝点": "One domain per line. The selection toolbar and writing assistant are hidden on these sites.",
    "系统提示词": "System prompt", "附加在每次对话开头的全局指令": "Global instruction prepended to every conversation.",
    "添加 OpenAI 兼容接口": "Add an OpenAI-compatible provider", "名称": "Name", "多个模型用逗号分隔": "Separate models with commas", "可留空": "Optional", "添加": "Add",
    "技能完全本地，可自由创建、编辑、设为快捷技能。输入框里用 / 调用。": "Skills are entirely local. Create, edit, and mark them as quick skills; invoke them with / in the composer.",
    "新建技能": "New skill", "技能说明 / 系统指令": "Skill instructions / system prompt", "快捷技能": "Quick skill", "可读当前页": "Can read current page", "可用浏览器操作": "Can use browser control", "可用网络搜索": "Can use web search", "保存技能": "Save skill",
    "导出或导入设置、技能和对话。对话仅保留用户和助手可见的文字及助手思考，不含网页上下文、附件或图片。文件只在本地处理。": "Export or import settings, skills, and conversations. Conversations retain only visible user and assistant text plus assistant thinking; page context, attachments, and images are excluded. Files are processed locally only.", "导出 JSON": "Export JSON", "导入 JSON": "Import JSON",
    "历史": "History", "新对话": "New chat", "设置": "Settings", "聊天历史": "Chat history", "搜索…": "Search…", "拒绝": "Deny", "允许": "Allow",
    "准备好开始对话": "Ready to chat", "选择模型": "Choose model", "关闭模型选择": "Close model picker", "选择技能": "Choose skill", "技能": "Skill", "添加技能": "Add skill", "清空技能": "Clear skills",
    "随便问，/ 使用技能，可直接粘贴截图": "Ask anything, use / for skills, or paste a screenshot", "当前页": "Current page", "思考": "Thinking", "添加页面或文件": "Add page or file", "停止": "Stop", "发送消息": "Send message",
    "添加到对话": "Add to conversation", "其他标签页": "Other tabs", "图片或文件": "Image or file", "选择其它标签页": "Choose other tabs",
    "每个网页旁的本地助手。API Key 只存在你的电脑上，没有订阅，也没有广告。": "A local assistant beside every page. Your API keys stay on your computer; no subscription or ads.",
    "今天想做什么？": "What would you like to do today?", "直接提问，或选择一个技能开始。你的密钥和对话只保存在本机。": "Ask directly, or choose a skill to get started. Your keys and chats stay on this device.",
    "暂无模型，请在设置中添加或拉取": "No models yet. Add or fetch them in Settings.", "不使用技能": "No skill", "直接与模型对话": "Chat with the model directly", "你": "You", "助手": "Assistant", "工具": "Tool", "已复制": "Copied", "复制": "Copy", "复制失败": "Copy failed", "编辑": "Edit", "重生成": "Regenerate", "导出此回答为 Markdown": "Export this answer as Markdown", "正在编辑上一条消息": "Editing the previous message", "对话": "Chat", "未命名": "Untitled", "导出": "Export", "导出格式": "Export format", "导出为 TXT": "Export as TXT", "导出为 Markdown": "Export as Markdown", "导出为 PDF": "Export as PDF", "删除": "Delete", "还没有对话": "No conversations yet", "回到顶部": "Back to top", "过程": "Process",
    "拉取模型列表": "Fetch model list", "拉取中…": "Fetching…", "快捷": "Quick", "已禁用": "Disabled", "编辑技能": "Edit skill", "启用技能": "Enable skill", "禁用技能": "Disable skill", "启用": "Enable", "禁用": "Disable", "删除技能": "Delete skill", "还没有技能": "No skills yet", "更新技能": "Update skill", "导入完成": "Import complete",
    "斜杠命令": "Slash command", "简介": "Description", "如 DeepSeek": "e.g. DeepSeek", "例如：总结当前页": "e.g. Summarize this page", "例如：summarize": "e.g. summarize", "一句话说明技能用途": "Describe the skill in one sentence", "描述技能应该如何工作": "Describe how the skill should work", "敏捷的棕色狐狸跳过懒狗。The quick brown fox jumps over the lazy dog.": "The quick brown fox jumps over the lazy dog.", "把当前网页正文附加到问题": "Attach the current page text to your question", "让支持的模型先输出推理过程再作答": "Ask supported models to reason before answering", "切换模型": "Switch model", "选择要附加的标签页": "Choose tabs to attach", "没有可添加的其它标签页": "No other tabs can be added"
  }
};

const originals = new WeakMap();

export function normalizeLanguage(language) {
  return language === "en" ? "en" : "zh-CN";
}

export function t(text, language = "zh-CN", values = {}) {
  const source = String(text ?? "");
  const translated = normalizeLanguage(language) === "en" ? (COPY.en[source] || source) : source;
  return translated.replace(/\{(\w+)\}/g, (_match, key) => String(values[key] ?? ""));
}

export function localizeDocument(language, root = document) {
  const lang = normalizeLanguage(language);
  document.documentElement.lang = lang;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      return parent && !["SCRIPT", "STYLE"].includes(parent.tagName) && node.nodeValue.trim()
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    }
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    if (!originals.has(node)) originals.set(node, node.nodeValue);
    const source = originals.get(node);
    const leading = source.match(/^\s*/)?.[0] || "";
    const trailing = source.match(/\s*$/)?.[0] || "";
    node.nodeValue = `${leading}${t(source.trim(), lang)}${trailing}`;
  });
  root.querySelectorAll?.("[title], [placeholder], [aria-label]").forEach((element) => {
    ["title", "placeholder", "aria-label"].forEach((attribute) => {
      if (!element.hasAttribute(attribute)) return;
      const key = `${attribute}:${element.getAttribute(attribute)}`;
      let attrs = originals.get(element);
      if (!attrs || !(attribute in attrs)) {
        attrs = attrs || {};
        attrs[attribute] = element.getAttribute(attribute);
        originals.set(element, attrs);
      }
      element.setAttribute(attribute, t(attrs[attribute], lang));
    });
  });
}
