# HyperPage AI Privacy Policy

Effective date: September 4, 2026

## English

HyperPage AI does not operate an application server and does not collect analytics, advertising identifiers, browsing history, or account information.

The extension enable state, Base URL, API Key, model name, image-capability setting, output language, interface language, result display mode, multi-tab task preference, user-saved workflow names and task descriptions, and the 20 most recent page-task execution records are stored locally in the user's Chrome profile through `chrome.storage.local`. Element references inserted while composing a page task become editable parts of that task description. Each execution record contains the task description, start and finish times, final status and result, and visible action descriptions and outputs. Action descriptions can include text entered into a page, an option selected by the task, a question asked during execution, or the URL of a tab opened by the task. HyperPage does not add a user's reply as the question action's stored output; the provider-generated final result may reflect information from that reply. These values are not synchronized by HyperPage AI. Local extension storage is not encrypted. Whether the floating panel is open is retained only for the current browser session.

When the user explicitly runs an AI action with an element selected, HyperPage AI sends that element's readable text and limited element metadata directly to the configured Base URL. Actions that require visual input also send a screenshot cropped to the selected element's currently visible area. When the user asks a custom question without selecting an element, HyperPage AI sends only the question entered by the user and does not send page content or a screenshot.

When the user explicitly starts a page task, including a saved workflow, HyperPage AI sends the task description and repeatedly sends a simplified text representation of the current task-controlled page to the configured Base URL. That representation includes visible page text, interactive-element metadata, and form state that the page exposes to the DOM. Questions generated during execution and the user's answers are also sent to the configured provider as part of that task. The provider returns structured actions that HyperPage AI uses to click, enter text, select options, scroll, or, when the multi-tab preference is enabled, open and control task-owned tabs. Page tasks do not send screenshots and cannot execute model-generated JavaScript.

When the user starts a performance analysis, HyperPage AI reads the current page session's browser performance timeline, including navigation timings, rendering metrics, long-task measurements, and resource URLs, durations, and browser-exposed transfer sizes. This report is processed in the current tab and is not sent to the configured AI provider or saved to extension storage. Some cross-origin resource sizes may be unavailable because of the website's timing policy.

Fetching models sends an authenticated request without page content. A connection test sends a short test prompt and, when image support is enabled, the HyperPage AI icon. The API Key is included only in requests to the configured API origin.

HyperPage AI does not independently persist selected content, page-task DOM representations, screenshots, or quick-action AI results outside the current page session. An element label inserted into a page task is persisted only as part of a workflow the user saves or an execution record created when the user runs that task. Page-task execution records can be deleted individually or cleared from the execution-history view. The configured AI provider processes and retains requests under its own privacy policy and terms.

The extension has declared access to regular web pages so its selection tools, page operations, and floating panel remain available when switching tabs while HyperPage is enabled. It cannot run on Chrome internal pages. The `tabs` permission supports the optional multi-tab task setting. HyperPage does not enumerate existing tabs for page tasks: it controls only the tab where the task started and tabs created by that task, and it never closes the starting tab. It reads, captures, or sends page content only after the user invokes an AI action or starts a page task. Disabling HyperPage from the extension icon's context menu removes its page interface and controller. Website access can also be managed in Chrome's extension settings. Removing the extension deletes its local configuration through Chrome.

## 简体中文

HyperPage AI 不运营应用服务器，也不收集分析数据、广告标识符、浏览历史或账号信息。

插件启用状态、Base URL、API Key、模型名称、图片能力设置、输出语言、界面语言、结果展示方式、多标签页任务开关、用户保存的流程名称和任务描述，以及最近 20 条页面任务执行记录，通过 `chrome.storage.local` 保存在用户当前的 Chrome 配置中。编写页面任务时插入的元素引用会成为可编辑任务描述的一部分。每条执行记录包含任务描述、开始和结束时间、最终状态与结果，以及界面可见的动作说明和动作结果；动作说明可能包含任务向网页输入的文字、选择的选项、执行中提出的问题，或任务打开的标签页 URL。HyperPage 不会把用户回复直接写入该提问动作的存储结果；AI 服务生成的最终结果仍可能体现回复中的信息。HyperPage AI 不同步这些数据，扩展本地存储也不等同于加密存储。悬浮面板是否打开仅在当前浏览器会话中保留。

当用户选中元素并主动执行 AI 操作时，HyperPage AI 会把该元素的可读文字和必要的元素信息直接发送到用户配置的 Base URL。需要视觉输入的操作还会发送所选元素当前可见区域的裁剪截图。当用户未选择元素并进行自定义问答时，HyperPage AI 只发送用户输入的问题，不发送网页内容或截图。

只有当用户主动启动页面任务（包括点击执行已保存的固定流程）时，HyperPage AI 才会把任务描述和当前任务所控页面的简化文本表示逐步发送到用户配置的 Base URL。该内容包括可见网页文字、可交互元素信息，以及页面通过 DOM 暴露的表单状态。执行中由模型生成的问题和用户回答也会作为该任务的一部分发送给配置的 AI 服务。AI 服务返回结构化操作，HyperPage AI 会据此执行点击、输入、选择、滚动；启用多标签页任务后，还可以打开并操作任务自己创建的标签页。页面任务不会发送截图，也不允许执行模型生成的 JavaScript。

只有当用户主动开始性能分析时，HyperPage AI 才会读取当前页面会话的浏览器性能时间线，包括导航时间、渲染指标、长任务测量，以及资源 URL、耗时和浏览器可见的传输体积。该报告仅在当前标签页中处理，不会发送给配置的 AI 服务，也不会写入扩展存储。受站点跨域计时策略限制，部分跨域资源体积可能无法获取。

获取模型时会发送不包含网页内容的认证请求。连接测试会发送简短测试提示；启用图片能力时还会发送 HyperPage AI 图标。API Key 只用于向配置的 API 源站发起请求。

HyperPage AI 不会在当前页面会话之外单独保存所选内容、页面任务 DOM 表示、截图或快捷 AI 操作结果。元素标签仅在用户保存流程或执行任务时，作为任务描述的一部分保存在固定流程或执行记录中。页面任务执行记录可在执行记录界面中逐条删除或全部清空。用户配置的 AI 服务商将依据其自身隐私政策和服务条款处理及保留请求。

扩展声明访问普通网页，以便启用 HyperPage 时切换标签页后仍可使用元素选择、页面操作和悬浮面板；Chrome 内部页面不在可运行范围内。`tabs` 权限用于可选的多标签页任务。HyperPage 不会为页面任务枚举用户已有标签页，仅控制任务发起页和本次任务创建的标签页，也不会关闭任务发起页。只有用户主动执行 AI 操作或启动页面任务后，扩展才会读取、截取或发送网页内容。从扩展图标的右键菜单停用 HyperPage 后，网页界面和页面控制器都会移除。用户也可在 Chrome 扩展设置中管理网站访问权限；卸载扩展后，Chrome 会删除扩展的本地配置。
