import {
  BetweenVerticalEnd,
  Eye,
  EyeOff,
  Info,
  PanelTop,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { browser } from "wxt/browser";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { message as notify } from "@/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import type {
  BackgroundRequest,
  CommandResult,
  Locale,
  ModelTask,
  ProviderProfile,
  ProviderConfig,
  ProviderCredentials,
  ResultDisplayMode,
  StoredSettings,
} from "../../shared/messages";
import {
  parseProviderConfig,
  parseProviderCredentials,
  saveSettings,
  SETTINGS_VERSION,
  createUnknownCapabilities,
  MODEL_TASKS,
  PROVIDER_PROTOCOLS,
  getProviderHostPermission,
} from "../../shared/settings";
import { formatError, t } from "./translations";
import { IconTooltip } from "./ui";
import { LocalDataView, HostPermissionsView } from "./DataSettings";

interface SettingsViewProps {
  settings: StoredSettings;
  onSaved: (settings: StoredSettings) => void;
}

const OUTPUT_LANGUAGES = [
  ["Simplified Chinese", "simplifiedChinese"],
  ["Traditional Chinese", "traditionalChinese"],
  ["English", "english"],
  ["Japanese", "japanese"],
  ["Korean", "korean"],
  ["Spanish", "spanish"],
  ["French", "french"],
  ["German", "german"],
] as const;

const INTERFACE_LANGUAGES = [
  ["zh_CN", "simplifiedChinese"],
  ["en", "english"],
] as const;

// Requests access only to the origin of the provider entered by the user.
async function requestProviderAccess(
  credentials: ProviderCredentials,
): Promise<void> {
  const granted = await browser.permissions.request({
    origins: [getProviderHostPermission(credentials.baseUrl)],
  });
  if (!granted) throw new Error("providerAccessDenied");
}

