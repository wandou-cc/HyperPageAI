import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../components/ui/tooltip";
import { SettingsPage } from "../entrypoints/options/SettingsPage";
import {
  createDefaultSettings,
  SETTINGS_STORAGE_KEY,
} from "../shared/settings";

const browserMock = vi.hoisted(() => ({
  i18n: { getUILanguage: vi.fn(() => "en") },
  runtime: {
    getURL: vi.fn((path: string) => `chrome-extension://test${path}`),
  },
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      getBytesInUse: vi.fn(),
    },
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
}));
vi.mock("wxt/browser", () => ({ browser: browserMock }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("extension settings page", () => {
  it("renders configuration in the extension page and follows saved language changes", async () => {
    browserMock.storage.local.get.mockResolvedValue({});
    render(
      <TooltipProvider>
        <SettingsPage />
      </TooltipProvider>,
    );
    expect(await screen.findByLabelText("API Key")).toHaveAttribute(
      "type",
      "password",
    );
    expect(document.documentElement.lang).toBe("en");
    const settings = createDefaultSettings("zh-CN");
    browserMock.storage.local.get.mockResolvedValue({
      [SETTINGS_STORAGE_KEY]: settings,
    });
    const listener =
      browserMock.storage.onChanged.addListener.mock.calls[0]?.[0];
    if (!listener) throw new Error("Missing settings listener");
    await act(async () =>
      listener({ [SETTINGS_STORAGE_KEY]: { newValue: settings } }, "local"),
    );
    expect(await screen.findByRole("button", { name: "保存" })).toBeVisible();
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("allows confirmed removal of invalid settings and then loads the configuration form", async () => {
    const values: Record<string, unknown> = {
      [SETTINGS_STORAGE_KEY]: { version: 100 },
    };
    browserMock.storage.local.get.mockImplementation(async () => ({
      ...values,
    }));
    browserMock.storage.local.getBytesInUse.mockResolvedValue(20);
    browserMock.storage.local.remove.mockImplementation(
      async (keys: string[]) => {
        for (const key of keys) delete values[key];
      },
    );
    render(
      <TooltipProvider>
        <SettingsPage />
      </TooltipProvider>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Clear data: Settings" }),
    );
    expect(browserMock.storage.local.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    expect(await screen.findByLabelText("API Key")).toBeVisible();
    expect(browserMock.storage.local.remove).toHaveBeenCalledWith([
      SETTINGS_STORAGE_KEY,
    ]);
  });
});
