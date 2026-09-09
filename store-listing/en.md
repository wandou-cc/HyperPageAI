# HyperPage AI

## Short description

Read webpages, PDFs and YouTube captions, translate, write, analyze images and automate page tasks with your own AI models.

## Description

HyperPage AI is your AI workspace for the web. Turn the content you are browsing into material you can ask questions about, and put AI to work on repetitive page tasks.

Find the key points in a long article, translate a selected passage, ask questions about PDFs and video captions, draft an email in a webpage, or describe a task for AI to carry out. A floating browser toolkit brings reading, chat, translation, writing and page actions together, with less copying and switching between tools.

Connect your own AI service and assign the models you choose to conversation and reading, writing, image analysis and page operation.

### Read webpages and trace answers to the source

- Attach the current page or select several webpage excerpts to discuss. Preview sources, original text and character counts before sending; select paragraphs or remove excerpts you do not need.
- Turn long articles into summaries, key points, outlines or structured information. Select a term or passage for an explanation, translation or closer analysis.
- Follow answer citations back to the corresponding content on the current page. Page reading uses visible text that the website has already loaded.
- Browse documents, images and videos found on the page in Sources. Open supported resources for reading and questions, follow the original link or locate the resource on the page.

### Ask questions about PDFs and text files

- Open a PDF from a webpage or import a local PDF, TXT or Markdown file to read its extracted text in the browser.
- Navigate PDF outlines, select passages and ask questions with page citations. Text files support paragraph selection and cited answers, too.
- Ask AI to summarize an argument, explain a concept or extract information from the passages you select. Files are parsed locally; importing does not send them to AI. Submitting a question sends the selected extracted text and source information to your configured service.
- Supports PDFs up to 20 MB and 500 pages, and UTF-8 TXT and Markdown files up to 10 MB. PDF reading requires extractable text and does not automatically OCR scanned pages.

### Turn YouTube captions into reading material

- Extract available captions on a YouTube watch page without opening the transcript panel or enabling CC.
- Switch between timestamped passages and paragraph-style text, then select passages to discuss, summarize, translate or analyze.
- Jump from an answer's time reference to that moment in the current video. Other webpage videos can use subtitles already loaded by their player.
- YouTube extraction uses the first subtitle track available for the current audio track. Accessible captions must already exist; HyperPage does not download video or audio or generate missing subtitles.

### Translate selected content

- Translate or explain an individual selection with quick actions, showing results in a floating window or beside the source text.

### Write, refine and use the result on the page

- Draft replies, emails and comments. Continue, expand, shorten, rewrite or correct existing text, with controls for tone and target length.
- Compare the original, result and text differences before confirming a replacement in a supported field or inserting at the cursor.
- Undo an applied edit while its content remains unchanged. Copy or export answers, or insert them below a selected webpage element.

### Understand images, charts and interfaces

- Select a webpage image, current video frame, canvas or interface region. Preview and crop its visible area before analysis with a vision-capable model.
- Ask image questions, recognize text with OCR, interpret charts, analyze interfaces or describe an image as a generation prompt.
- Open supported webpage images or import local images in Sources for questions. Inspect the image before sending; the screenshot analysis tool also shows preview dimensions and file size.

### Keep asking, with conversation and web search

- Read streamed replies with completed conversation history and its attachments included automatically. Stop generation, regenerate a response or edit and resend a question.
- Enable web search when your service and model support it to bring in information beyond the page, with clickable sources returned by the provider.
- Save useful conversations, search by name or group by webpage, and reopen them to continue. Rename, delete, import or export conversation archives as JSON.
- Export an individual result or a full conversation as Markdown or plain text for notes and further editing.

### Describe a page task and let AI carry out the steps

- Ask AI to click, type, select options and scroll, for tasks such as filling ordinary forms, setting filters or gathering information through page steps. Results depend on the website and model capabilities.
- Reference several page elements while composing a task to identify its targets. Follow the active target, task stages, actions and results as execution progresses.
- Tasks run directly once started and can submit forms, send, publish or delete content as instructed, without additional step-by-step confirmation. They ask for missing information and can be stopped at any time.
- Save recurring tasks as named workflows, fill in template parameters and set allowed websites. Edit, import or export workflows, and review or manage the 20 most recent execution records.
- Optionally enable multi-tab tasks to control the starting page and tabs the task creates, without accessing other existing tabs.

### Your prompts, models and saved work

- Create prompt templates with categories and variables. Favorite frequent prompts and arrange their shortcuts. A template fills the draft so you decide when to send it.
- Save multiple service and model configurations, assign different models to different tasks, and configure image input and web search capabilities.
- Use English or Simplified Chinese menus and choose an output language. Resize the floating toolkit and toggle it with the toolbar icon or Alt+Shift+H.
- Inspect saved data and actual storage usage. Preview, export or clear data by category, and review or revoke website access.

### Privacy and website access

HyperPage AI requires no HyperPage account and has no ads, analytics or application backend receiving your requests. AI requests go directly to your configured service, which handles their content under its own policies.

Settings and saved data stay in the current Chrome profile. Conversations remain in the current page session unless you explicitly save them locally. Conversation archives and local-data previews and exports exclude API keys.

You activate the toolkit on the current page and grant access to your AI service as needed. Broad HTTP/HTTPS access is requested when you enable multi-tab tasks. Page tasks send the page text and interaction information they need to the configured service. Native password fields and password, verification-code and payment fields marked with standard autocomplete attributes cannot be read or modified; unmarked sensitive content is outside this detection scope.

### Requirements and supported content

Requires Chrome 116 or newer and your own AI service Base URL, API key and model. Supports OpenAI Chat Completions, OpenAI Responses, Anthropic Claude and Google Gemini protocols, including compatible service endpoints.

Conversation, writing and text actions require streaming responses; page tasks require tool calling; image analysis requires image input. Web search requires a supported provider endpoint. Chat Completions configurations also need a compatible Responses search endpoint, and image conversations do not support web search. Selected text must fit the model's context capacity.

Webpage tools work on accessible HTTP/HTTPS pages, excluding Chrome internal pages. Online resources remain subject to website access restrictions. Office document parsing, encrypted video parsing and missing-caption generation are unsupported, and some complex editors cannot accept direct text insertion.

## Permission justification

- `activeTab`: temporarily accesses only the current page after the user clicks the toolbar icon.
- `scripting`: injects the HyperPage interface and page controller into that explicitly activated page.
- Optional website access: requests the configured AI service host for model requests. Full HTTP/HTTPS access is requested only when the user enables multi-tab tasks, so task-created tabs can be operated.
- `storage`: keeps provider settings, preferences, prompt templates, saved workflows, the 20 most recent page-task execution records, and explicitly saved conversations in the current Chrome profile.
- `clipboardWrite`: writes selected text, screenshots and AI results only when the user requests a copy; it does not read the clipboard.
- `contextMenus`: adds the enable switch to the HyperPage AI toolbar icon's context menu.
