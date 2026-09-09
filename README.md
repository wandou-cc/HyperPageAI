# HyperPage AI

HyperPage AI is a Chrome extension for asking AI questions, working with selected page elements, and running natural-language page tasks from an isolated floating panel.

## Features

- Use the panel's Chat, Sources, Writing, Tools and Tasks workspaces with a shared AI composer. Source previews open inside the panel. Switching workspaces or closing and reopening the panel retains the current session until the webpage is reloaded or HyperPage is disabled.
- Select one page element with a live, layout-safe outline.
- Click the toolbar icon to activate and open HyperPage only in the current page; inactive pages contain no HyperPage interface or controller.
- Open or toggle the toolkit with `Alt+Shift+H` (`Option+Shift+H` on macOS); change the binding in `chrome://extensions/shortcuts`.
- Click the toolbar icon again to close or reopen the panel, and drag the floating toolbox edges to adjust its width and height.
- Enable or disable all webpage integration from the extension icon's context menu.
- Copy readable text or the selected visible region as an image.
- Translate, explain, summarize, polish, extract text, or ask AI about a selected element.
- Continue a multi-turn conversation with completed history included automatically, streamed replies and cancellation.
- Enable web search for a configured model and use the search toggle in the chat composer. Search answers include provider-returned source links. Search uses Responses `web_search`, Claude web search, or Gemini Google Search according to the selected protocol; Chat Completions configurations require a compatible Responses endpoint for search.
- Regenerate replies or edit and resend a message with its original attached content.
- Export individual results or conversations as Markdown or plain text.
- Explicitly save named conversations locally, search or group them by webpage, and rename, delete, import or export saved conversations.
- Attach the current page, select webpage excerpts, add a local text file or extract YouTube subtitles from the composer. Selecting more webpage content adds it to the same excerpt list. Review and remove attachments before sending; each new turn starts without a new attachment.
- Import UTF-8 TXT or Markdown files locally, preview and select paragraphs, and ask questions with file citations. Text files may be up to 10 MB; importing a file does not send it to AI.
- Open Sources to discover documents, images and video players on the current page, grouped by type and deduplicated. Scanning does not download files or contact AI. Select a supported resource to preview it and ask questions from the bottom composer; refresh to discover page changes. Original links and page locations remain available for unsupported resources.
- Sources reads PDF, UTF-8 TXT/Markdown, image files and already-loaded video subtitles, with local file import also available. Website access and CORS rules apply; Office parsing, encrypted video streams and missing subtitle generation are unsupported. Image questions use the assigned vision model, with images normalized to PNG locally (up to 5 MB and 16 million pixels); image conversations do not support web search.
- PDF reading provides extracted text, a document outline and questions with page citations. PDFs may be up to 20 MB and 500 pages. Passwords are used only for local opening. Sending a question includes the selected extracted text; citations navigate to the corresponding page text.
- Extract subtitles directly on a YouTube watch page. Switch between timestamped passages and body text reflowed into reading paragraphs. Type a question to request editing, translation or analysis of selected passages; citations seek to the corresponding time. Extraction uses the first subtitle track provided for the player's current audio track and does not require the transcript panel or CC to be enabled. Unavailable subtitles and access restrictions are reported. HyperPage does not download audio or generate missing subtitles.
- Preview source titles, URLs, text and total character count. Remove individual element snapshots or choose paragraphs. Selected original text is sent without truncation or automatic splitting into multiple AI requests.
- Subtitle, webpage and document previews render only visible text and nearby passages as the user scrolls. The complete extracted original remains available for selection, export and citation navigation.
- Conversation text length is governed by the configured AI provider's context capacity; provider errors are displayed. Requests retain a separate 20 MB image limit. Completed reading history includes the attached original text.
- Summarize a page, extract key points or structured information, create an outline, identify its type, or ask questions with clickable original-source citations. Changed or missing passages are reported as unavailable.
- History opens the saved-conversation list; selecting a conversation resumes it. Success and error messages appear in floating notifications without taking space in the workspace.
- Use a vision-capable model for OCR and image prompt extraction.
- Preview the selected visible region, crop it by pixel coordinates, and ask an image question or run OCR, chart analysis or interface analysis. Only the final preview is sent. Image previews display dimensions and byte size, support copying and clearing, and accept PNG data up to 5 MB and 16 million pixels.
- Screenshot capture rejects areas overlapping marked sensitive fields or embedded content, and discards captures if the source tab loses its active state.
- Show page-level AI results in a floating window or insert them beside the source element.
- Draft replies, continuations, expansions, shortened text, rewrites, corrections, emails and comments, with tone and approximate length controls.
- Preview the original, result and text differences before replacing a field or inserting at its caret. Confirmed edits can be undone while the edited content remains unchanged. Passwords, sensitive fields, readonly controls and rich editors with embedded or hidden controls are excluded.
- Insert any answer below the selected element, copy or export it, or continue discussing a result in conversation.
- Describe a task and let the AI click, type, select options, and scroll on the page.
- See the element targeted by each operation through an on-page outline, simulated pointer, and click feedback.
- Run page tasks directly without approval prompts, answer requests for missing information, and stop execution at any time.
- Protect password, verification-code and payment fields identified by native input semantics and standard autocomplete attributes.
- Optionally allow a task to open and control its own new tabs without accessing existing tabs.
- Select multiple page elements while composing a task; each editable reference is inserted at the text cursor.
- Follow each page-task stage, browser action, and action result in a structured live status view.
- Save, edit, delete, and run named page workflows without retyping the task.
- Review, expand, delete, or clear the 20 most recent page-task execution records.
- Switch between English and Simplified Chinese.
- Save multiple named service/model configurations and assign models to conversation, text, image and page-operation tasks.
- Configure image input and native web search capabilities for each model.
- View, export or clear saved settings, workflows, prompt templates, execution records and conversations, with actual Chrome storage usage. Data previews and exports exclude API keys.
- Create and categorize prompt templates, fill variables, favorite frequently used prompts and arrange their shortcuts. Using a template fills the conversation draft without sending a request or changing its selected context.
- Inspect effective provider access and granted website scopes, and revoke individual grants. Permission removal stops active AI requests and page tasks.

