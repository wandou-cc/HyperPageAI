import { Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Locale } from "../../shared/messages";
import { downloadText, markdownToText } from "../../shared/export";
import { formatError, t } from "./translations";
import { message as notify } from "@/components/ui/toast";
import { IconTooltip } from "./ui";

export function TextExport({
  content,
  filename,
  locale,
  disabled = false,
}: {
  content: string | (() => string);
  filename: string;
  locale: Locale;
  disabled?: boolean;
}) {
  const [format, setFormat] = useState<"markdown" | "text">("markdown");
  const formats = [
    { value: "markdown", label: "Markdown" },
    { value: "text", label: t(locale, "plainText") },
  ] as const;
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Select
        items={formats}
        value={format}
        disabled={disabled}
        onValueChange={(value) => { if (value !== null) setFormat(value); }}
      >
        <SelectTrigger size="sm" className="w-28" aria-label={t(locale, "exportFormat")}><SelectValue /></SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {formats.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
          </SelectGroup>
        </SelectContent>
      </Select>
      <IconTooltip label={t(locale, "exportText")}>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={t(locale, "exportText")}
          disabled={disabled || !content}
          onClick={() => {
            try {
            const value = typeof content === "function" ? content() : content;
            downloadText(
              format === "markdown" ? value : markdownToText(value),
              `${filename}.${format === "markdown" ? "md" : "txt"}`,
              format === "markdown"
                ? "text/markdown;charset=utf-8"
                : "text/plain;charset=utf-8",
            );
            } catch (failure) {
              notify.error(formatError(locale, failure));
            }
          }}
        >
          <Download />
        </Button>
      </IconTooltip>
    </div>
  );
}
