# HyperPage AI

## Short description

Ask AI, work with selected page content, or describe a task and let HyperPage operate webpages.

## Description

HyperPage AI combines a floating webpage toolkit with local PDF reading. Use your own AI service and choose the content attached to every request.

- Click the toolbar icon to activate and open HyperPage only on the current page.
- Click the toolbar icon again to close or reopen the panel, and drag the floating toolkit edges to adjust its width and height.
- Enable or disable all webpage integration from the extension icon's context menu.
- Select one text block, image, video frame, canvas, form field, or interface region.
- Copy its readable text or visible screenshot.
- Translate, explain, summarize, polish, and ask AI about a selected element.
- Hold a multi-turn conversation with history included automatically, streamed replies and cancellation. Enable web search when the assigned model passes its check, with clickable sources in the answer.
- Regenerate replies, edit and resend messages, and export results or conversations as Markdown or plain text.
- Optionally save named conversations locally; search, group by webpage, rename, delete, import and export them.
- Save multiple AI service/model configurations, assign models by task, and configure image-input and web-search capabilities. Search uses Responses `web_search`, Claude web search, or Gemini Google Search; Chat Completions configurations require a compatible Responses search endpoint.
- Open the toolkit with Alt+Shift+H, extract structured page information and identify page types from selected content.
- Inspect, export and clear saved data, view storage usage, and check or revoke website permissions.
- Attach the current page, select one or more webpage excerpts, add local text or extract YouTube subtitles from the composer. Review and remove attachments before sending.
- Import TXT and Markdown locally, select paragraphs and ask questions with file citations.
- Discover documents, images and videos in Sources. Select supported PDF, text, image or subtitle resources to preview and ask questions; local files are also supported. PDFs provide an outline and page citations. Website access restrictions apply; unsupported resources offer their original link or page location.
- Extract the first subtitle track provided for the current YouTube audio track. Switch between timestamped passages and body text for reading. Type questions about selected passages and jump to cited timestamps. The transcript panel and CC need not be enabled. Unavailable subtitles and access restrictions are reported; missing subtitles are never generated.
- Preview and select page paragraphs, summarize them, extract key points or an outline, and ask questions with clickable source citations.
- Combine explicitly selected element snapshots, with individual removal and source previews.
- Translate page paragraphs with a saved terminology table, preview the result, switch between bilingual/original/translated views, and restore the page.
- Preview and crop selected image regions for image questions, OCR, chart and interface analysis, with visible image dimensions and size before sending.
- View selected character counts and send the complete selected text within the configured AI provider's context capacity. Large subtitle and document previews show visible passages as you scroll, with the complete extracted text retained for selection, export and citations.
- Use Chat, Sources, Writing, Tools and Tasks in one panel with a shared AI composer and a direct conversation-history entry.
- Extract text from visual content with a vision-capable model.
- Show quick-action results in a floating window or insert them beside the source content.
- Draft replies, continuations, rewrites, corrections, emails and comments with tone and length controls.
- Preview differences, confirm field replacement or cursor insertion, and undo unchanged edits.
- Describe a task and let AI click, type, select options, and scroll on the page.
- Follow the active target through an on-page outline, simulated pointer, and click feedback.
- Page tasks execute directly without approval prompts, pause for missing information, and can be stopped at any time.
- Password, verification-code and payment fields identified by native semantics and standard autocomplete attributes are protected from reading and modification.
- Optionally let a task open and control its own new tabs without accessing existing tabs.
- Select multiple page elements while composing a task; each editable reference is inserted into the task.
- See each task stage, browser action, and action result in a structured live status view.
- Save, edit, delete, import and export named workflows, with template parameters and optional website scope.
- Create prompt templates with categories and variables, and arrange favorite template shortcuts.
- Review and manage the 20 most recent page-task execution records.

Select OpenAI Chat Completions, OpenAI Responses, Anthropic Claude, or Google Gemini and configure its Base URL, API Key, and model in the extension-owned settings tab. Conversation requires SSE streaming, and page operation requires tool calling. HyperPage AI has no application backend, analytics, ads, or account requirement.

## Permission justification

- `activeTab`: temporarily accesses only the current page after the user clicks the toolbar icon.
- `scripting`: injects the HyperPage interface and page controller into that explicitly activated page.
- Optional website access: requests the configured AI service host for model requests. Full HTTP/HTTPS access is requested only when the user enables multi-tab tasks, so task-created tabs can be operated.
- `storage`: keeps provider settings, preferences, saved workflows, the 20 most recent page-task execution records, and explicitly saved conversations in the current Chrome profile.
- `clipboardWrite`: copies selected text, screenshots, and AI results.
- `contextMenus`: adds the enable switch to the HyperPage AI toolbar icon's context menu.
