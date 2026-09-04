import {
  BetweenVerticalEnd,
  CircleAlert,
  CircleCheck,
  Eye,
  EyeOff,
  Info,
  PanelTop,
  PlugZap,
  RefreshCw,
  Save,
} from "lucide-react";
import { useEffect, useState } from "react";
import { browser } from "wxt/browser";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
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
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";

import type {
  BackgroundRequest,
  CommandResult,
  Locale,
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
} from "../../shared/settings";
import { formatError, t } from "./translations";
import { IconTooltip } from "./ui";

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

// Retrieves model IDs through the background worker without exposing requests to page scripts.
async function loadProviderModels(
  credentials: ProviderCredentials,
): Promise<string[]> {
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

// Sends a connection test through the background worker and unwraps its typed result.
async function testProviderConnection(provider: ProviderConfig): Promise<void> {
  const request: BackgroundRequest = {
    target: "background",
    type: "test-connection",
    provider,
  };
  const result = (await browser.runtime.sendMessage(request)) as CommandResult<null>;
  if (!result.ok) throw new Error(result.error);
}

// Renders and validates the local provider, model capability, and language settings.
export function SettingsView({ settings, onSaved }: SettingsViewProps) {
  const [locale, setLocale] = useState<Locale>(settings.locale);
  const [baseUrl, setBaseUrl] = useState(settings.provider?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState(settings.provider?.apiKey ?? "");
  const [model, setModel] = useState(settings.provider?.model ?? "");
  const [models, setModels] = useState<string[]>(
    settings.provider ? [settings.provider.model] : [],
  );
  const [supportsVision, setSupportsVision] = useState(
    settings.provider?.supportsVision ?? false,
  );
  const [targetLanguage, setTargetLanguage] = useState(
    settings.provider?.targetLanguage ?? "Simplified Chinese",
  );
  const [resultDisplayMode, setResultDisplayMode] =
    useState<ResultDisplayMode>(settings.resultDisplayMode);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState<"models" | "test" | "save" | null>(null);
  const [notice, setNotice] = useState<
    { type: "success" | "error"; text: string } | undefined
  >();

  const modelPlaceholder = t(
    locale,
    models.length === 0 ? "loadModelsFirst" : "selectModel",
  );
  const modelItems = [
    {
      label: modelPlaceholder,
      value: null,
    },
    ...models.map((availableModel) => ({
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

  // Refreshes form values when the persisted settings object changes.
  useEffect(() => {
    setLocale(settings.locale);
    setBaseUrl(settings.provider?.baseUrl ?? "");
    setApiKey(settings.provider?.apiKey ?? "");
    setModel(settings.provider?.model ?? "");
    setModels(settings.provider ? [settings.provider.model] : []);
    setSupportsVision(settings.provider?.supportsVision ?? false);
    setTargetLanguage(
      settings.provider?.targetLanguage ?? "Simplified Chinese",
    );
    setResultDisplayMode(settings.resultDisplayMode);
  }, [settings]);

  // Builds one validated provider object from the controlled form fields.
  function getProvider(): ProviderConfig {
    return parseProviderConfig({
      baseUrl,
      apiKey,
      model,
      supportsVision,
      targetLanguage,
    });
  }

  // Loads the provider's current model list after validating its credentials.
  async function handleLoadModels(): Promise<void> {
    setNotice(undefined);
    setBusy("models");
    try {
      const credentials = parseProviderCredentials({ baseUrl, apiKey });
      const availableModels = await loadProviderModels(credentials);
      setModels(availableModels);
      setModel((current) =>
        availableModels.includes(current) ? current : "",
      );
      setNotice({ type: "success", text: t(locale, "modelsLoaded") });
    } catch (error) {
      setNotice({ type: "error", text: formatError(locale, error) });
    } finally {
      setBusy(null);
    }
  }

  // Tests the exact draft configuration against the configured provider.
  async function handleTest(): Promise<void> {
    setNotice(undefined);
    try {
      const provider = getProvider();
      setBusy("test");
      await testProviderConnection(provider);
      setNotice({ type: "success", text: t(locale, "connectionPassed") });
    } catch (error) {
      setNotice({ type: "error", text: formatError(locale, error) });
    } finally {
      setBusy(null);
    }
  }

  // Saves the complete validated provider and preference revision.
  async function handleSave(): Promise<void> {
    setNotice(undefined);
    try {
      setBusy("save");
      const providerFieldsAreEmpty =
        !baseUrl.trim() && !apiKey.trim() && !model.trim();

      if (providerFieldsAreEmpty) {
        const nextSettings: StoredSettings = {
          version: SETTINGS_VERSION,
          locale,
          provider: null,
          resultDisplayMode,
        };
        await saveSettings(nextSettings);
        onSaved(nextSettings);
        return;
      }

      const provider = getProvider();
      const nextSettings: StoredSettings = {
        version: SETTINGS_VERSION,
        locale,
        provider,
        resultDisplayMode,
      };
      await saveSettings(nextSettings);
      onSaved(nextSettings);
    } catch (error) {
      setNotice({ type: "error", text: formatError(locale, error) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="flex flex-col gap-3 p-3 pb-6">
      <Card size="sm">
        <CardHeader>
          <CardTitle>{t(locale, "provider")}</CardTitle>
          <CardDescription>{t(locale, "providerDescription")}</CardDescription>
        </CardHeader>

        <CardContent>
          <FieldGroup className="gap-4">
            <Field data-disabled={busy !== null}>
              <FieldLabel htmlFor="base-url">{t(locale, "baseUrl")}</FieldLabel>
              <Input
                id="base-url"
                value={baseUrl}
                placeholder="https://api.openai.com/v1"
                inputMode="url"
                autoComplete="url"
                disabled={busy !== null}
                onChange={(event) => {
                  setBaseUrl(event.target.value);
                  setModel("");
                  setModels([]);
                  setNotice(undefined);
                }}
              />
            </Field>

            <Field data-disabled={busy !== null}>
              <FieldLabel htmlFor="api-key">{t(locale, "apiKey")}</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="api-key"
                  value={apiKey}
                  type={showKey ? "text" : "password"}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy !== null}
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    setModel("");
                    setModels([]);
                    setNotice(undefined);
                  }}
                />
                <InputGroupAddon align="inline-end">
                  <IconTooltip
                    label={t(locale, showKey ? "hideApiKey" : "showApiKey")}
                  >
                    <InputGroupButton
                      size="icon-xs"
                      aria-label={t(
                        locale,
                        showKey ? "hideApiKey" : "showApiKey",
                      )}
                      disabled={busy !== null}
                      onClick={() => setShowKey((visible) => !visible)}
                    >
                      {showKey ? <EyeOff /> : <Eye />}
                    </InputGroupButton>
                  </IconTooltip>
                </InputGroupAddon>
              </InputGroup>
            </Field>

            <Field data-disabled={busy !== null}>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={busy !== null || !baseUrl.trim() || !apiKey.trim()}
                onClick={handleLoadModels}
              >
                {busy === "models" ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <RefreshCw data-icon="inline-start" />
                )}
                {t(
                  locale,
                  busy === "models" ? "loadingModels" : "loadModels",
                )}
              </Button>
            </Field>

            <Field data-disabled={models.length === 0 || busy !== null}>
              <FieldLabel htmlFor="model">{t(locale, "model")}</FieldLabel>
              <Select
                items={modelItems}
                value={model || null}
                disabled={models.length === 0 || busy !== null}
                onValueChange={(nextModel) => setModel(nextModel ?? "")}
              >
                <SelectTrigger id="model" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    <SelectItem value={null} disabled>
                      {modelPlaceholder}
                    </SelectItem>
                    {models.map((availableModel) => (
                      <SelectItem key={availableModel} value={availableModel}>
                        {availableModel}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field orientation="horizontal" data-disabled={busy !== null}>
              <FieldLabel htmlFor="supports-vision">
                {t(locale, "supportsVision")}
              </FieldLabel>
              <Switch
                id="supports-vision"
                checked={supportsVision}
                disabled={busy !== null}
                onCheckedChange={setSupportsVision}
              />
            </Field>
          </FieldGroup>
        </CardContent>

        <CardFooter>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={busy !== null}
            onClick={handleTest}
          >
            {busy === "test" ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <PlugZap data-icon="inline-start" />
            )}
            {t(locale, busy === "test" ? "testingConnection" : "testConnection")}
          </Button>
        </CardFooter>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{t(locale, "preferences")}</CardTitle>
        </CardHeader>

        <CardContent>
          <FieldGroup className="gap-4">
            <Field data-disabled={busy !== null}>
              <FieldLabel htmlFor="target-language">
                {t(locale, "targetLanguage")}
              </FieldLabel>
              <Select
                items={outputLanguageItems}
                value={targetLanguage}
                disabled={busy !== null}
                onValueChange={(nextLanguage) => {
                  if (nextLanguage !== null) setTargetLanguage(nextLanguage);
                }}
              >
                <SelectTrigger id="target-language" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {outputLanguageItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field data-disabled={busy !== null}>
              <FieldLabel htmlFor="locale">
                {t(locale, "interfaceLanguage")}
              </FieldLabel>
              <Select
                items={interfaceLanguageItems}
                value={locale}
                disabled={busy !== null}
                onValueChange={(nextLocale) => {
                  if (nextLocale !== null) setLocale(nextLocale);
                }}
              >
                <SelectTrigger id="locale" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {interfaceLanguageItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field data-disabled={busy !== null}>
              <FieldLabel>{t(locale, "resultDisplayMode")}</FieldLabel>
              <ToggleGroup
                className="grid w-full grid-cols-2"
                variant="outline"
                spacing={0}
                value={[resultDisplayMode]}
                disabled={busy !== null}
                aria-label={t(locale, "resultDisplayMode")}
                onValueChange={(values) => {
                  const nextMode = values[0];
                  if (nextMode === "floating" || nextMode === "inline") {
                    setResultDisplayMode(nextMode);
                  }
                }}
              >
                <ToggleGroupItem value="floating">
                  <PanelTop data-icon="inline-start" />
                  {t(locale, "floatingResult")}
                </ToggleGroupItem>
                <ToggleGroupItem value="inline">
                  <BetweenVerticalEnd data-icon="inline-start" />
                  {t(locale, "inlineResult")}
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Alert role="note">
        <Info />
        <AlertTitle>{t(locale, "privacy")}</AlertTitle>
        <AlertDescription>
          <p>{t(locale, "localKeyNotice")}</p>
          <p>{t(locale, "selectedContentNotice")}</p>
        </AlertDescription>
      </Alert>

      {notice && (
        <Alert
          variant={notice.type === "error" ? "destructive" : "default"}
          role={notice.type === "error" ? "alert" : "status"}
        >
          {notice.type === "error" ? <CircleAlert /> : <CircleCheck />}
          <AlertDescription>{notice.text}</AlertDescription>
        </Alert>
      )}

      <Button
        type="button"
        size="lg"
        className="w-full"
        disabled={busy !== null}
        onClick={handleSave}
      >
        {busy === "save" ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <Save data-icon="inline-start" />
        )}
        {t(locale, "save")}
      </Button>
    </main>
  );
}
