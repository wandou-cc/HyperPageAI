import { browser } from "wxt/browser";

import type {
  Locale,
  ProviderConfig,
  ProviderCredentials,
  ResultDisplayMode,
  StoredSettings,
} from "./messages";

export const SETTINGS_STORAGE_KEY = "hyperpage.settings";
export const SETTINGS_VERSION = 2;

interface LegacySettingsV1 {
  locale: Locale;
  provider: ProviderConfig | null;
}

// Creates the first-run settings from Chrome's current interface language.
export function createDefaultSettings(uiLanguage: string): StoredSettings {
  return {
    version: SETTINGS_VERSION,
    locale: uiLanguage.toLowerCase().startsWith("zh") ? "zh_CN" : "en",
    provider: null,
    resultDisplayMode: "floating",
  };
}

// Converts the only previous settings shape into the current persisted schema.
export function parseStoredSettings(value: unknown): StoredSettings {
  if (!value || typeof value !== "object") throw new Error("settingsInvalid");
  const candidate = value as Record<string, unknown>;
  const locale = candidate.locale;
  if (locale !== "zh_CN" && locale !== "en") {
    throw new Error("settingsInvalid");
  }
  if (!("provider" in candidate)) throw new Error("settingsInvalid");

  if (!("version" in candidate)) {
    const legacy = candidate as unknown as LegacySettingsV1;
    return {
      version: SETTINGS_VERSION,
      locale,
      provider: legacy.provider,
      resultDisplayMode: "floating",
    };
  }

  const resultDisplayMode = candidate.resultDisplayMode;
  if (
    candidate.version !== SETTINGS_VERSION ||
    (resultDisplayMode !== "floating" && resultDisplayMode !== "inline")
  ) {
    throw new Error("settingsInvalid");
  }

  return candidate as unknown as StoredSettings;
}

// Validates the connection fields before any request is sent to the provider.
export function parseProviderCredentials(
  input: ProviderCredentials,
): ProviderCredentials {
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, "");
  const apiKey = input.apiKey.trim();

  if (!baseUrl) throw new Error("baseUrlRequired");
  if (!apiKey) throw new Error("apiKeyRequired");

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("baseUrlInvalid");
  }

  const localHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");

  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("baseUrlProtocol");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("baseUrlInvalid");
  }
  if (
    url.pathname.endsWith("/chat/completions") ||
    url.pathname.endsWith("/models")
  ) {
    throw new Error("baseUrlEndpoint");
  }

  return { baseUrl, apiKey };
}

// Validates and normalizes the complete provider form before it is persisted.
export function parseProviderConfig(input: ProviderConfig): ProviderConfig {
  const credentials = parseProviderCredentials(input);
  const model = input.model.trim();
  const targetLanguage = input.targetLanguage.trim();

  if (!model) throw new Error("modelRequired");
  if (!targetLanguage) throw new Error("targetLanguageRequired");

  return {
    ...credentials,
    model,
    supportsVision: input.supportsVision,
    targetLanguage,
  };
}

// Returns the configured OpenAI-compatible Chat Completions endpoint.
export function getChatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl}/chat/completions`;
}

// Returns the standard OpenAI-compatible model-list endpoint.
export function getModelsUrl(baseUrl: string): string {
  return `${baseUrl}/models`;
}

// Loads settings while preserving the explicit first-run state when no value exists.
export async function loadSettings(
  uiLanguage: string,
): Promise<StoredSettings> {
  const stored = await browser.storage.local.get(SETTINGS_STORAGE_KEY);
  const value = stored[SETTINGS_STORAGE_KEY] as unknown;
  if (value === undefined) return createDefaultSettings(uiLanguage);

  const settings = parseStoredSettings(value);
  if (!("version" in (value as Record<string, unknown>))) {
    await saveSettings(settings);
  }
  return settings;
}

// Persists the complete settings object as one coherent configuration revision.
export async function saveSettings(settings: StoredSettings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings });
}
