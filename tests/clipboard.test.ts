import { afterEach, describe, expect, it, vi } from "vitest";
import { copyPng, copyText } from "../shared/clipboard";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("clipboard capability errors", () => {
  it("reports unavailable text and image APIs as rejected promises", async () => {
    vi.stubGlobal("navigator", {});
    await expect(copyText("Text")).rejects.toThrow("clipboardUnavailable");
    await expect(copyPng("data:image/png;base64,")).rejects.toThrow(
      "clipboardUnavailable",
    );
  });

  it("propagates a denied write without reporting successful copying", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi
          .fn()
          .mockRejectedValue(
            new DOMException("Write denied", "NotAllowedError"),
          ),
      },
    });
    await expect(copyText("Text")).rejects.toThrow("Write denied");
  });
});
