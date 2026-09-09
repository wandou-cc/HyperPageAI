import { message as notify } from "@/components/ui/toast";
import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { browser } from "wxt/browser";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { downloadText } from "../../shared/export";
import {
  LOCAL_DATA_CATEGORIES,
  clearLocalData,
  exportLocalData,
  loadLocalData,
  type LocalDataScope,
  type LocalDataSummary,
} from "../../shared/local-data";
import type {
  BackgroundRequest,
  CommandResult,
  HostAccessState,
  Locale,
} from "../../shared/messages";
import { formatError, t } from "./translations";
import { IconTooltip } from "./ui";

export function LocalDataView({
  locale,
  onCleared,
}: {
  locale: Locale;
  onCleared?: () => Promise<void>;
}) {
  const [data, setData] = useState<LocalDataSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [clearScope, setClearScope] = useState<LocalDataScope | null>(null);
  const refresh = useCallback(async () => {
    setBusy(true);

    try {
      setData(await loadLocalData());
    } catch (failure) {
      setData(null);
      notify.error(formatError(locale, failure));
    } finally {
      setBusy(false);
    }
  }, [locale]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function clear(): Promise<void> {
    if (!clearScope) return;
    setBusy(true);

    try {
      await clearLocalData(clearScope);
      setClearScope(null);
      await onCleared?.();
      setData(await loadLocalData());
    } catch (failure) {
      notify.error(formatError(locale, failure));
    } finally {
      setBusy(false);
    }
  }

  function download(scope: LocalDataScope): void {
    if (!data) return;
    try {
      downloadText(
        exportLocalData(data, scope),
        `hyperpage-${scope}.json`,
        "application/json;charset=utf-8",
      );
    } catch (failure) {
      notify.error(formatError(locale, failure));
    }
  }

  return (
    <section
      aria-label={t(locale, "localData")}
      aria-busy={busy}
      className="flex min-w-0 flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground" role="status">
          {busy ? (
            <Spinner aria-label={t(locale, "processing")} />
          ) : (
            data &&
            `${data.totalBytes.toLocaleString()} ${t(locale, "storageBytes")}`
          )}
        </span>
        <div className="flex items-center gap-1">
          <IconTooltip label={t(locale, "refreshData")}>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={t(locale, "refreshData")}
              disabled={busy}
              onClick={() => void refresh()}
            >
              <RefreshCw />
            </Button>
          </IconTooltip>
          <IconTooltip label={t(locale, "exportAllData")}>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={t(locale, "exportAllData")}
              disabled={busy || !data}
              onClick={() => download("all")}
            >
              <Download />
            </Button>
          </IconTooltip>
          <IconTooltip label={t(locale, "clearAllData")}>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={t(locale, "clearAllData")}
              disabled={busy}
              onClick={() => setClearScope("all")}
            >
              <Trash2 />
            </Button>
          </IconTooltip>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(locale, "dataKeyNotice")}
      </p>
      {clearScope && (
        <Alert>
          <AlertTitle>
            {t(locale, "confirmClearData")}: {t(locale, `data_${clearScope}`)}
          </AlertTitle>
          <AlertDescription>
            <p>{t(locale, "dataClearNotice")}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() => void clear()}
              >
                <Trash2 data-icon="inline-start" />
                {t(locale, "confirmClearData")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setClearScope(null)}
              >
                {t(locale, "cancel")}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {LOCAL_DATA_CATEGORIES.map((category) => {
        const group = data?.groups[category];
        const label = t(locale, `data_${category}`);
        return (
          <section
            key={category}
            aria-label={label}
            className="flex min-w-0 flex-col gap-2 border-t pt-2"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="min-w-0 text-sm font-medium">
                {label}
                {group && ` (${group.count})`}
              </h3>
              <div className="flex items-center gap-1">
                <IconTooltip label={`${t(locale, "exportData")}: ${label}`}>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`${t(locale, "exportData")}: ${label}`}
                    disabled={busy || !group}
                    onClick={() => download(category)}
                  >
                    <Download />
                  </Button>
                </IconTooltip>
                <IconTooltip label={`${t(locale, "clearData")}: ${label}`}>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`${t(locale, "clearData")}: ${label}`}
                    disabled={busy || group?.bytes === 0}
                    onClick={() => setClearScope(category)}
                  >
                    <Trash2 />
                  </Button>
                </IconTooltip>
              </div>
            </div>
            {group && (
              <details className="min-w-0 text-xs">
                <summary className="cursor-pointer">
                  {t(locale, "viewData")}: {group.bytes.toLocaleString()}{" "}
                  {t(locale, "storageBytes")}
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(group.data, null, 2)}
                </pre>
              </details>
            )}
          </section>
        );
      })}
    </section>
  );
}

export function HostPermissionsView({ locale }: { locale: Locale }) {
  const [access, setAccess] = useState<HostAccessState | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useCallback(
    async (message: BackgroundRequest) => {
      setBusy(true);

      try {
        const result = (await browser.runtime.sendMessage(
          message,
        )) as CommandResult<HostAccessState>;
        if (!result.ok) throw new Error(result.error);
        setAccess(result.data);
      } catch (failure) {
        setAccess(null);
        notify.error(formatError(locale, failure));
      } finally {
        setBusy(false);
      }
    },
    [locale],
  );
  useEffect(() => {
    void request({ target: "background", type: "get-host-access" });
  }, [request]);
  return (
    <section
      aria-label={t(locale, "websitePermissions")}
      aria-busy={busy}
      className="flex min-w-0 flex-col gap-3"
    >
      <div className="flex items-center justify-between gap-2">
        <ShieldCheck className="size-4" />
        <IconTooltip label={t(locale, "refreshPermissions")}>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={t(locale, "refreshPermissions")}
            disabled={busy}
            onClick={() =>
              void request({ target: "background", type: "get-host-access" })
            }
          >
            {busy ? <Spinner /> : <RefreshCw />}
          </Button>
        </IconTooltip>
      </div>
      {access && (
        <>
          <ul className="flex flex-col gap-2">
            {access.providers.map(({ origin, granted }) => (
              <li
                key={origin}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span className="min-w-0 break-all text-xs">{origin}</span>
                <Badge variant={granted ? "secondary" : "outline"}>
                  {t(locale, granted ? "accessGranted" : "accessMissing")}
                </Badge>
              </li>
            ))}
          </ul>
          <h3 className="text-sm font-medium">{t(locale, "grantedScopes")}</h3>
          {access.origins.length === 0 ? (
            <p className="text-xs text-muted-foreground" role="status">
              {t(locale, "noHostAccess")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {access.origins.map((origin) => (
                <li
                  key={origin}
                  className="flex min-w-0 items-center justify-between gap-2"
                >
                  <span className="min-w-0 break-all text-xs">{origin}</span>
                  <IconTooltip
                    label={`${t(locale, "revokeAccess")}: ${origin}`}
                  >
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`${t(locale, "revokeAccess")}: ${origin}`}
                      disabled={busy}
                      onClick={() =>
                        void request({
                          target: "background",
                          type: "revoke-host-access",
                          origin,
                        })
                      }
                    >
                      <Trash2 />
                    </Button>
                  </IconTooltip>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
