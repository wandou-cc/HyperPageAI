import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockSourceTextLayout } from "./source-text-layout";

import { TooltipProvider } from "../components/ui/tooltip";
import { App } from "../entrypoints/sidepanel/App";
import type { BackgroundRequest, PageState } from "../shared/messages";
import { parseStoredSettings } from "../shared/settings";
import { buildTurnContent, CONVERSATION_STORAGE_PREFIX } from "../shared/conversations";
import * as textExport from "../shared/export";

const EMPTY_PAGE_STATE = {
  selection: null,
  selectionRevision: 0,
  canUndoReplace: false,
  canRemoveInsertion: false,
  selecting: false,
};

const browserMock = vi.hoisted(() => ({
  i18n: {
    getUILanguage: vi.fn(() => "zh-CN"),
  },
  runtime: {
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    sendMessage: vi.fn(),
    getURL: vi.fn((path: string) => `chrome-extension://test${path}`),
  },
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
}));

vi.mock("wxt/browser", () => ({ browser: browserMock }));

async function openTools(): Promise<void> {
  fireEvent.click(await screen.findByRole("tab", { name: "工具" }));
}

async function chooseAttachment(name: string): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "添加资料" }));
  fireEvent.click(await screen.findByRole("menuitem", { name }));
}

async function finishContextSelection(state: PageState): Promise<void> {
  await waitFor(() => expect(document.querySelector("#hyperpage-tool-panel")).not.toBeVisible());
  const listener = browserMock.runtime.onMessage.addListener.mock.calls.at(-1)?.[0];
  if (!listener) throw new Error("Missing page state listener");
  await act(async () => listener({ target: "panel", type: "page-state-changed", state: { ...state, selecting: false } }));
}

// Creates pointer events with the fields React reads in the JSDOM test runtime.
function createPointerEvent(
  type: string,
  pointerId: number,
  clientX: number,
  clientY: number,
): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX,
    clientY,
  });
  Object.defineProperties(event, {
    isPrimary: { value: true },
    pointerId: { value: pointerId },
  });
  return event;
}

// Supplies the pointer-capture methods used by draggable DOM elements.
function mockPointerCapture(element: HTMLElement): void {
  let captured = false;
  Object.defineProperties(element, {
    hasPointerCapture: {
      configurable: true,
      value: vi.fn(() => captured),
    },
    releasePointerCapture: {
      configurable: true,
      value: vi.fn(() => {
        captured = false;
      }),
    },
    setPointerCapture: {
      configurable: true,
      value: vi.fn(() => {
        captured = true;
      }),
    },
  });
}

