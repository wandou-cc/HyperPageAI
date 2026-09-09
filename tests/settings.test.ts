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

import type {
  PageAgentExecutionRecord,
  ProviderConfig,
} from "../shared/messages";
import {
  addPageAgentExecutionRecord,
  createDefaultSettings,
  createUnknownCapabilities,
  getChatCompletionsUrl,
  getModelsUrl,
  getTaskProvider,
  loadPageAgentHistory,
  loadPageWorkflows,
  loadSettings,
  PAGE_AGENT_HISTORY_LIMIT,
  parseStoredPageAgentHistory,
  parseStoredPageWorkflows,
  parseProviderConfig,
  parseProviderCredentials,
  parseStoredSettings,
  savePageWorkflows,
  requireModelCapability,
} from "../shared/settings";

const validProvider: ProviderConfig = {
  protocol: "chat-completions",
  baseUrl: " https://api.example.com/v1/ ",
  apiKey: " secret ",
  model: " vision-model ",
  capabilities: createUnknownCapabilities(),
  targetLanguage: " Simplified Chinese ",
};

describe("provider settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes a valid OpenAI-compatible configuration", () => {
    expect(parseProviderConfig(validProvider)).toEqual({
      protocol: "chat-completions",
      baseUrl: "https://api.example.com/v1",
      apiKey: "secret",
      model: "vision-model",
      capabilities: createUnknownCapabilities(),
      targetLanguage: "Simplified Chinese",
    });
  });

  it("validates credentials before a model has been selected", () => {
    expect(
      parseProviderCredentials({
        protocol: "chat-completions",
        baseUrl: " https://api.example.com/v1/ ",
        apiKey: " secret ",
      }),
    ).toEqual({
      protocol: "chat-completions",
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
        protocol: "chat-completions",
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
      version: 8,
      enabled: true,
      locale: "zh_CN",
      providers: [],
      taskModels: { chat: null, text: null, vision: null, automation: null },
      resultDisplayMode: "floating",
      allowMultiTab: false,
    });
    expect(createDefaultSettings("en-US").locale).toBe("en");
  });

  it("migrates version 1 settings as enabled with floating results", async () => {
    const legacySettings = {
      locale: "zh_CN",
      provider: null,
    };
    browserMock.storage.local.get.mockResolvedValue({
      "hyperpage.settings": legacySettings,
    });

    const settings = await loadSettings("en-US");

    expect(settings).toEqual({
      ...createDefaultSettings("zh-CN"),
      resultDisplayMode: "floating",
      allowMultiTab: false,
    });
    expect(browserMock.storage.local.set).toHaveBeenCalledWith({
      "hyperpage.settings": settings,
    });
  });

  it("migrates v5 profiles and assignments while leaving web search unverified", async () => {
    const { webSearch: _search, ...capabilities } = createUnknownCapabilities();
    const { protocol: _protocol, ...legacyProvider } = validProvider;
    capabilities.text = { status: "supported", checkedAt: 100 };
    const settings = createDefaultSettings("en");
    const legacy = { ...settings, version: 5, providers: [{ id: "one", name: "One", config: { ...legacyProvider, capabilities } }], taskModels: { chat: "one", text: "one", vision: null, automation: null } };
    browserMock.storage.local.get.mockResolvedValue({ "hyperpage.settings": legacy });
    const migrated = await loadSettings("en");
    expect(migrated).toMatchObject({ version: 8, taskModels: legacy.taskModels, providers: [{ config: { protocol: "chat-completions", capabilities: { text: capabilities.text, webSearch: { status: "unknown" } } } }] });
    expect(browserMock.storage.local.set).toHaveBeenCalledWith({ "hyperpage.settings": migrated });
    const provider = migrated.providers[0];
    if (!provider) throw new Error("Missing migrated provider");
    expect(() => requireModelCapability(provider.config, "webSearch")).toThrow("webSearchCheckRequired");
    expect(migrated).not.toHaveProperty("chunkedReading");
  });

  it("migrates v6 profiles without losing their credentials or task assignments", async () => {
    const { protocol: _protocol, ...config } = parseProviderConfig(validProvider);
    const legacy = { ...createDefaultSettings("en"), version: 6, chunkedReading: true, providers: [{ id: "one", name: "One", config }], taskModels: { chat: "one", text: "one", vision: null, automation: "one" } };
    browserMock.storage.local.get.mockResolvedValue({ "hyperpage.settings": legacy });
    const migrated = await loadSettings("en");
    const { chunkedReading: _removed, ...retained } = legacy;
    expect(migrated).toEqual({ ...retained, version: 8, providers: [{ id: "one", name: "One", config: { ...config, protocol: "chat-completions" } }] });
    expect(browserMock.storage.local.set).toHaveBeenCalledWith({ "hyperpage.settings": migrated });
  });

  it.each(["chat-completions", "responses", "anthropic", "gemini"] as const)("persists an explicit %s protocol", (protocol) => {
    const config = parseProviderConfig({ ...validProvider, protocol });
    const settings = { ...createDefaultSettings("en"), providers: [{ id: "one", name: "One", config }] };
    expect(parseStoredSettings(settings).providers[0]?.config.protocol).toBe(protocol);
    expect(() => parseProviderConfig({ ...config, protocol: "unknown" })).toThrow("settingsInvalid");
    const { protocol: _protocol, ...withoutProtocol } = config;
    expect(() => parseStoredSettings({ ...settings, providers: [{ ...settings.providers[0], config: withoutProtocol }] })).toThrow("settingsInvalid");
  });

  it("migrates v7 settings while preserving providers and removing the chunk preference", async () => {
    const current = { ...createDefaultSettings("en"), providers: [{ id: "one", name: "One", config: parseProviderConfig(validProvider) }], taskModels: { chat: "one", text: "one", vision: null, automation: null } };
    browserMock.storage.local.get.mockResolvedValue({ "hyperpage.settings": { ...current, version: 7, chunkedReading: true } });
    expect(await loadSettings("en")).toEqual(current);
    expect(browserMock.storage.local.set).toHaveBeenCalledWith({ "hyperpage.settings": current });
  });

  it("migrates version 2 settings without changing the result destination", async () => {
    browserMock.storage.local.get.mockResolvedValue({
      "hyperpage.settings": {
        version: 2,
        locale: "en",
        provider: null,
        resultDisplayMode: "inline",
      },
    });

    const settings = await loadSettings("zh-CN");

    expect(settings).toEqual({
      ...createDefaultSettings("en-US"),
      resultDisplayMode: "inline",
      allowMultiTab: false,
    });
    expect(browserMock.storage.local.set).toHaveBeenCalledWith({
      "hyperpage.settings": settings,
    });
  });

  it("migrates an explicitly disabled version 3 configuration", () => {
    const settings = {
      version: 3 as const,
      enabled: false,
      locale: "en" as const,
      provider: null,
      resultDisplayMode: "floating" as const,
    };

    expect(parseStoredSettings(settings)).toEqual({
      ...createDefaultSettings("en-US"),
      enabled: false,
      resultDisplayMode: "floating",
      allowMultiTab: false,
    });
  });

  it("rejects version 3 settings without an enable state", () => {
    expect(() =>
      parseStoredSettings({
        version: 3,
        locale: "en",
        provider: null,
        resultDisplayMode: "floating",
      }),
    ).toThrow("settingsInvalid");
  });

  it("rejects unsupported persisted settings revisions", () => {
    expect(() =>
      parseStoredSettings({
        version: 5,
        enabled: true,
        locale: "en",
        provider: null,
        resultDisplayMode: "floating",
      }),
    ).toThrow("settingsInvalid");
  });

  it("requires an explicit multi-tab preference in version 4", () => {
    expect(() =>
      parseStoredSettings({
        version: 4,
        enabled: true,
        locale: "en",
        provider: null,
        resultDisplayMode: "floating",
      }),
    ).toThrow("settingsInvalid");

    expect(
      parseStoredSettings({
        version: 4,
        enabled: true,
        locale: "en",
        provider: null,
        resultDisplayMode: "floating",
        allowMultiTab: true,
      }),
    ).toEqual({
      ...createDefaultSettings("en-US"),
      resultDisplayMode: "floating",
      allowMultiTab: true,
    });
  });

  it("migrates the existing model without inventing capability test results", () => {
    const settings = parseStoredSettings({
      version: 4,
      enabled: true,
      locale: "en",
      resultDisplayMode: "inline",
      allowMultiTab: true,
      provider: {
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "old-model",
        targetLanguage: "English",
        supportsVision: true,
      },
    });
    expect(settings.taskModels).toEqual({
      chat: "default",
      text: "default",
      vision: "default",
      automation: "default",
    });
    expect(getTaskProvider(settings, "vision")).toMatchObject({
      model: "old-model",
      capabilities: {
        text: { status: "unknown" },
        vision: { status: "supported", checkedAt: null },
      },
    });
    expect(settings.resultDisplayMode).toBe("inline");
    expect(settings.allowMultiTab).toBe(true);
  });

  it("rejects dangling task assignments, duplicated profiles and malformed legacy credentials", () => {
    const base = createDefaultSettings("en");
    expect(() =>
      parseStoredSettings({
        ...base,
        taskModels: { ...base.taskModels, chat: "missing" },
      }),
    ).toThrow("settingsInvalid");
    const profile = {
      id: "same",
      name: "Text",
      config: parseProviderConfig(validProvider),
    };
    expect(() =>
      parseStoredSettings({ ...base, providers: [profile, profile] }),
    ).toThrow("settingsInvalid");
    expect(() =>
      parseStoredSettings({
        locale: "en",
        provider: { baseUrl: "https://api.example.com", apiKey: 42 },
      }),
    ).toThrow("settingsInvalid");
  });

  it("uses only the assigned model", () => {
    const first = {
      id: "one",
      name: "One",
      config: parseProviderConfig(validProvider),
    };
    const second = {
      id: "two",
      name: "Two",
      config: {
        ...first.config,
        model: "other-model",
        capabilities: {
          ...createUnknownCapabilities(),
          streaming: {
            status: "failed" as const,
            checkedAt: 100,
            error: "apiStreamIncomplete",
          },
        },
      },
    };
    const settings = parseStoredSettings({
      ...createDefaultSettings("en"),
      providers: [first, second],
      taskModels: { chat: "two", text: "one", vision: null, automation: null },
    });
    const selected = getTaskProvider(settings, "chat");
    expect(selected?.model).toBe("other-model");
    expect(getTaskProvider(settings, "vision")).toBeNull();
    if (!selected) throw new Error("Expected assigned provider");
    expect(() => requireModelCapability(selected, "vision")).toThrow(
      "visionRequired",
    );
    expect(() => requireModelCapability(selected, "text")).not.toThrow();
  });
});

