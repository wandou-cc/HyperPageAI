import { z } from "zod";

const variablePattern = /\{\{([^{}]*)\}\}/gu;
const variableNamePattern = /^[\p{L}_][\p{L}\p{N}_]{0,39}$/u;

export function getTemplateVariables(template: string): string[] {
  const names = new Set<string>();
  const remaining = template.replace(
    variablePattern,
    (_token, name: string) => {
      if (!variableNamePattern.test(name))
        throw new Error("templateSyntaxInvalid");
      names.add(name);
      return "";
    },
  );
  if (remaining.includes("{{") || remaining.includes("}}"))
    throw new Error("templateSyntaxInvalid");
  return [...names];
}

export function fillTemplate(
  template: string,
  values: Record<string, string>,
): string {
  const names = getTemplateVariables(template);
  if (Object.keys(values).some((name) => !names.includes(name)))
    throw new Error("templateValuesInvalid");
  return template.replace(variablePattern, (_token, name: string) => {
    const value = values[name];
    if (!Object.hasOwn(values, name) || !value?.trim())
      throw new Error("templateValueRequired");
    return value;
  });
}

export function parseSiteOrigins(value: unknown): string[] {
  const parsed = z.array(z.string()).max(30).safeParse(value);
  if (!parsed.success) throw new Error("siteScopeInvalid");
  const origins = parsed.data.map((origin) => {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error("siteScopeInvalid");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.hostname.includes("*") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error("siteScopeInvalid");
    return url.origin;
  });
  return [...new Set(origins)];
}

export function parseSiteInput(input: string): string[] {
  return parseSiteOrigins(
    input
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

export function assertSiteAllowed(url: string, allowedOrigins: string[]): void {
  if (allowedOrigins.length && !allowedOrigins.includes(new URL(url).origin))
    throw new Error("siteScopeDenied");
}
