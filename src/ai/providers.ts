/**
 * Provider presets and profile management.
 *
 * A "profile" is one complete, independently configured connection: a name, an
 * API style, a base URL, an API key and a model. Built-in presets are offered as
 * starting points; the user can add, rename, duplicate and delete profiles, and
 * custom entries work for any endpoint (including Claude-style APIs).
 */

export type ApiStyle = "openai" | "anthropic";

export interface Profile {
  id: string;
  /** User-visible name. */
  name: string;
  /** Request protocol. */
  style: ApiStyle;
  /** Base URL without the endpoint path. */
  baseURL: string;
  apiKey: string;
  /** Default model; the model box can be edited freely. */
  defaultModel: string;
  /** Suggested model names, shown in a datalist. */
  models: string[];
  /** Whether an API key is required (local services don't need one). */
  apiKeyOptional?: boolean;
  /** Short note shown under the field. */
  hint?: string;
  /** True for the shipped presets; user profiles are removable. */
  builtin?: boolean;
}

/** Built-in starting points. Nothing is stored until the user saves. */
export const BUILTIN_PROFILES: Profile[] = [
  {
    id: "openai",
    name: "OpenAI",
    style: "openai",
    baseURL: "https://api.openai.com/v1",
    apiKey: "",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini", "o4-mini"],
    hint: "platform.openai.com/api-keys",
    builtin: true,
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    style: "anthropic",
    baseURL: "https://api.anthropic.com",
    apiKey: "",
    defaultModel: "claude-sonnet-4-5",
    models: [
      "claude-sonnet-4-5",
      "claude-opus-4-1",
      "claude-haiku-4-5",
      "claude-3-5-sonnet-latest",
    ],
    hint: "console.anthropic.com/settings/keys · 使用 Claude Messages API",
    builtin: true,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    style: "openai",
    baseURL: "https://api.deepseek.com/v1",
    apiKey: "",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    hint: "platform.deepseek.com · 国内直连，性价比高",
    builtin: true,
  },
  {
    id: "qwen",
    name: "通义千问 Qwen",
    style: "openai",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "",
    defaultModel: "qwen-plus",
    models: ["qwen-plus", "qwen-max", "qwen-turbo", "qwen-long"],
    hint: "bailian.console.aliyun.com · OpenAI 兼容模式",
    builtin: true,
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    style: "openai",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    apiKey: "",
    defaultModel: "glm-4-plus",
    models: ["glm-4-plus", "glm-4", "glm-4-flash", "glm-4-long"],
    hint: "open.bigmodel.cn/usercenter/apikeys",
    builtin: true,
  },
  {
    id: "moonshot",
    name: "Kimi / Moonshot",
    style: "openai",
    baseURL: "https://api.moonshot.cn/v1",
    apiKey: "",
    defaultModel: "moonshot-v1-32k",
    models: [
      "moonshot-v1-8k",
      "moonshot-v1-32k",
      "moonshot-v1-128k",
      "kimi-k2-0711-preview",
    ],
    hint: "platform.moonshot.cn/console/api-keys",
    builtin: true,
  },
  {
    id: "siliconflow",
    name: "硅基流动 SiliconFlow",
    style: "openai",
    baseURL: "https://api.siliconflow.cn/v1",
    apiKey: "",
    defaultModel: "deepseek-ai/DeepSeek-V3",
    models: [
      "deepseek-ai/DeepSeek-V3",
      "deepseek-ai/DeepSeek-R1",
      "Qwen/Qwen2.5-72B-Instruct",
      "THUDM/glm-4-9b-chat",
    ],
    hint: "cloud.siliconflow.cn · 一个 key 可用多家模型",
    builtin: true,
  },
  {
    id: "volcengine",
    name: "火山方舟 Ark",
    style: "openai",
    baseURL: "https://ark.cn-beijing.volces.com/api/coding/v3",
    apiKey: "",
    // Dated version ids, which is what the API expects. The console's
    // "Auto" mode is a UI-only alias and is not accepted by the API.
    defaultModel: "doubao-seed-2.0-pro-260215",
    models: [
      "doubao-seed-2.0-pro-260215",
      "doubao-seed-2.1-pro",
      "doubao-seed-2.1-lite",
      "doubao-seed-2.0-mini",
      "doubao-seed-evolving",
      "deepseek-v4.1-flash",
      "deepseek-v4.1-flash-economy",
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "kimi-k3.1-pro",
      "kimi-k2.8-preview",
      "kimi-k2.7-code",
      "kimi-k3",
      "glm-5.3",
      "glm-5.3-flash",
      "minimax-m3",
    ],
    hint: "Coding Plan 专用地址 https://ark.cn-beijing.volces.com/api/coding/v3（勿用 /api/v3，会产生额外费用）。模型填推理接入点 ID（ep-xxxxxxxx）。",
    builtin: true,
  },
  {
    id: "volcengine-anthropic",
    name: "火山方舟 Ark（Claude 协议）",
    style: "anthropic",
    baseURL: "https://ark.cn-beijing.volces.com/api/coding",
    apiKey: "",
    defaultModel: "",
    models: [],
    hint: "Coding Plan 的 Anthropic 兼容地址。模型填推理接入点 ID（ep-xxxxxxxx）。",
    builtin: true,
  },
  {
    id: "ollama",
    name: "Ollama（本地）",
    style: "openai",
    baseURL: "http://localhost:11434/v1",
    apiKey: "",
    defaultModel: "llama3.1",
    models: ["llama3.1", "qwen2.5", "gemma2", "mistral"],
    apiKeyOptional: true,
    hint: "本地运行，无需联网与 API Key",
    builtin: true,
  },
];

