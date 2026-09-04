import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../components/ui/tooltip";
import { SettingsView } from "../entrypoints/sidepanel/SettingsView";

const browserMock = vi.hoisted(() => ({
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("provider settings view", () => {
  it("loads models and renders shadcn selectors for model and language", async () => {
    browserMock.runtime.sendMessage.mockResolvedValue({
      ok: true,
      data: ["gpt-4.1", "gpt-4.1-mini"],
    });

    render(
      <TooltipProvider>
        <SettingsView
          settings={{
            version: 2,
            locale: "zh_CN",
            provider: null,
            resultDisplayMode: "floating",
          }}
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
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({
      target: "background",
      type: "list-models",
      credentials: {
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
          settings={{
            version: 2,
            locale: "zh_CN",
            provider: null,
            resultDisplayMode: "floating",
          }}
          onSaved={onSaved}
        />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "插入页面" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({
        version: 2,
        locale: "zh_CN",
        provider: null,
        resultDisplayMode: "inline",
      });
    });
    expect(browserMock.storage.local.set).toHaveBeenCalledWith({
      "hyperpage.settings": {
        version: 2,
        locale: "zh_CN",
        provider: null,
        resultDisplayMode: "inline",
      },
    });
  });
});
