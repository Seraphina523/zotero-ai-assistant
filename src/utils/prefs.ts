import { config } from "../../package.json";
import {
  ResolvedConfig,
  getActiveProfileId,
  listProfiles,
} from "../ai/providers";

const PREFIX = config.prefsPrefix;

export const DEFAULT_TEMPERATURE = 0.3;
export const DEFAULT_MAX_TOKENS = 8192;
export const DEFAULT_MAX_PDF_CHARS = 60000;
export const DEFAULT_CONTEXT_CHARS = 12000;

export function getPref<T = any>(key: string, fallback?: T): T {
  const value = Zotero.Prefs.get(`${PREFIX}.${key}`, true);
  if (value === undefined || value === null || value === "") {
    return (fallback !== undefined ? fallback : value) as T;
  }
  return value as T;
}

export function setPref(key: string, value: any) {
  Zotero.Prefs.set(`${PREFIX}.${key}`, value, true);
}

export function clearPref(key: string) {
  Zotero.Prefs.clear(`${PREFIX}.${key}`, true);
}

export function isEnabled(): boolean {
  return getPref<boolean>("enable", true) !== false;
}

/** The id of the profile currently selected in the pane. */
export function getProviderId(): string {
  return getActiveProfileId();
}

export function getTemperature(): number {
  const raw = Number(getPref("temperature", DEFAULT_TEMPERATURE));
  if (!Number.isFinite(raw)) return DEFAULT_TEMPERATURE;
  return Math.min(2, Math.max(0, raw));
}

export function getMaxTokens(): number {
  const raw = Number(getPref("maxTokens", DEFAULT_MAX_TOKENS));
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MAX_TOKENS;
  return Math.min(64000, Math.floor(raw));
}

export function getMaxPdfChars(): number {
  const raw = Number(getPref("maxPdfChars", DEFAULT_MAX_PDF_CHARS));
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MAX_PDF_CHARS;
  return Math.min(400000, Math.floor(raw));
}

export function getContextChars(): number {
  const raw = Number(getPref("contextChars", DEFAULT_CONTEXT_CHARS));
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_CONTEXT_CHARS;
  return Math.min(60000, Math.floor(raw));
}

/**
 * Resolve the active profile into request configuration.
 *
 * Reads from the profile store, falling back to the shipped defaults so an
 * untouched installation still works.
 */
export function resolveConfig(
  providerId = getProviderId(),
  modelOverride?: string,
): ResolvedConfig {
  const profiles = listProfiles();
  const profile =
    profiles.find((entry) => entry.id === providerId) || profiles[0];

  if (!profile) {
    return {
      provider: "openai",
      providerName: "OpenAI",
      style: "openai",
      baseURL: "https://api.openai.com/v1",
      apiKey: "",
      model: modelOverride || "",
      temperature: getTemperature(),
      maxTokens: getMaxTokens(),
    };
  }

  return {
    provider: profile.id,
    providerName: profile.name,
    style: profile.style,
    baseURL: profile.baseURL,
    apiKey: profile.apiKey,
    // The pane's model picker takes precedence over the profile default.
    model: modelOverride || profile.defaultModel,
    temperature: getTemperature(),
    maxTokens: getMaxTokens(),
  };
}

export function getPrefSummary(): string {
  const cfg = resolveConfig();
  return `${cfg.providerName} · ${cfg.model || "(未设置模型)"}`;
}

/** Compatibility helpers kept for older call sites. */
export function getApiKey(_provider = getProviderId()): string {
  return resolveConfig().apiKey;
}

export function getBaseURL(_provider = getProviderId()): string {
  return resolveConfig().baseURL;
}

export function getModel(_provider = getProviderId()): string {
  return resolveConfig().model;
}
