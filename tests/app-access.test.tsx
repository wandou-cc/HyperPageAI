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

const EMPTY_PAGE_STATE = {
  selection: null,
  selectionRevision: 0,
  canUndoHide: false,
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
        version: 2,
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
        version: 2,
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
        version: 2,
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

  it("drags the launcher within the viewport without opening the panel", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(800);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(600);
    browserMock.storage.local.get.mockResolvedValue({
      "hyperpage.settings": {
        version: 2,
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
        version: 2,
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
});
