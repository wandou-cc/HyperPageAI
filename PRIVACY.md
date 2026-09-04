# HyperPage AI Privacy Policy

Effective date: September 3, 2026

## English

HyperPage AI does not operate an application server and does not collect analytics, advertising identifiers, browsing history, or account information.

The Base URL, API Key, model name, image-capability setting, output language, interface language, and result display mode are stored locally in the user's Chrome profile through `chrome.storage.local`. These values are not synchronized by HyperPage AI. Local extension storage is not encrypted. Whether the floating panel is open is retained only for the current browser session.

When the user explicitly runs an AI action, HyperPage AI sends the selected element's readable text and limited element metadata directly to the configured Base URL. Actions that require visual input also send a screenshot cropped to the selected element's currently visible area. Fetching models sends an authenticated request without page content. A connection test sends a short test prompt and, when image support is enabled, the HyperPage AI icon. The API Key is included only in requests to the configured API origin.

HyperPage AI does not persist selected page content, screenshots, or AI results outside the current page session. The configured AI provider processes and retains requests under its own privacy policy and terms.

The extension has declared access to regular web pages so its selection tools and floating panel remain available when switching tabs. It cannot run on Chrome internal pages. It reads, captures, or sends page content only after the user selects content and invokes an operation. Website access can be managed in Chrome's extension settings. Removing the extension deletes its local configuration through Chrome.

## 简体中文

HyperPage AI 不运营应用服务器，也不收集分析数据、广告标识符、浏览历史或账号信息。

Base URL、API Key、模型名称、图片能力设置、输出语言、界面语言和结果展示方式通过 `chrome.storage.local` 保存在用户当前的 Chrome 配置中。HyperPage AI 不同步这些数据，扩展本地存储也不等同于加密存储。悬浮面板是否打开仅在当前浏览器会话中保留。

只有当用户主动执行 AI 操作时，HyperPage AI 才会把所选元素的可读文字和必要的元素信息直接发送到用户配置的 Base URL。需要视觉输入的操作还会发送所选元素当前可见区域的裁剪截图。获取模型时会发送不包含网页内容的认证请求。连接测试会发送简短测试提示；启用图片能力时还会发送 HyperPage AI 图标。API Key 只用于向配置的 API 源站发起请求。

HyperPage AI 不会在当前页面会话之外保存所选网页内容、截图或 AI 结果。用户配置的 AI 服务商将依据其自身隐私政策和服务条款处理及保留请求。

扩展声明访问普通网页，以便切换标签页后仍可使用元素选择和悬浮面板；Chrome 内部页面不在可运行范围内。只有用户选择内容并执行操作后，扩展才会读取、截取或发送网页内容。用户可在 Chrome 扩展设置中管理网站访问权限；卸载扩展后，Chrome 会删除扩展的本地配置。
