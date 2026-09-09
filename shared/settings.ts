import { browser } from "wxt/browser";
import { z } from "zod";
import { getTemplateVariables, parseSiteOrigins } from "./task-templates";

import type {
  ModelCapabilities,
  ModelCapability,
  ModelTask,
  PageAgentExecutionRecord,
  ProviderConfig,
  ProviderCredentials,
  SavedPageWorkflow,
  StoredPageAgentHistory,
  StoredPageWorkflows,
  StoredSettings,
} from "./messages";

export const SETTINGS_STORAGE_KEY = "hyperpage.settings";
export const SETTINGS_VERSION = 8;
export const PAGE_WORKFLOWS_STORAGE_KEY = "hyperpage.pageWorkflows";
export const PAGE_WORKFLOWS_VERSION = 2;
export const PAGE_AGENT_HISTORY_STORAGE_KEY = "hyperpage.pageAgentHistory";
export const PAGE_AGENT_HISTORY_VERSION = 1;
export const PAGE_AGENT_HISTORY_LIMIT = 20;

z.config({ jitless: true });

export const MODEL_TASKS = ["chat", "text", "vision", "automation"] as const;
const capabilitySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unknown") }).strict(),
  z
    .object({
      status: z.literal("supported"),
      checkedAt: z.number().int().nonnegative().nullable(),
    })
    .strict(),
  z
    .object({
      status: z.literal("failed"),
      checkedAt: z.number().int().nonnegative(),
      error: z.string().min(1),
    })
    .strict(),
]);
const capabilitiesSchema = z
  .object({
    text: capabilitySchema,
    streaming: capabilitySchema,
    vision: capabilitySchema,
    tools: capabilitySchema,
    webSearch: capabilitySchema,
  })
  .strict();
export const PROVIDER_PROTOCOLS = ["chat-completions", "responses", "anthropic", "gemini"] as const;
const legacyCredentialsSchema = z.object({ baseUrl: z.string(), apiKey: z.string() });
const credentialsSchema = legacyCredentialsSchema.extend({ protocol: z.enum(PROVIDER_PROTOCOLS) });
const providerSchema = credentialsSchema
  .extend({
    model: z.string(),
    targetLanguage: z.string(),
    capabilities: capabilitiesSchema,
  })
  .strict();
const legacyProviderSchema = legacyCredentialsSchema
  .extend({
    model: z.string(),
    targetLanguage: z.string(),
    supportsVision: z.boolean(),
  })
  .strict()
  .nullable();
const legacyBaseSchema = z.object({
  locale: z.enum(["zh_CN", "en"]),
  provider: legacyProviderSchema,
});
const displaySchema = z.enum(["floating", "inline"]);
const legacyV2Schema = legacyBaseSchema.extend({
  version: z.literal(2),
  resultDisplayMode: displaySchema,
});
const legacyV3Schema = legacyV2Schema.extend({
  version: z.literal(3),
  enabled: z.boolean(),
});
const legacyV4Schema = legacyV3Schema.extend({
  version: z.literal(4),
  allowMultiTab: z.boolean(),
});
const legacySettingsSchema = z.union([
  legacyBaseSchema.strict(),
  legacyV2Schema.strict(),
  legacyV3Schema.strict(),
  legacyV4Schema.strict(),
]);
const settingsObjectSchema = z
  .object({
    version: z.literal(SETTINGS_VERSION),
    enabled: z.boolean(),
    locale: z.enum(["zh_CN", "en"]),
    resultDisplayMode: displaySchema,
    allowMultiTab: z.boolean(),
    providers: z.array(
      z
        .object({
          id: z.string().trim().min(1),
          name: z.string().trim().min(1).max(100),
          config: providerSchema,
        })
        .strict(),
    ),
    taskModels: z
      .object({
        chat: z.string().nullable(),
        text: z.string().nullable(),
        vision: z.string().nullable(),
        automation: z.string().nullable(),
      })
      .strict(),
  })
  .strict();
