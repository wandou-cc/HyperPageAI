import { describe, expect, it } from "vitest";
import { parseWebSearchResponse } from "../shared/web-search";

function response() {
  const output: [
    { type: string; id: string; status: string; action: { type: string } },
    { type: string; role: string; status: string; content: Array<{ type: string; text: string; annotations: Array<{ type: string; start_index: number; end_index: number; title: string; url: string }> }> },
  ] = [
    { type: "web_search_call", id: "search-1", status: "completed", action: { type: "search" } },
    { type: "message", role: "assistant", status: "completed", content: [{
      type: "output_text", text: "Current information [source].", annotations: [{
        type: "url_citation", start_index: 20, end_index: 28, title: "Official source", url: "https://example.com/doc?q=a%20b",
      }],
    }] },
  ];
  return { status: "completed", output };
}

describe("native web search evidence", () => {
  it("renders provider citations as clickable Markdown links", () => {
    expect(parseWebSearchResponse(response())).toBe("Current information [1](<https://example.com/doc?q=a%20b>).");
  });
  it("rejects an answer that claims to search without a real search call", () => {
    const result = response();
    result.output.shift();
    expect(() => parseWebSearchResponse(result)).toThrow("webSearchNotPerformed");
  });
  it("rejects a failed search call even when an answer contains citations", () => {
    const result = response();
    result.output[0].status = "failed";
    expect(() => parseWebSearchResponse(result)).toThrow("webSearchNotPerformed");
  });
  it("requires citations and rejects invalid citation ranges and executable URLs", () => {
    for (const annotations of [[], [{ type: "url_citation", start_index: 20, end_index: 1000, title: "Invalid", url: "https://example.com" }], [{ type: "url_citation", start_index: 20, end_index: 28, title: "Invalid", url: "javascript:alert(1)" }]]) {
      const result = response();
      result.output[1].content = [{ type: "output_text", text: "Current information [source].", annotations }];
      expect(() => parseWebSearchResponse(result)).toThrow();
    }
  });
  it("rejects incomplete responses", () => {
    expect(() => parseWebSearchResponse({ ...response(), status: "incomplete" })).toThrow("apiResponseInvalid");
  });
});
