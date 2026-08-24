// Skilldock 新手引导 —— 自绘插画 + 分页导览
const $ = (id) => document.getElementById(id);

const previewTheme = new URLSearchParams(location.search).get("theme");
if (previewTheme) document.documentElement.dataset.theme = previewTheme;

const S = `viewBox="0 0 132 100" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;

// 自绘线性插画，与扩展图标同一笔触体系
const ART = {
  welcome: `<svg ${S}>
    <rect x="14" y="14" width="104" height="72" rx="10" opacity="0.45"/>
    <rect x="78" y="14" width="40" height="72" rx="10"/>
    <path d="M86 30h24M86 40h18" opacity="0.6"/>
    <rect x="24" y="30" width="34" height="14" rx="7"/>
    <rect x="38" y="52" width="30" height="14" rx="7" opacity="0.6"/>
  </svg>`,
  models: `<svg ${S}>
    <circle cx="46" cy="42" r="16"/>
    <path d="M46 34v8l6 4" opacity="0.7"/>
    <path d="M70 42h34M92 42v10M104 42v7" />
    <path d="M58 66l10 10M66 58l8 8" opacity="0.45"/>
  </svg>`,
  page: `<svg ${S}>
    <rect x="22" y="12" width="56" height="76" rx="8" opacity="0.45"/>
    <path d="M32 28h36M32 40h36M32 52h24" opacity="0.6"/>
    <circle cx="88" cy="62" r="16"/>
    <path d="M100 74l12 12"/>
  </svg>`,
  tools: `<svg ${S}>
    <path d="M20 30h58M20 44h44" opacity="0.5"/>
    <path d="M20 58h30" opacity="0.5"/>
    <path d="M30 22l4-8M52 22l2-9M74 24l6-7" opacity="0.35"/>
    <rect x="62" y="52" width="56" height="30" rx="9"/>
    <circle cx="76" cy="67" r="3"/><circle cx="90" cy="67" r="3"/><circle cx="104" cy="67" r="3"/>
  </svg>`,
  shield: `<svg ${S}>
    <path d="M66 12l34 12v24c0 22-14 34-34 40-20-6-34-18-34-40V24l34-12z"/>
    <path d="M52 50l10 10 20-22"/>
  </svg>`,
  done: `<svg ${S}>
    <circle cx="66" cy="50" r="34"/>
    <path d="M50 52l12 12 22-26"/>
    <path d="M66 6v6M100 16l-4 4M32 16l4 4" opacity="0.4"/>
  </svg>`
};

const PAGES = [
  {
    art: "welcome",
    title: "欢迎使用 Skilldock",
    desc: "开源、本地优先的侧边栏 AI 工作区。密钥和对话只存在本机，没有账户、订阅和广告。",
    points: []
  },
  {
    art: "models",
    title: "先接一个模型",
    desc: "内置 OpenAI、Anthropic、Google Gemini、OpenRouter 和本地 Ollama 预设，也支持任意 OpenAI 兼容接口。",
    points: [
      "填入 API Key 即可开始，请求由浏览器直连服务商",
      "用 Ollama 可以完全离线、免费运行",
      "之后随时在 设置 → 模型 里修改"
    ]
  },
  {
    art: "page",
    title: "它读懂你正在看的页面",
    desc: "提问可自动附带当前页正文，也能附加截图、文件和 PDF 一起问。",
    points: [
      "输入框的「当前页」开关控制是否附带正文",
      "可关联其他标签页，多个页面一起分析",
      "内置 PDF 阅读器，看完直接「带去提问」"
    ]
  },
  {
    art: "tools",
    title: "技能和网页研究",
    desc: "输入 / 调用自定义技能，联网搜索与划词工具让研究不离开当前页。",
    points: [
      "选中网页文字，浮出总结 / 翻译 / 解释",
      "搜索结果附标题、链接和摘要，可直接读取",
      "支持图片问答与 LaTeX 公式渲染"
    ]
  },
  {
    art: "shield",
    title: "数据和权限都由你掌控",
    desc: "设置、密钥和对话历史只保存在本机；敏感操作默认先征求同意。",
    points: [
      "AI 点击或填写网页前，会先弹窗问你",
      "对话支持分叉、Markdown / PDF 导出和 JSON 备份",
      "每个技能的读网页、搜索、浏览器权限可逐项开关"
    ]
  },
  {
    art: "done",
    title: "准备好了",
    desc: "按 Alt+S 或点击工具栏图标，开始第一段对话。",
    points: []
  }
];

let step = 0;

async function applyThemeFromSettings() {
  if (previewTheme) return;
  try {
    const r = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
    const t = r?.settings?.theme || "system";
    document.documentElement.dataset.theme = t;
    document.documentElement.classList.toggle("system", t === "system");
  } catch {
    document.documentElement.classList.add("system");
  }
}

function render() {
  const p = PAGES[step];
  $("art").innerHTML = ART[p.art];
  $("title").textContent = p.title;
  $("desc").textContent = p.desc;
  $("points").innerHTML = p.points.map((t) => `<li></li>`).join("");
  $("points").querySelectorAll("li").forEach((li, i) => (li.textContent = p.points[i]));
  $("dots").innerHTML = PAGES.map((_, i) => `<i class="${i === step ? "on" : ""}"></i>`).join("");
  $("prev").style.visibility = step === 0 ? "hidden" : "visible";
  $("skip").style.display = step === PAGES.length - 1 ? "none" : "";
  $("next").textContent = step === PAGES.length - 1 ? "打开侧边栏" : "下一步";
  const card = document.querySelector(".card");
  card.classList.remove("swap");
  void card.offsetWidth;
  card.classList.add("swap");
}

async function finish() {
  try {
    const win = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: win.id });
  } catch {
    /* 某些环境不允许页面直接开侧边栏，用户可点工具栏图标 */
  }
  window.close();
  // window.close 在非脚本打开的窗口里可能失败，留个兜底提示
  $("desc").textContent = "可以点击工具栏的 Skilldock 图标打开侧边栏，开始第一段对话。";
}

$("next").addEventListener("click", () => {
  if (step === PAGES.length - 1) return finish();
  step += 1;
  render();
});
$("prev").addEventListener("click", () => {
  if (step > 0) {
    step -= 1;
    render();
  }
});
$("skip").addEventListener("click", () => {
  step = PAGES.length - 1;
  render();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") $("next").click();
  if (e.key === "ArrowLeft") $("prev").click();
});

applyThemeFromSettings();
render();