describe("saved page workflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses an empty collection before the user saves a workflow", async () => {
    browserMock.storage.local.get.mockResolvedValue({});

    await expect(loadPageWorkflows()).resolves.toEqual([]);
    expect(browserMock.storage.local.get).toHaveBeenCalledWith(
      "hyperpage.pageWorkflows",
    );
  });

  it("accepts a versioned collection of named task descriptions", () => {
    const stored = {
      version: 1 as const,
      workflows: [
        {
          id: "workflow-1",
          name: "提交日报",
          task: "填写当前页面的日报表单并提交",
        },
      ],
    };

    expect(parseStoredPageWorkflows(stored)).toEqual({ version: 2, workflows: stored.workflows.map((workflow) => ({ ...workflow, allowedOrigins: [] })) });
  });

  it("rejects duplicate ids and unnormalized workflow text", () => {
    expect(() =>
      parseStoredPageWorkflows({
        version: 1,
        workflows: [
          { id: "same", name: "One", task: "First" },
          { id: "same", name: "Two", task: "Second" },
        ],
      }),
    ).toThrow("pageWorkflowsInvalid");
    expect(() =>
      parseStoredPageWorkflows({
        version: 1,
        workflows: [{ id: "one", name: " Name ", task: "Task" }],
      }),
    ).toThrow("pageWorkflowsInvalid");
  });

  it("persists the complete workflow collection as one revision", async () => {
    const workflows = [
      { id: "workflow-1", name: "Search", task: "Search for HyperPage", allowedOrigins: [] },
    ];

    await savePageWorkflows(workflows);

    expect(browserMock.storage.local.set).toHaveBeenCalledWith({
      "hyperpage.pageWorkflows": { version: 2, workflows },
    });
  });
});

