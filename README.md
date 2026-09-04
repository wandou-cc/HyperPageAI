# HyperPage AI

HyperPage AI is a Chrome extension for asking AI questions, working with selected page elements, and running natural-language page tasks from an isolated floating panel.

## Features

- Select one page element with a live, layout-safe outline.
- Open the toolbox from a launcher in the lower-right corner while HyperPage is enabled.
- Drag the floating toolbox's left edge to adjust its width.
- Enable or disable all webpage integration from the extension icon's context menu.
- Copy readable text or the selected visible region as an image.
- Temporarily hide an element and undo the change.
- Translate, explain, summarize, polish, extract text, or ask AI about a selected element.
- Ask general questions without selecting or sending page content, and run the same input as a page task.
- Use a vision-capable model for OCR and image prompt extraction.
- Show page-level AI results in a floating window or insert them beside the source element.
- Replace editable fields with polished text and undo the replacement.
- Describe a task and let the AI click, type, select options, and scroll on the page.
- See the element targeted by each operation through an on-page outline, simulated pointer, and click feedback.
- Answer questions during execution; the agent is instructed to ask for explicit confirmation before consequential actions.
- Optionally allow a task to open and control its own new tabs without accessing existing tabs.
- Select multiple page elements while composing a task; each editable reference is inserted at the text cursor.
- Follow each page-task stage, browser action, and action result in a structured live status view.
- Save, edit, delete, and run named page workflows without retyping the task.
- Review, expand, delete, or clear the 20 most recent page-task execution records.
- Analyze the current page's TTFB, FCP, LCP, CLS, navigation timing, long tasks, and resource costs locally, with prioritized findings and LCP element location.
- Switch between English and Simplified Chinese.

## Install locally

Requirements: Node.js 22 or newer and Chrome 116 or newer.

```bash
npm install
npm run build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `.output/chrome-mv3`.

## Configure

Open HyperPage AI from the lower-right page launcher or the toolbar icon, then enter:

- Base URL: the API root, such as `https://api.openai.com/v1`.
- API Key: the key sent directly to that API origin.
- Model: fetch the provider's model list, then select one Chat Completions-compatible model.
- Page operation requires a model that supports OpenAI-compatible tool calling.
- Page tasks can pause for missing information. The agent is instructed to ask for confirmation immediately before submitting, sending, publishing, purchasing, deleting, or other consequential actions.
- Multi-tab page tasks are disabled by default. When enabled, a task can use its starting tab and background tabs it creates; it cannot access other existing tabs or close the starting tab.
- Saved workflows keep a name and task description locally. Each run plans against the page's current DOM instead of replaying stale element indexes.
- Page-task history keeps the 20 most recent task descriptions, timestamps, statuses, final results, and visible action details locally.
- Performance analysis reads the current page session's browser timing entries on demand. Its report is neither sent to the configured model nor saved to extension storage.
- Model supports images: enable only when that model accepts `image_url` input.
- Output language: choose one of the available languages; the default is `Simplified Chinese`.
- Quick action results: choose `Floating window` or `Insert in page`.

Right-click the HyperPage AI toolbar icon and clear **Enable HyperPage on webpages** to remove the launcher, shortcuts, and page controller from every open page. Check it again to re-enable them.

HTTP API endpoints are accepted only for `localhost` and `127.0.0.1`. Other endpoints must use HTTPS.

## Commands

```bash
npm run typecheck
npm test
npm run build
npm run zip
```

## Privacy

HyperPage AI has no application backend, analytics, advertising, or account system. Provider settings stay in the current Chrome profile. Content is sent only when the user runs an AI command, starts a page task, or tests the connection. See [PRIVACY.md](./PRIVACY.md).

Page operation uses the MIT-licensed [Page Agent](https://github.com/alibaba/page-agent) engine. Its notices are included in `public/THIRD_PARTY_NOTICES.txt`.
