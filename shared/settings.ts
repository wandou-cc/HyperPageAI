import { browser } from "wxt/browser";

import type {
  Locale,
  PageAgentExecutionRecord,
  ProviderConfig,
  ProviderCredentials,
  ResultDisplayMode,
  SavedPageWorkflow,
  StoredPageAgentHistory,
  StoredPageWorkflows,
  StoredSettings,
} from "./messages";

export const SETTINGS_STORAGE_KEY = "hyperpage.settings";
export const SETTINGS_VERSION = 4;
export const PAGE_WORKFLOWS_STORAGE_KEY = "hyperpage.pageWorkflows";
export const PAGE_WORKFLOWS_VERSION = 1;
export const PAGE_AGENT_HISTORY_STORAGE_KEY = "hyperpage.pageAgentHistory";
export const PAGE_AGENT_HISTORY_VERSION = 1;
export const PAGE_AGENT_HISTORY_LIMIT = 20;

interface LegacySettingsV1 {
  locale: Locale;
  provider: ProviderConfig | null;
}

interface LegacySettingsV2 extends LegacySettingsV1 {
  version: 2;
  resultDisplayMode: ResultDisplayMode;
}

interface LegacySettingsV3 extends LegacySettingsV1 {
  version: 3;
  enabled: boolean;
  resultDisplayMode: ResultDisplayMode;
}

// Creates the first-run settings from Chrome's current interface language.
export function createDefaultSettings(uiLanguage: string): StoredSettings {
  return {
    version: SETTINGS_VERSION,
    enabled: true,
    locale: uiLanguage.toLowerCase().startsWith("zh") ? "zh_CN" : "en",
    provider: null,
    resultDisplayMode: "floating",
    allowMultiTab: false,
  };
}

// Converts earlier settings shapes into the current persisted schema.
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
      enabled: true,
      locale,
      provider: legacy.provider,
      resultDisplayMode: "floating",
      allowMultiTab: false,
    };
  }

  const resultDisplayMode = candidate.resultDisplayMode;
  if (candidate.version === 2) {
    if (resultDisplayMode !== "floating" && resultDisplayMode !== "inline") {
      throw new Error("settingsInvalid");
    }
    const legacy = candidate as unknown as LegacySettingsV2;
    return {
      version: SETTINGS_VERSION,
      enabled: true,
      locale,
      provider: legacy.provider,
      resultDisplayMode: legacy.resultDisplayMode,
      allowMultiTab: false,
    };
  }
  if (candidate.version === 3) {
    if (
      typeof candidate.enabled !== "boolean" ||
      (resultDisplayMode !== "floating" && resultDisplayMode !== "inline")
    ) {
      throw new Error("settingsInvalid");
    }
    const legacy = candidate as unknown as LegacySettingsV3;
    return {
      version: SETTINGS_VERSION,
      enabled: legacy.enabled,
      locale,
      provider: legacy.provider,
      resultDisplayMode: legacy.resultDisplayMode,
      allowMultiTab: false,
    };
  }
  if (
    candidate.version !== SETTINGS_VERSION ||
    typeof candidate.enabled !== "boolean" ||
    typeof candidate.allowMultiTab !== "boolean" ||
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
  if ((value as Record<string, unknown>).version !== SETTINGS_VERSION) {
    await saveSettings(settings);
  }
  return settings;
}

// Persists the complete settings object as one coherent configuration revision.
export async function saveSettings(settings: StoredSettings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings });
}

// Validates the independently versioned collection of reusable page tasks.
export function parseStoredPageWorkflows(value: unknown): StoredPageWorkflows {
  if (!value || typeof value !== "object") {
    throw new Error("pageWorkflowsInvalid");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== PAGE_WORKFLOWS_VERSION) {
    throw new Error("pageWorkflowsInvalid");
  }
  if (!Array.isArray(candidate.workflows)) {
    throw new Error("pageWorkflowsInvalid");
  }

  const ids = new Set<string>();
  for (const item of candidate.workflows) {
    if (!item || typeof item !== "object") {
      throw new Error("pageWorkflowsInvalid");
    }
    const workflow = item as Record<string, unknown>;
    if (
      typeof workflow.id !== "string" ||
      !workflow.id ||
      workflow.id !== workflow.id.trim() ||
      ids.has(workflow.id) ||
      typeof workflow.name !== "string" ||
      !workflow.name ||
      workflow.name !== workflow.name.trim() ||
      typeof workflow.task !== "string" ||
      !workflow.task ||
      workflow.task !== workflow.task.trim()
    ) {
      throw new Error("pageWorkflowsInvalid");
    }
    ids.add(workflow.id);
  }

  return candidate as unknown as StoredPageWorkflows;
}

