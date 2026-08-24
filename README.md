# Skilldock

![Skilldock extension icon](icons/icon128.png)

**Your private AI workspace beside every web page.**

Skilldock is a Chromium Manifest V3 extension that puts a bring-your-own-key AI chat panel next to the page you are reading. It is built from scratch as a local-first alternative to hosted browser assistants: no account, subscription, advertising, cloud sync, or skill marketplace.

[简体中文](README.zh-CN.md)

> **Repository description:** A private, local-first AI side panel for Chrome — custom skills, page context, and your choice of model provider.

## Screenshots

**Chat beside the page** — the side panel stays docked while you browse; questions can include the current page's text.

![Skilldock chat panel docked next to a web page, answering questions with page context](screenshots/chat.jpg)

**Send and read images** — attach screenshots or page images; vision-capable models can see and discuss them.

![Conversation where the model receives and interprets an attached image](screenshots/chatwithpicture.jpg)

**LaTeX math rendering** — formulas in model replies are rendered with KaTeX, alongside Markdown and streaming output.

![Assistant reply with rendered LaTeX formulas](screenshots/LaTeXsupport.jpg)

**Custom skills** — build your own skills with a slash command, Markdown instructions, and per-skill permissions for page reading, web search, and browser tools.

![Skill editor for creating a custom skill with slash command and permissions](screenshots/createyourskill.jpg)

## Highlights

- **Page-aware chat** — send the current page's readable text and relevant images with a question; attach other tabs when needed.
- **Bring your own model** — OpenAI, Anthropic, Google Gemini, OpenRouter, Ollama, and OpenAI-compatible endpoints.
- **Skills you control** — invoke reusable prompts with `/`, choose quick skills, and configure whether a skill may read pages, search the web, or use browser tools.
- **Web research without tab clutter** — search results include titles, URLs, and snippets; the assistant can read a selected public result page directly without opening a tab.
- **In-page assistance** — selection toolbar, a quick-chat popup, and an optional writing dot beside focused inputs.
- **Attachments and PDF reader** — paste screenshots, attach text files and PDFs, inspect PDFs in the built-in viewer, then send them to chat.
- **Careful browser actions** — page reading, tab listing, link extraction, page search, and optional click/fill/scroll/open-tab tools. Actions that can change a page require confirmation.
- **Conversation ownership** — local conversation history, chat branching, Markdown/PDF export, and JSON backup/import.
- **Readable responses** — streaming output, collapsible tool/thinking traces, Markdown, and KaTeX math.

## Privacy and data flow

Skilldock stores its settings, providers, API keys, skills, and conversation history in `chrome.storage.local`. It does not operate a Skilldock server or require an account.

When you send a message, the selected model provider receives the message and any context you explicitly include or have enabled (for example, page text, attachments, and page images). When global web search is enabled—and, for a custom skill, that skill also permits it—the extension queries DuckDuckGo's HTML search endpoint and may retrieve a selected public result page for the answer. Review each provider's privacy terms before using it with sensitive content.

## Install from source

1. Clone or download this repository.
2. In Chrome or another Chromium browser, open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the repository root.
5. Open the side panel from the toolbar icon, then add a provider and model in **Settings**.

After changing source files, click the extension's reload button on `chrome://extensions`.

## Get started

1. Open **Settings** and enter the API key for at least one provider. Ollama does not need a key.
2. Choose the provider and model in the side panel.
3. Ask a question. By default, Skilldock includes the readable content of the active page.
4. Type `/` to select a skill, or select text in a page to use the in-page tools.

### Ollama

The default OpenAI-compatible endpoint is `http://127.0.0.1:11434/v1`. To allow a local Ollama server to accept requests from extensions, configure its allowed origins if necessary:

```powershell
set OLLAMA_ORIGINS=*
```

Restart Ollama, then use **Fetch model list** in Settings.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `Alt+S` | Open Skilldock's side panel |
| `Alt+Q` | Toggle quick chat in the current page |
| `Enter` | Send the message |
| `Shift+Enter` | Insert a newline |

## Project structure

```text
background/   Extension service worker and tool execution
content/      Selection toolbar, quick chat, page extraction
sidepanel/    Main chat interface
settings/     Provider, skill, backup, and preference settings
viewer/       Built-in PDF viewer
print/        Printable conversation view
shared/       Storage, provider adapters, Markdown, PDF helpers
vendor/       Bundled third-party assets (KaTeX and PDF.js)
```

This is a no-build, dependency-free vanilla JavaScript extension. Third-party browser assets are vendored under `vendor/`; see their included license files for details.

## Development checks

Load the unpacked extension and exercise the affected flow in Chrome. The repository also includes focused smoke scripts in `checkpoints/` for provider request formatting. These are static checks, not a substitute for validating actual browser UI, provider credentials, or browser-action confirmation flows.

## Scope

Skilldock is independently implemented. It can be used alongside other browser assistants for comparison, but it does not include their source code, assets, branding, accounts, payment system, cloud sync, or skill marketplace.

## License

[MIT](LICENSE)
