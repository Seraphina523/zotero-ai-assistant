import { ApiStyle } from "../ai/providers";
import { resolveConfig } from "../utils/prefs";

/**
 * Per-profile model registry.
 *
 * Each profile keeps a list of models with an optional display name, so the
 * user can rename "claude-sonnet-4-5" to "Sonnet 4.5" without losing the id.
 * Models can be added by hand or pulled from the provider's /models endpoint.
 */

export interface ModelEntry {
  /** The id sent to the API. */
  id: string;
  /** What the user sees; falls back to the id when empty. */
  name: string;
  /** Optional context window, in tokens. */
  contextWindow?: number;
  /** Optional output token ceiling. */
  maxOutputTokens?: number;
  /** Provider the candidate came from; used only for grouping. */
  provider?: string;
}

const MODELS_KEY = "profileModels";
const CANDIDATES_KEY = "modelCandidates";

/** Read a positive finite number, or undefined when absent / NaN / <= 0. */
function positiveNumber(value: any): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function key(profileId: string) {
  return `${MODELS_KEY}.${profileId}`;
}

export function loadModels(profileId: string): ModelEntry[] {
  const raw = Zotero.Prefs.get(`${getPrefix()}.${key(profileId)}`, true);
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry.id === "string")
      .map((entry) => ({
        id: entry.id,
        name: typeof entry.name === "string" && entry.name ? entry.name : entry.id,
        // JSON.stringify turns NaN/undefined into null, and Number(null) is 0,
        // so guard against a falsy-but-zero value explicitly.
        contextWindow: positiveNumber(entry.contextWindow),
        maxOutputTokens: positiveNumber(entry.maxOutputTokens),
      }));
  } catch {
    return [];
  }
}

/** Cache the last fetched candidate list for the ID pickers. */
export function saveCandidates(models: ModelEntry[]): void {
  Zotero.Prefs.set(
    `${getPrefix()}.${CANDIDATES_KEY}`,
    JSON.stringify(models.slice(0, 500)),
    true,
  );
}

export function loadCandidates(): ModelEntry[] {
  const raw = Zotero.Prefs.get(`${getPrefix()}.${CANDIDATES_KEY}`, true);
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => entry && typeof entry.id === "string");
  } catch {
    return [];
  }
}

export function saveModels(profileId: string, models: ModelEntry[]): void {
  Zotero.Prefs.set(`${getPrefix()}.${key(profileId)}`, JSON.stringify(models), true);
}

function getPrefix(): string {
  const pkg = require("../../package.json") as { config: { prefsPrefix: string } };
  return pkg.config.prefsPrefix;
}

/**
 * Rename a model in place, or add it when the id is new.
 *
 * Doing the removal and the insert as one operation keeps a duplicate from
 * appearing when the user picks an id that another row already uses.
 */
export function renameModel(
  profileId: string,
  oldId: string,
  next: ModelEntry,
): ModelEntry[] {
  const models = loadModels(profileId).filter((entry) => entry.id !== oldId);
  // Collapse any existing row that already carries the target id.
  const deduped = models.filter((entry) => entry.id !== next.id);
  deduped.push(next);
  saveModels(profileId, deduped);
  return deduped;
}

export function upsertModel(profileId: string, model: ModelEntry): ModelEntry[] {
  const models = loadModels(profileId);
  const index = models.findIndex((entry) => entry.id === model.id);
  if (index >= 0) {
    models[index] = model;
  } else {
    models.push(model);
  }
  saveModels(profileId, models);
  return models;
}

export function removeModel(profileId: string, id: string): ModelEntry[] {
  const models = loadModels(profileId).filter((entry) => entry.id !== id);
  saveModels(profileId, models);
  return models;
}

/** The model ids suggested in the pane's model selector. */
export function modelOptions(profileId: string): ModelEntry[] {
  return loadModels(profileId);
}

export interface FetchResult {
  models: ModelEntry[];
  /** Where the list came from, for the UI message. */
  source: string;
}

/**
 * Ask the provider for its model list.
 *
 * OpenAI-compatible endpoints expose GET /models. Anthropic has no such
 * endpoint, so the caller is told that and can fall back to manual entry.
 */
