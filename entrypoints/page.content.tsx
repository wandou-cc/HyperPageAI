import React from "react";
import ReactDOM from "react-dom/client";
import { browser } from "wxt/browser";

import { PortalContainerProvider } from "@/components/ui/portal-container";
import { TooltipProvider } from "@/components/ui/tooltip";

import "../assets/tailwind.css";
import { PageController } from "../lib/page-controller";
import type {
  BackgroundRequest,
  CommandResult,
  StoredSettings,
} from "../shared/messages";
import {
  loadSettings,
  parseStoredSettings,
  SETTINGS_STORAGE_KEY,
} from "../shared/settings";
import { App } from "./sidepanel/App";
import "./sidepanel/style.css";

// Sends one non-page command through the trusted background boundary.
async function sendBackgroundRequest<T>(
  request: BackgroundRequest,
): Promise<T> {
  const result = (await browser.runtime.sendMessage(
    request,
  )) as CommandResult<T>;
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_idle",
  cssInjectionMode: "ui",
  async main(ctx) {
    const uiLanguage = browser.i18n.getUILanguage();
    const [initialSettings, panelOpen] = await Promise.all([
      loadSettings(uiLanguage),
      sendBackgroundRequest<boolean>({
        target: "background",
        type: "get-panel-visibility",
      }),
    ]);
    let controller: PageController | null = null;
    let removeUi: (() => void) | null = null;
    let invalidated = false;

    // Mounts or removes the complete page experience for the persisted enable state.
    async function applySettings(settings: StoredSettings): Promise<void> {
      if (invalidated) return;
      if (!settings.enabled) {
        controller?.destroy();
        controller = null;
        removeUi?.();
        removeUi = null;
        return;
      }
      if (controller) {
        controller.updateSettings(settings);
        return;
      }

      const ui = await createShadowRootUi(ctx, {
        name: "hyperpage-panel",
        position: "modal",
        zIndex: 2147483647,
        isolateEvents: [
          "click",
          "dblclick",
          "mousedown",
          "mouseup",
          "pointerdown",
          "pointermove",
          "pointerup",
          "pointercancel",
          "touchstart",
          "touchend",
          "keydown",
          "keyup",
          "keypress",
          "input",
          "change",
          "submit",
          "wheel",
        ],
        onMount(container, shadow) {
          container.style.pointerEvents = "none";
          const root = ReactDOM.createRoot(container);
          root.render(
            <React.StrictMode>
              <PortalContainerProvider container={shadow}>
                <TooltipProvider delay={350}>
                  <App initialOpen={panelOpen} />
                </TooltipProvider>
              </PortalContainerProvider>
            </React.StrictMode>,
          );
          return root;
        },
        onRemove(root) {
          root?.unmount();
        },
      });
      if (invalidated) return;

      const nextController = new PageController(settings);
      try {
        ui.shadowHost.setAttribute("popover", "manual");
        ui.shadowHost.dataset.hyperpageUi = "panel";
        ui.shadowHost.dataset.pageAgentNotInteractive = "true";
        ui.mount();

        // WXT writes host styles while mounting, so protect the final values afterward.
        ui.shadowHost.style.setProperty("all", "initial", "important");
        ui.shadowHost.style.setProperty("position", "fixed", "important");
        ui.shadowHost.style.setProperty("top", "0", "important");
        ui.shadowHost.style.setProperty("left", "0", "important");
        ui.shadowHost.style.setProperty("display", "block", "important");
        ui.shadowHost.style.setProperty("width", "0", "important");
        ui.shadowHost.style.setProperty("height", "0", "important");
        ui.shadowHost.style.setProperty("overflow", "visible", "important");
        ui.shadowHost.style.setProperty("pointer-events", "none", "important");
        ui.shadowHost.style.setProperty("visibility", "visible", "important");
        ui.shadowHost.style.setProperty("opacity", "1", "important");
        ui.shadowHost.style.setProperty("transform", "none", "important");
        ui.shadowHost.style.setProperty("isolation", "isolate", "important");
        ui.shadowHost.style.setProperty("z-index", "2147483647", "important");
        // The top layer stays above page stacking contexts, including native dialogs.
        ui.shadowHost.showPopover();
      } catch (error) {
        nextController.destroy();
        ui.remove();
        throw error;
      }

      controller = nextController;
      removeUi = () => ui.remove();
    }

    let settingsQueue = Promise.resolve();
    function scheduleSettings(settings: StoredSettings): Promise<void> {
      settingsQueue = settingsQueue.then(() => applySettings(settings));
      return settingsQueue;
    }

    // Keeps the page experience synchronized with extension storage.
    const handleStorageChange = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: Browser.storage.AreaName,
    ): void => {
      if (areaName !== "local") return;
      const change = changes[SETTINGS_STORAGE_KEY];
      if (!change || change.newValue === undefined) return;
      void scheduleSettings(parseStoredSettings(change.newValue));
    };

    const initialMount = scheduleSettings(initialSettings);
    browser.storage.onChanged.addListener(handleStorageChange);
    ctx.onInvalidated(() => {
      invalidated = true;
      browser.storage.onChanged.removeListener(handleStorageChange);
      controller?.destroy();
      removeUi?.();
    });
    await initialMount;
  },
});
