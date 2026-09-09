import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "./render-with-messages";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../components/ui/tooltip";
import {
  HostPermissionsView,
  LocalDataView,
} from "../entrypoints/sidepanel/DataSettings";
import { downloadText } from "../shared/export";
import { createDefaultSettings } from "../shared/settings";

const browserMock = vi.hoisted(() => ({
  runtime: { sendMessage: vi.fn() },
  storage: { local: { get: vi.fn(), getBytesInUse: vi.fn(), remove: vi.fn() } },
}));
vi.mock("wxt/browser", () => ({ browser: browserMock }));
vi.mock("../shared/export", () => ({ downloadText: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("data and permission controls", () => {
  it("exports a selected category and clears saved data only after confirmation", async () => {
    const values: Record<string, unknown> = {
      "hyperpage.settings": createDefaultSettings("en"),
    };
    browserMock.storage.local.get.mockImplementation(async () => ({
      ...values,
    }));
    browserMock.storage.local.getBytesInUse.mockImplementation(
      async (keys: string[]) => keys.length * 64,
    );
    browserMock.storage.local.remove.mockImplementation(
      async (keys: string[]) => {
        for (const key of keys) delete values[key];
      },
    );
    const onCleared = vi.fn();
    render(
      <TooltipProvider>
        <LocalDataView locale="en" onCleared={onCleared} />
      </TooltipProvider>,
    );
    expect(await screen.findByText("Settings (1)")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Export data: Settings" }),
    );
    expect(downloadText).toHaveBeenCalledWith(
      expect.stringContaining('"settings"'),
      "hyperpage-settings.json",
      "application/json;charset=utf-8",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Clear all saved data" }),
    );
    expect(browserMock.storage.local.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(browserMock.storage.local.remove).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear all saved data" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    expect(await screen.findByText("Settings (0)")).toBeVisible();
    expect(browserMock.storage.local.remove).toHaveBeenCalledWith([
      "hyperpage.settings",
    ]);
    expect(onCleared).toHaveBeenCalledOnce();
  });

  it("keeps deletion available for invalid saved records", async () => {
    browserMock.storage.local.get.mockResolvedValue({
      "hyperpage.settings": { version: 100 },
    });
    browserMock.storage.local.getBytesInUse.mockResolvedValue(0);
    browserMock.storage.local.remove.mockResolvedValue(undefined);
    render(
      <TooltipProvider>
        <LocalDataView locale="en" />
      </TooltipProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("alertdialog", { hidden: true })).toHaveTextContent("saved settings"),
    );
    expect(
      screen.getByRole("button", { name: "Clear data: Settings" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Export all saved data" }),
    ).toBeDisabled();
  });

  it("shows actual remaining access when a host is also covered by a broad grant", async () => {
    const provider = { origin: "https://api.example/*", granted: true };
    browserMock.runtime.sendMessage.mockResolvedValueOnce({
      ok: true,
      data: {
        origins: [provider.origin, "https://*/*"],
        providers: [provider],
      },
    });
    browserMock.runtime.sendMessage.mockResolvedValueOnce({
      ok: true,
      data: { origins: ["https://*/*"], providers: [provider] },
    });
    render(
      <TooltipProvider>
        <HostPermissionsView locale="en" />
      </TooltipProvider>,
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: `Revoke access: ${provider.origin}`,
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", {
          name: `Revoke access: ${provider.origin}`,
        }),
      ).toBeNull(),
    );
    expect(screen.getByText("Authorized")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Revoke access: https://*/*" }),
    ).toBeEnabled();
    expect(browserMock.runtime.sendMessage).toHaveBeenLastCalledWith({
      target: "background",
      type: "revoke-host-access",
      origin: provider.origin,
    });
  });

  it("does not display a stale permission state after refresh fails", async () => {
    browserMock.runtime.sendMessage.mockResolvedValueOnce({
      ok: true,
      data: {
        origins: [],
        providers: [{ origin: "https://api.example/*", granted: true }],
      },
    });
    browserMock.runtime.sendMessage.mockResolvedValueOnce({
      ok: false,
      error: "Permission query failed",
    });
    render(
      <TooltipProvider>
        <HostPermissionsView locale="en" />
      </TooltipProvider>,
    );
    expect(await screen.findByText("Authorized")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh permissions" }),
    );
    expect(await screen.findByRole("alertdialog", { hidden: true })).toHaveTextContent(
      "Permission query failed",
    );
    expect(screen.queryByText("Authorized")).toBeNull();
  });
});
