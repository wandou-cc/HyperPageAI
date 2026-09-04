import { beforeEach, describe, expect, it, vi } from "vitest";

const browserMock = vi.hoisted(() => ({
  i18n: {
    getUILanguage: vi.fn(() => "zh-CN"),
  },
  runtime: {
    sendMessage: vi.fn(),
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

const createShadowRootUiMock = vi.hoisted(() => vi.fn());
const pageControllerMock = vi.hoisted(() => ({
  construct: vi.fn(),
  updateSettings: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock("wxt/browser", () => ({ browser: browserMock }));
vi.mock("wxt/utils/content-script-ui/shadow-root", () => ({
  createShadowRootUi: createShadowRootUiMock,
}));
vi.mock("react-dom/client", () => ({
  default: {
    createRoot: vi.fn(() => ({
      render: vi.fn(),
      unmount: vi.fn(),
    })),
  },
}));
vi.mock("../entrypoints/sidepanel/App", () => ({ App: () => null }));
vi.mock("../lib/page-controller", () => ({
  PageController: class {
    constructor(settings: unknown) {
      pageControllerMock.construct(settings);
    }

    updateSettings = pageControllerMock.updateSettings;
    destroy = pageControllerMock.destroy;
  },
}));

import contentScript from "../entrypoints/page.content";

beforeEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
  browserMock.storage.local.get.mockResolvedValue({});
  browserMock.runtime.sendMessage.mockResolvedValue({ ok: true, data: false });
});

describe("page content UI host", () => {
  it("enters the top layer after mount without losing protected host styles", async () => {
    const shadowHost = document.createElement("hyperpage-panel");
    const shadow = shadowHost.attachShadow({ mode: "open" });
    const uiContainer = document.createElement("div");
    shadow.append(uiContainer);
    const showPopover = vi.fn();
    Object.defineProperty(shadowHost, "showPopover", { value: showPopover });

    const mount = vi.fn(() => {
      document.body.append(shadowHost);
      shadowHost.style.position = "relative";
      shadowHost.style.zIndex = "2147483647";
    });
    createShadowRootUiMock.mockResolvedValue({
      mount,
      remove: vi.fn(),
      autoMount: vi.fn(),
      shadow,
      shadowHost,
      uiContainer,
      mounted: undefined,
    });

    if (typeof contentScript.main !== "function") {
      throw new Error("Expected an isolated-world content script");
    }
    await contentScript.main({ onInvalidated: vi.fn() } as never);

    expect(mount).toHaveBeenCalledOnce();
    expect(shadowHost.getAttribute("popover")).toBe("manual");
    expect(showPopover).toHaveBeenCalledOnce();
    expect(shadowHost.style.getPropertyValue("position")).toBe("fixed");
    expect(shadowHost.style.getPropertyPriority("position")).toBe("important");
    expect(shadowHost.style.getPropertyValue("z-index")).toBe("2147483647");
    expect(shadowHost.style.getPropertyPriority("z-index")).toBe("important");
  });

  it("mounts no page entry or controller while the extension is disabled", async () => {
    const disabledSettings = {
      version: 4,
      enabled: false,
      locale: "zh_CN",
      provider: null,
      resultDisplayMode: "floating",
      allowMultiTab: false,
    } as const;
    const enabledSettings = { ...disabledSettings, enabled: true } as const;
    browserMock.storage.local.get.mockResolvedValue({
      "hyperpage.settings": disabledSettings,
    });

    const shadowHost = document.createElement("hyperpage-panel");
    const shadow = shadowHost.attachShadow({ mode: "open" });
    const uiContainer = document.createElement("div");
    shadow.append(uiContainer);
    Object.defineProperty(shadowHost, "showPopover", { value: vi.fn() });
    const mount = vi.fn();
    const remove = vi.fn();
    createShadowRootUiMock.mockResolvedValue({
      mount,
      remove,
      autoMount: vi.fn(),
      shadow,
      shadowHost,
      uiContainer,
      mounted: undefined,
    });

    if (typeof contentScript.main !== "function") {
      throw new Error("Expected an isolated-world content script");
    }
    await contentScript.main({ onInvalidated: vi.fn() } as never);

    expect(pageControllerMock.construct).not.toHaveBeenCalled();
    expect(createShadowRootUiMock).not.toHaveBeenCalled();
    const handleStorageChange =
      browserMock.storage.onChanged.addListener.mock.calls.at(-1)?.[0];
    if (!handleStorageChange) {
      throw new Error("Storage change listener was not registered");
    }

    browserMock.storage.local.get.mockResolvedValue({
      "hyperpage.settings": enabledSettings,
    });
    handleStorageChange(
      { "hyperpage.settings": { newValue: enabledSettings } },
      "local",
    );
    await vi.waitFor(() => {
      expect(pageControllerMock.construct).toHaveBeenCalledWith(
        enabledSettings,
      );
      expect(mount).toHaveBeenCalledOnce();
    });

    browserMock.storage.local.get.mockResolvedValue({
      "hyperpage.settings": disabledSettings,
    });
    handleStorageChange(
      { "hyperpage.settings": { newValue: disabledSettings } },
      "local",
    );
    await vi.waitFor(() => {
      expect(pageControllerMock.destroy).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledOnce();
    });
  });
});
