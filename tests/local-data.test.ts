import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLocalData,
  exportLocalData,
  loadLocalData,
} from "../shared/local-data";
import {
  createDefaultSettings,
  createUnknownCapabilities,
} from "../shared/settings";
import { importConversations } from "../shared/conversations";

const storage = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  getBytesInUse: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("wxt/browser", () => ({ browser: { storage: { local: storage } } }));

describe("local data management", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows validated data and exact Chrome storage usage without exposing provider keys", async () => {
    const values = {
      "hyperpage.settings": {
        ...createDefaultSettings("en"),
        providers: [
          {
            id: "one",
            name: "One",
            config: {
              protocol: "chat-completions",
              baseUrl: "https://api.example/v1",
              apiKey: "private-test-key",
              model: "text",
              targetLanguage: "English",
              capabilities: createUnknownCapabilities(),
            },
          },
        ],
      },
      "hyperpage.pageWorkflows": {
        version: 1,
        workflows: [{ id: "flow", name: "Read", task: "Read this page" }],
      },
    };
    storage.get.mockResolvedValue(values);
    storage.getBytesInUse.mockImplementation(async (keys: string[]) =>
      keys.length ? 321 : 0,
    );
    const data = await loadLocalData();
    expect(data.totalBytes).toBe(642);
    expect(data.groups.workflows.count).toBe(1);
    expect(data.groups.history.count).toBe(0);
    const exported = exportLocalData(data, "all");
    expect(exported).not.toContain("private-test-key");
    expect(exported).not.toContain("apiKey");
    expect(JSON.parse(exported).data.settings.providers[0].config.baseUrl).toBe(
      "https://api.example/v1",
    );
    expect(
      JSON.parse(exportLocalData(data, "workflows")),
    ).toEqual({ version: 2, workflows: [{ id: "flow", name: "Read", task: "Read this page", allowedOrigins: [] }] });
  });

  it("removes only the requested app-owned records, including invalid records", async () => {
    storage.get.mockResolvedValue({
      "hyperpage.settings": { broken: true },
      "hyperpage.pageWorkflows": { broken: true },
      "hyperpage.pageAgentHistory": { broken: true },
      "hyperpage.conversation.invalid": { broken: true },
      unrelated: { preserve: true },
    });
    await clearLocalData("conversations");
    expect(storage.remove).toHaveBeenCalledWith([
      "hyperpage.conversation.invalid",
    ]);
    await clearLocalData("all");
    expect(storage.remove).toHaveBeenLastCalledWith([
      "hyperpage.settings",
      "hyperpage.pageWorkflows",
      "hyperpage.pageAgentHistory",
      "hyperpage.conversation.invalid",
    ]);
  });

  it("exports conversations in the format accepted by the conversation library", async () => {
    const id = "22cb2313-71ef-4a9a-9fe1-348812653921";
    const record = {
      version: 1,
      id,
      name: "Saved",
      title: "Page",
      url: "https://example.com/",
      createdAt: 1,
      updatedAt: 1,
      turns: [
        {
          id: "turn",
          prompt: "Question",
          answer: "Answer",
          status: "complete",
          includeHistory: false,
          snapshot: { type: "none" },
        },
      ],
    };
    storage.get.mockResolvedValue({ [`hyperpage.conversation.${id}`]: record });
    storage.getBytesInUse.mockResolvedValue(100);
    const archive = exportLocalData(await loadLocalData(), "conversations");
    await importConversations(archive);
    expect(storage.set).toHaveBeenCalledOnce();
    const saved = Object.values(storage.set.mock.calls[0]?.[0])[0];
    expect(saved).toMatchObject({ name: "Saved", turns: record.turns });
  });

  it("reports corrupt data and storage errors without presenting an empty success", async () => {
    storage.get.mockResolvedValue({
      "hyperpage.pageWorkflows": { version: 100 },
    });
    await expect(loadLocalData()).rejects.toThrow("pageWorkflowsInvalid");
    storage.get.mockResolvedValue({});
    storage.getBytesInUse.mockRejectedValue(new Error("Storage unavailable"));
    await expect(loadLocalData()).rejects.toThrow("Storage unavailable");
    storage.remove.mockRejectedValue(new Error("Deletion failed"));
    await expect(clearLocalData("settings")).rejects.toThrow("Deletion failed");
  });
});
