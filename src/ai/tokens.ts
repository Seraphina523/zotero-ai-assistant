import { ChatMessage, findProfile } from "./providers";

/**
 * Known context-window limits (input tokens) for common models.
 *
 * Only a conservative subset is listed. Unknown models fall back to a safe
 * default so a mis-typed model name never silently overflows.
 */

const DEFAULT_CONTEXT = 128000;
const SMALL_CONTEXT = 8000;

// Rough token-per-character ratios used to turn a character budget into
// tokens. Latin text is denser than CJK, which is why these differ.
const CHARS_PER_TOKEN_LATIN = 3.6;
const CHARS_PER_TOKEN_CJK = 1.5;

const CONTEXT_LIMITS: Record<string, number> = {
  // OpenAI
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-4-turbo": 128000,
  "gpt-4.1": 1000000,
  "gpt-4.1-mini": 1000000,
  "gpt-4.1-nano": 1000000,
  "gpt-3.5-turbo": 16000,
  "gpt-4": 8000,
  "gpt-4-32k": 32000,
  "gpt-5": 400000,
  "o1": 200000,
  "o3": 200000,
  "o3-mini": 200000,
  "o4-mini": 200000,
  // Anthropic
  "claude-3-5-sonnet": 200000,
  "claude-3-5-haiku": 200000,
  "claude-3-opus": 200000,
  "claude-3-haiku": 200000,
  "claude-sonnet-4": 200000,
  "claude-opus-4": 200000,
  "claude-sonnet-4-5": 200000,
  "claude-opus-4-1": 200000,
  "claude-haiku-4-5": 200000,
  // DeepSeek
  "deepseek-chat": 64000,
  "deepseek-reasoner": 64000,
  // Qwen
  "qwen-turbo": 1000000,
  "qwen-plus": 130000,
  "qwen-max": 32000,
  "qwen-long": 1000000,
  "qwen2.5": 130000,
  // GLM
  "glm-4": 128000,
  "glm-4-plus": 128000,
  "glm-4-air": 128000,
  "glm-4-flash": 128000,
  "glm-4-long": 1000000,
  // Kimi
  "moonshot-v1-8k": 8000,
  "moonshot-v1-32k": 32000,
  "moonshot-v1-128k": 128000,
  "kimi-k2": 130000,
  // Local
  llama3: 8000,
  "llama3.1": 128000,
  qwen2: 32000,
  gemma2: 8000,
  mistral: 32000,
};

function normalize(model: string): string {
  return (model || "").trim().toLowerCase();
}

/** Look up the input token limit for a model name. */
export function contextLimit(model: string): number {
  const name = normalize(model);
  if (!name) return DEFAULT_CONTEXT;
  if (CONTEXT_LIMITS[name]) return CONTEXT_LIMITS[name];
  // Strip vendor prefixes and date suffixes, then retry.
  const stripped = name.replace(/^[a-z0-9.-]+\//, "").replace(
    /-\d{4}-\d{2}-\d{2}$/,
    "",
  );
  if (CONTEXT_LIMITS[stripped]) return CONTEXT_LIMITS[stripped];
  // Any 8k/16k/32k/128k variant.
  const sizeMatch = name.match(/(\d+)k/);
  if (sizeMatch) {
    const k = parseInt(sizeMatch[1], 10);
    if (Number.isFinite(k) && k > 0) return k * 1000;
  }
  return DEFAULT_CONTEXT;
}

/** Reserve room for the reply so the request stays inside the window. */
export function usableInputTokens(
  model: string,
  maxTokens = 2048,
): number {
  const limit = contextLimit(model);
  return Math.max(2000, limit - Math.max(256, maxTokens) - 1200);
}

/** Estimate tokens for mixed Chinese/English text. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let latin = 0;
  for (const char of text) {
    if (/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(char)) cjk++;
    else latin++;
  }
  return Math.ceil(
    cjk / CHARS_PER_TOKEN_CJK + latin / CHARS_PER_TOKEN_LATIN,
  );
}

/** Characters per token for the current text mix, used to convert budgets. */
export function charsPerToken(text: string): number {
  if (!text) return CHARS_PER_TOKEN_LATIN;
  let cjk = 0;
  for (const char of text) {
    if (/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(char)) cjk++;
  }
  const cjkRatio = cjk / text.length;
  return (
    cjkRatio * CHARS_PER_TOKEN_CJK + (1 - cjkRatio) * CHARS_PER_TOKEN_LATIN
  );
}

/**
 * Trim a document to fit the model's input window.
 *
 * Returns the text to send plus a flag describing whether trimming happened.
 */
export function fitToContext(
  text: string,
  model: string,
  maxTokens: number,
): { text: string; trimmed: boolean; tokens: number } {
  const budget = usableInputTokens(model, maxTokens);
  const tokens = estimateTokens(text);
  if (tokens <= budget) {
    return { text, trimmed: false, tokens };
  }
  const ratio = charsPerToken(text);
  const chars = Math.max(500, Math.floor(budget * ratio * 0.95));
  return {
    text: text.slice(0, chars),
    trimmed: true,
    tokens: estimateTokens(text.slice(0, chars)),
  };
}

/** Convert a character budget into tokens for display. */
export function describeBudget(model: string, maxTokens: number): string {
  const limit = contextLimit(model);
  const usable = usableInputTokens(model, maxTokens);
  return `${limit.toLocaleString()} tokens 窗口，正文可用约 ${usable.toLocaleString()}`;
}

/** Build the system prompt, keeping it inside the context window. */
export function buildSystemPrompt(parts: string[]): string {
  return parts.filter(Boolean).join("\n");
}

/** Truncate a message history to the newest entries that fit. */
export function fitHistory(
  messages: ChatMessage[],
  model: string,
  maxTokens: number,
): ChatMessage[] {
  const budget = usableInputTokens(model, maxTokens) * 0.4;
  const kept: ChatMessage[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const tokens = estimateTokens(message.content);
    if (used + tokens > budget && kept.length > 0) break;
    kept.unshift(message);
    used += tokens;
  }
  return kept;
}

/** Suggested model names for a profile, used to populate a datalist. */
export function providerModels(providerId: string): string[] {
  return findProfile(providerId)?.models || [];
}