const legacyV7Schema = settingsObjectSchema.extend({
  version: z.literal(7),
  chunkedReading: z.boolean(),
});
const legacyV6Schema = legacyV7Schema.extend({
  version: z.literal(6),
  providers: z.array(z.object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1).max(100),
    config: providerSchema.omit({ protocol: true }),
  }).strict()),
}).strict();
const legacyV5Schema = legacyV6Schema.omit({ chunkedReading: true }).extend({
  version: z.literal(5),
  providers: z.array(z.object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1).max(100),
    config: providerSchema.omit({ protocol: true }).extend({ capabilities: capabilitiesSchema.omit({ webSearch: true }) }),
  }).strict()),
}).strict();
const settingsSchema = settingsObjectSchema.refine((settings) => {
    const ids = new Set(settings.providers.map((profile) => profile.id));
    return (
      ids.size === settings.providers.length &&
      Object.values(settings.taskModels).every(
        (id) => id === null || ids.has(id),
      )
    );
  });

export function createUnknownCapabilities(): ModelCapabilities {
  return {
    text: { status: "unknown" },
    streaming: { status: "unknown" },
    vision: { status: "unknown" },
    tools: { status: "unknown" },
    webSearch: { status: "unknown" },
  };
}

// Creates the first-run settings from Chrome's current interface language.
export function createDefaultSettings(uiLanguage: string): StoredSettings {
  return {
    version: SETTINGS_VERSION,
    enabled: true,
    locale: uiLanguage.toLowerCase().startsWith("zh") ? "zh_CN" : "en",
    providers: [],
    taskModels: { chat: null, text: null, vision: null, automation: null },
    resultDisplayMode: "floating",
    allowMultiTab: false,
  };
}

// Converts earlier settings shapes into the current persisted schema.
export function parseStoredSettings(value: unknown): StoredSettings {
  const v7 = legacyV7Schema.safeParse(value);
  if (v7.success) {
    const { chunkedReading: _removed, ...settings } = v7.data;
    return parseStoredSettings({ ...settings, version: SETTINGS_VERSION });
  }
  const v6 = legacyV6Schema.safeParse(value);
  if (v6.success) {
    return parseStoredSettings({
      ...v6.data,
      version: 7,
      providers: v6.data.providers.map((profile) => ({
        ...profile,
        config: { ...profile.config, protocol: "chat-completions" },
      })),
    });
  }
  const v5 = legacyV5Schema.safeParse(value);
  if (v5.success) {
    return parseStoredSettings({
      ...v5.data,
      version: 6,
      chunkedReading: false,
      providers: v5.data.providers.map((profile) => ({
        ...profile,
        config: { ...profile.config, capabilities: { ...profile.config.capabilities, webSearch: { status: "unknown" } } },
      })),
    });
  }
  const current = settingsSchema.safeParse(value);
  if (current.success) {
    return {
      ...current.data,
      providers: current.data.providers.map((profile) => ({
        ...profile,
        config: parseProviderConfig(profile.config),
      })),
    };
  }
  const parsedLegacy = legacySettingsSchema.safeParse(value);
  if (!parsedLegacy.success) throw new Error("settingsInvalid");
  const legacy = parsedLegacy.data;
  const settings = createDefaultSettings(legacy.locale);
  settings.enabled = "enabled" in legacy ? legacy.enabled : true;
  settings.resultDisplayMode =
    "resultDisplayMode" in legacy ? legacy.resultDisplayMode : "floating";
  settings.allowMultiTab =
    "allowMultiTab" in legacy ? legacy.allowMultiTab : false;
  if (legacy.provider) {
    const { supportsVision, ...provider } = legacy.provider;
    const capabilities = createUnknownCapabilities();
    if (supportsVision)
      capabilities.vision = { status: "supported", checkedAt: null };
    settings.providers = [
      {
        id: "default",
        name: provider.model.trim(),
        config: parseProviderConfig({ ...provider, protocol: "chat-completions", capabilities }),
      },
    ];
    settings.taskModels = {
      chat: "default",
      text: "default",
      vision: "default",
      automation: "default",
    };
  }
  return settings;
}

