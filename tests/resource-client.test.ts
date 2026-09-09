import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestPageResource } from "../entrypoints/documents/resource-client";

const port = vi.hoisted(() => ({
  postMessage: vi.fn(), disconnect: vi.fn(),
  onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
  onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
}));
const connect = vi.hoisted(() => vi.fn());
vi.mock("wxt/browser", () => ({ browser: { runtime: { connect } } }));
beforeEach(() => { vi.resetAllMocks(); connect.mockReturnValue(port); });

describe("resource connection", () => {
  it("correlates a result and releases the one-request connection", async () => {
    const pending = requestPageResource({ type: "scan" }, new AbortController().signal);
    expect(connect).toHaveBeenCalledWith({ name: "hyperpage.page-resources" });
    const receive = port.onMessage.addListener.mock.calls[0]![0];
    const requestId = port.postMessage.mock.calls[0]![0].requestId;
    receive({ requestId: "other", result: { ok: true } });
    expect(port.disconnect).not.toHaveBeenCalled();
    const result = { type: "catalog", title: "Page", url: "https://example.com", resources: [] };
    receive({ requestId, result: { ok: true, data: result } });
    expect(await pending).toEqual(result);
    expect(port.onMessage.removeListener).toHaveBeenCalledWith(receive);
    expect(port.onDisconnect.removeListener).toHaveBeenCalledOnce();
    expect(port.disconnect).toHaveBeenCalledOnce();
  });

  it.each(["abort", "disconnect", "post-failure"])("rejects and cleans up on %s", async (failure) => {
    const controller = new AbortController();
    if (failure === "post-failure") port.postMessage.mockImplementation(() => { throw new Error("Send failed"); });
    const pending = requestPageResource({ type: "scan" }, controller.signal);
    if (failure === "abort") controller.abort();
    if (failure === "disconnect") port.onDisconnect.addListener.mock.calls[0]![0]();
    await expect(pending).rejects.toThrow(failure === "disconnect" ? "resourceConnectionClosed" : failure === "post-failure" ? "Send failed" : "aborted");
    expect(port.onMessage.removeListener).toHaveBeenCalledOnce();
    expect(port.onDisconnect.removeListener).toHaveBeenCalledOnce();
    expect(port.disconnect).toHaveBeenCalledOnce();
  });

  it("does not connect after cancellation", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => requestPageResource({ type: "scan" }, controller.signal)).toThrow();
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects an empty page response without leaving a pending request", async () => {
    const pending = requestPageResource({ type: "scan" }, new AbortController().signal);
    const requestId = port.postMessage.mock.calls[0]![0].requestId;
    port.onMessage.addListener.mock.calls[0]![0]({ requestId });
    await expect(pending).rejects.toThrow("resourceResponseInvalid");
    expect(port.disconnect).toHaveBeenCalledOnce();
  });
});