export async function fetchModelList(): Promise<FetchResult> {
  const cfg = resolveConfig();

  if (!cfg.baseURL) {
    throw new Error("请先填写接口地址。");
  }

  const style: ApiStyle = cfg.style;
  const base = cfg.baseURL.replace(/\/+$/, "");

  if (!cfg.apiKey && !base.includes("localhost")) {
    throw new Error(`请先在设置中填写 ${cfg.providerName} 的 API Key。`);
  }

  // Gateways commonly expose the OpenAI /models endpoint even when the
  // chat API uses the Claude protocol, so probe it for both styles.
  // Anthropic uses x-api-key; OpenAI uses a bearer token.
  const headers: Record<string, string> = style === "anthropic"
    ? {
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01",
      }
    : {
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      };

  const url = `${base}/models`;

  let data: any;
  try {
    const xhr = await Zotero.HTTP.request("GET", url, {
      headers,
      responseType: "json",
      timeout: 30000,
    });
    data = xhr?.response;
  } catch (error) {
    const status = (error as any)?.xmlhttp?.status;
    if (status === 404) {
      throw new Error(
        `${cfg.providerName} 未提供 /models 接口（HTTP 404），请手动添加模型。` +
        (cfg.baseURL.includes("volces.com")
          ? " 火山方舟需要在「模型」处填写推理接入点 ID（ep-xxxxxxxx）。"
          : ""),
      );
    }
    if (status === 401 || status === 403) {
      throw new Error(
        `鉴权失败（HTTP ${status}），请检查 API Key 是否有权限。`,
      );
    }
    throw new Error(
      `获取模型列表失败：${(error as any)?.message || error}`,
    );
  }

  const raw = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data)
      ? data
      : [];
  if (!raw.length) {
    throw new Error("接口返回了空的模型列表。");
  }

  const models: ModelEntry[] = raw
    .map((entry: any) => {
      const id = String(entry?.id || entry?.name || "").trim();
      if (!id) return null;
      return {
        id,
        name: String(entry?.display_name || entry?.name || id),
        contextWindow: positiveNumber(entry?.context_window),
      } as ModelEntry;
    })
    .filter((entry: ModelEntry | null): entry is ModelEntry => Boolean(entry));

  // Tag each candidate with the profile that produced it, so the picker can
  // group options by provider.
  const tagged = models.map((model) => ({
    ...model,
    provider: cfg.providerName,
  }));
  saveCandidates(tagged);

  return { models: tagged, source: url };
}

/**
 * Shorten a model id into something readable for pickers.
 *
 * Providers often return only an id; "deepseek-v4-1-flash-261017" reads
 * better as "DeepSeek V4.1 Flash".
 */
export function prettyName(id: string, fallback: string): string {
  // A name that merely repeats the id is not a display name; derive one.
  const looksLikeId = (value: string) =>
    !value || value.trim() === id || value.trim().toLowerCase() === id.toLowerCase();

  const cleaned = id.replace(/-\d{6,}$/, "");

  // Recognised brands keep their real casing. The trailing digit group is
  // consumed by the pattern so "qwen3" becomes "Qwen3", not "Qwen33".
  const brands: Array<[RegExp, string]> = [
    [/\bdeepseek(\d*)/i, "DeepSeek"],
    [/\bdoubao(\d*)/i, "Doubao"],
    [/\bqwen(\d*)/i, "Qwen"],
    [/\bglm(\d*)/i, "GLM"],
    [/\bkimi(\d*)/i, "Kimi"],
    [/\bclaude(\d*)/i, "Claude"],
    [/\bgpt(\d*)/i, "GPT"],
    [/\bmistral(\d*)/i, "Mistral"],
    [/\bllama(\d*)/i, "Llama"],
    [/\bgemini(\d*)/i, "Gemini"],
    [/\bmoonshot(\d*)/i, "Moonshot"],
    [/\bernie(\d*)/i, "Ernie"],
    [/\bhunyuan(\d*)/i, "Hunyuan"],
    [/\bseedance(\d*)/i, "Seedance"],
    [/\bseedream(\d*)/i, "Seedream"],
    [/\bminimax(\d*)/i, "MiniMax"],
    [/\bark-code(\d*)/i, "Ark Code"],
  ];

  // A genuinely different name wins over a derived one.
  if (!looksLikeId(fallback)) return fallback.trim();

  let result = cleaned;
  for (const [pattern, replacement] of brands) {
    result = result.replace(pattern, (_match: string, digits: string) => {
      return digits ? replacement + digits : replacement;
    });
  }

  const parts = result
    .split(/[-_\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  return parts
    .map((part) => {
      // Only rewrite a part that is exactly a brand word; "Qwen3" keeps its digit.
      const lower = part.toLowerCase();
      const brand = brands.find(([, r]) => r.toLowerCase() === lower);
      if (brand) return brand[1];
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}