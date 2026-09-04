import { browser } from "wxt/browser";

export const PANEL_VISIBILITY_STORAGE_KEY = "hyperpage.panelVisible";

// Reads the session-wide panel state and rejects corrupted extension storage.
export async function loadPanelVisibility(): Promise<boolean> {
  const stored = await browser.storage.session.get(
    PANEL_VISIBILITY_STORAGE_KEY,
  );
  const value = stored[PANEL_VISIBILITY_STORAGE_KEY] as unknown;
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new Error("panelStateInvalid");
  return value;
}

// Persists whether the floating tool panel is visible across the current session.
export async function savePanelVisibility(visible: boolean): Promise<void> {
  await browser.storage.session.set({
    [PANEL_VISIBILITY_STORAGE_KEY]: visible,
  });
}
