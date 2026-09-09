import { describe, expect, it, vi } from "vitest";
import {
  assertSiteAllowed,
  fillTemplate,
  getTemplateVariables,
  parseSiteInput,
} from "../shared/task-templates";
import {
  exportPageWorkflows,
  importPageWorkflows,
  parseStoredPageWorkflows,
} from "../shared/settings";

vi.mock("wxt/browser", () => ({ browser: {} }));

describe("task variables and website scope", () => {
  it("fills repeated variables once without interpreting parameter text as another template", () => {
    const template = "Find {{主题}}, then compare {{other}} with {{主题}}";
    expect(getTemplateVariables(template)).toEqual(["主题", "other"]);
    expect(
      fillTemplate(template, { 主题: "{{other}}", other: "literal" }),
    ).toBe("Find {{other}}, then compare literal with {{other}}");
    expect(() => fillTemplate(template, { other: "value" })).toThrow(
      "templateValueRequired",
    );
    expect(() =>
      fillTemplate("Find {{name}}", { name: "", extra: "value" }),
    ).toThrow("templateValuesInvalid");
    expect(() => fillTemplate("Find {{toString}}", {})).toThrow(
      "templateValueRequired",
    );
    expect(() => getTemplateVariables("Find {{wrong name}}")).toThrow(
      "templateSyntaxInvalid",
    );
    expect(() => getTemplateVariables("Find {{name")).toThrow(
      "templateSyntaxInvalid",
    );
  });

  it("compares exact origins including ports and rejects paths, credentials and wildcards", () => {
    const origins = parseSiteInput(
      " https://example.com/\nhttps://example.com\nhttp://localhost:8080 ",
    );
    expect(origins).toEqual(["https://example.com", "http://localhost:8080"]);
    expect(() =>
      assertSiteAllowed("https://example.com/a?q=b", origins),
    ).not.toThrow();
    for (const url of [
      "https://sub.example.com",
      "http://localhost:8081",
      "https://example.com.evil.test",
    ]) {
      expect(() => assertSiteAllowed(url, origins)).toThrow("siteScopeDenied");
    }
    for (const value of [
      "https://example.com/path",
      "https://*.example.com",
      "https://user:pass@example.com",
      "file:///tmp/file",
      "https://example.com?q=1",
    ]) {
      expect(() => parseSiteInput(value)).toThrow("siteScopeInvalid");
    }
  });

  it("round-trips workflow templates with their website scope and assigns new IDs on import", () => {
    const workflow = {
      id: "original",
      name: "Find",
      task: "Search for {{query}}",
      allowedOrigins: ["https://example.com"],
    };
    const exported = exportPageWorkflows([workflow]);
    const imported = importPageWorkflows(exported);
    expect(imported).toEqual([{ ...workflow, id: expect.any(String) }]);
    expect(imported[0]?.id).not.toBe(workflow.id);
    expect(parseStoredPageWorkflows(JSON.parse(exported))).toEqual({
      version: 2,
      workflows: [workflow],
    });
    expect(() =>
      importPageWorkflows(
        '{"version":2,"workflows":[{"id":"a","name":"x","task":"x"}]}',
      ),
    ).toThrow("pageWorkflowsInvalid");
    expect(() => importPageWorkflows("x".repeat(2_000_001))).toThrow(
      "workflowImportTooLarge",
    );
  });
});
