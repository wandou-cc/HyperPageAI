import { afterEach, describe, expect, it, vi } from "vitest";

import background, {
  fetchAvailableModels,
  handleBackgroundRequest,
} from "../entrypoints/background";

const EMPTY_PAGE_STATE = {
  selection: null,
  selectionRevision: 0,
  canUndoHide: false,
  canUndoReplace: false,
  canRemoveInsertion: false,
  selecting: false,
};

const browserMock = vi.hoisted(() => ({
  action: {
    onClicked: {
      addListener: vi.fn(),
    },
  },
  i18n: {
    getUILanguage: vi.fn(() => "en"),
  },
  runtime: {
    onMessage: {
      addListener: vi.fn(),
    },
  },
  storage: {
    local: {
      get: vi.fn(),
    },
    session: {
      get: vi.fn(),
      set: vi.fn(),
      setAccessLevel: vi.fn(),
    },
  },
  tabs: {
    sendMessage: vi.fn(),
  },
}));

vi.mock("wxt/browser", () => ({ browser: browserMock }));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("floating panel activation", () => {
  it("toggles the session-wide panel state from the toolbar", async () => {
    browserMock.storage.session.setAccessLevel.mockResolvedValue(undefined);
    browserMock.storage.session.get.mockResolvedValue({
      "hyperpage.panelVisible": false,
    });
    browserMock.storage.session.set.mockResolvedValue(undefined);
    background.main();

    expect(browserMock.storage.session.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS",
    });
    const handleActionClick =
      browserMock.action.onClicked.addListener.mock.calls.at(0)?.[0];
    if (!handleActionClick) throw new Error("Action listener was not registered");
    handleActionClick({ id: 42 });

    await vi.waitFor(() => {
      expect(browserMock.storage.session.set).toHaveBeenCalledWith({
        "hyperpage.panelVisible": true,
      });
    });
  });
});

describe("source tab routing", () => {
  const pageStateRequest = {
    target: "background" as const,
    type: "page-command" as const,
    command: { type: "get-page-state" as const },
  };

  it("rejects page commands that do not originate from a content script", async () => {
    await expect(handleBackgroundRequest(pageStateRequest)).resolves.toEqual({
      ok: false,
      error: "activeTabUnavailable",
    });
  });

  it("routes page commands back to the declarative controller in the sender tab", async () => {
    browserMock.tabs.sendMessage.mockResolvedValue({
      ok: true,
      data: EMPTY_PAGE_STATE,
    });

    await expect(
      handleBackgroundRequest(pageStateRequest, {
        id: 42,
        windowId: 3,
      } as Browser.tabs.Tab),
    ).resolves.toEqual({ ok: true, data: EMPTY_PAGE_STATE });
    expect(browserMock.tabs.sendMessage).toHaveBeenCalledWith(42, {
      target: "content",
      command: { type: "get-page-state" },
    });
  });
});

describe("inline AI actions", () => {
  it("processes the exact text range supplied by the content script", async () => {
    browserMock.storage.local.get.mockResolvedValue({
      "hyperpage.settings": {
        version: 2,
        locale: "en",
        provider: {
          baseUrl: "https://api.example.com/v1",
          apiKey: "secret",
          model: "gpt-4.1-mini",
          supportsVision: true,
          targetLanguage: "Simplified Chinese",
        },
        resultDisplayMode: "floating",
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "精确翻译" } }],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = {
      target: "background" as const,
      type: "run-inline-ai" as const,
      requestId: "inline-1",
      request: { action: "translate" as const },
      selection: {
        kind: "text" as const,
        tagName: "p",
        text: "an unfamiliar phrase",
        accessibleName: "",
        role: "",
        editable: false,
        rect: { x: 10, y: 20, width: 160, height: 20 },
        viewport: { width: 1200, height: 800 },
      },
    };

    await expect(
      handleBackgroundRequest(request, {
        id: 42,
        windowId: 3,
      } as Browser.tabs.Tab),
    ).resolves.toEqual({ ok: true, data: "精确翻译" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("an unfamiliar phrase"),
      }),
    );
  });
});

describe("provider models", () => {
  it("requests and sorts model IDs from the standard models endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "gpt-4.1-mini" }, { id: "gpt-4.1" }],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchAvailableModels({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
      }),
    ).resolves.toEqual(["gpt-4.1", "gpt-4.1-mini"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/models",
      {
        method: "GET",
        headers: { Authorization: "Bearer secret" },
      },
    );
  });

  it("rejects empty and malformed model lists", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ name: "missing-id" }] })),
      );
    vi.stubGlobal("fetch", fetchMock);
    const credentials = {
      baseUrl: "https://api.example.com/v1",
      apiKey: "secret",
    };

    await expect(fetchAvailableModels(credentials)).rejects.toThrow(
      "modelListEmpty",
    );
    await expect(fetchAvailableModels(credentials)).rejects.toThrow(
      "modelListResponseInvalid",
    );
  });
});
