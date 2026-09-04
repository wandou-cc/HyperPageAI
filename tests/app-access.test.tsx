import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../components/ui/tooltip";
import { App } from "../entrypoints/sidepanel/App";
import type { PageState } from "../shared/messages";

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("floating panel page binding", () => {
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
      expect(screen.getByRole("button", { name: "取消选择" })).toBeVisible();
    });
    expect(
      screen.queryByRole("button", { name: "选择元素" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a 58 pixel launcher available while the panel is closed", async () => {
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

    const launcher = await waitFor(() =>
      screen.getByRole("button", { name: "打开 HyperPage AI" }),
    );
    expect(launcher).toHaveClass("size-[58px]", "bg-white", "shadow-xl");
    expect(
      screen.queryByRole("button", { name: "选择元素" }),
    ).not.toBeInTheDocument();

    launcher.click();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "保存" })).toBeVisible();
    });
    expect(document.querySelector("#hyperpage-tool-panel")).toHaveStyle({
      width: "420px",
    });
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({
      target: "background",
      type: "set-panel-visibility",
      visible: true,
    });
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

  it("uses custom input for questions, selected context, and page tasks", async () => {
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
      (message: { type: string; command?: { type: string } }) => {
        if (message.type === "run-ai") {
          return Promise.resolve({
            ok: true,
            data: { content: "这是普通回答", selectionRevision: null },
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
    const customInput = screen.getByRole("textbox", { name: "询问 AI" });
    expect(customInput).toBeEnabled();
    expect(customInput).toHaveAttribute("placeholder", "向 AI 提问");
    fireEvent.change(customInput, { target: { value: "解释什么是 CLS" } });
    fireEvent.click(screen.getByRole("button", { name: "询问 AI" }));

    expect(await screen.findByText("这是普通回答")).toBeVisible();
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({
      target: "background",
      type: "run-ai",
      requestId: expect.any(String),
      request: { action: "custom", prompt: "解释什么是 CLS" },
    });

    const handlePanelEvent =
      browserMock.runtime.onMessage.addListener.mock.calls.at(-1)?.[0];
    if (!handlePanelEvent) {
      throw new Error("Page state listener was not registered");
    }
    handlePanelEvent({
      target: "panel",
      type: "page-state-changed",
      state: selectedPageState,
    });
    await waitFor(() => {
      expect(screen.getByText("基于所选元素")).toBeVisible();
      expect(customInput).toHaveAttribute(
        "placeholder",
        "描述如何处理所选元素",
      );
      expect(screen.getByText("这是普通回答")).toBeVisible();
    });

    fireEvent.click(screen.getByRole("button", { name: "执行页面任务" }));
    const pageTaskInput = await screen.findByRole("textbox", {
      name: "页面任务",
    });
    expect(pageTaskInput).toHaveValue(
      '[元素 <button> role="button" "提交订单"] 解释什么是 CLS',
    );
    expect(screen.getByRole("tab", { name: "操作页面" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      document.querySelector("[data-selected-element-summary]"),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({
        target: "background",
        type: "run-page-agent",
        requestId: expect.any(String),
        task: '[元素 <button> role="button" "提交订单"] 解释什么是 CLS',
      });
    });
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({
      target: "background",
      type: "page-command",
      command: { type: "add-selection-to-page-task" },
    });
    const bindCallIndex = browserMock.runtime.sendMessage.mock.calls.findIndex(
      ([message]) =>
        message.type === "page-command" &&
        message.command?.type === "add-selection-to-page-task",
    );
    const runCallIndex = browserMock.runtime.sendMessage.mock.calls.findIndex(
      ([message]) => message.type === "run-page-agent",
    );
    expect(bindCallIndex).toBeGreaterThan(-1);
    expect(runCallIndex).toBeGreaterThan(bindCallIndex);
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

    const operateTab = await screen.findByRole("tab", { name: "操作页面" });
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
                action: "询问确认或补充信息: 确定要提交这个表单吗？",
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

    fireEvent.click(await screen.findByRole("tab", { name: "操作页面" }));
    const taskInput = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "页面任务",
    });
    fireEvent.change(taskInput, { target: { value: "先点击" } });
    taskInput.setSelectionRange(3, 3);
    fireEvent.click(screen.getByRole("button", { name: "选择并插入元素" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "取消选择" })).toBeVisible();
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
    expect(screen.getByRole("tab", { name: "操作页面" })).toHaveAttribute(
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
      expect(screen.getByRole("button", { name: "取消选择" })).toBeVisible();
    });
    currentPageState = secondSelectedPageState;
    handlePanelEvent({
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
    fireEvent.click(await screen.findByRole("tab", { name: "操作页面" }));
    const taskInput = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "页面任务",
    });
    fireEvent.change(taskInput, { target: { value: "保留这段任务" } });
    fireEvent.click(screen.getByRole("button", { name: "选择并插入元素" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "取消选择" })).toBeVisible();
    });

    const handlePanelEvent =
      browserMock.runtime.onMessage.addListener.mock.calls.at(-1)?.[0];
    if (!handlePanelEvent) {
      throw new Error("Page state listener was not registered");
    }
    handlePanelEvent({
      target: "panel",
      type: "page-state-changed",
      state: EMPTY_PAGE_STATE,
    });

    expect(
      await screen.findByRole<HTMLTextAreaElement>("textbox", {
        name: "页面任务",
      }),
    ).toHaveValue("保留这段任务");
  });

  it("creates, updates, runs, and deletes a saved workflow", async () => {
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
    browserMock.storage.local.set.mockResolvedValue(undefined);
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

    fireEvent.click(await screen.findByRole("tab", { name: "操作页面" }));
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
          version: 1,
          workflows: [
            {
              id: expect.any(String),
              name: "提交日报",
              task: "填写并提交日报",
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
        "hyperpage.pageWorkflows": { version: 1, workflows: [] },
      });
    });
  });

  it("drags the launcher within the viewport without opening the panel", async () => {
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
        <App initialOpen={false} />
      </TooltipProvider>,
    );

    const launcher = await screen.findByRole("button", {
      name: "打开 HyperPage AI",
    });
    mockPointerCapture(launcher);
    vi.spyOn(launcher, "getBoundingClientRect").mockReturnValue({
      x: 726,
      y: 526,
      left: 726,
      top: 526,
      right: 784,
      bottom: 584,
      width: 58,
      height: 58,
      toJSON: () => ({}),
    });

    fireEvent(launcher, createPointerEvent("pointerdown", 1, 750, 550));
    fireEvent(launcher, createPointerEvent("pointermove", 1, -100, -100));
    fireEvent(launcher, createPointerEvent("pointerup", 1, -100, -100));

    expect(launcher).toHaveStyle({
      left: "8px",
      top: "8px",
      right: "auto",
      bottom: "auto",
    });

    fireEvent.click(launcher);
    expect(browserMock.runtime.sendMessage).not.toHaveBeenCalledWith({
      target: "background",
      type: "set-panel-visibility",
      visible: true,
    });
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

    await screen.findByRole("button", { name: "选择元素" });
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

    await screen.findByRole("button", { name: "选择元素" });
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

    await screen.findByRole("button", { name: "选择元素" });
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
      "grid",
      "min-h-0",
      "flex-1",
      "content-start",
      "overflow-y-auto",
    );
    expect(scrollRegion).not.toHaveClass("flex", "flex-col");

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
    expect(scrollRegion?.contains(feedback)).toBe(false);
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
    async (errorCode, statusLabel, status, resultText) => {
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

      fireEvent.click(await screen.findByRole("tab", { name: "操作页面" }));
      fireEvent.change(screen.getByRole("textbox", { name: "页面任务" }), {
        target: { value: "尝试提交页面" },
      });
      fireEvent.click(screen.getByRole("button", { name: "执行" }));

      await waitFor(() => {
        expect(screen.getByText(statusLabel)).toBeVisible();
        expect(screen.getByText(resultText)).toBeVisible();
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

    fireEvent.click(await screen.findByRole("tab", { name: "操作页面" }));
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
