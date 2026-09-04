# HyperPage AI

## Short description

Ask AI, work with selected page content, or describe a task and let HyperPage operate webpages.

## Description

HyperPage AI provides a lightweight floating toolkit for the exact page element you select.

- Open the toolkit from its lower-right launcher while HyperPage is enabled.
- Drag the floating toolkit's left edge to adjust its width.
- Enable or disable all webpage integration from the extension icon's context menu.
- Select one text block, image, video frame, canvas, form field, or interface region.
- Copy its readable text or visible screenshot.
- Temporarily hide distracting elements and undo the change.
- Translate, explain, summarize, polish, and ask AI about a selected element.
- Ask general questions without selecting or sending page content, then run the same input as a page task when needed.
- Extract text from visual content with a vision-capable model.
- Show quick-action results in a floating window or insert them beside the source content.
- Replace editable text only after explicit confirmation.
- Describe a task and let AI click, type, select options, and scroll on the page.
- Follow the active target through an on-page outline, simulated pointer, and click feedback.
- Answer questions during execution; the agent is instructed to request confirmation before consequential actions.
- Optionally let a task open and control its own new tabs without accessing existing tabs.
- Select multiple page elements while composing a task; each editable reference is inserted into the task.
- See each task stage, browser action, and action result in a structured live status view.
- Save, edit, delete, and run named page workflows in one click.
- Review and manage the 20 most recent page-task execution records.
- Analyze TTFB, FCP, LCP, CLS, navigation timing, long tasks, and resource costs locally, then locate the recorded LCP element on the page.

Bring your own OpenAI-compatible Base URL, API Key, and model. Page operation requires a model with tool calling. HyperPage AI has no application backend, analytics, ads, or account requirement.

## Permission justification

- Website access: displays tools, reads user-requested page state and performance timings, performs page tasks, selects elements, and captures user-requested visible regions on regular HTTP/HTTPS pages without repeated per-tab authorization.
- `storage`: keeps provider settings, preferences, saved workflows, and the 20 most recent page-task execution records in the current Chrome profile.
- `clipboardWrite`: copies selected text, screenshots, and AI results.
- `contextMenus`: adds the enable switch to the HyperPage AI toolbar icon's context menu.
- `tabs`: opens, identifies, switches between, and closes only tabs controlled by a multi-tab page task when that setting is enabled.
