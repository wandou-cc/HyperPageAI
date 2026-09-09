import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultSettings } from "../shared/settings";

const browserMock = vi.hoisted(() => ({
  i18n: {
    getUILanguage: vi.fn(() => "zh-CN"),
  },
  runtime: {
    getURL: vi.fn((path: string) => `chrome-extension://test${path}`),
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
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(":root { --background: white; } .hp-panel { display: flex; }"),
      ),
  );
});

describe("page content UI host", () => {
  it("is built for explicit runtime injection instead of page-load registration", () => {
    expect(contentScript.registration).toBe("runtime");
    expect(contentScript.matches).toEqual([]);
    expect(contentScript.cssInjectionMode).toBe("manual");
  });

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
    expect(createShadowRootUiMock.mock.calls[0]?.[1].mode).toBe("closed");
    expect(createShadowRootUiMock.mock.calls[0]?.[1].css).toContain(
      ":host { --background: white; }",
    );
    expect(shadowHost.getAttribute("popover")).toBe("manual");
    expect(showPopover).toHaveBeenCalledOnce();
    expect(shadowHost.style.getPropertyValue("position")).toBe("fixed");
    expect(shadowHost.style.getPropertyPriority("position")).toBe("important");
    expect(shadowHost.style.getPropertyValue("z-index")).toBe("2147483647");
    expect(shadowHost.style.getPropertyPriority("z-index")).toBe("important");
  });

  it("removes an activated page when disabled and does not remount on enable", async () => {
    const disabledSettings = {
      ...createDefaultSettings("zh-CN"),
      enabled: false,
    } as const;
    const enabledSettings = { ...disabledSettings, enabled: true } as const;
    browserMock.storage.local.get.mockResolvedValue({
      "hyperpage.settings": enabledSettings,
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

    expect(pageControllerMock.construct).toHaveBeenCalledWith(enabledSettings);
    expect(mount).toHaveBeenCalledOnce();
    const handleStorageChange =
      browserMock.storage.onChanged.addListener.mock.calls.at(-1)?.[0];
    if (!handleStorageChange) {
      throw new Error("Storage change listener was not registered");
    }

    handleStorageChange(
      { "hyperpage.settings": { newValue: disabledSettings } },
      "local",
    );
    await vi.waitFor(() => {
      expect(pageControllerMock.destroy).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledOnce();
    });

    handleStorageChange(
      { "hyperpage.settings": { newValue: enabledSettings } },
      "local",
    );
    expect(pageControllerMock.construct).toHaveBeenCalledOnce();
    expect(mount).toHaveBeenCalledOnce();
  });
});