// Retrieves model IDs through the background worker without exposing requests to page scripts.
async function loadProviderModels(
  credentials: ProviderCredentials,
): Promise<string[]> {
  await requestProviderAccess(credentials);
  const request: BackgroundRequest = {
    target: "background",
    type: "list-models",
    credentials,
  };
  const result = (await browser.runtime.sendMessage(request)) as CommandResult<
    string[]
  >;
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

function emptyProfile(): ProviderProfile {
  return {
    id: crypto.randomUUID(),
    name: "",
    config: {
      protocol: "chat-completions",
      baseUrl: "",
      apiKey: "",
      model: "",
      targetLanguage: "Simplified Chinese",
      capabilities: createUnknownCapabilities(),
    },
  };
}

function createProviderDrafts(
  profiles: ProviderProfile[],
): [ProviderProfile, ...ProviderProfile[]] {
  const [first, ...rest] = profiles;
  return first ? [first, ...rest] : [emptyProfile()];
}

// Renders and validates the local provider, model capability, and language settings.
export function SettingsView({ settings, onSaved }: SettingsViewProps) {
  const [locale, setLocale] = useState<Locale>(settings.locale);
  const [profiles, setProfiles] = useState(() =>
    createProviderDrafts(settings.providers),
  );
  const [profileId, setProfileId] = useState(profiles[0].id);
  const [taskModels, setTaskModels] = useState<StoredSettings["taskModels"]>(
    settings.taskModels,
  );
  const [models, setModels] = useState<string[]>([]);
  const profile = profiles.find((item) => item.id === profileId);
  if (!profile) throw new Error("settingsInvalid");
  const { protocol, baseUrl, apiKey, model, targetLanguage, capabilities } =
    profile.config;
  const availableModels = [...new Set([...(model ? [model] : []), ...models])];
  const [resultDisplayMode, setResultDisplayMode] = useState<ResultDisplayMode>(
    settings.resultDisplayMode,
  );
  const [allowMultiTab, setAllowMultiTab] = useState(settings.allowMultiTab);
  const [showKey, setShowKey] = useState(false);
  const [showData, setShowData] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);
  const [busy, setBusy] = useState<"models" | "save" | null>(null);

  const modelPlaceholder = t(
    locale,
    availableModels.length === 0 ? "loadModelsFirst" : "selectModel",
  );
  const modelItems = [
    {
      label: modelPlaceholder,
      value: null,
    },
    ...availableModels.map((availableModel) => ({
      label: availableModel,
      value: availableModel,
    })),
  ];
  const outputLanguageItems = OUTPUT_LANGUAGES.map(([value, labelKey]) => ({
    label: t(locale, labelKey),
    value,
  }));
  const interfaceLanguageItems = INTERFACE_LANGUAGES.map(
    ([value, labelKey]) => ({
      label: t(locale, labelKey),
      value,
    }),
  );
  const profileItems = profiles.map((item) => ({
    value: item.id,
    label: item.config.model ? `${item.config.model}${item.name ? ` (${item.name})` : ""}` : item.name || t(locale, "newProvider"),
  }));
  const configuredModels = profiles.filter((item) => item.config.model.trim());
  const additionalModels = models.filter((modelId) => !configuredModels.some((item) =>
    item.config.model === modelId && item.config.baseUrl === baseUrl && item.config.apiKey === apiKey && item.config.protocol === protocol,
  ));
  const taskItems = [
    { value: null, label: t(locale, "unassignedModel") },
    ...configuredModels.map((item) => ({
      value: item.id,
      label: `${item.config.model}${item.name ? ` (${item.name})` : ""}`,
    })),
    ...additionalModels.map((modelId) => ({ value: JSON.stringify([profileId, modelId]), label: modelId })),
  ];

  function assignTaskModel(task: ModelTask, value: string | null): void {
    const modelId = additionalModels.find((id) => JSON.stringify([profileId, id]) === value);
    if (modelId) {
      const next: ProviderProfile = {
        id: crypto.randomUUID(),
        name: modelId,
        config: { protocol, baseUrl, apiKey, targetLanguage, model: modelId, capabilities: createUnknownCapabilities() },
      };
      setProfiles((items) => [...items, next]);
      setTaskModels((current) => ({ ...current, [task]: next.id }));
    } else {
      setTaskModels((current) => ({ ...current, [task]: value }));
    }
  }

  // Refreshes form values when the persisted settings object changes.
  useEffect(() => {
    setLocale(settings.locale);
    const nextProfiles = createProviderDrafts(settings.providers);
    setProfiles(nextProfiles);
    setProfileId(nextProfiles[0].id);
    setTaskModels(settings.taskModels);
    setModels([]);
    setResultDisplayMode(settings.resultDisplayMode);
    setAllowMultiTab(settings.allowMultiTab);
  }, [settings]);

  function updateConfig(
    patch: Partial<ProviderConfig>,
  ): void {
    setProfiles((items) =>
      createProviderDrafts(
        items.map((item) =>
          item.id === profileId
            ? {
                ...item,
                config: {
                  ...item.config,
                  ...patch,
                },
              }
            : item,
        ),
      ),
    );
  }

  function handleAddProfile(): void {
    const next = emptyProfile();
    setProfiles((items) => [...items, next]);
    setProfileId(next.id);
    setModels([]);
    setShowKey(false);
  }

  function handleDeleteProfile(): void {
    const remaining = profiles.filter((item) => item.id !== profileId);
    const next = createProviderDrafts(remaining);
    setProfiles(next);
    setProfileId(next[0].id);
    setTaskModels((current) => ({
      chat: current.chat === profileId ? null : current.chat,
      text: current.text === profileId ? null : current.text,
      vision: current.vision === profileId ? null : current.vision,
      automation: current.automation === profileId ? null : current.automation,
    }));
    setModels([]);
    setShowKey(false);
  }

  // Loads the provider's current model list after validating its credentials.
  async function handleLoadModels(): Promise<void> {
    setBusy("models");
    try {
      const credentials = parseProviderCredentials({ protocol, baseUrl, apiKey });
      const availableModels = await loadProviderModels(credentials);
      setModels(availableModels);
      notify.success(t(locale, "modelsLoaded"));
    } catch (error) {
      notify.error(formatError(locale, error));
    } finally {
      setBusy(null);
    }
  }

  // Saves the complete validated provider and preference revision.
  async function handleSave(): Promise<void> {
    try {
      setBusy("save");
      const savedProfiles = profiles
        .filter(
          (item) =>
            item.name.trim() ||
            item.config.baseUrl.trim() ||
            item.config.apiKey.trim() ||
            item.config.model.trim(),
        )
        .map((item) => {
          if (!item.name.trim()) throw new Error("providerNameRequired");
          return {
            ...item,
            name: item.name.trim(),
            config: parseProviderConfig(item.config),
          };
        });
      const origins = allowMultiTab
        ? ["http://*/*", "https://*/*"]
        : [
            ...new Set(
              savedProfiles.map((item) =>
                getProviderHostPermission(item.config.baseUrl),
              ),
            ),
          ];
      if (origins.length) {
        const granted = await browser.permissions.request({ origins });
        if (!granted)
          throw new Error(
            allowMultiTab ? "multiTabAccessDenied" : "providerAccessDenied",
          );
      }
      const ids = new Set(savedProfiles.map((item) => item.id));
      const nextSettings: StoredSettings = {
        version: SETTINGS_VERSION,
        enabled: settings.enabled,
        locale,
        providers: savedProfiles,
        taskModels: {
          chat:
            taskModels.chat !== null && ids.has(taskModels.chat)
              ? taskModels.chat
              : null,
          text:
            taskModels.text !== null && ids.has(taskModels.text)
              ? taskModels.text
              : null,
          vision:
            taskModels.vision !== null && ids.has(taskModels.vision)
              ? taskModels.vision
              : null,
          automation:
            taskModels.automation !== null && ids.has(taskModels.automation)
              ? taskModels.automation
              : null,
        },
        resultDisplayMode,
        allowMultiTab,
      };
      await saveSettings(nextSettings);
      onSaved(nextSettings);
      notify.success(t(locale, "settingsSaved"));
    } catch (error) {
      notify.error(formatError(locale, error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="flex min-w-0 flex-col gap-6 p-4 sm:p-6">
      <section className="flex min-w-0 flex-col gap-4" aria-labelledby="model-settings-heading">
        <h2 id="model-settings-heading" className="text-base font-semibold">{t(locale, "provider")}</h2>
        <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field className="sm:col-span-2" data-disabled={busy !== null}>
            <FieldLabel htmlFor="provider-profile">{t(locale, "providerProfile")}</FieldLabel>
            <div className="flex min-w-0 items-center gap-2">
              <Select items={profileItems} value={profileId} disabled={busy !== null} onValueChange={(id) => {
                if (id === null) return;
                setProfileId(id);
                setModels([]);
                setShowKey(false);
              }}>
                <SelectTrigger id="provider-profile" className="min-w-0 flex-1"><SelectValue /></SelectTrigger>
                <SelectContent alignItemWithTrigger={false}><SelectGroup>
                  {profileItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
              <IconTooltip label={t(locale, "addProvider")}>
                <Button variant="outline" size="icon" aria-label={t(locale, "addProvider")} disabled={busy !== null} onClick={handleAddProfile}><Plus /></Button>
              </IconTooltip>
              <IconTooltip label={t(locale, "deleteProvider")}>
                <Button variant="ghost" size="icon" aria-label={t(locale, "deleteProvider")} disabled={busy !== null} onClick={handleDeleteProfile}><Trash2 /></Button>
              </IconTooltip>
            </div>
          </Field>
          <Field data-disabled={busy !== null}>
            <FieldLabel htmlFor="provider-protocol">{t(locale, "providerProtocol")}</FieldLabel>
            <Select items={PROVIDER_PROTOCOLS.map((value) => ({ value, label: t(locale, `protocol_${value}`) }))} value={protocol} disabled={busy !== null} onValueChange={(value) => {
              if (value !== null) {
                updateConfig({ protocol: value, capabilities: createUnknownCapabilities() });
                setModels([]);
              }
            }}>
              <SelectTrigger id="provider-protocol" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent alignItemWithTrigger={false}><SelectGroup>
                {PROVIDER_PROTOCOLS.map((value) => <SelectItem key={value} value={value}>{t(locale, `protocol_${value}`)}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field data-disabled={busy !== null}>
            <FieldLabel htmlFor="base-url">{t(locale, "baseUrl")}</FieldLabel>
            <Input id="base-url" value={baseUrl} placeholder={protocol === "anthropic" ? "https://api.anthropic.com/v1" : protocol === "gemini" ? "https://generativelanguage.googleapis.com/v1beta" : "https://api.openai.com/v1"} inputMode="url" autoComplete="url" disabled={busy !== null} onChange={(event) => {
              updateConfig({ baseUrl: event.target.value });
              setModels([]);
            }} />
          </Field>
          <Field data-disabled={busy !== null}>
            <FieldLabel htmlFor="api-key">{t(locale, "apiKey")}</FieldLabel>
            <InputGroup>
              <InputGroupInput id="api-key" value={apiKey} type={showKey ? "text" : "password"} autoComplete="off" spellCheck={false} disabled={busy !== null} onChange={(event) => {
                updateConfig({ apiKey: event.target.value });
                setModels([]);
              }} />
              <InputGroupAddon align="inline-end">
                <IconTooltip label={t(locale, showKey ? "hideApiKey" : "showApiKey")}>
                  <InputGroupButton size="icon-xs" aria-label={t(locale, showKey ? "hideApiKey" : "showApiKey")} disabled={busy !== null} onClick={() => setShowKey((visible) => !visible)}>
                    {showKey ? <EyeOff /> : <Eye />}
                  </InputGroupButton>
                </IconTooltip>
              </InputGroupAddon>
            </InputGroup>
          </Field>
          <Field data-disabled={busy !== null}>
            <FieldLabel htmlFor="model">{t(locale, "model")}</FieldLabel>
            <div className="flex min-w-0 items-center gap-2">
              <Select items={modelItems} value={model || null} disabled={availableModels.length === 0 || busy !== null} onValueChange={(nextModel) => {
                if (nextModel !== null) updateConfig({ model: nextModel });
              }}>
                <SelectTrigger id="model" className="min-w-0 flex-1"><SelectValue /></SelectTrigger>
                <SelectContent alignItemWithTrigger={false}><SelectGroup>
                  <SelectItem value={null} disabled>{modelPlaceholder}</SelectItem>
                  {availableModels.map((id) => <SelectItem key={id} value={id}>{id}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
              <IconTooltip label={t(locale, busy === "models" ? "loadingModels" : "loadModels")}>
                <Button type="button" variant="outline" size="icon" aria-label={t(locale, "loadModels")} disabled={busy !== null || !baseUrl.trim() || !apiKey.trim()} onClick={handleLoadModels}>
                  {busy === "models" ? <Spinner /> : <RefreshCw />}
                </Button>
              </IconTooltip>
            </div>
          </Field>
          <Field data-disabled={busy !== null}>
            <FieldLabel htmlFor="provider-name">{t(locale, "providerName")}</FieldLabel>
            <Input id="provider-name" value={profile.name} maxLength={100} disabled={busy !== null} onChange={(event) => {
              setProfiles((items) => createProviderDrafts(items.map((item) => item.id === profileId ? { ...item, name: event.target.value } : item)));
            }} />
          </Field>
          <Field data-disabled={busy !== null}>
            <FieldLabel htmlFor="target-language">{t(locale, "targetLanguage")}</FieldLabel>
            <Select items={outputLanguageItems} value={targetLanguage} disabled={busy !== null} onValueChange={(value) => { if (value !== null) updateConfig({ targetLanguage: value }); }}>
              <SelectTrigger id="target-language" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent alignItemWithTrigger={false}><SelectGroup>
                {outputLanguageItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Field>
        </FieldGroup>
        <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(["webSearch", "vision"] as const).map((capability) => (
            <Field key={capability} orientation="horizontal" data-disabled={busy !== null}>
              <FieldContent>
                <FieldLabel htmlFor={`model-${capability}`}>{t(locale, `capability_${capability}`)}</FieldLabel>
              </FieldContent>
              <Switch
                id={`model-${capability}`}
                checked={capabilities[capability].status === "supported"}
                disabled={busy !== null}
                onCheckedChange={(enabled) => updateConfig({
                  capabilities: {
                    ...capabilities,
                    [capability]: enabled ? { status: "supported", checkedAt: null } : { status: "unknown" },
                  },
                })}
              />
            </Field>
          ))}
        </FieldGroup>
      </section>

      <Separator />
      <section className="flex flex-col gap-4" aria-labelledby="task-models-heading">
        <h2 id="task-models-heading" className="text-base font-semibold">{t(locale, "taskModels")}</h2>
        <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {MODEL_TASKS.map((task) => (
            <Field key={task} data-disabled={busy !== null}>
              <FieldLabel htmlFor={`task-model-${task}`}>{t(locale, `modelTask_${task}`)}</FieldLabel>
              <Select items={taskItems} value={taskModels[task]} disabled={busy !== null} onValueChange={(id) => assignTaskModel(task, id)}>
                <SelectTrigger id={`task-model-${task}`} className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent alignItemWithTrigger={false}><SelectGroup>
                  {taskItems.map((item) => <SelectItem key={item.value ?? "none"} value={item.value}>{item.label}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
            </Field>
          ))}
        </FieldGroup>
      </section>

      <Separator />
      <section className="flex flex-col gap-4" aria-labelledby="preferences-heading">
        <h2 id="preferences-heading" className="text-base font-semibold">{t(locale, "preferences")}</h2>
        <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field data-disabled={busy !== null}>
            <FieldLabel htmlFor="locale">{t(locale, "interfaceLanguage")}</FieldLabel>
            <Select items={interfaceLanguageItems} value={locale} disabled={busy !== null} onValueChange={(value) => { if (value !== null) setLocale(value); }}>
              <SelectTrigger id="locale" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent alignItemWithTrigger={false}><SelectGroup>
                {interfaceLanguageItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field data-disabled={busy !== null}>
            <FieldLabel>{t(locale, "resultDisplayMode")}</FieldLabel>
            <ToggleGroup className="grid w-full grid-cols-2" variant="outline" spacing={0} value={[resultDisplayMode]} disabled={busy !== null} aria-label={t(locale, "resultDisplayMode")} onValueChange={(values) => {
              const mode = values[0];
              if (mode === "floating" || mode === "inline") setResultDisplayMode(mode);
            }}>
              <ToggleGroupItem value="floating"><PanelTop data-icon="inline-start" />{t(locale, "floatingResult")}</ToggleGroupItem>
              <ToggleGroupItem value="inline"><BetweenVerticalEnd data-icon="inline-start" />{t(locale, "inlineResult")}</ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <Field orientation="horizontal" data-disabled={busy !== null}>
            <FieldContent>
              <FieldLabel htmlFor="allow-multi-tab">{t(locale, "allowMultiTab")}</FieldLabel>
            </FieldContent>
            <Switch id="allow-multi-tab" checked={allowMultiTab} disabled={busy !== null} onCheckedChange={setAllowMultiTab} />
          </Field>
        </FieldGroup>
      </section>

      <Separator />
      <section className="flex flex-col gap-4">
        <details onToggle={(event) => setShowData(event.currentTarget.open)}>
          <summary className="cursor-pointer text-sm font-medium">{t(locale, "localData")}</summary>
          {showData && <div className="pt-3"><LocalDataView locale={locale} /></div>}
        </details>
        <details onToggle={(event) => setShowPermissions(event.currentTarget.open)}>
          <summary className="cursor-pointer text-sm font-medium">{t(locale, "websitePermissions")}</summary>
          {showPermissions && <div className="pt-3"><HostPermissionsView locale={locale} /></div>}
        </details>
        <details>
          <summary className="cursor-pointer text-sm font-medium">{t(locale, "privacy")}</summary>
          <Alert role="note" className="mt-3">
            <Info /><AlertTitle>{t(locale, "privacy")}</AlertTitle>
            <AlertDescription><p>{t(locale, "localKeyNotice")}</p><p>{t(locale, "selectedContentNotice")}</p></AlertDescription>
          </Alert>
        </details>
      </section>
      <footer className="sticky bottom-0 flex justify-end border-t bg-background py-3">
        <Button type="button" disabled={busy !== null} onClick={handleSave}>
          {busy === "save" ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
          {t(locale, "save")}
        </Button>
      </footer>
    </main>
  );
}
