import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "./render-with-messages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../components/ui/tooltip";
import { SettingsView } from "../entrypoints/sidepanel/SettingsView";
import {
  createDefaultSettings,
  createUnknownCapabilities,
} from "../shared/settings";
import type { BackgroundRequest, StoredSettings } from "../shared/messages";

const browserMock = vi.hoisted(() => ({
  permissions: { request: vi.fn() },
  runtime: {
    sendMessage: vi.fn(),
  },
  storage: {
    local: {
      set: vi.fn(),
    },
  },
}));

vi.mock("wxt/browser", () => ({ browser: browserMock }));

beforeEach(() => {
  browserMock.permissions.request.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("provider settings view", () => {
  it.each(["OpenAI Responses", "Anthropic Claude", "Google Gemini"])("loads and saves the selected %s protocol", async (label) => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    const settings = providerSettings();
    const first = settings.providers[0];
    if (!first) throw new Error("Missing provider");
    first.config.capabilities.vision = { status: "supported", checkedAt: 100 };
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: true, data: ["One-model"] });
    const onSaved = vi.fn();
    render(<TooltipProvider><SettingsView settings={settings} onSaved={onSaved} /></TooltipProvider>);
    fireEvent.click(screen.getByRole("combobox", { name: "API protocol" }));
    const option = await screen.findByRole("option", { name: label });
    fireEvent.pointerDown(option);
    fireEvent.click(option);
    fireEvent.click(screen.getByRole("button", { name: "Get models" }));
    const protocol = label === "OpenAI Responses" ? "responses" : label === "Anthropic Claude" ? "anthropic" : "gemini";
    await waitFor(() => expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "list-models", credentials: { protocol, baseUrl: "https://one.example/v1", apiKey: "One-key" } })));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ providers: [
      expect.objectContaining({ config: expect.objectContaining({ protocol, capabilities: expect.objectContaining({ vision: { status: "unknown" } }) }) }),
      expect.objectContaining({ config: expect.objectContaining({ protocol: "chat-completions" }) }),
    ] }));
  });

  const providerSettings = (): StoredSettings => ({
    ...createDefaultSettings("en"),
    providers: ["One", "Two"].map((name) => ({
      id: name,
      name,
      config: {
        protocol: "chat-completions",
        baseUrl: `https://${name.toLowerCase()}.example/v1`,
        apiKey: `${name}-key`,
        model: `${name}-model`,
        targetLanguage: "English",
        capabilities: createUnknownCapabilities(),
      },
    })),
    taskModels: { chat: "One", text: "One", vision: "Two", automation: "Two" },
  });

  it("keeps model configurations separate and persists explicit task assignments", async () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: true, data: null });
    const onSaved = vi.fn();
    render(
      <TooltipProvider>
        <SettingsView settings={providerSettings()} onSaved={onSaved} />
      </TooltipProvider>,
    );
    await act(async () =>
      fireEvent.click(
        screen.getByRole("combobox", { name: "Configured models" }),
      ),
    );
    const secondProfile = screen.getByRole("option", { name: "Two-model (Two)" });
    expect(secondProfile).toBeVisible();
    fireEvent.pointerDown(secondProfile);
    fireEvent.click(secondProfile);
    expect(screen.getByLabelText("API Key")).toHaveValue("Two-key");
    fireEvent.change(screen.getByLabelText("Configuration name"), {
      target: { value: "Image service" },
    });
    await act(async () =>
      fireEvent.click(
        screen.getByRole("combobox", { name: "Conversation and reading" }),
      ),
    );
    const imageModel = screen.getByRole("option", { name: "Two-model (Image service)" });
    expect(imageModel).toBeVisible();
    fireEvent.pointerDown(imageModel);
    fireEvent.click(imageModel);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const saved = onSaved.mock.calls[0]?.[0] as StoredSettings;
    expect(saved.providers).toHaveLength(2);
    expect(saved.providers[0]?.config.apiKey).toBe("One-key");
    expect(saved.providers[1]?.name).toBe("Image service");
    expect(saved.taskModels).toEqual({
      chat: "Two",
      text: "One",
      vision: "Two",
      automation: "Two",
    });
    expect(browserMock.permissions.request).toHaveBeenCalledExactlyOnceWith({
      origins: ["https://one.example/*", "https://two.example/*"],
    });
  });

  it("clears assignments when their model configuration is deleted", async () => {
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: true, data: null });
    const onSaved = vi.fn();
    render(
      <TooltipProvider>
        <SettingsView settings={providerSettings()} onSaved={onSaved} />
      </TooltipProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete model" }),
    );
    expect(screen.getByLabelText("API Key")).toHaveValue("Two-key");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(
        expect.objectContaining({
          taskModels: {
            chat: null,
            text: null,
            vision: "Two",
            automation: "Two",
          },
          providers: [expect.objectContaining({ id: "Two" })],
        }),
      ),
    );
  });

  it("loads models and renders shadcn selectors for model and language", async () => {
    browserMock.runtime.sendMessage.mockResolvedValue({
      ok: true,
      data: ["gpt-4.1", "gpt-4.1-mini"],
    });

    render(
      <TooltipProvider>
        <SettingsView
          settings={createDefaultSettings("zh-CN")}
          onSaved={vi.fn()}
        />
      </TooltipProvider>,
    );

    const modelSelect = screen.getByRole("combobox", { name: "模型" });
    expect(modelSelect).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://api.example.com/v1/" },
    });
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "获取模型" }));

    await waitFor(() => expect(modelSelect).toBeEnabled());
    expect(browserMock.permissions.request).toHaveBeenCalledExactlyOnceWith({
      origins: ["https://api.example.com/*"],
    });
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({
      target: "background",
      type: "list-models",
      credentials: {
        protocol: "chat-completions",
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
      },
    });

    expect(modelSelect).toHaveTextContent("选择模型");

    const outputLanguage = screen.getByRole("combobox", {
      name: "输出语言",
    });
    expect(outputLanguage).not.toBeInstanceOf(HTMLSelectElement);
    expect(outputLanguage).toHaveTextContent("简体中文");
  });

  it("persists the selected quick-action result destination", async () => {
    const onSaved = vi.fn();
    render(
      <TooltipProvider>
        <SettingsView
          settings={createDefaultSettings("zh-CN")}
          onSaved={onSaved}
        />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "插入页面" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({
        ...createDefaultSettings("zh-CN"),
        resultDisplayMode: "inline",
        allowMultiTab: false,
      });
    });
    expect(browserMock.storage.local.set).toHaveBeenCalledWith({
      "hyperpage.settings": {
        ...createDefaultSettings("zh-CN"),
        resultDisplayMode: "inline",
        allowMultiTab: false,
      },
    });
  });

  it("persists the explicit multi-tab task switch", async () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    browserMock.runtime.sendMessage.mockResolvedValue({
      ok: true,
      data: null,
    });
    const onSaved = vi.fn();
    render(
      <TooltipProvider>
        <SettingsView
          settings={createDefaultSettings("zh-CN")}
          onSaved={onSaved}
        />
      </TooltipProvider>,
    );

    const multiTabSwitch = screen.getByRole("switch", {
      name: "允许页面任务使用多个标签页",
    });
    expect(multiTabSwitch).not.toBeChecked();
    fireEvent.click(multiTabSwitch);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({
        ...createDefaultSettings("zh-CN"),
        resultDisplayMode: "floating",
        allowMultiTab: true,
      });
    });
    expect(browserMock.permissions.request).toHaveBeenCalledExactlyOnceWith({
      origins: ["http://*/*", "https://*/*"],
    });
  });

  it("saves model configuration without a long-content processing option", async () => {
    const onSaved = vi.fn();
    render(<TooltipProvider><SettingsView settings={providerSettings()} onSaved={onSaved} /></TooltipProvider>);
    expect(screen.queryByRole("switch", { name: "Process long content in chunks" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(providerSettings()));
    expect(screen.getByRole("dialog", { name: "Settings saved" })).toBeVisible();
  });

  it("does not persist settings when the combined host grant is denied", async () => {
    browserMock.permissions.request.mockResolvedValue(false);
    const onSaved = vi.fn();
    render(
      <TooltipProvider>
        <SettingsView settings={providerSettings()} onSaved={onSaved} />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alertdialog", { hidden: true })).toHaveTextContent("access");
    expect(browserMock.permissions.request).toHaveBeenCalledOnce();
    expect(browserMock.storage.local.set).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
