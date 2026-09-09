import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../components/ui/tooltip";
import { PromptTemplates } from "../entrypoints/sidepanel/PromptTemplates";
import {
  createDefaultPromptTemplates,
  loadPromptTemplates,
  parsePromptTemplates,
  PROMPT_TEMPLATES_STORAGE_KEY,
  savePromptTemplates,
} from "../shared/prompt-templates";
import {
  clearLocalData,
  exportLocalData,
  loadLocalData,
} from "../shared/local-data";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  getBytesInUse: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
}));
vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      local: {
        get: mocks.get,
        set: mocks.set,
        remove: mocks.remove,
        getBytesInUse: mocks.getBytesInUse,
      },
      onChanged: {
        addListener: mocks.addListener,
        removeListener: mocks.removeListener,
      },
    },
  },
}));
let stored: Record<string, unknown>;
beforeEach(() => {
  stored = {};
  vi.clearAllMocks();
  mocks.get.mockImplementation(async () => ({ ...stored }));
  mocks.set.mockImplementation(async (values: Record<string, unknown>) => {
    Object.assign(stored, values);
  });
  mocks.getBytesInUse.mockImplementation(
    async (keys: string[]) => keys.length * 100,
  );
  mocks.remove.mockImplementation(async (keys: string[]) => {
    for (const key of keys) delete stored[key];
  });
});
afterEach(cleanup);

describe("prompt templates", () => {
  it("provides defaults without writing storage and preserves an intentionally empty library", async () => {
    expect(await loadPromptTemplates("en")).toEqual(
      createDefaultPromptTemplates("en"),
    );
    expect(mocks.set).not.toHaveBeenCalled();
    await savePromptTemplates([]);
    expect(await loadPromptTemplates("en")).toEqual([]);
    expect(() =>
      parsePromptTemplates({
        version: 1,
        templates: [
          {
            id: "x",
            name: "Bad",
            prompt: "{{unfinished",
            category: "other",
            favorite: false,
          },
        ],
      }),
    ).toThrow("templateSyntaxInvalid");
    expect(() => parsePromptTemplates({ version: 2, templates: [] })).toThrow(
      "promptTemplatesInvalid",
    );
  });

  it("creates a template, fills its parameters, and persists favorites and order", async () => {
    const onUse = vi.fn();
    render(
      <TooltipProvider>
        <PromptTemplates locale="en" disabled={false} onUse={onUse} />
      </TooltipProvider>,
    );
    expect(
      await screen.findByRole("button", { name: "Use template: Summarize" }),
    ).toBeEnabled();
    expect(mocks.set).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Manage templates" }));
    fireEvent.click(screen.getByRole("button", { name: "New template" }));
    fireEvent.change(screen.getByLabelText("Template name"), {
      target: { value: "Specific reply" },
    });
    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "Reply about {{topic}}" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Use template: Specific reply",
      }),
    );
    expect(onUse).not.toHaveBeenCalled();
    const parameters = screen.getByRole("region", {
      name: "Template parameters",
    });
    fireEvent.change(within(parameters).getByLabelText("topic"), {
      target: { value: "project status" },
    });
    fireEvent.click(
      within(parameters).getByRole("button", { name: "Use template" }),
    );
    expect(onUse).toHaveBeenCalledWith("Reply about project status");
    fireEvent.click(
      screen.getByRole("button", { name: "Favorite template: Specific reply" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Favorite template: Specific reply",
        }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Move template up: Specific reply" }),
    );
    await waitFor(async () =>
      expect((await loadPromptTemplates("en")).at(-2)?.name).toBe(
        "Specific reply",
      ),
    );
    const saved = await loadPromptTemplates("en");
    expect(saved.find((item) => item.name === "Specific reply")?.favorite).toBe(
      true,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete template: Specific reply" }),
    );
    await waitFor(() =>
      expect(screen.queryByText("Specific reply")).toBeNull(),
    );
  });

  it("includes saved templates in local-data preview, export and deletion", async () => {
    await savePromptTemplates(createDefaultPromptTemplates("en"));
    const data = await loadLocalData();
    expect(data.groups.templates.count).toBe(5);
    expect(data.groups.templates.bytes).toBe(100);
    expect(
      JSON.parse(exportLocalData(data, "templates")).data.templates.templates[0]
        .id,
    ).toBe("summary");
    await clearLocalData("templates");
    expect(stored[PROMPT_TEMPLATES_STORAGE_KEY]).toBeUndefined();
  });
});
