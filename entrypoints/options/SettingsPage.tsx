import { useCallback, useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { message as notify, Toaster } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/spinner";
import type { StoredSettings } from "../../shared/messages";
import { loadSettings, SETTINGS_STORAGE_KEY } from "../../shared/settings";
import { LocalDataView } from "../sidepanel/DataSettings";
import { SettingsView } from "../sidepanel/SettingsView";
import { formatError, t } from "../sidepanel/translations";

export function SettingsPage() {
  const [settings, setSettings] = useState<StoredSettings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const uiLanguage = browser.i18n.getUILanguage();
  const locale =
    settings?.locale ??
    (uiLanguage.toLowerCase().startsWith("zh") ? "zh_CN" : "en");
  const reload = useCallback(async () => {
    try {
      setSettings(await loadSettings(uiLanguage));
      setLoadFailed(false);
    } catch (failure) {
      setSettings(null);
      setLoadFailed(true);
      notify.error(formatError(uiLanguage.toLowerCase().startsWith("zh") ? "zh_CN" : "en", failure));
    }
  }, [uiLanguage]);

  useEffect(() => {
    const listener = (
      changes: Record<string, Browser.storage.StorageChange>,
      area: Browser.storage.AreaName,
    ) => {
      if (area === "local" && changes[SETTINGS_STORAGE_KEY]) void reload();
    };
    browser.storage.onChanged.addListener(listener);
    void reload();
    return () => browser.storage.onChanged.removeListener(listener);
  }, [reload]);

  useEffect(() => {
    document.documentElement.lang = locale === "zh_CN" ? "zh-CN" : "en";
    document.title = `HyperPage AI - ${t(locale, "settings")}`;
  }, [locale]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col bg-background text-foreground">
      <Toaster closeLabel={t(locale, "close")} />
      <header className="flex flex-wrap items-center gap-3 border-b p-4">
        <img
          src={browser.runtime.getURL("/icon/32.png")}
          alt=""
          className="size-8"
        />
        <h1 className="text-lg font-semibold">HyperPage AI</h1>
        <span className="text-sm text-muted-foreground">
          {t(locale, "settings")}
        </span>
      </header>
      {loadFailed ? (
        <main className="flex flex-col gap-4 p-4">
          <LocalDataView locale={locale} onCleared={reload} />
        </main>
      ) : settings ? (
        <SettingsView settings={settings} onSaved={setSettings} />
      ) : (
        <div className="flex justify-center p-8" role="status">
          <Spinner aria-label={t(locale, "processing")} />
        </div>
      )}
    </div>
  );
}
