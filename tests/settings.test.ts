import { beforeEach, describe, expect, it, vi } from "vitest";

const browserMock = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
    },
  },
}));

vi.mock("wxt/browser", () => ({ browser: browserMock }));

import type { ProviderConfig } from "../shared/messages";
import {
  createDefaultSettings,
  getChatCompletionsUrl,
  getModelsUrl,
  loadSettings,
  parseProviderConfig,
  parseProviderCredentials,
  parseStoredSettings,
} from "../shared/settings";

const validProvider: ProviderConfig = {
  baseUrl: " https://api.example.com/v1/ ",
  apiKey: " secret ",
  model: " vision-model ",
  supportsVision: true,
  targetLanguage: " Simplified Chinese ",
};

describe("provider settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes a valid OpenAI-compatible configuration", () => {
    expect(parseProviderConfig(validProvider)).toEqual({
      baseUrl: "https://api.example.com/v1",
      apiKey: "secret",
      model: "vision-model",
      supportsVision: true,
      targetLanguage: "Simplified Chinese",
    });
  });

  it("validates credentials before a model has been selected", () => {
    expect(
      parseProviderCredentials({
        baseUrl: " https://api.example.com/v1/ ",
        apiKey: " secret ",
      }),
    ).toEqual({
      baseUrl: "https://api.example.com/v1",
      apiKey: "secret",
    });
  });

  it("accepts local HTTP and rejects insecure remote HTTP", () => {
    expect(
      parseProviderConfig({
        ...validProvider,
        baseUrl: "http://localhost:11434/v1",
      }).baseUrl,
    ).toBe("http://localhost:11434/v1");
    expect(() =>
      parseProviderConfig({
        ...validProvider,
        baseUrl: "http://api.example.com/v1",
      }),
    ).toThrow("baseUrlProtocol");
  });

  it("rejects a full endpoint and URLs containing request-specific data", () => {
    expect(() =>
      parseProviderConfig({
        ...validProvider,
        baseUrl: "https://api.example.com/v1/chat/completions",
      }),
    ).toThrow("baseUrlEndpoint");
    expect(() =>
      parseProviderConfig({
        ...validProvider,
        baseUrl: "https://api.example.com/v1?tenant=one",
      }),
    ).toThrow("baseUrlInvalid");
    expect(() =>
      parseProviderCredentials({
        baseUrl: "https://api.example.com/v1/models",
        apiKey: "secret",
      }),
    ).toThrow("baseUrlEndpoint");
  });

  it("derives the exact provider request endpoints", () => {
    expect(getChatCompletionsUrl("https://api.example.com/v1")).toBe(
      "https://api.example.com/v1/chat/completions",
    );
    expect(getModelsUrl("https://api.example.com/v1")).toBe(
      "https://api.example.com/v1/models",
    );
  });

  it("uses Chrome's interface language only for first-run locale", () => {
    expect(createDefaultSettings("zh-CN")).toEqual({
      version: 2,
      locale: "zh_CN",
      provider: null,
      resultDisplayMode: "floating",
    });
    expect(createDefaultSettings("en-US").locale).toBe("en");
  });

  it("migrates the previous settings shape once with floating results", async () => {
    const legacySettings = {
      locale: "zh_CN",
      provider: null,
    };
    browserMock.storage.local.get.mockResolvedValue({
      "hyperpage.settings": legacySettings,
    });

    const settings = await loadSettings("en-US");

    expect(settings).toEqual({
      version: 2,
      locale: "zh_CN",
      provider: null,
      resultDisplayMode: "floating",
    });
    expect(browserMock.storage.local.set).toHaveBeenCalledWith({
      "hyperpage.settings": settings,
    });
  });

  it("rejects unsupported persisted settings revisions", () => {
    expect(() =>
      parseStoredSettings({
        version: 3,
        locale: "en",
        provider: null,
        resultDisplayMode: "floating",
      }),
    ).toThrow("settingsInvalid");
  });
});
