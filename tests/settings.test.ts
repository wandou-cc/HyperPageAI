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
  getChatCompletionsUrl,
  getModelsUrl,
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
      version: 4,
      enabled: true,
      locale: "zh_CN",
      provider: null,
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
      version: 4,
      enabled: true,
      locale: "zh_CN",
      provider: null,
      resultDisplayMode: "floating",
      allowMultiTab: false,
    });
    expect(browserMock.storage.local.set).toHaveBeenCalledWith({
      "hyperpage.settings": settings,
    });
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
      version: 4,
      enabled: true,
      locale: "en",
      provider: null,
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
      version: 4,
      enabled: false,
      locale: "en",
      provider: null,
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
      version: 4,
      enabled: true,
      locale: "en",
      provider: null,
      resultDisplayMode: "floating",
      allowMultiTab: true,
    });
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

    expect(parseStoredPageWorkflows(stored)).toEqual(stored);
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
      { id: "workflow-1", name: "Search", task: "Search for HyperPage" },
    ];

    await savePageWorkflows(workflows);

    expect(browserMock.storage.local.set).toHaveBeenCalledWith({
      "hyperpage.pageWorkflows": { version: 1, workflows },
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
