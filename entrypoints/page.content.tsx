import React from "react";
import ReactDOM from "react-dom/client";
import { browser } from "wxt/browser";

import { PortalContainerProvider } from "@/components/ui/portal-container";
import { TooltipProvider } from "@/components/ui/tooltip";

import "../assets/tailwind.css";
import { PageController } from "../lib/page-controller";
import type { StoredSettings } from "../shared/messages";
import {
  loadSettings,
  createDefaultSettings,
  parseStoredSettings,
  SETTINGS_STORAGE_KEY,
} from "../shared/settings";
import { App } from "./sidepanel/App";
import "./sidepanel/style.css";

export default defineContentScript({
  matches: [],
  registration: "runtime",
  runAt: "document_idle",
  cssInjectionMode: "manual",
  async main(ctx) {
    const uiLanguage = browser.i18n.getUILanguage();
    const initialSettings = await loadSettings(uiLanguage);
    if (!initialSettings.enabled) return;

    const stylesheetResponse = await fetch(
      new URL(
        "content-scripts/page.css",
        browser.runtime.getURL("/"),
      ).href,
    );
    if (!stylesheetResponse.ok) {
      throw new Error(`panelStylesUnavailable:${stylesheetResponse.status}`);
    }
    const stylesheet = (await stylesheetResponse.text()).replaceAll(
      ":root",
      ":host",
    );
    let currentSettings = initialSettings;
    let controller: PageController | null = null;
    let removeUi: (() => void) | null = null;
    let invalidated = false;

    // Removes every page-owned artifact when HyperPage is disabled or invalidated.
    function removePageExperience(): void {
      controller?.destroy();
      controller = null;
      removeUi?.();
      removeUi = null;
    }

    // Applies setting changes without creating an entry on an inactive page.
    const handleStorageChange = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: Browser.storage.AreaName,
    ): void => {
      if (areaName !== "local") return;
      const change = changes[SETTINGS_STORAGE_KEY];
      if (!change) return;
      const settings = change.newValue === undefined ? createDefaultSettings(uiLanguage) : parseStoredSettings(change.newValue);
      currentSettings = settings;
      if (!settings.enabled) {
        removePageExperience();
        return;
      }
      controller?.updateSettings(settings);
    };

    browser.storage.onChanged.addListener(handleStorageChange);
    ctx.onInvalidated(() => {
      invalidated = true;
      browser.storage.onChanged.removeListener(handleStorageChange);
      removePageExperience();
    });

    const ui = await createShadowRootUi(ctx, {
      name: "hyperpage-panel",
      mode: "closed",
      position: "modal",
      zIndex: 2147483647,
      css: stylesheet,
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
                <App initialOpen />
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
    if (invalidated || !currentSettings.enabled) {
      ui.remove();
      return;
    }

    const nextController = new PageController(currentSettings);
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
  },
});