describe("page-agent execution history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses an empty collection before the first page task finishes", async () => {
    browserMock.storage.local.get.mockResolvedValue({});

    await expect(loadPageAgentHistory()).resolves.toEqual([]);
    expect(browserMock.storage.local.get).toHaveBeenCalledWith(
      "hyperpage.pageAgentHistory",
    );
  });

  it("accepts all terminal states with visible action details", () => {
    const records: PageAgentExecutionRecord[] = [
      "completed",
      "incomplete",
      "failed",
      "cancelled",
    ].map((status, index) => ({
      id: `record-${index}`,
      task: `Task ${index}`,
      startedAt: 1_000 + index,
      finishedAt: 2_000 + index,
      status: status as PageAgentExecutionRecord["status"],
      result: `Result ${index}`,
      steps: [
        {
          action: "Click element #4",
          output: "Clicked element [4].",
          durationMs: 18,
        },
      ],
    }));
    const stored = { version: 1 as const, records };

    expect(parseStoredPageAgentHistory(stored)).toEqual(stored);
  });

  it("rejects malformed records and collections above the retention limit", () => {
    expect(() =>
      parseStoredPageAgentHistory({
        version: 1,
        records: [
          {
            id: "record-1",
            task: "Task",
            startedAt: 2_000,
            finishedAt: 1_000,
            status: "completed",
            result: "Done",
            steps: [],
          },
        ],
      }),
    ).toThrow("pageAgentHistoryInvalid");

    expect(() =>
      parseStoredPageAgentHistory({
        version: 1,
        records: Array.from(
          { length: PAGE_AGENT_HISTORY_LIMIT + 1 },
          (_, index) => ({
            id: `record-${index}`,
            task: `Task ${index}`,
            startedAt: index,
            finishedAt: index,
            status: "completed",
            result: "Done",
            steps: [],
          }),
        ),
      }),
    ).toThrow("pageAgentHistoryInvalid");
  });

  it("prepends a run and retains only the latest 20 records", async () => {
    const existingRecords: PageAgentExecutionRecord[] = Array.from(
      { length: PAGE_AGENT_HISTORY_LIMIT },
      (_, index) => ({
        id: `record-${index}`,
        task: `Task ${index}`,
        startedAt: index,
        finishedAt: index + 1,
        status: "completed",
        result: "Done",
        steps: [],
      }),
    );
    browserMock.storage.local.get.mockResolvedValue({
      "hyperpage.pageAgentHistory": {
        version: 1,
        records: existingRecords,
      },
    });
    const newest: PageAgentExecutionRecord = {
      id: "newest-record",
      task: "Newest task",
      startedAt: 100,
      finishedAt: 200,
      status: "completed",
      result: "Newest result",
      steps: [],
    };

    const records = await addPageAgentExecutionRecord(newest);

    expect(records).toHaveLength(PAGE_AGENT_HISTORY_LIMIT);
    expect(records[0]).toEqual(newest);
    expect(records.at(-1)?.id).toBe("record-18");
    expect(browserMock.storage.local.set).toHaveBeenCalledWith({
      "hyperpage.pageAgentHistory": { version: 1, records },
    });
  });
});