// Validates the connection fields before any request is sent to the provider.
export function parseProviderCredentials(input: unknown): ProviderCredentials {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) throw new Error("settingsInvalid");
  const baseUrl = parsed.data.baseUrl.trim().replace(/\/+$/, "");
  const apiKey = parsed.data.apiKey.trim();

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
    url.pathname.endsWith("/models") ||
    url.pathname.endsWith("/responses") ||
    url.pathname.endsWith("/messages") ||
    /:streamGenerateContent$|:generateContent$/.test(url.pathname)
  ) {
    throw new Error("baseUrlEndpoint");
  }

  return { baseUrl, apiKey, protocol: parsed.data.protocol };
}

// Validates and normalizes the complete provider form before it is persisted.
export function parseProviderConfig(input: unknown): ProviderConfig {
  const parsed = providerSchema.safeParse(input);
  if (!parsed.success) throw new Error("settingsInvalid");
  const credentials = parseProviderCredentials(parsed.data);
  const model = parsed.data.model.trim();
  const targetLanguage = parsed.data.targetLanguage.trim();

  if (!model) throw new Error("modelRequired");
  if (!targetLanguage) throw new Error("targetLanguageRequired");

  return {
    ...credentials,
    model,
    capabilities: parsed.data.capabilities,
    targetLanguage,
  };
}

export function getTaskProvider(
  settings: StoredSettings,
  task: ModelTask,
): ProviderConfig | null {
  const id = settings.taskModels[task];
  if (id === null) return null;
  const profile = settings.providers.find((item) => item.id === id);
  if (!profile) throw new Error("settingsInvalid");
  return profile.config;
}

export function requireModelCapability(
  provider: ProviderConfig,
  capability: ModelCapability,
): void {
  const result = provider.capabilities[capability];
  if (capability === "vision" && result.status !== "supported")
    throw new Error("visionRequired");
  if (capability === "webSearch" && result.status !== "supported")
    throw new Error("webSearchCheckRequired");
}

// Returns the configured OpenAI-compatible Chat Completions endpoint.
export function getChatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl}/chat/completions`;
}

// Returns the standard OpenAI-compatible model-list endpoint.
export function getModelsUrl(baseUrl: string): string {
  return `${baseUrl}/models`;
}

// Returns the exact host pattern needed for the configured provider endpoint.
export function getProviderHostPermission(baseUrl: string): string {
  const url = new URL(baseUrl);
  return `${url.protocol}//${url.hostname}/*`;
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
  await browser.storage.local.set({
    [SETTINGS_STORAGE_KEY]: parseStoredSettings(settings),
  });
}

// Validates the independently versioned collection of reusable page tasks.
export function parseStoredPageWorkflows(value: unknown): StoredPageWorkflows {
  const text = z.string().min(1).refine((input) => input === input.trim());
  const workflow = z.object({ id: text, name: text, task: text }).strict();
  const schema = z.discriminatedUnion("version", [
    z.object({ version: z.literal(1), workflows: z.array(workflow) }).strict(),
    z.object({ version: z.literal(2), workflows: z.array(workflow.extend({ allowedOrigins: z.array(z.string()) })) }).strict(),
  ]);
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("pageWorkflowsInvalid");
  if (new Set(parsed.data.workflows.map((item) => item.id)).size !== parsed.data.workflows.length) throw new Error("pageWorkflowsInvalid");
  const workflows = parsed.data.workflows.map((item) => {
    getTemplateVariables(item.task);
    return { ...item, allowedOrigins: "allowedOrigins" in item ? parseSiteOrigins(item.allowedOrigins) : [] };
  });
  return { version: PAGE_WORKFLOWS_VERSION, workflows };
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
  await browser.storage.local.set({ [PAGE_WORKFLOWS_STORAGE_KEY]: parseStoredPageWorkflows(stored) });
}

export function exportPageWorkflows(workflows: SavedPageWorkflow[]): string {
  return JSON.stringify(parseStoredPageWorkflows({ version: PAGE_WORKFLOWS_VERSION, workflows }), null, 2);
}

export function importPageWorkflows(text: string): SavedPageWorkflow[] {
  if (new TextEncoder().encode(text).length > 2_000_000) throw new Error("workflowImportTooLarge");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("pageWorkflowsInvalid"); }
  return parseStoredPageWorkflows(value).workflows.map((workflow) => ({ ...workflow, id: crypto.randomUUID() }));
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
