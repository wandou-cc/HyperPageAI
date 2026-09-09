import { browser } from "wxt/browser";
import { RESOURCE_PORT, type ResourceCommand, type ResourceEvent, type ResourceResult } from "../../shared/page-resources";

export function requestPageResource(command: ResourceCommand, signal: AbortSignal): Promise<ResourceResult> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const port = browser.runtime.connect({ name: RESOURCE_PORT });
    const requestId = crypto.randomUUID();
    const cleanup = () => {
      port.onMessage.removeListener(receive);
      port.onDisconnect.removeListener(disconnect);
      signal.removeEventListener("abort", abort);
      port.disconnect();
    };
    const receive = (event: ResourceEvent) => {
      if (event.requestId !== requestId) return;
      cleanup();
      if (!event.result) reject(new Error("resourceResponseInvalid"));
      else if (event.result.ok) resolve(event.result.data);
      else reject(new Error(event.result.error));
    };
    const disconnect = () => { cleanup(); reject(new Error("resourceConnectionClosed")); };
    const abort = () => { cleanup(); reject(signal.reason); };
    port.onMessage.addListener(receive);
    port.onDisconnect.addListener(disconnect);
    signal.addEventListener("abort", abort, { once: true });
    try { port.postMessage({ requestId, command }); }
    catch (error) { cleanup(); reject(error); }
  });
}
