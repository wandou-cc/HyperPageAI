# HyperPage AI

HyperPage AI is a Chrome extension for selecting a page element and acting on that exact content from an isolated floating panel or page-level shortcut.

## Features

- Select one page element with a live, layout-safe outline.
- Open the toolbox from a persistent launcher in the lower-right corner.
- Copy readable text or the selected visible region as an image.
- Temporarily hide an element and undo the change.
- Translate, explain, summarize, polish, extract text, or ask a custom question.
- Use a vision-capable model for OCR and image prompt extraction.
- Show page-level AI results in a floating window or insert them beside the source element.
- Replace editable fields with polished text and undo the replacement.
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
- Model supports images: enable only when that model accepts `image_url` input.
- Output language: choose one of the available languages; the default is `Simplified Chinese`.
- Quick action results: choose `Floating window` or `Insert in page`.

HTTP API endpoints are accepted only for `localhost` and `127.0.0.1`. Other endpoints must use HTTPS.

## Commands

```bash
npm run typecheck
npm test
npm run build
npm run zip
```

## Privacy

HyperPage AI has no application backend, analytics, advertising, or account system. Provider settings stay in the current Chrome profile. Content is sent only when the user runs an AI command or connection test. See [PRIVACY.md](./PRIVACY.md).