const PROFILES_KEY = "profiles";
const ACTIVE_KEY = "activeProfileId";

function readJSON<T>(value: any, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Merge built-in presets with user edits and additions.
 *
 * Built-in presets are templates: their shipped baseURL / model / hint always
 * win unless the user overrode them. User edits to a built-in preset (for
 * example pointing OpenAI at a proxy) are stored separately and layered on top,
 * so an update to the preset defaults does not silently wipe user settings.
 */
const OVERRIDES_KEY = "profileOverrides";

function loadOverrides(): Record<string, Partial<Profile>> {
  const raw = Zotero.Prefs.get(`${getPrefsPrefix()}.${OVERRIDES_KEY}`, true);
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function listProfiles(): Profile[] {
  const stored = readJSON<Profile[]>(
    Zotero.Prefs.get(`${getPrefsPrefix()}.${PROFILES_KEY}`, true),
    [],
  );
  const custom = Array.isArray(stored) ? stored : [];
  const overrides = loadOverrides();

  return [
    ...BUILTIN_PROFILES.map((preset) => ({
      ...preset,
      ...(overrides[preset.id] || {}),
    })),
    ...custom,
  ];
}

export function getPrefsPrefix(): string {
  const pkg = require("../../package.json") as { config: { prefsPrefix: string } };
  return pkg.config.prefsPrefix;
}

export function saveProfiles(profiles: Profile[]): void {
  const overrides: Record<string, Partial<Profile>> = {};
  const custom: Profile[] = [];

  for (const profile of profiles) {
    if (profile.builtin) {
      // Persist only what differs from the shipped preset.
      const preset = BUILTIN_PROFILES.find((entry) => entry.id === profile.id);
      if (!preset) continue;
      const diff: Partial<Profile> = {};
      for (const key of ["name", "baseURL", "apiKey", "defaultModel", "style", "models"] as const) {
        if (profile[key] !== preset[key]) {
          (diff as any)[key] = profile[key];
        }
      }
      if (Object.keys(diff).length) overrides[profile.id] = diff;
      continue;
    }
    custom.push(profile);
  }

  Zotero.Prefs.set(`${getPrefsPrefix()}.${PROFILES_KEY}`, JSON.stringify(custom), true);
  Zotero.Prefs.set(`${getPrefsPrefix()}.${OVERRIDES_KEY}`, JSON.stringify(overrides), true);
}

/** Create an id that will not collide with existing profiles. */

/** The id of the profile currently selected in the pane. */
export function getActiveProfileId(): string {
  const id = Zotero.Prefs.get(`${getPrefsPrefix()}.${ACTIVE_KEY}`, true);
  return typeof id === "string" && id ? id : "openai";
}

export function setActiveProfileId(id: string): void {
  Zotero.Prefs.set(`${getPrefsPrefix()}.${ACTIVE_KEY}`, id, true);
}

/** Look up one profile by id, including built-in presets. */
export function findProfile(id: string): Profile | undefined {
  return listProfiles().find((profile) => profile.id === id);
}

export function newProfileId(name: string): string {
  const base = `custom-${(name || "profile")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24)}`;
  const existing = new Set(listProfiles().map((profile) => profile.id));
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function upsertProfile(profile: Profile): Profile[] {
  const profiles = listProfiles();
  const index = profiles.findIndex((entry) => entry.id === profile.id);
  if (index >= 0) {
    profiles[index] = profile;
  } else {
    profiles.push(profile);
  }
  saveProfiles(profiles);
  return profiles;
}

export function removeProfile(id: string): Profile[] {
  const profiles = listProfiles().filter((profile) => profile.id !== id);
  saveProfiles(profiles);
  if (getActiveProfileId() === id) {
    const next = profiles[0];
    if (next) setActiveProfileId(next.id);
  }
  return profiles;
}

/** Blank template for the "add profile" dialog. */
export function blankProfile(): Profile {
  return {
    id: newProfileId("自定义"),
    name: "自定义 API",
    style: "openai",
    baseURL: "",
    apiKey: "",
    defaultModel: "",
    models: [],
    hint: "",
  };
}

export interface ResolvedConfig {
  provider: string;
  providerName: string;
  style: ApiStyle;
  baseURL: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  system?: string;
  temperature?: number;
  maxTokens?: number;
}