## Install locally

Requirements: Node.js 22.13 or newer and Chrome 116 or newer.

```bash
npm install
npm run build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `.output/chrome-mv3`.

## Configure

Click the HyperPage AI toolbar icon, then open **Settings**. Configuration opens in an extension-owned tab. Enter:

- API protocol: OpenAI Chat Completions, OpenAI Responses, Anthropic Claude, or Google Gemini.
- Base URL: the versioned API root, such as `https://api.openai.com/v1`, `https://api.anthropic.com/v1`, or `https://generativelanguage.googleapis.com/v1beta`. Custom provider addresses are supported.
- API Key: the key sent directly to that API origin.
- Configuration name: a local label for this service and model.
- Model: fetch the provider's model list, then select a model supporting the chosen protocol. Additional configurations can use the same service or different services. Claude and Gemini model lists include pagination.
- Models by task: explicitly assign configurations to conversation/reading, writing/text actions, image analysis and page operation. Deleting a configuration clears its task assignments.
- Capabilities: enable image input and web search when supported by the selected service and model. Changing the protocol clears capability selections. Protocols and models are not switched after a failed request.
- Conversation requires SSE streaming in the selected protocol. Interrupted, filtered and output-limited responses produce explicit errors.
- Page operation requires tool calling in the selected protocol. Native tool results and required reasoning metadata are retained in task memory for subsequent model turns.
- Page tasks execute actions directly and pause only for missing information. They can submit, send, publish, purchase or delete as part of the requested task without separate approval.
- Multi-tab page tasks are disabled by default. When enabled, a task can use its starting tab and background tabs it creates; it cannot access other existing tabs or close the starting tab.
- Chrome asks for access only to the configured AI service. Enabling multi-tab tasks separately requests optional HTTP/HTTPS website access so task-created tabs can be operated.
- Saved workflows keep a name, task template and optional allowed website origins locally. Variables such as `{{product}}` become required input fields before execution. JSON import/export preserves templates and website scope; imports receive new IDs and do not run automatically. Each run plans against the current DOM.
- Page-task scope accepts exact HTTP/HTTPS origins, one per line. When a scope is set, HyperPage checks it before reading or operating a page, following navigation, and opening task tabs. The scope is not a network filter for the website's own requests or scripts.
- Page-task element mutations use attribute and CSS-property allowlists. Script attributes, resource URLs and arbitrary CSS properties are excluded. All requested mutations are checked before applying a batch.
- Page-task history keeps the 20 most recent task descriptions, timestamps, statuses, final results, and visible action details locally.
- Conversations stay in the current page session unless explicitly saved. Saved conversations include prompts, replies, attached content snapshots, search mode, timestamps and webpage metadata. Clearing the current session does not delete saved conversations. JSON imports and exports contain conversation data, without provider settings or API keys. Completed earlier turns are automatically included in the next request.
- PDF, text-file, image and video-subtitle snapshots follow the same explicit-saving rule. Saved image conversations include normalized PNG attachments. Original PDF bytes, passwords and rendered PDF pages are not saved in conversations. PDF citations locate the current unchanged document snapshot; citations from reopened archives may be unavailable.
- Page reading includes currently loaded, visible text outside the viewport, excludes form values and editable areas, and does not load more content or read embedded frames. Refresh page content explicitly to capture changes. Navigation invalidates existing reading snapshots.
- Image actions require the assigned image model's image-input capability to be available.
- Output language: choose one of the available languages; the default is `Simplified Chinese`.
- Quick action results: choose `Floating window` or `Insert in page`.
- Local data: inspect saved data by category, export JSON, or confirm deletion. Clearing saved data does not clear live conversation memory or revoke Chrome website permissions.
- Clipboard writing retains the `clipboardWrite` permission for explicit copy commands, including copies that finish after asynchronous work. It never reads the clipboard. Clipboard APIs require a secure context; unsupported pages show an error, and text export remains available.
- Website permissions: inspect and revoke granted scopes. A broad HTTP/HTTPS grant may still cover a provider after its individual grant is removed; the displayed provider status reflects effective Chrome access.

Right-click the HyperPage AI toolbar icon and clear **Enable HyperPage on webpages** to remove HyperPage from activated pages. After enabling it again, click the toolbar icon on each page where you want to use it.

HTTP API endpoints are accepted only for `localhost` and `127.0.0.1`. Other endpoints must use HTTPS.

## Commands

```bash
npm run typecheck
npm test
npm run build
npm run zip
```

## Privacy

HyperPage AI has no application backend, analytics, advertising, or account system. Provider settings stay in the current Chrome profile. AI requests require an explicit command, page task or capability check. See [PRIVACY.md](./PRIVACY.md).

Page operation uses the MIT-licensed [Page Agent](https://github.com/alibaba/page-agent) engine. Third-party license notices are included in `public/THIRD_PARTY_NOTICES.txt`.