// Loads saved page workflows without creating storage on first use.
export async function loadPageWorkflows(): Promise<SavedPageWorkflow[]> {
  const stored = await browser.storage.local.get(PAGE_WORKFLOWS_STORAGE_KEY);
  const value = stored[PAGE_WORKFLOWS_STORAGE_KEY] as unknown;
  if (value === undefined) return [];
  return parseStoredPageWorkflows(value).workflows;
}

// Persists one validated workflow collection as a coherent revision.
export async function savePageWorkflows(
  workflows: SavedPageWorkflow[],
): Promise<void> {
  const stored: StoredPageWorkflows = {
    version: PAGE_WORKFLOWS_VERSION,
    workflows,
  };
  parseStoredPageWorkflows(stored);
  await browser.storage.local.set({ [PAGE_WORKFLOWS_STORAGE_KEY]: stored });
}

// Validates persisted page-task records before they are rendered in the panel.
export function parseStoredPageAgentHistory(
  value: unknown,
): StoredPageAgentHistory {
  if (!value || typeof value !== "object") {
    throw new Error("pageAgentHistoryInvalid");
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== PAGE_AGENT_HISTORY_VERSION ||
    !Array.isArray(candidate.records) ||
    candidate.records.length > PAGE_AGENT_HISTORY_LIMIT
  ) {
    throw new Error("pageAgentHistoryInvalid");
  }

  const ids = new Set<string>();
  for (const item of candidate.records) {
    if (!item || typeof item !== "object") {
      throw new Error("pageAgentHistoryInvalid");
    }
    const record = item as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      !record.id ||
      record.id !== record.id.trim() ||
      ids.has(record.id) ||
      typeof record.task !== "string" ||
      !record.task ||
      record.task !== record.task.trim() ||
      typeof record.startedAt !== "number" ||
      !Number.isInteger(record.startedAt) ||
      record.startedAt < 0 ||
      typeof record.finishedAt !== "number" ||
      !Number.isInteger(record.finishedAt) ||
      record.finishedAt < record.startedAt ||
      (record.status !== "completed" &&
        record.status !== "incomplete" &&
        record.status !== "failed" &&
        record.status !== "cancelled") ||
      typeof record.result !== "string" ||
      !Array.isArray(record.steps)
    ) {
      throw new Error("pageAgentHistoryInvalid");
    }

    for (const itemStep of record.steps) {
      if (!itemStep || typeof itemStep !== "object") {
        throw new Error("pageAgentHistoryInvalid");
      }
      const step = itemStep as Record<string, unknown>;
      if (
        typeof step.action !== "string" ||
        !step.action ||
        step.action !== step.action.trim() ||
        typeof step.output !== "string" ||
        typeof step.durationMs !== "number" ||
        !Number.isInteger(step.durationMs) ||
        step.durationMs < 0
      ) {
        throw new Error("pageAgentHistoryInvalid");
      }
    }
    ids.add(record.id);
  }

  return candidate as unknown as StoredPageAgentHistory;
}

// Loads page-task history without creating storage before the first execution.
export async function loadPageAgentHistory(): Promise<
  PageAgentExecutionRecord[]
> {
  const stored = await browser.storage.local.get(
    PAGE_AGENT_HISTORY_STORAGE_KEY,
  );
  const value = stored[PAGE_AGENT_HISTORY_STORAGE_KEY] as unknown;
  if (value === undefined) return [];
  return parseStoredPageAgentHistory(value).records;
}

// Persists one validated, bounded page-task history revision.
export async function savePageAgentHistory(
  records: PageAgentExecutionRecord[],
): Promise<void> {
  const stored: StoredPageAgentHistory = {
    version: PAGE_AGENT_HISTORY_VERSION,
    records,
  };
  parseStoredPageAgentHistory(stored);
  await browser.storage.local.set({
    [PAGE_AGENT_HISTORY_STORAGE_KEY]: stored,
  });
}

// Prepends one completed run and returns the exact bounded revision persisted.
export async function addPageAgentExecutionRecord(
  record: PageAgentExecutionRecord,
): Promise<PageAgentExecutionRecord[]> {
  const records = [record, ...(await loadPageAgentHistory())].slice(
    0,
    PAGE_AGENT_HISTORY_LIMIT,
  );
  await savePageAgentHistory(records);
  return records;
}
