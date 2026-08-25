# 功能定位清单

想改某个功能时，先在这里找到对应文件和锚点函数，再用编辑器/grep 搜索函数名跳转。
行号会随改动漂移，**锚点一律用函数名**。

## 总览

| 目录 | 角色 |
|---|---|
| `sidepanel/` | 侧边栏聊天界面（核心交互都在这里） |
| `background/sw.js` | Service Worker：聊天管线、工具调用、网页抓取、右键菜单 |
| `content/` | 注入网页的脚本：划词工具条、页面正文/图片提取 |
| `settings/` | 设置页（模型、技能、外观、数据导入导出） |
| `onboarding/` | 首次安装的引导页 |
| `viewer/` | 内置 PDF 查看器（拖入 PDF 后问答） |
| `print/` | 导出 PDF 用的打印页 |
| `shared/` | 各页面共用的模块（存储、模型接口、Markdown、翻译等） |
| `vendor/` | 第三方库（pdfjs、katex），一般不用动 |
| `_locales/` | 浏览器级 i18n（扩展名/描述）；界面文案不在这里 |

## 侧边栏聊天（sidepanel/sidepanel.js + sidepanel.css）

| 功能 | 锚点 |
|---|---|
| 消息气泡渲染（用户/助手/思考/工具） | `addMsgEl` |
| 整条对话渲染 / 历史对话切换 | `renderConv` |
| 用户长消息自动折叠 | `setupUserCollapse`（阈值常量 `USER_COLLAPSE_THRESHOLD`） |
| 用户消息底部按钮（复制/编辑/时间） | `attachUserFooter` |
| 助手消息底部按钮（复制/重生成/导出） | `attachMsgFooter` |
| 编辑上一条消息 / 取消编辑 | `beginEdit` / `cancelEdit`（暂存节点 `editStashedNodes`） |
| 重生成回答 | `regenerate` |
| 分叉对话 | `forkFrom` |
| 发送消息（含编辑截断、本地气泡） | `send` |
| 流式输出接收（delta/思考/工具/完成） | `onPort` + `upsertById` + `streamBuf` |
| 等待首个响应的加载转圈 | `showWorking` / `hideWorking`（样式 `.working` / `.spinner`） |
| 工具调用一句话摘要 | `toolSummary` |
| 思考/工具过程折叠成「过程」条 | `collapseTrace` |
| 消息分叉按钮（气泡右上角） | `attachMsgActions` |
| 空状态首页（快捷技能入口） | `emptyView` |
| 流式输出底部跟随（用户上滚即解除）/ 回到底部、回到顶部悬浮钮 | `stickToBottom` / `maybeScrollToBottom` / `scrollToBottom`，悬浮钮在文件底部 `init` 里 |
| 技能选择（/ 斜杠命令） | `hideSlash` / `pickSkill` / `selectSkill`，搜 "slash" |
| 附件/标签页 chips | `renderChips` / `pickTabs` / `openAttachmentMenu` |
| 权限确认弹窗（智能体执行敏感操作前） | `onPort` 里 `msg.type === "permission"` |
| 图片灯箱 / 消息内图片 | `openLightbox` / `appendImages` |
| 历史对话列表 | `renderHistory`，搜 "history" |
| 样式 | `sidepanel.css`：气泡 `.msg.user .user-bubble`、折叠 `.user-bubble.collapsed`、底部按钮 `.msg-foot`、过程折叠 `.trace` |

## 后台管线（background/sw.js）

| 功能 | 锚点 |
|---|---|
| 聊天主流程（组上下文→调模型→回推流） | `handleChat` |
| 编辑消息时后台截断会话 | `handleChat` 里 `req.editMessageId` 分支 |
| 工具分发（读页面/搜索/点击/填写等） | `runTool` |
| 技能决定可用哪些工具 | `toolNamesFor` |
| 敏感操作前等用户确认 | `waitPermission` |
| 收集当前页/附加标签页上下文 | `collectContext` |
| 联网搜索（DuckDuckGo） | `webSearch` / `fetchSearchResultPage` |
| 网页正文/图片提取（注入页面执行） | `extractPageFn` / `listImagesFn` / `getImageFn` |
| 浏览器操作工具（点击/填写/滚动/搜页面） | `clickFn` / `fillFn` / `scrollFn` / `searchPageFn` |
| 右键菜单（总结页面等） | 顶部 `chrome.contextMenus.create` |
| 点图标/Alt+S 打开侧边栏 | `enablePanel` / `queueContextAction` |

## 内容脚本（content/content.js + content.css）

| 功能 | 锚点 |
|---|---|
| 划词工具条（选中文字浮出快捷操作） | `showToolbar` / `runAction` / `hideToolbar` |
| 禁用站点判断 | `disabled` / `hostOf` |
| 页面正文提取（供后台调用） | `extractPage` / `readableRoot` |
| 页面图片抓取 | `grabPageImages` / `getPageImage` |

## 设置页（settings/settings.js）

| 功能 | 锚点 |
|---|---|
| 页签切换 | `showTab` |
| 常规设置（主题/字号/语言/开关） | `fillGeneral` / `readGeneralSettings` / `saveGeneralSettings` |
| 模型服务商管理（添加/拉取模型） | `renderProviders` |
| 技能创建/编辑/启停 | `renderSkills` / `editSkill` / `currentSkillForm` |
| 数据导入导出 | 搜 "export" / "import" |

## 共用模块（shared/）

| 功能 | 文件 / 锚点 |
|---|---|
| 界面文案翻译（zh→en 词表） | `i18n.js` 顶部 `COPY.en`，加新文案改这里 |
| 状态存储与读写 | `storage.js`：`loadState` / `saveState` / `upsertConversation` |
| 默认技能定义 | `storage.js`：`defaultSkills` |
| 数据迁移（老版本状态升级） | `storage.js`：`migrate` |
| 导入导出数据包 | `storage.js`：`exportBundle` / `importBundle` |
| 模型 API 适配（OpenAI/Anthropic/Gemini 流式） | `providers.js`：`streamChat` / `toOpenAIMessages` / `toGeminiContents` |
| 拉取远程模型列表 | `providers.js`：`listRemoteModels` |
| Markdown 渲染（含代码块、LaTeX） | `markdown.js`：`renderMarkdown` |
| PDF 文本提取 | `pdf.js` |
| 通用小工具（uid、下载文本、转义等） | `utils.js` |

## 其他页面

| 功能 | 文件 |
|---|---|
| 首次安装引导（填 key、选模型） | `onboarding/` |
| PDF 查看器与 PDF 问答 | `viewer/viewer.js`：`loadPdf` / `askWithPdf` |
| 导出对话为 PDF（打印页） | `print/` |
| 扩展图标、快捷键、权限 | `manifest.json` |

## 常见改动速查

- **加一句界面文案**：写中文，英文翻译加到 `shared/i18n.js` 的 `COPY.en`。
- **改气泡样式/颜色**：`sidepanel/sidepanel.css`（主题变量在文件顶部 `:root`）。
- **改发给模型的 prompt/上下文**：`background/sw.js` 的 `collectContext` 和 `handleChat`。
- **加一个智能体工具**：`background/sw.js` 的 `runTool` + `toolNamesFor`，页面侧操作加到 `content/content.js`。
- **改默认技能**：`shared/storage.js` 的 `defaultSkills`。
- **加模型服务商类型**：`shared/providers.js`。
