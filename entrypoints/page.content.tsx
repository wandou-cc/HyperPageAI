import React from "react";
import ReactDOM from "react-dom/client";
import { browser } from "wxt/browser";

import { PortalContainerProvider } from "@/components/ui/portal-container";
import { TooltipProvider } from "@/components/ui/tooltip";

import "../assets/tailwind.css";
import { PageController } from "../lib/page-controller";
import type { BackgroundRequest, CommandResult } from "../shared/messages";
import { loadSettings, SETTINGS_STORAGE_KEY } from "../shared/settings";
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
    const [settings, panelOpen] = await Promise.all([
      loadSettings(uiLanguage),
      sendBackgroundRequest<boolean>({
        target: "background",
        type: "get-panel-visibility",
      }),
    ]);
    const controller = new PageController(settings);
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
    ui.shadowHost.dataset.hyperpageUi = "panel";

    // Keeps the mounted UI and page controller synchronized with extension storage.
    const handleStorageChange = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: Browser.storage.AreaName,
    ): void => {
      if (areaName === "local" && changes[SETTINGS_STORAGE_KEY]) {
        void loadSettings(uiLanguage).then((nextSettings) => {
          controller.updateSettings(nextSettings);
        });
      }
    };

    browser.storage.onChanged.addListener(handleStorageChange);
    ctx.onInvalidated(() => {
      browser.storage.onChanged.removeListener(handleStorageChange);
      controller.destroy();
    });

    ui.mount();
  },
});