let restoreSourceLayout: () => void;
beforeEach(() => { restoreSourceLayout = mockSourceTextLayout(); });
afterEach(() => {
  cleanup();
  restoreSourceLayout();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("floating panel page binding", () => {
  it("shows extracted subtitle originals without preparing or sending an AI question", async () => {
    browserMock.storage.local.get.mockResolvedValue({ "hyperpage.settings": parseStoredSettings({
      version: 4, enabled: true, locale: "zh_CN", resultDisplayMode: "floating", allowMultiTab: false,
      provider: { baseUrl: "https://api.example.com/v1", apiKey: "secret", model: "model", supportsVision: false, targetLanguage: "简体中文" },
    }) });
    browserMock.runtime.sendMessage.mockImplementation(async (message: BackgroundRequest) => {
      if (message.type === "reading-command") return { ok: true, data: { id: "video", title: "Lecture", url: "https://www.youtube.com/watch?v=ToK8L3b-aCA", videoId: "ToK8L3b-aCA", blocks: [
        { id: "1.1", text: "Original subtitle", heading: "00:10", headingLevel: null, timeSeconds: 10 },
      ] } };
      if (message.type === "run-chat") return { ok: true, data: { content: "Answer", selectionRevision: null, citations: [] } };
      return { ok: true, data: EMPTY_PAGE_STATE };
    });
    render(<TooltipProvider><App initialOpen /></TooltipProvider>);
    await chooseAttachment("视频字幕");
    expect(await screen.findByText("Original subtitle")).toBeVisible();
    expect(screen.getByText("00:10")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "正文" }));
    expect(screen.queryByText("00:10")).toBeNull();
    expect(screen.getByText("Original subtitle")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "询问 AI" })).toHaveValue("");
    expect(screen.queryByRole("button", { name: /视频总结|整理章节/ })).toBeNull();
    expect(browserMock.runtime.sendMessage.mock.calls.some(([message]) => message.type === "run-chat")).toBe(false);
    fireEvent.change(screen.getByRole("textbox", { name: "询问 AI" }), { target: { value: "Translate this" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await screen.findByText("Answer");
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "run-chat", request: expect.objectContaining({ prompt: "Translate this", context: "video", pageSelection: { snapshotId: "video", blockIds: ["1.1"] } }) }));
  });

  it("enables web search only after the assigned model passes its check and preserves search on replay", async () => {
    const settings = parseStoredSettings({ version: 4, enabled: true, locale: "zh_CN", resultDisplayMode: "floating", allowMultiTab: false,
      provider: { baseUrl: "https://api.example.com/v1", apiKey: "secret", model: "model", supportsVision: false, targetLanguage: "简体中文" },
    });
    browserMock.storage.local.get.mockResolvedValue({ "hyperpage.settings": settings });
    browserMock.runtime.sendMessage.mockImplementation(async (request: BackgroundRequest) => request.type === "run-chat" || request.type === "replay-chat"
      ? { ok: true, data: { content: "Web answer [1](https://example.com)", userContent: request.request.prompt, selectionRevision: null, citations: [] } }
      : { ok: true, data: EMPTY_PAGE_STATE });
    render(<TooltipProvider><App initialOpen /></TooltipProvider>);
    const toggle = await screen.findByRole("switch", { name: "联网搜索" });
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    const provider = settings.providers[0];
    if (!provider) throw new Error("Missing test provider");
    provider.config.capabilities.webSearch = { status: "supported", checkedAt: 100 };
    const update = browserMock.storage.onChanged.addListener.mock.calls.at(-1)?.[0];
    if (!update) throw new Error("Missing settings listener");
    await act(async () => update({ "hyperpage.settings": { newValue: settings } }, "local"));
    await waitFor(() => expect(toggle).not.toHaveAttribute("aria-disabled", "true"));
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    fireEvent.change(screen.getByRole("textbox", { name: "询问 AI" }), { target: { value: "Current information" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    expect(await screen.findByRole("link", { name: "1" })).toHaveAttribute("href", "https://example.com");
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "run-chat", request: expect.objectContaining({ webSearch: true, includeHistory: true }) }));
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "重新生成回复" }));
    await waitFor(() => expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "replay-chat", request: expect.objectContaining({ webSearch: true, includeHistory: true }) })));
  });

  it("provides five workspaces and retains the PDF frame across navigation and closing", async () => {
    browserMock.storage.local.get.mockResolvedValue({ "hyperpage.settings": parseStoredSettings({
      version: 4, enabled: true, locale: "zh_CN", resultDisplayMode: "floating", allowMultiTab: false,
      provider: { baseUrl: "https://api.example.com/v1", apiKey: "secret", model: "model", supportsVision: false, targetLanguage: "简体中文" },
    }) });
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: true, data: EMPTY_PAGE_STATE });
    render(<TooltipProvider><App initialOpen /></TooltipProvider>);
    const input = await screen.findByRole("textbox", { name: "询问 AI" });
    fireEvent.change(input, { target: { value: "Unsent question" } });
    expect(screen.queryByRole("button", { name: "不带网页" })).toBeNull();
    expect(document.querySelector("[data-selected-element-summary]")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["对话", "资料", "写作", "工具", "任务"]);
    fireEvent.click(screen.getByRole("tab", { name: "资料" }));
    const documents = screen.getByTitle("资料");
    expect(documents).toHaveAttribute("src", "chrome-extension://test/documents.html");
    fireEvent.click(screen.getByRole("tab", { name: "对话" }));
    expect(documents).not.toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "资料" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭 HyperPage AI" }));
    expect(documents).not.toBeVisible();
    const listener = browserMock.runtime.onMessage.addListener.mock.calls.at(-1)?.[0];
    if (!listener) throw new Error("Missing panel listener");
    act(() => listener({ target: "panel", type: "toggle-panel" }));
    expect(screen.getByTitle("资料")).toBe(documents);
    expect(documents).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "对话" }));
    expect(screen.getByRole("textbox", { name: "询问 AI" })).toHaveValue("Unsent question");
    expect(browserMock.runtime.sendMessage.mock.calls.some(([message]) => message.type === "open-documents")).toBe(false);

    fireEvent.click(screen.getByRole("tab", { name: "写作" }));
    fireEvent.change(screen.getByRole("textbox", { name: "写作要求" }), { target: { value: "Writing draft" } });
    fireEvent.click(screen.getByRole("tab", { name: "工具" }));
    fireEvent.change(screen.getByRole("textbox", { name: "询问 AI" }), { target: { value: "Tool draft" } });
    fireEvent.click(screen.getByRole("tab", { name: "任务" }));
    fireEvent.change(screen.getByRole("textbox", { name: "页面任务" }), { target: { value: "Task draft" } });
    fireEvent.click(screen.getByRole("tab", { name: "对话" }));
    expect(screen.getByRole("textbox", { name: "询问 AI" })).toHaveValue("Unsent question");
    fireEvent.click(screen.getByRole("tab", { name: "写作" }));
    expect(screen.getByRole("textbox", { name: "写作要求" })).toHaveValue("Writing draft");
    fireEvent.click(screen.getByRole("tab", { name: "工具" }));
    expect(screen.getByRole("textbox", { name: "询问 AI" })).toHaveValue("Tool draft");
    fireEvent.click(screen.getByRole("tab", { name: "任务" }));
    expect(screen.getByRole("textbox", { name: "页面任务" })).toHaveValue("Task draft");
  });

  it("opens the saved conversation list directly from History and resumes a named record", async () => {
    const record = { version: 1, id: crypto.randomUUID(), name: "Reading notes", title: "Article", url: "https://example.com/article", createdAt: 1, updatedAt: 2,
      turns: [{ id: "turn", prompt: "Saved question", answer: "Saved answer", status: "complete", includeHistory: true, snapshot: { type: "none" } }],
    };
    browserMock.storage.local.get.mockResolvedValue({
      "hyperpage.settings": parseStoredSettings({ version: 4, enabled: true, locale: "zh_CN", resultDisplayMode: "floating", allowMultiTab: false,
        provider: { baseUrl: "https://api.example.com/v1", apiKey: "secret", model: "model", supportsVision: false, targetLanguage: "简体中文" },
      }),
      [`${CONVERSATION_STORAGE_PREFIX}${record.id}`]: record,
    });
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: true, data: EMPTY_PAGE_STATE });
    render(<TooltipProvider><App initialOpen /></TooltipProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "历史记录" }));
    const saved = await screen.findByRole("button", { name: "Reading notes" });
    expect(screen.queryByRole("textbox", { name: "询问 AI" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "对话名称" })).toBeNull();
    fireEvent.click(saved);
    expect(await screen.findByText("Saved answer")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "询问 AI" })).toHaveValue("");
    expect(browserMock.storage.local.set).not.toHaveBeenCalled();
  });

  it("loads state directly from the content script's own tab", async () => {
    browserMock.storage.local.get.mockResolvedValue({
      "hyperpage.settings": {
        version: 3,
        enabled: true,
        locale: "zh_CN",
        provider: {
          baseUrl: "https://api.example.com/v1",
          apiKey: "secret",
          model: "gpt-4.1-mini",
          supportsVision: true,
          targetLanguage: "简体中文",
        },
        resultDisplayMode: "floating",
      },
    });
    browserMock.runtime.sendMessage.mockResolvedValue({
      ok: true,
      data: EMPTY_PAGE_STATE,
    });

    render(
      <TooltipProvider>
        <App initialOpen />
      </TooltipProvider>,
    );

    await openTools();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "选择元素" })).toBeEnabled();
    });
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({
      target: "background",
      type: "page-command",
      command: { type: "get-page-state" },
    });

    browserMock.runtime.sendMessage.mockResolvedValue({
      ok: true,
      data: { ...EMPTY_PAGE_STATE, selecting: true },
    });
    screen.getByRole("button", { name: "选择元素" }).click();

    await waitFor(() => {
      expect(
        document.querySelector("#hyperpage-tool-panel"),
      ).not.toBeVisible();
    });

    browserMock.runtime.sendMessage.mockResolvedValue({
      ok: true,
      data: EMPTY_PAGE_STATE,
    });
    const handlePanelEvent =
      browserMock.runtime.onMessage.addListener.mock.calls.at(-1)?.[0];
    if (!handlePanelEvent) {
      throw new Error("Panel listener was not registered");
    }
    handlePanelEvent({ target: "panel", type: "toggle-panel" });

    await waitFor(() => {
      expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({
        target: "background",
        type: "page-command",
        command: { type: "cancel-selection" },
      });
      expect(screen.getByRole("button", { name: "选择元素" })).toBeVisible();
    });
  });

  it("uses toolbar messages as the only page-panel entry", async () => {
    browserMock.storage.local.get.mockResolvedValue({
      "hyperpage.settings": {
        version: 3,
        enabled: true,
        locale: "zh_CN",
        provider: null,
        resultDisplayMode: "floating",
      },
    });
    browserMock.runtime.sendMessage.mockResolvedValue({
      ok: true,
      data: EMPTY_PAGE_STATE,
    });

    render(
      <TooltipProvider>
        <App initialOpen={false} />
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(browserMock.runtime.onMessage.addListener).toHaveBeenCalled();
    });
    expect(document.querySelector(".hp-launcher")).not.toBeInTheDocument();
    expect(
      document.querySelector("#hyperpage-tool-panel"),
    ).not.toBeVisible();

    const handlePanelEvent =
      browserMock.runtime.onMessage.addListener.mock.calls.at(-1)?.[0];
    if (!handlePanelEvent) {
      throw new Error("Panel listener was not registered");
    }
    handlePanelEvent({ target: "panel", type: "toggle-panel" });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "打开设置" })).toBeVisible();
    });
    const panel = document.querySelector("#hyperpage-tool-panel");
    expect(panel).toHaveClass("bottom-4");
    expect(panel).not.toHaveClass("bottom-[86px]");
    expect(document.querySelector(".hp-launcher")).not.toBeInTheDocument();

    handlePanelEvent({ target: "panel", type: "toggle-panel" });
    await waitFor(() => {
      expect(
        document.querySelector("#hyperpage-tool-panel"),
      ).not.toBeVisible();
    });
  });

  it("opens extension settings without credential inputs and updates after configuration is saved", async () => {
    browserMock.storage.local.get.mockResolvedValue({});
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: true, data: EMPTY_PAGE_STATE });
    render(<TooltipProvider><App initialOpen /></TooltipProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "打开设置" }));
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({ target: "background", type: "open-settings" });
    expect(screen.queryByLabelText("API Key")).toBeNull();
    const settings = parseStoredSettings({
      locale: "zh_CN",
      provider: { baseUrl: "https://api.example.com/v1", apiKey: "secret", model: "model", supportsVision: false, targetLanguage: "English" },
    });
    browserMock.storage.local.get.mockResolvedValue({ "hyperpage.settings": settings });
    const listener = browserMock.storage.onChanged.addListener.mock.calls.at(-1)?.[0];
    if (!listener) throw new Error("Storage listener was not registered");
    await act(async () => listener({ "hyperpage.settings": { newValue: settings } }, "local"));
    await openTools();
    expect(await screen.findByRole("button", { name: "选择元素" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.queryByLabelText("API Key")).toBeNull();
  });

  it("copies selected text and reveals its complete content", async () => {
    const selectionText = `${"Complete selected content. ".repeat(24)}End.`;
    const selectedPageState = {
      ...EMPTY_PAGE_STATE,
      selectionRevision: 1,
      selection: {
        kind: "text" as const,
        tagName: "p",
        text: selectionText,
        accessibleName: "",
        role: "",
        editable: false,
        rect: { x: 20, y: 30, width: 320, height: 120 },
        viewport: { width: 1280, height: 800 },
      },
    };
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    browserMock.storage.local.get.mockResolvedValue({
      "hyperpage.settings": {
        version: 3,
        enabled: true,
        locale: "zh_CN",
        provider: {
          baseUrl: "https://api.example.com/v1",
          apiKey: "secret",
          model: "gpt-4.1-mini",
          supportsVision: true,
          targetLanguage: "简体中文",
        },
        resultDisplayMode: "floating",
      },
    });
    browserMock.runtime.sendMessage.mockResolvedValue({
      ok: true,
      data: selectedPageState,
    });

    render(
      <TooltipProvider>
        <App initialOpen />
      </TooltipProvider>,
    );

    await openTools();
    const expandButton = await screen.findByRole("button", {
      name: "查看全部内容",
    });
    const content = document.querySelector<HTMLElement>(
      "#hyperpage-selection-content",
    );
    if (!content) throw new Error("Selected content was not rendered");
    expect(content).toHaveTextContent(selectionText);
    expect(content).toHaveClass("line-clamp-3");

    screen.getByRole("button", { name: "复制文字" }).click();
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(selectionText));

    fireEvent.click(expandButton);
    await waitFor(() => {
      expect(content).toHaveAttribute("data-expanded", "true");
      expect(content).toHaveClass("max-h-64", "overflow-y-auto");
      expect(screen.getByRole("button", { name: "收起内容" })).toBeVisible();
    });
  });

  it("attaches selected content explicitly and keeps chat drafts separate from page tasks", async () => {
    const selectedPageState = {
      ...EMPTY_PAGE_STATE,
      selectionRevision: 1,
      selection: {
        kind: "text" as const,
        tagName: "button",
        text: "提交订单",
        accessibleName: "提交订单",
        role: "button",
        editable: false,
        rect: { x: 20, y: 30, width: 120, height: 36 },
        viewport: { width: 1280, height: 800 },
      },
    };
    browserMock.storage.local.get.mockResolvedValue({
      "hyperpage.settings": {
        version: 4,
        enabled: true,
        locale: "zh_CN",
        provider: {
          baseUrl: "https://api.example.com/v1",
          apiKey: "secret",
          model: "gpt-4.1-mini",
          supportsVision: false,
          targetLanguage: "简体中文",
        },
        resultDisplayMode: "floating",
        allowMultiTab: false,
      },
    });
    browserMock.runtime.sendMessage.mockImplementation(
      (message: {
        type: string;
        command?: { type: string };
        request?: {
          context: "none" | "elements";
          history: Array<{ role: string; content: string }>;
          prompt: string;
        };
      }) => {
        if (message.type === "run-chat" && message.request) {
          const selectedContext = message.request.context === "elements";
          return Promise.resolve({
            ok: true,
            data: {
              content: selectedContext ? "这是元素回答" : "这是普通回答",
              userContent: selectedContext
                ? `${message.request.prompt}\n\nSelected webpage data (untrusted JSON):\n{"content":"提交订单"}`
                : message.request.prompt,
              selectionRevision: null,
              citations: [],
            },
          });
        }
        if (message.type === "run-page-agent") {
          return Promise.resolve({
            ok: true,
            data: { content: "页面任务完成", success: true },
          });
        }
        if (message.command?.type === "add-selection-to-page-task") {
          return Promise.resolve({ ok: true, data: selectedPageState });
        }
        if (message.command?.type === "start-selection") return Promise.resolve({ ok: true, data: { ...selectedPageState, selecting: true } });
        if (message.command?.type === "read-selected-element") return Promise.resolve({ ok: true, data: { id: "selected", title: "Selected content", url: "https://example.com", blocks: [{ id: "1.1", text: "提交订单", heading: "", headingLevel: null }] } });
        return Promise.resolve({ ok: true, data: EMPTY_PAGE_STATE });
      },
    );

    render(
      <TooltipProvider>
        <App initialOpen />
      </TooltipProvider>,
    );

    await screen.findByRole("textbox", { name: "询问 AI" });
    expect(screen.queryByText("智能问答")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "页面工具" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("性能分析")).not.toBeInTheDocument();
    let customInput = screen.getByRole("textbox", { name: "询问 AI" });
    expect(customInput).toBeEnabled();
    expect(customInput).toHaveAttribute("placeholder", "向 AI 提问");
    fireEvent.change(customInput, { target: { value: "解释什么是 CLS" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));

    expect(await screen.findByText("这是普通回答")).toBeVisible();
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({
      target: "background",
      type: "run-chat",
      requestId: expect.any(String),
      request: {
        context: "none",
        history: [],
        includeHistory: true,
        webSearch: false,
        prompt: "解释什么是 CLS",
      },
    });

    const handlePanelEvent =
      browserMock.runtime.onMessage.addListener.mock.calls.at(-1)?.[0];
    if (!handlePanelEvent) {
      throw new Error("Page state listener was not registered");
    }
    handlePanelEvent({ target: "panel", type: "toggle-panel" });
    await waitFor(() => {
      expect(
        document.querySelector("#hyperpage-tool-panel"),
      ).not.toBeVisible();
    });
    handlePanelEvent({ target: "panel", type: "toggle-panel" });
    expect(await screen.findByText("这是普通回答")).toBeVisible();
    customInput = screen.getByRole("textbox", { name: "询问 AI" });

    handlePanelEvent({
      target: "panel",
      type: "page-state-changed",
      state: selectedPageState,
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "移除资料" })).toBeNull();
      expect(customInput).toHaveAttribute("placeholder", "向 AI 提问");
      expect(screen.getByText("这是普通回答")).toBeVisible();
    });

    await chooseAttachment("选择网页内容");
    await finishContextSelection({ ...selectedPageState, selectionRevision: 2 });
    expect(await screen.findByText(/Selected content/)).toBeVisible();
    fireEvent.change(customInput, { target: { value: "解释这段内容" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    expect(await screen.findByText("这是元素回答")).toBeVisible();
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({
      target: "background",
      type: "run-chat",
      requestId: expect.any(String),
      request: {
        context: "elements",
        includeHistory: true,
        webSearch: false,
        elementSelections: [{ snapshotId: "selected", blockIds: ["1.1"] }],
        history: [
          { role: "user", content: "解释什么是 CLS" },
          { role: "assistant", content: "这是普通回答" },
        ],
        prompt: "解释这段内容",
      },
    });

    fireEvent.change(customInput, { target: { value: "解释什么是 CLS" } });
    expect(screen.queryByRole("button", { name: "执行页面任务" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "任务" }));
    const pageTaskInput = await screen.findByRole("textbox", {
      name: "页面任务",
    });
    expect(pageTaskInput).toHaveValue("");
    expect(screen.getByRole("tab", { name: "任务" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      document.querySelector("[data-selected-element-summary]"),
    ).not.toBeInTheDocument();
    expect(browserMock.runtime.sendMessage.mock.calls.some(([message]) => message.type === "run-page-agent")).toBe(false);
    fireEvent.change(pageTaskInput, { target: { value: "提交订单" } });
    fireEvent.click(screen.getByRole("button", { name: "执行" }));
    await waitFor(() => {
      expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({
        target: "background",
        type: "run-page-agent",
        requestId: expect.any(String),
        task: "提交订单",
      });
    });
    fireEvent.click(screen.getByRole("tab", { name: "对话" }));
    expect(screen.getByRole("textbox", { name: "询问 AI" })).toHaveValue("解释什么是 CLS");
  });

  it("regenerates and edits a saved turn using its original snapshot and preceding history", async () => {
    browserMock.storage.local.get.mockResolvedValue({ "hyperpage.settings": parseStoredSettings({
      version: 4, enabled: true, locale: "zh_CN", resultDisplayMode: "floating", allowMultiTab: false,
      provider: { baseUrl: "https://api.example.com/v1", apiKey: "secret", model: "model", supportsVision: false, targetLanguage: "简体中文" },
    }) });
    const selected: PageState = { ...EMPTY_PAGE_STATE, selectionRevision: 1, selection: { kind: "text", tagName: "p", text: "Original page text", accessibleName: "", role: "", editable: false, rect: { x: 0, y: 0, width: 200, height: 30 }, viewport: { width: 1024, height: 768 } } };
    const page = { id: "original", title: "Original page", url: "https://example.com", blocks: [{ id: "1.1", text: "Original page text", heading: "", headingLevel: null }] };
    let responseCount = 0;
    browserMock.runtime.sendMessage.mockImplementation((message: BackgroundRequest) => {
      if (message.type === "run-chat" || message.type === "replay-chat") return Promise.resolve({ ok: true, data: { content: `Response ${++responseCount}`, userContent: message.request.prompt, selectionRevision: null, citations: [] } });
      if (message.type === "page-command" && message.command.type === "start-selection") return Promise.resolve({ ok: true, data: { ...selected, selecting: true } });
      if (message.type === "reading-command") return Promise.resolve({ ok: true, data: page });
      return Promise.resolve({ ok: true, data: selected });
    });
    render(<TooltipProvider><App initialOpen /></TooltipProvider>);
    await chooseAttachment("选择网页内容");
    await finishContextSelection({ ...selected, selectionRevision: 2 });
    await screen.findByText(/Original page \(/);
    const input = screen.getByRole("textbox", { name: "询问 AI" });
    fireEvent.change(input, { target: { value: "First question" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    expect(await screen.findByText("Response 1")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重新生成回复" }));
    expect(await screen.findByText("Response 2")).toBeVisible();
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "replay-chat", request: { prompt: "First question", includeHistory: true, webSearch: false, history: [], snapshot: { type: "elements", pages: [page] } } }));
    expect(screen.queryByRole("button", { name: "移除资料" })).toBeNull();
    fireEvent.change(input, { target: { value: "Follow-up" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    expect(await screen.findByText("Response 3")).toBeVisible();
    const edit = screen.getAllByRole("button", { name: "编辑消息" })[0];
    if (!edit) throw new Error("Missing edit control");
    fireEvent.click(edit);
    expect(input).toHaveValue("First question");
    fireEvent.change(input, { target: { value: "Revised question" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    expect(await screen.findByText("Response 4")).toBeVisible();
    expect(screen.queryByText("Response 3")).toBeNull();
    expect(browserMock.runtime.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "replay-chat", request: { prompt: "Revised question", history: [], includeHistory: true, webSearch: false, snapshot: { type: "elements", pages: [page] } } }));
    expect(browserMock.storage.local.set).not.toHaveBeenCalled();
  });

  it("reads exact paragraphs, renders sources and always includes completed history", async () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    browserMock.storage.local.get.mockResolvedValue({ "hyperpage.settings": {
      version: 4, enabled: true, locale: "zh_CN", resultDisplayMode: "floating", allowMultiTab: false,
      provider: { baseUrl: "https://api.example.com/v1", apiKey: "secret", model: "model", supportsVision: false, targetLanguage: "简体中文" },
    } });
    const snapshot = { id: "snapshot", title: "Article", url: "https://example.com/article", blocks: [
      { id: "1.1", text: "First passage", heading: "First", headingLevel: null },
      { id: "1.2", text: "Second passage", heading: "Second", headingLevel: null },
    ] };
    browserMock.runtime.sendMessage.mockImplementation((message: BackgroundRequest) => {
      if (message.type === "reading-command") return Promise.resolve({ ok: true, data: message.command.type === "read-page" ? snapshot : null });
      if (message.type === "run-chat") return Promise.resolve({ ok: true, data: { content: "Result [[snapshot:1.1]]", userContent: "Attached first passage", selectionRevision: null, citations: snapshot.blocks.slice(0, 1).map((block) => ({ ...block, id: `snapshot:${block.id}`, blockId: block.id, snapshotId: snapshot.id, title: snapshot.title, url: snapshot.url })) } });
      return Promise.resolve({ ok: true, data: EMPTY_PAGE_STATE });
    });
    render(<TooltipProvider><App initialOpen /></TooltipProvider>);
    await chooseAttachment("当前页面");
    expect(await screen.findByRole("checkbox", { name: "段落 1.1" })).toBeVisible();
    fireEvent.click(screen.getByRole("checkbox", { name: "段落 1.2" }));
    fireEvent.click(within(screen.getByRole("region", { name: "当前页面" })).getByRole("button", { name: "总结" }));
    const citation = await screen.findByRole("button", { name: "[1.1]" });
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "run-chat", request: {
      history: [], context: "page", includeHistory: true, webSearch: false, prompt: "总结提供的页面内容，并引用原文。", pageSelection: { snapshotId: "snapshot", blockIds: ["1.1"] },
    } }));
    fireEvent.click(citation);
    await waitFor(() => expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({ target: "background", type: "reading-command", command: { type: "locate-citation", snapshotId: "snapshot", blockId: "1.1" } }));
    expect(screen.queryByRole("checkbox", { name: /携带历史对话/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "移除资料" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "询问 AI" }), { target: { value: "Independent question" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "run-chat", request: { history: [
      { role: "user", content: buildTurnContent("总结提供的页面内容，并引用原文。", { type: "page", page: { ...snapshot, blocks: snapshot.blocks.slice(0, 1) } }) },
      { role: "assistant", content: "Result [[snapshot:1.1]]" },
    ], context: "none", includeHistory: true, webSearch: false, prompt: "Independent question" } })));
    fireEvent.click(screen.getByRole("button", { name: "新建对话" }));
    await waitFor(() => expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({ target: "background", type: "reading-command", command: { type: "clear-reading" } }));
  });

  it("collects independent element previews, removes sources and sends the retained IDs", async () => {
    browserMock.storage.local.get.mockResolvedValue({ "hyperpage.settings": {
      version: 4, enabled: true, locale: "zh_CN", resultDisplayMode: "floating", allowMultiTab: false,
      provider: { baseUrl: "https://api.example.com/v1", apiKey: "secret", model: "model", supportsVision: false, targetLanguage: "简体中文" },
    } });
    const selected: PageState = { ...EMPTY_PAGE_STATE, selectionRevision: 1, selection: { kind: "text", tagName: "p", text: "Element", accessibleName: "", role: "", editable: false, rect: { x: 0, y: 0, width: 200, height: 30 }, viewport: { width: 1024, height: 768 } } };
    let number = 0;
    browserMock.runtime.sendMessage.mockImplementation(async (message: BackgroundRequest) => {
      if (message.type === "reading-command" && message.command.type === "read-selected-element") {
        number++;
        return { ok: true, data: { id: `source-${number}`, title: `Source ${number}`, url: "https://example.com", blocks: [{ id: `${number}.1`, text: `Passage ${number}`, heading: "", headingLevel: null }] } };
      }
      if (message.type === "run-chat") return { ok: true, data: { content: "Answer", selectionRevision: null, citations: [] } };
      if (message.type === "page-command" && message.command.type === "start-selection") return { ok: true, data: { ...selected, selectionRevision: number + 1, selecting: true } };
      return { ok: true, data: selected };
    });
    render(<TooltipProvider><App initialOpen /></TooltipProvider>);
    await chooseAttachment("选择网页内容");
    await finishContextSelection({ ...selected, selectionRevision: 2 });
    await screen.findByText(/Source 1/);
    fireEvent.click(screen.getByRole("button", { name: "继续选择内容" }));
    await finishContextSelection({ ...selected, selectionRevision: 3 });
    await screen.findByText(/Source 2/);
    fireEvent.click(screen.getByRole("button", { name: "移除元素 1" }));
    expect(screen.queryByText(/Source 1/)).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "询问 AI" }), { target: { value: "Explain" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await screen.findByText("Answer");
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "run-chat", request: { prompt: "Explain", context: "elements", history: [], includeHistory: true, webSearch: false, elementSelections: [{ snapshotId: "source-2", blockIds: ["2.1"] }] } }));
  });

  it("sends a long selected original without a fixed input limit or a preview error", async () => {
    const settings = parseStoredSettings({
      version: 4, enabled: true, locale: "zh_CN", resultDisplayMode: "floating", allowMultiTab: false,
      provider: { baseUrl: "https://api.example.com/v1", apiKey: "secret", model: "model", supportsVision: false, targetLanguage: "简体中文" },
    });
    browserMock.storage.local.get.mockResolvedValue({ "hyperpage.settings": settings });
    browserMock.runtime.sendMessage.mockImplementation(async (message: BackgroundRequest) => {
      if (message.type === "reading-command") return { ok: true, data: { id: "long", title: "Long source", url: "https://example.com", blocks: [
        { id: "1.1", text: "x".repeat(16_000), heading: "", headingLevel: null },
        { id: "1.2", text: "y".repeat(16_000), heading: "", headingLevel: null },
      ] } };
      if (message.type === "run-chat") return { ok: true, data: { content: "Synthesis", selectionRevision: null, citations: [] } };
      return { ok: true, data: EMPTY_PAGE_STATE };
    });
    render(<TooltipProvider><App initialOpen /></TooltipProvider>);
    await chooseAttachment("当前页面");
    await screen.findByRole("checkbox", { name: "段落 1.1" });
    fireEvent.change(screen.getByRole("textbox", { name: "询问 AI" }), { target: { value: "Summarize" } });
    expect(screen.getByRole("button", { name: "发送消息" })).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(browserMock.runtime.sendMessage.mock.calls.some(([message]) => message.type === "run-chat")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await screen.findByText("Synthesis");
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "run-chat", request: { prompt: "Summarize", context: "page", history: [], includeHistory: true, webSearch: false, pageSelection: { snapshotId: "long", blockIds: ["1.1", "1.2"] } } }));
  });

  it("previews a webpage translation before applying it and exposes display and restore controls", async () => {
    browserMock.storage.local.get.mockResolvedValue({ "hyperpage.settings": {
      version: 4, enabled: true, locale: "zh_CN", resultDisplayMode: "floating", allowMultiTab: false,
      provider: { baseUrl: "https://api.example.com/v1", apiKey: "secret", model: "model", supportsVision: false, targetLanguage: "简体中文" },
    } });
    const result = { snapshotId: "source", translations: [{ blockId: "1.1", text: "Translated passage" }] };
    browserMock.runtime.sendMessage.mockImplementation(async (message: BackgroundRequest) => {
      if (message.type === "reading-command") return { ok: true, data: { id: "source", title: "Article", url: "https://example.com", blocks: [{ id: "1.1", text: "Original passage", heading: "", headingLevel: null }] } };
      if (message.type === "translate-page") return { ok: true, data: result };
      if (message.type === "translation-command") return { ok: true, data: null };
      return { ok: true, data: EMPTY_PAGE_STATE };
    });
    render(<TooltipProvider><App initialOpen /></TooltipProvider>);
    await openTools();
    fireEvent.click(screen.getByRole("button", { name: "网页翻译" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新页面内容" }));
    await screen.findByText("Article");
    fireEvent.click(await screen.findByRole("button", { name: "翻译所选段落" }));
    const apply = await screen.findByRole("button", { name: "显示双语页面" });
    expect(browserMock.runtime.sendMessage.mock.calls.some(([message]) => message.type === "translation-command")).toBe(false);
    fireEvent.click(apply);
    const original = await screen.findByRole("button", { name: /^原文$/ });
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({ target: "background", type: "translation-command", command: { type: "apply-translation", result } });
    fireEvent.click(original);
    await waitFor(() => expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({ target: "background", type: "translation-command", command: { type: "translation-mode", mode: "original" } }));
    fireEvent.click(screen.getByRole("button", { name: "恢复页面" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "恢复页面" })).toBeNull());
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({ target: "background", type: "translation-command", command: { type: "restore-translation" } });
  });

  it("keeps a selected local file private until a conversation request and sends only chosen paragraphs", async () => {
    browserMock.storage.local.get.mockResolvedValue({ "hyperpage.settings": {
      version: 4, enabled: true, locale: "zh_CN", resultDisplayMode: "floating", allowMultiTab: false,
      provider: { baseUrl: "https://api.example.com/v1", apiKey: "secret", model: "model", supportsVision: false, targetLanguage: "简体中文" },
    } });
    browserMock.runtime.sendMessage.mockImplementation(async (message: BackgroundRequest) => {
      if (message.type === "run-chat") return { ok: true, data: { content: "File answer", selectionRevision: null, citations: [] } };
      return { ok: true, data: EMPTY_PAGE_STATE };
    });
    render(<TooltipProvider><App initialOpen /></TooltipProvider>);
    await chooseAttachment("本地文件");
    const file = new File(["First\n\nSecond"], "notes.txt", { type: "text/plain" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode("First\n\nSecond").buffer });
    fireEvent.change(screen.getByLabelText("选择文本文件", { selector: "input" }), { target: { files: [file] } });
    await screen.findByRole("checkbox", { name: "段落 1.1" });
    expect(browserMock.runtime.sendMessage.mock.calls.some(([message]) => message.type === "run-chat")).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: "段落 1.1" }));
    fireEvent.change(screen.getByRole("textbox", { name: "询问 AI" }), { target: { value: "Explain" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await screen.findByText("File answer");
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "run-chat", request: expect.objectContaining({ context: "file", file: expect.objectContaining({ name: "notes.txt", blocks: [{ id: "1.2", text: "Second", heading: "", headingLevel: null, pageNumber: 1 }] }) }) }));
  });

  it("renders matching stream deltas and stops the active conversation", async () => {
    let completeChat:
      ((response: { ok: false; error: string }) => void) | undefined;
    let chatRequestId: string | undefined;
    browserMock.storage.local.get.mockResolvedValue({
      "hyperpage.settings": {
        version: 4,
        enabled: true,
        locale: "zh_CN",
        provider: {
          baseUrl: "https://api.example.com/v1",
          apiKey: "secret",
          model: "gpt-4.1-mini",
          supportsVision: false,
          targetLanguage: "简体中文",
        },
        resultDisplayMode: "floating",
        allowMultiTab: false,
      },
    });
    browserMock.runtime.sendMessage.mockImplementation(
      (message: { type: string; requestId?: string }) => {
        if (message.type === "run-chat") {
          chatRequestId = message.requestId;
          return new Promise((resolve) => {
            completeChat = resolve;
          });
        }
        if (message.type === "cancel-ai") {
          completeChat?.({ ok: false, error: "requestCancelled" });
          return Promise.resolve({ ok: true, data: null });
        }
        return Promise.resolve({ ok: true, data: EMPTY_PAGE_STATE });
      },
    );

    render(
      <TooltipProvider>
        <App initialOpen />
      </TooltipProvider>,
    );

    const input = await screen.findByRole("textbox", { name: "询问 AI" });
    fireEvent.change(input, { target: { value: "开始回答" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    const stopButton = await screen.findByRole("button", {
      name: "停止生成",
    });
    if (!chatRequestId) throw new Error("Chat request did not start");

    const handlePanelEvent =
      browserMock.runtime.onMessage.addListener.mock.calls.at(-1)?.[0];
    if (!handlePanelEvent) {
      throw new Error("Chat stream listener was not registered");
    }
    handlePanelEvent({
      target: "panel",
      type: "chat-delta",
      requestId: "another-request",
      delta: "不应显示",
    });
    handlePanelEvent({
      target: "panel",
      type: "chat-delta",
      requestId: chatRequestId,
      delta: "部分回复",
    });
    expect(await screen.findByText("部分回复")).toBeVisible();
    expect(screen.queryByText("不应显示")).not.toBeInTheDocument();

    fireEvent.click(stopButton);
    await waitFor(() => {
      expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({
        target: "background",
        type: "cancel-ai",
        requestId: chatRequestId,
      });
      expect(screen.getByText("生成已停止")).toBeVisible();
      expect(screen.getByRole("alertdialog", { hidden: true })).toHaveTextContent("请求已取消。");
      expect(input).toHaveValue("开始回答");
    });
  });

  it("submits a natural-language task from the operate-page tab", async () => {
    let completePageTask:
      | ((response: {
          ok: true;
          data: { content: string; success: boolean };
        }) => void)
      | undefined;
    let pageAgentRequestId: string | undefined;
    browserMock.storage.local.get.mockResolvedValue({
      "hyperpage.settings": {
        version: 3,
        enabled: true,
        locale: "zh_CN",
        provider: {
          baseUrl: "https://api.example.com/v1",
          apiKey: "secret",
          model: "gpt-4.1-mini",
          supportsVision: false,
          targetLanguage: "简体中文",
        },
        resultDisplayMode: "floating",
      },
    });
    browserMock.runtime.sendMessage.mockImplementation(
      (message: { type: string; requestId?: string; answer?: string }) => {
        if (message.type === "run-page-agent") {
          const handlePanelEvent =
            browserMock.runtime.onMessage.addListener.mock.calls.at(-1)?.[0];
          if (!handlePanelEvent || !message.requestId) {
            throw new Error("Page Agent progress listener was not registered");
          }
          handlePanelEvent({
            target: "panel",
            type: "page-agent-progress",
            requestId: "another-request",
            progress: {
              phase: "action-complete",
              stepIndex: 0,
              action: { type: "click", index: 99 },
              output: "Wrong task output",
              durationMs: 1,
            },
          });
          handlePanelEvent({
            target: "panel",
            type: "page-agent-progress",
            requestId: message.requestId,
            progress: { phase: "planning", stepIndex: 0 },
          });
          pageAgentRequestId = message.requestId;
          return new Promise((resolve) => {
            completePageTask = resolve;
          });
        }
        if (message.type === "answer-page-agent") {
          return Promise.resolve({ ok: true, data: null });
        }
        return Promise.resolve({ ok: true, data: EMPTY_PAGE_STATE });
      },
    );

    render(
      <TooltipProvider>
        <App initialOpen />
      </TooltipProvider>,
    );

    const operateTab = await screen.findByRole("tab", { name: "任务" });
    fireEvent.click(operateTab);
    const taskInput = screen.getByRole("textbox", { name: "页面任务" });
    fireEvent.change(taskInput, { target: { value: "填写并提交表单" } });
    fireEvent.click(screen.getByRole("button", { name: "执行" }));

    expect(await screen.findByText("模型正在规划下一步操作")).toBeVisible();
    expect(screen.getByRole("button", { name: "取消请求" })).toBeVisible();
    if (!pageAgentRequestId || !completePageTask) {
      throw new Error("Page task did not start");
    }
    const handlePanelEvent =
      browserMock.runtime.onMessage.addListener.mock.calls.at(-1)?.[0];
    if (!handlePanelEvent) {
      throw new Error("Page Agent progress listener was not registered");
    }
    handlePanelEvent({
      target: "panel",
      type: "page-agent-progress",
      requestId: pageAgentRequestId,
      progress: {
        phase: "awaiting-user",
        stepIndex: 0,
        question: "确定要提交这个表单吗？",
      },
    });
    expect(await screen.findByText("正在等待你回答")).toBeVisible();
    expect(screen.getByText("确定要提交这个表单吗？")).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "你的回答" }), {
      target: { value: "确认提交" },
    });
    fireEvent.click(screen.getByRole("button", { name: "回复" }));
    await waitFor(() => {
      expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({
        target: "background",
        type: "answer-page-agent",
        requestId: pageAgentRequestId,
        answer: "确认提交",
      });
    });
    handlePanelEvent({
      target: "panel",
      type: "page-agent-progress",
      requestId: pageAgentRequestId,
      progress: {
        phase: "action-complete",
        stepIndex: 0,
        action: {
          type: "ask-user",
          question: "确定要提交这个表单吗？",
        },
        output: "",
        durationMs: 12,
      },
    });
    handlePanelEvent({
      target: "panel",
      type: "page-agent-progress",
      requestId: pageAgentRequestId,
      progress: {
        phase: "executing",
        stepIndex: 1,
        action: { type: "click", index: 4 },
      },
    });
    expect(await screen.findByText("点击元素 #4")).toBeVisible();
    handlePanelEvent({
      target: "panel",
      type: "page-agent-progress",
      requestId: pageAgentRequestId,
      progress: {
        phase: "action-complete",
        stepIndex: 1,
        action: { type: "click", index: 4 },
        output: "Clicked element [4].",
        durationMs: 18,
      },
    });
    completePageTask({
      ok: true,
      data: { content: "表单已提交", success: true },
    });

    await waitFor(() => {
      expect(screen.getByText("表单已提交")).toBeVisible();
      expect(screen.getByText("已完成")).toBeVisible();
      expect(screen.getByText("执行明细")).toBeVisible();
      expect(screen.getByText(/点击元素 #4/)).toBeVisible();
      expect(screen.getByText(/Clicked element \[4\]\./)).toBeVisible();
    });
    expect(screen.queryByText("Wrong task output")).not.toBeInTheDocument();
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({
      target: "background",
      type: "run-page-agent",
      requestId: expect.any(String),
      task: "填写并提交表单",
    });
    expect(browserMock.storage.local.set).toHaveBeenCalledWith({
      "hyperpage.pageAgentHistory": {
        version: 1,
        records: [
          {
            id: expect.any(String),
            task: "填写并提交表单",
            startedAt: expect.any(Number),
            finishedAt: expect.any(Number),
            status: "completed",
            result: "表单已提交",
            steps: [
              {
                action: "请求补充信息: 确定要提交这个表单吗？",
                output: "",
                durationMs: 12,
              },
              {
                action: "点击元素 #4",
                output: "Clicked element [4].",
                durationMs: 18,
              },
            ],
          },
        ],
      },
    });
  });

  it("inserts multiple editable element references into the page task", async () => {
    const firstSelectedPageState = {
      ...EMPTY_PAGE_STATE,
      selectionRevision: 1,
      selection: {
        kind: "text" as const,
        tagName: "button",
        text: "提交订单",
        accessibleName: "提交订单",
        role: "button",
        editable: false,
        rect: { x: 40, y: 80, width: 120, height: 36 },
        viewport: { width: 1280, height: 800 },
      },
    };
    const secondSelectedPageState = {
      ...EMPTY_PAGE_STATE,
      selectionRevision: 2,
      selection: {
        kind: "text" as const,
        tagName: "a",
        text: "确认支付",
        accessibleName: "",
        role: "link",
        editable: false,
        rect: { x: 240, y: 180, width: 120, height: 36 },
        viewport: { width: 1280, height: 800 },
      },
    };
    let currentPageState: PageState = EMPTY_PAGE_STATE;
    browserMock.storage.local.get.mockResolvedValue({
      "hyperpage.settings": {
        version: 3,
        enabled: true,
        locale: "zh_CN",
        provider: {
          baseUrl: "https://api.example.com/v1",
          apiKey: "secret",
          model: "gpt-4.1-mini",
          supportsVision: false,
          targetLanguage: "简体中文",
        },
        resultDisplayMode: "floating",
      },
    });
    browserMock.runtime.sendMessage.mockImplementation(
      (message: { type: string; command?: { type: string } }) => {
        if (message.command?.type === "start-page-task-selection") {
          return Promise.resolve({
            ok: true,
            data: { ...currentPageState, selecting: true },
          });
        }
        return Promise.resolve({ ok: true, data: currentPageState });
      },
    );

    render(
      <TooltipProvider>
        <App initialOpen />
      </TooltipProvider>,
    );

    fireEvent.click(await screen.findByRole("tab", { name: "任务" }));
    const taskInput = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "页面任务",
    });
    fireEvent.change(taskInput, { target: { value: "先点击" } });
    taskInput.setSelectionRange(3, 3);
    fireEvent.click(screen.getByRole("button", { name: "选择并插入元素" }));

    await waitFor(() => {
      expect(
        document.querySelector("#hyperpage-tool-panel"),
      ).not.toBeVisible();
    });
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({
      target: "background",
      type: "page-command",
      command: { type: "start-page-task-selection" },
    });

    const handlePanelEvent =
      browserMock.runtime.onMessage.addListener.mock.calls.at(-1)?.[0];
    if (!handlePanelEvent) {
      throw new Error("Page state listener was not registered");
    }
    currentPageState = firstSelectedPageState;
    handlePanelEvent({
      target: "panel",
      type: "page-state-changed",
      state: firstSelectedPageState,
    });

    const taskWithFirstReference = await screen.findByRole<HTMLTextAreaElement>(
      "textbox",
      { name: "页面任务" },
    );
    await waitFor(() => {
      expect(taskWithFirstReference).toHaveValue(
        '先点击 [元素 <button> role="button" "提交订单"] ',
      );
    });
    expect(
      document.querySelectorAll("[data-page-task-reference]"),
    ).toHaveLength(1);
    expect(
      document.querySelector("[data-page-task-reference]"),
    ).toHaveTextContent('[元素 <button> role="button" "提交订单"]');
    expect(
      document.querySelector("[data-page-task-highlight]"),
    ).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("tab", { name: "任务" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.change(taskWithFirstReference, {
      target: {
        value: '先点击 [元素 <button> role="button" "提交订单"] 然后点击',
      },
    });
    taskWithFirstReference.setSelectionRange(
      taskWithFirstReference.value.length,
      taskWithFirstReference.value.length,
    );
    fireEvent.click(screen.getByRole("button", { name: "选择并插入元素" }));
    await waitFor(() => {
      expect(
        document.querySelector("#hyperpage-tool-panel"),
      ).not.toBeVisible();
    });
    currentPageState = secondSelectedPageState;
    const handleSecondSelection =
      browserMock.runtime.onMessage.addListener.mock.calls.at(-1)?.[0];
    if (!handleSecondSelection) {
      throw new Error("Page state listener was not registered");
    }
    handleSecondSelection({
      target: "panel",
      type: "page-state-changed",
      state: secondSelectedPageState,
    });

    expect(
      await screen.findByRole<HTMLTextAreaElement>("textbox", {
        name: "页面任务",
      }),
    ).toHaveValue(
      '先点击 [元素 <button> role="button" "提交订单"] 然后点击 [元素 <a> role="link" "确认支付"] ',
    );
    expect(
      document.querySelectorAll("[data-page-task-reference]"),
    ).toHaveLength(2);
    expect(
      browserMock.runtime.sendMessage.mock.calls.filter(
        ([message]) => message.command?.type === "start-page-task-selection",
      ),
    ).toHaveLength(2);
  });

  it("does not insert an element reference when task selection is cancelled", async () => {
    browserMock.storage.local.get.mockResolvedValue({
      "hyperpage.settings": {
        version: 3,
        enabled: true,
        locale: "zh_CN",
        provider: {
          baseUrl: "https://api.example.com/v1",
          apiKey: "secret",
          model: "gpt-4.1-mini",
          supportsVision: false,
          targetLanguage: "简体中文",
        },
        resultDisplayMode: "floating",
      },
    });
    browserMock.runtime.sendMessage.mockImplementation(
      (message: { command?: { type: string } }) =>
        Promise.resolve({
          ok: true,
          data:
            message.command?.type === "start-page-task-selection"
              ? { ...EMPTY_PAGE_STATE, selecting: true }
              : EMPTY_PAGE_STATE,
        }),
    );

    render(
      <TooltipProvider>
        <App initialOpen />
      </TooltipProvider>,
    );
    fireEvent.click(await screen.findByRole("tab", { name: "任务" }));
    const taskInput = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "页面任务",
    });
    fireEvent.change(taskInput, { target: { value: "保留这段任务" } });
    fireEvent.click(screen.getByRole("button", { name: "选择并插入元素" }));

    await waitFor(() => {
      expect(
        document.querySelector("#hyperpage-tool-panel"),
      ).not.toBeVisible();
    });

    const handlePanelEvent =
      browserMock.runtime.onMessage.addListener.mock.calls.at(-1)?.[0];
    if (!handlePanelEvent) {
      throw new Error("Page state listener was not registered");
    }
    handlePanelEvent({ target: "panel", type: "toggle-panel" });

    expect(
      await screen.findByRole<HTMLTextAreaElement>("textbox", {
        name: "页面任务",
      }),
    ).toHaveValue("保留这段任务");
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({
      target: "background",
      type: "page-command",
      command: { type: "cancel-selection" },
    });
  });

  it("creates, updates, runs, and deletes a saved workflow", async () => {
    const stored: Record<string, unknown> = {
      "hyperpage.settings": {
        version: 3,
        enabled: true,
        locale: "zh_CN",
        provider: {
          baseUrl: "https://api.example.com/v1",
          apiKey: "secret",
          model: "gpt-4.1-mini",
          supportsVision: false,
          targetLanguage: "简体中文",
        },
        resultDisplayMode: "floating",
      },
    };
    browserMock.storage.local.get.mockImplementation(async () => stored);
    browserMock.storage.local.set.mockImplementation(async (values: Record<string, unknown>) => { Object.assign(stored, values); });
    browserMock.runtime.sendMessage.mockImplementation(
      (message: { type: string }) =>
        Promise.resolve(
          message.type === "run-page-agent"
            ? { ok: true, data: { content: "执行完成", success: true } }
            : { ok: true, data: EMPTY_PAGE_STATE },
        ),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <TooltipProvider>
        <App initialOpen />
      </TooltipProvider>,
    );

    fireEvent.click(await screen.findByRole("tab", { name: "任务" }));
    const taskInput = screen.getByRole("textbox", { name: "页面任务" });
    fireEvent.change(taskInput, { target: { value: "填写并提交日报" } });
    fireEvent.click(screen.getByRole("button", { name: "保存流程" }));
    const nameInput = screen.getByRole("textbox", { name: "流程名称" });
    fireEvent.change(nameInput, { target: { value: "提交日报" } });
    fireEvent.click(screen.getByRole("button", { name: "保存流程" }));

    await waitFor(() => {
      expect(screen.getByText("提交日报")).toBeVisible();
      expect(browserMock.storage.local.set).toHaveBeenCalledWith({
        "hyperpage.pageWorkflows": {
          version: 2,
          workflows: [
            {
              id: expect.any(String),
              name: "提交日报",
              task: "填写并提交日报",
              allowedOrigins: [],
            },
          ],
        },
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "编辑流程: 提交日报" }));
    fireEvent.change(screen.getByRole("textbox", { name: "页面任务" }), {
      target: { value: "填写并提交本周周报" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "流程名称" }), {
      target: { value: "提交周报" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => {
      expect(screen.getByText("提交周报")).toBeVisible();
      expect(screen.queryByText("提交日报")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "执行流程: 提交周报" }));
    await waitFor(() => {
      expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({
        target: "background",
        type: "run-page-agent",
        requestId: expect.any(String),
        task: "填写并提交本周周报",
      });
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "删除流程: 提交周报" }),
    );
    await waitFor(() => {
      expect(screen.getByText("暂无固定流程")).toBeVisible();
      expect(browserMock.storage.local.set).toHaveBeenLastCalledWith({
        "hyperpage.pageWorkflows": { version: 2, workflows: [] },
      });
    });
  });

  it("imports a scoped workflow and submits only after its parameters are filled", async () => {
    const settings = parseStoredSettings({ locale: "en", provider: { baseUrl: "https://api.example.com/v1", apiKey: "secret", model: "model", supportsVision: false, targetLanguage: "English" } });
    const stored: Record<string, unknown> = { "hyperpage.settings": settings };
    browserMock.storage.local.get.mockImplementation(async () => stored);
    browserMock.storage.local.set.mockImplementation(async (values: Record<string, unknown>) => { Object.assign(stored, values); });
    browserMock.runtime.sendMessage.mockImplementation(async (request: BackgroundRequest) => ({ ok: true, data: request.type === "run-page-agent" ? { success: true, content: "Done" } : EMPTY_PAGE_STATE }));
    render(<TooltipProvider><App initialOpen /></TooltipProvider>);
    fireEvent.click(await screen.findByRole("tab", { name: "Tasks" }));
    const archive = JSON.stringify({ version: 2, workflows: [{ id: "imported", name: "Find product", task: "Find {{product}}", allowedOrigins: [window.location.origin] }] });
    const file = new File([archive], "workflows.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: () => Promise.resolve(archive) });
    fireEvent.change(screen.getByLabelText("Import workflows", { selector: "input" }), { target: { files: [file] } });
    fireEvent.click(await screen.findByRole("button", { name: "Run workflow: Find product" }));
    const parameters = screen.getByRole("region", { name: "Task parameters" });
    expect(browserMock.runtime.sendMessage.mock.calls.some(([request]) => request.type === "run-page-agent")).toBe(false);
    fireEvent.change(within(parameters).getByLabelText("product"), { target: { value: "Keyboard" } });
    fireEvent.click(within(parameters).getByRole("button", { name: "Start" }));
    await waitFor(() => expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({ target: "background", type: "run-page-agent", requestId: expect.any(String), task: "Find Keyboard", allowedOrigins: [window.location.origin] }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Run workflow: Find product" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Run workflow: Find product" }));
    expect(within(screen.getByRole("region", { name: "Task parameters" })).getByLabelText("product")).toHaveValue("");
    expect(stored["hyperpage.pageWorkflows"]).toEqual({ version: 2, workflows: [{ id: expect.any(String), name: "Find product", task: "Find {{product}}", allowedOrigins: [window.location.origin] }] });
  });

  it("loads saved workflows, preserves their website scope when edited, and exports them", async () => {
    const workflow = { id: "existing", name: "Find product", task: "Find {{product}}", allowedOrigins: ["https://shop.example.com"] };
    const stored: Record<string, unknown> = {
      "hyperpage.settings": parseStoredSettings({ locale: "en", provider: { baseUrl: "https://api.example.com/v1", apiKey: "secret", model: "model", supportsVision: false, targetLanguage: "English" } }),
      "hyperpage.pageWorkflows": { version: 2, workflows: [workflow] },
    };
    browserMock.storage.local.get.mockImplementation(async () => stored);
    browserMock.storage.local.set.mockImplementation(async (values: Record<string, unknown>) => { Object.assign(stored, values); });
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: true, data: EMPTY_PAGE_STATE });
    const download = vi.spyOn(textExport, "downloadText").mockImplementation(() => {});
    render(<TooltipProvider><App initialOpen /></TooltipProvider>);
    fireEvent.click(await screen.findByRole("tab", { name: "Tasks" }));
    fireEvent.click(screen.getByRole("button", { name: "Run workflow: Find product" }));
    expect(await screen.findByText("This website is outside the task's allowed origins.", { selector: "h2" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Task parameters" })).toBeNull();
    expect(browserMock.runtime.sendMessage.mock.calls.some(([request]) => request.type === "run-page-agent")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Edit workflow: Find product" }));
    fireEvent.click(screen.getByRole("button", { name: "Website scope" }));
    expect(screen.getByRole("textbox", { name: "Website scope" })).toHaveValue("https://shop.example.com");
    fireEvent.change(screen.getByRole("textbox", { name: "Workflow name" }), { target: { value: "Find item" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Page task" }), { target: { value: "Locate {{product}}" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByRole("button", { name: "Edit workflow: Find item" });
    const saved = { version: 2, workflows: [{ ...workflow, name: "Find item", task: "Locate {{product}}" }] };
    expect(stored["hyperpage.pageWorkflows"]).toEqual(saved);
    fireEvent.click(screen.getByRole("button", { name: "Export workflows" }));
    expect(download).toHaveBeenCalledWith(JSON.stringify(saved, null, 2), "hyperpage-workflows.json", "application/json");

    stored["hyperpage.pageWorkflows"] = { version: 2, workflows: [] };
    const listener = browserMock.storage.onChanged.addListener.mock.calls.at(-1)?.[0];
    if (!listener) throw new Error("Missing storage listener");
    await act(async () => listener({ "hyperpage.pageWorkflows": { newValue: stored["hyperpage.pageWorkflows"] } }, "local"));
    expect(screen.getByText("No saved workflows")).toBeVisible();
    expect(screen.getByRole("button", { name: "Export workflows" })).toBeDisabled();
  });

  it("keeps workflow drafts on storage failures and rejects invalid imports", async () => {
    const stored: Record<string, unknown> = {
      "hyperpage.settings": parseStoredSettings({ locale: "en", provider: { baseUrl: "https://api.example.com/v1", apiKey: "secret", model: "model", supportsVision: false, targetLanguage: "English" } }),
    };
    browserMock.storage.local.get.mockImplementation(async () => stored);
    browserMock.storage.local.set.mockRejectedValue(new Error("Storage full"));
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: true, data: EMPTY_PAGE_STATE });
    render(<TooltipProvider><App initialOpen /></TooltipProvider>);
    fireEvent.click(await screen.findByRole("tab", { name: "Tasks" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Page task" }), { target: { value: "Read this page" } });
    fireEvent.click(screen.getByRole("button", { name: "Save workflow" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Workflow name" }), { target: { value: "Read page" } });
    fireEvent.click(screen.getByRole("button", { name: "Save workflow" }));
    expect(await screen.findByText("Storage full", { selector: "h2" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Workflow name" })).toHaveValue("Read page");
    expect(screen.getByText("No saved workflows")).toBeVisible();

    browserMock.storage.local.set.mockImplementation(async (values: Record<string, unknown>) => { Object.assign(stored, values); });
    fireEvent.click(screen.getByRole("button", { name: "Save workflow" }));
    await screen.findByRole("button", { name: "Run workflow: Read page" });
    const saved = stored["hyperpage.pageWorkflows"];
    browserMock.storage.local.set.mockClear();
    const file = new File(["invalid"], "workflows.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: () => Promise.resolve("invalid") });
    fireEvent.change(screen.getByLabelText("Import workflows", { selector: "input" }), { target: { files: [file] } });
    expect(await screen.findByText("The saved workflows are invalid.", { selector: "h2" })).toBeVisible();
    expect(browserMock.storage.local.set).not.toHaveBeenCalled();
    expect(stored["hyperpage.pageWorkflows"]).toEqual(saved);
    expect(screen.getByRole("button", { name: "Run workflow: Read page" })).toBeEnabled();
  });

  it("drags the panel header while keeping the panel inside the viewport", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(800);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(600);
    browserMock.storage.local.get.mockResolvedValue({
      "hyperpage.settings": {
        version: 3,
        enabled: true,
        locale: "zh_CN",
        provider: {
          baseUrl: "https://api.example.com/v1",
          apiKey: "secret",
          model: "gpt-4.1-mini",
          supportsVision: true,
          targetLanguage: "简体中文",
        },
        resultDisplayMode: "floating",
      },
    });
    browserMock.runtime.sendMessage.mockResolvedValue({
      ok: true,
      data: EMPTY_PAGE_STATE,
    });

    render(
      <TooltipProvider>
        <App initialOpen />
      </TooltipProvider>,
    );

    await screen.findByRole("button", { name: "添加资料" });
    const panel = document.querySelector<HTMLElement>("#hyperpage-tool-panel");
    const header = panel?.querySelector<HTMLElement>("header");
    if (!panel || !header) throw new Error("Floating panel was not rendered");
    mockPointerCapture(header);
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
      x: 404,
      y: 24,
      left: 404,
      top: 24,
      right: 784,
      bottom: 514,
      width: 380,
      height: 490,
      toJSON: () => ({}),
    });

    fireEvent(header, createPointerEvent("pointerdown", 2, 500, 32));
    fireEvent(header, createPointerEvent("pointermove", 2, 900, 700));
    fireEvent(header, createPointerEvent("pointerup", 2, 900, 700));

    expect(panel).toHaveStyle({
      left: "412px",
      top: "102px",
      right: "auto",
      bottom: "auto",
    });
  });

  it("resizes the panel horizontally from its left edge", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(800);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(600);
    browserMock.storage.local.get.mockResolvedValue({
      "hyperpage.settings": {
        version: 3,
        enabled: true,
        locale: "zh_CN",
        provider: {
          baseUrl: "https://api.example.com/v1",
          apiKey: "secret",
          model: "gpt-4.1-mini",
          supportsVision: true,
          targetLanguage: "简体中文",
        },
        resultDisplayMode: "floating",
      },
    });
    browserMock.runtime.sendMessage.mockResolvedValue({
      ok: true,
      data: EMPTY_PAGE_STATE,
    });

    render(
      <TooltipProvider>
        <App initialOpen />
      </TooltipProvider>,
    );

    await screen.findByRole("button", { name: "添加资料" });
    const panel = document.querySelector<HTMLElement>("#hyperpage-tool-panel");
    if (!panel) throw new Error("Floating panel was not rendered");
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
      x: 404,
      y: 24,
      left: 404,
      top: 24,
      right: 784,
      bottom: 514,
      width: 380,
      height: 490,
      toJSON: () => ({}),
    });
    const resizeHandle = screen.getByRole("separator", {
      name: "横向调整面板宽度",
    });
    mockPointerCapture(resizeHandle);

    fireEvent(resizeHandle, createPointerEvent("pointerdown", 3, 404, 200));
    fireEvent(resizeHandle, createPointerEvent("pointermove", 3, 204, 200));

    expect(panel).toHaveAttribute("data-resizing", "true");
    expect(panel).toHaveStyle({
      left: "204px",
      top: "24px",
      right: "auto",
      bottom: "auto",
      width: "580px",
    });

    fireEvent(resizeHandle, createPointerEvent("pointermove", 3, 600, 200));
    expect(panel).toHaveStyle({ left: "464px", width: "320px" });

    fireEvent(resizeHandle, createPointerEvent("pointerup", 3, 600, 200));
    expect(panel).not.toHaveAttribute("data-resizing");
    expect(resizeHandle).toHaveAttribute("aria-valuenow", "320");
  });

  it("resizes the panel vertically from its top edge", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(800);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    browserMock.storage.local.get.mockResolvedValue({
      "hyperpage.settings": {
        version: 3,
        enabled: true,
        locale: "zh_CN",
        provider: {
          baseUrl: "https://api.example.com/v1",
          apiKey: "secret",
          model: "gpt-4.1-mini",
          supportsVision: true,
          targetLanguage: "简体中文",
        },
        resultDisplayMode: "floating",
      },
    });
    browserMock.runtime.sendMessage.mockResolvedValue({
      ok: true,
      data: EMPTY_PAGE_STATE,
    });

    render(
      <TooltipProvider>
        <App initialOpen />
      </TooltipProvider>,
    );

    await screen.findByRole("button", { name: "添加资料" });
    const panel = document.querySelector<HTMLElement>("#hyperpage-tool-panel");
    if (!panel) throw new Error("Floating panel was not rendered");
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
      x: 404,
      y: 200,
      left: 404,
      top: 200,
      right: 784,
      bottom: 690,
      width: 380,
      height: 490,
      toJSON: () => ({}),
    });
    const resizeHandle = screen.getByRole("separator", {
      name: "纵向调整面板高度",
    });
    mockPointerCapture(resizeHandle);

    fireEvent(resizeHandle, createPointerEvent("pointerdown", 4, 600, 200));
    fireEvent(resizeHandle, createPointerEvent("pointermove", 4, 600, 100));

    expect(panel).toHaveAttribute("data-resizing", "true");
    expect(panel).toHaveStyle({
      left: "404px",
      top: "100px",
      right: "auto",
      bottom: "auto",
      height: "590px",
    });

    fireEvent(resizeHandle, createPointerEvent("pointermove", 4, 600, -1000));
    expect(panel).toHaveStyle({ top: "8px", height: "682px" });

    fireEvent(resizeHandle, createPointerEvent("pointermove", 4, 600, 600));
    expect(panel).toHaveStyle({ top: "410px", height: "280px" });
    const scrollRegion = panel.querySelector("[data-panel-scroll-region]");
    expect(scrollRegion).toHaveClass(
      "flex",
      "min-h-0",
      "flex-1",
      "flex-col",
      "overflow-hidden",
    );
    expect(panel.querySelector("[data-chat-composer]")).toBeVisible();

    fireEvent(resizeHandle, createPointerEvent("pointerup", 4, 600, 600));
    expect(panel).not.toHaveAttribute("data-resizing");
    expect(resizeHandle).toHaveAttribute("aria-orientation", "horizontal");
    expect(resizeHandle).toHaveAttribute("aria-valuenow", "280");
  });

  it("shows a structured loading state before displaying an AI result", async () => {
    let completeAiRequest:
      | ((response: {
          ok: true;
          data: { content: string; selectionRevision: number | null };
        }) => void)
      | undefined;
    const selectedPageState = {
      ...EMPTY_PAGE_STATE,
      selectionRevision: 1,
      selection: {
        kind: "text" as const,
        tagName: "p",
        text: "需要翻译的内容",
        accessibleName: "",
        role: "",
        editable: false,
        rect: { x: 20, y: 30, width: 320, height: 120 },
        viewport: { width: 1280, height: 800 },
      },
    };
    browserMock.storage.local.get.mockResolvedValue({
      "hyperpage.settings": {
        version: 3,
        enabled: true,
        locale: "zh_CN",
        provider: {
          baseUrl: "https://api.example.com/v1",
          apiKey: "secret",
          model: "gpt-4.1-mini",
          supportsVision: false,
          targetLanguage: "简体中文",
        },
        resultDisplayMode: "floating",
      },
    });
    browserMock.runtime.sendMessage.mockImplementation(
      (message: { type: string }) => {
        if (message.type === "run-ai") {
          return new Promise((resolve) => {
            completeAiRequest = resolve;
          });
        }
        return Promise.resolve({ ok: true, data: selectedPageState });
      },
    );

    render(
      <TooltipProvider>
        <App initialOpen />
      </TooltipProvider>,
    );

    await openTools();
    const translateButton = await screen.findByRole("button", { name: "翻译" });
    await waitFor(() => expect(translateButton).toBeEnabled());
    fireEvent.click(translateButton);

    expect(await screen.findByText("正在处理")).toBeVisible();
    expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
    expect(screen.getByRole("button", { name: "取消请求" })).toBeVisible();
    expect(screen.getByRole("button", { name: "设置" })).toBeDisabled();
    for (const closeButton of screen.getAllByRole("button", {
      name: "关闭 HyperPage AI",
    })) {
      expect(closeButton).toBeDisabled();
    }
    const navigation = document.querySelector("[data-main-navigation]");
    const scrollRegion = document.querySelector("[data-panel-scroll-region]");
    const feedback = document.querySelector("[data-execution-feedback]");
    expect(navigation).not.toBeNull();
    expect(scrollRegion).not.toBeNull();
    expect(feedback).not.toBeNull();
    expect(scrollRegion?.contains(navigation)).toBe(false);
    expect(scrollRegion?.contains(feedback)).toBe(true);
    if (!completeAiRequest) throw new Error("AI request did not start");
    completeAiRequest({
      ok: true,
      data: { content: "Translated result", selectionRevision: 1 },
    });

    await waitFor(() => {
      expect(screen.getByText("Translated result")).toBeVisible();
      expect(screen.getByText("结果")).toBeVisible();
      expect(screen.getByRole("button", { name: "删除结果" })).toBeVisible();
      expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(
        0,
      );
    });
  });

  it.each([
    ["requestCancelled", "已取消", "cancelled", "请求已取消。"],
    [
      "pageAgentFailed:模型拒绝执行",
      "失败",
      "failed",
      "页面操作失败: 模型拒绝执行",
    ],
  ] as const)(
    "records a terminal page-task error as %s",
    async (errorCode, _statusLabel, status, resultText) => {
      browserMock.storage.local.get.mockResolvedValue({
        "hyperpage.settings": {
          version: 3,
          enabled: true,
          locale: "zh_CN",
          provider: {
            baseUrl: "https://api.example.com/v1",
            apiKey: "secret",
            model: "gpt-4.1-mini",
            supportsVision: false,
            targetLanguage: "简体中文",
          },
          resultDisplayMode: "floating",
        },
      });
      browserMock.runtime.sendMessage.mockImplementation(
        (message: { type: string }) =>
          Promise.resolve(
            message.type === "run-page-agent"
              ? { ok: false, error: errorCode }
              : { ok: true, data: EMPTY_PAGE_STATE },
          ),
      );

      render(
        <TooltipProvider>
          <App initialOpen />
        </TooltipProvider>,
      );

      fireEvent.click(await screen.findByRole("tab", { name: "任务" }));
      fireEvent.change(screen.getByRole("textbox", { name: "页面任务" }), {
        target: { value: "尝试提交页面" },
      });
      fireEvent.click(screen.getByRole("button", { name: "执行" }));

      await waitFor(() => {
        expect(screen.getByRole("alertdialog", { hidden: true })).toHaveTextContent(resultText);
        expect(document.querySelector("[data-execution-feedback]")).toBeNull();
        expect(browserMock.storage.local.set).toHaveBeenCalledWith({
          "hyperpage.pageAgentHistory": {
            version: 1,
            records: [
              expect.objectContaining({
                task: "尝试提交页面",
                status,
                result: resultText,
                steps: [],
              }),
            ],
          },
        });
      });
    },
  );

  it("expands, deletes, and clears persisted execution records", async () => {
    const records = [
      {
        id: "record-1",
        task: "第一项任务",
        startedAt: 1_780_000_000_000,
        finishedAt: 1_780_000_001_250,
        status: "completed" as const,
        result: "第一项任务已完成",
        steps: [
          {
            action: "点击元素 #4",
            output: "Clicked element [4].",
            durationMs: 18,
          },
        ],
      },
      {
        id: "record-2",
        task: "第二项任务",
        startedAt: 1_779_000_000_000,
        finishedAt: 1_779_000_000_500,
        status: "failed" as const,
        result: "页面操作失败",
        steps: [],
      },
    ];
    browserMock.storage.local.get.mockResolvedValue({
      "hyperpage.settings": {
        version: 3,
        enabled: true,
        locale: "zh_CN",
        provider: {
          baseUrl: "https://api.example.com/v1",
          apiKey: "secret",
          model: "gpt-4.1-mini",
          supportsVision: false,
          targetLanguage: "简体中文",
        },
        resultDisplayMode: "floating",
      },
      "hyperpage.pageAgentHistory": { version: 1, records },
    });
    browserMock.storage.local.set.mockResolvedValue(undefined);
    browserMock.runtime.sendMessage.mockResolvedValue({
      ok: true,
      data: EMPTY_PAGE_STATE,
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <TooltipProvider>
        <App initialOpen />
      </TooltipProvider>,
    );

    fireEvent.click(await screen.findByRole("tab", { name: "任务" }));
    fireEvent.click(screen.getByRole("tab", { name: "执行记录" }));
    const firstRecord = await screen.findByRole("button", {
      name: "已完成: 第一项任务",
    });
    fireEvent.click(firstRecord);

    await waitFor(() => {
      expect(screen.getByText("第一项任务已完成")).toBeVisible();
      expect(screen.getByText(/Clicked element \[4\]\./)).toBeVisible();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "删除执行记录: 第二项任务" }),
    );
    await waitFor(() => {
      expect(browserMock.storage.local.set).toHaveBeenCalledWith({
        "hyperpage.pageAgentHistory": { version: 1, records: [records[0]] },
      });
      expect(screen.queryByText("第二项任务")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "清空记录" }));
    await waitFor(() => {
      expect(browserMock.storage.local.set).toHaveBeenLastCalledWith({
        "hyperpage.pageAgentHistory": { version: 1, records: [] },
      });
      expect(screen.getByText("暂无执行记录")).toBeVisible();
    });
  });
});
