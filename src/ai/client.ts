import { ChatMessage, ResolvedConfig } from "./providers";
import { getProviderId, resolveConfig } from "../utils/prefs";

const REQUEST_TIMEOUT = 300000;

function normalizeBase(base: string): string {
  let b = (base || "").trim();
  if (!b) return b;
  if (!/^https?:\/\//i.test(b)) {
    b = /^(localhost|127\.|\[::1\])/i.test(b) ? `http://${b}` : `https://${b}`;
  }
  return b.replace(/\/+$/, "");
}

function joinURL(base: string, path: string): string {
  const b = normalizeBase(base);
  if (!b) {
    throw new Error("Base URL 为空，请先在插件设置中填写服务地址。");
  }
  if (b.endsWith(path)) return b;
  if (/\/chat\/completions$/i.test(b) && path === "/chat/completions") return b;
  if (/\/messages$/i.test(b) && path === "/messages") return b;
  return b + path;
}

function openAICompatURL(base: string): string {
  const b = normalizeBase(base);
  if (/\/chat\/completions$/i.test(b)) return b;
  return joinURL(b, "/chat/completions");
}

function anthropicURL(base: string): string {
  const b = normalizeBase(base);
  if (/\/v1\/messages$/i.test(b) || /\/messages$/i.test(b)) return b;
  if (/\/v1$/i.test(b)) return joinURL(b, "/messages");
  return joinURL(b, "/v1/messages");
}

function flattenContent(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part === "string" ? part : part?.text || ""))
      .join("");
  }
  return "";
}

function textFromOpenAIResponse(data: any): string {
  const choice = data?.choices?.[0];
  if (!choice) return "";
  const message = choice.message;
  const content = flattenContent(message?.content);
  if (content.trim()) return content;

  // Reasoning models (DeepSeek-R1 style, some gateways) put their thinking in
  // a separate field and leave content empty when max_tokens is exhausted by
  // reasoning. Fall back to the reasoning text so the user sees something
  // instead of a blank bubble.
  const reasoning =
    flattenContent(message?.reasoning_content) ||
    flattenContent(message?.reasoning) ||
    flattenContent((choice as any)?.reasoning_content);
  return reasoning;
}

function textFromAnthropicResponse(data: any): string {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  return blocks
    .filter((block: any) => block?.type === "text")
    .map((block: any) => block.text || "")
    .join("\n");
}

/**
 * Re-parse a complete SSE body and concatenate all streamed text.
 *
 * Used as a recovery path when `onprogress` never fires: the body is already
 * in the XHR, we just need to walk it.
 */
export function collectSSEText(body: string, style: "openai" | "anthropic"): string {
  if (!body) return "";
  let text = "";
  const lines = body.split(String.fromCharCode(10));
  for (const line of lines) {
    const data = parseSSELine(line);
    if (data === null || data === "[DONE]") continue;
    try {
      const json = JSON.parse(data);
      if (style === "anthropic") {
        if (json?.type === "content_block_delta") {
          text += json?.delta?.text || "";
        } else if (json?.type === "message" && Array.isArray(json.content)) {
          text += json.content
            .filter((block: any) => block?.type === "text")
            .map((block: any) => block.text || "")
            .join("");
        }
        continue;
      }
      const delta = json?.choices?.[0]?.delta?.content;
      if (typeof delta === "string") text += delta;
      const messageContent = json?.choices?.[0]?.message?.content;
      if (!delta && typeof messageContent === "string") text += messageContent;
    } catch {
      // ignore partial JSON
    }
  }
  return text;
}

/** Best-effort finish_reason, for error messages. */
function finishReasonOf(xhr: any): string {
  try {
    const body = String(xhr?.responseText || "");
    for (const line of body.split(String.fromCharCode(10))) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const reason = json?.choices?.[0]?.finish_reason;
        if (typeof reason === "string") return reason;
        if (json?.delta?.stop_reason) return String(json.delta.stop_reason);
      } catch {
        // ignore partial JSON
      }
    }
  } catch {
    // ignore
  }
  return "";
}

function formatRequestError(error: any, cfg: ResolvedConfig): Error {
  const message = String(error?.message || "");
  if (message === "Request cancelled") {
    return new Error("请求已取消。");
  }
  if (message.startsWith("Request timed out")) {
    return new Error(`请求超时（${REQUEST_TIMEOUT / 1000} 秒），可稍后重试。`);
  }

  const xhr = error?.xmlhttp;
  const status = xhr?.status;

  let data: any = null;
  try {
    data = xhr?.response;
  } catch {
    data = null;
  }
  if (data === null || data === undefined || data === "") {
    try {
      const text = xhr?.responseText;
      if (text) data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (data === null || data === undefined || data === "") {
    data = error?.message || error;
  }

  let detail: string;
  if (typeof data === "string") {
    detail = data.slice(0, 500);
  } else {
    const value =
      data?.error?.message ?? data?.message ?? data?.error ?? data?.detail ?? "";
    detail = typeof value === "string" ? value : JSON.stringify(value);
  }
  if (!detail) detail = "未知错误";

  const parts = [`${cfg.providerName} 请求失败`];
  if (status) parts.push(`HTTP ${status}`);
  parts.push(detail);

  // Providers return distinct messages for "model unknown" and "model not
  // activated"; both need different advice from a wrong URL.
  const lowered = detail.toLowerCase();
  const unknownModel =
    lowered.includes("does not exist") ||
    lowered.includes("not found") ||
    lowered.includes("model or endpoint");
  const notActivated =
    lowered.includes("has not activated") || lowered.includes("not activated");

  if (notActivated) {
    parts.push(
      "该模型未在控制台开通。请到服务商控制台开通此模型后重试。",
    );
  } else if (unknownModel) {
    parts.push(
      "模型名称不被识别。请在「获取模型列表」后从下拉框中选择，不要手输。",
    );
    // Ark expects a dated version id (doubao-seed-2.0-pro-260215); an undated
    // name is the most common cause of this error.
    if (cfg.baseURL.includes("volces.com")) {
      parts.push(
        "注意：火山模型需带日期后缀，例如 doubao-seed-2.0-pro-260215。",
      );
    }
  } else if (status === 401 || status === 403) {
    parts.push("请检查 API Key 是否正确、是否有模型权限。");
  } else if (status === 404) {
    parts.push("请检查 Base URL 与模型名称是否正确。");
  } else if (status === 429) {
    parts.push("请求过于频繁或额度不足，请稍后再试。");
  }
  return new Error(parts.join(" · "));
}

export interface StreamHandlers {
  onDelta: (text: string, full: string) => void;
  onDone?: (full: string) => void;
  /**
   * Receives a function that aborts the in-flight request.
   *
   * The UI stores it so the Stop button can abort immediately; without this
   * the request only stopped after it had already finished.
   */
  registerCancel?: (cancel: () => void) => void;
  signal?: { cancelled: boolean; started?: boolean };
}

/** Parse a Server-Sent Events line into its data payload. */
export function parseSSELine(line: string): string | null {
  const match = line.match(/^data:\s*([\s\S]*)$/);
  return match ? match[1] : null;
}

function streamOpenAICompatible(
  xhr: XMLHttpRequest,
  handlers: StreamHandlers,
): void {
  let buffer = "";
  const handle = (chunk: string) => {
    buffer += chunk;
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        const data = parseSSELine(line);
        if (data === null || data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          const delta = json?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) {
            handlers.onDelta(delta, "");
          }
        } catch {
          // partial JSON, keep in buffer
        }
      }
    }
  };
  xhr.onprogress = (event) => {
    if (handlers.signal?.cancelled) return;
    const text = (event as any).target?.response || "";
    const delta = text.slice((xhr as any)._zaiLastLength || 0);
    (xhr as any)._zaiLastLength = text.length;
    if (delta) handle(delta);
  };
}

function streamAnthropic(
  xhr: XMLHttpRequest,
  handlers: StreamHandlers,
): void {
  let buffer = "";
  const handle = (chunk: string) => {
    buffer += chunk;
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        const data = parseSSELine(line);
        if (data === null) continue;
        try {
          const json = JSON.parse(data);
          const delta =
            json?.type === "content_block_delta" ? json.delta?.text : null;
          if (typeof delta === "string" && delta) {
            handlers.onDelta(delta, "");
          }
        } catch {
          // partial JSON, keep in buffer
        }
      }
    }
  };
  xhr.onprogress = (event) => {
    if (handlers.signal?.cancelled) return;
    const text = (event as any).target?.response || "";
    const delta = text.slice((xhr as any)._zaiLastLength || 0);
    (xhr as any)._zaiLastLength = text.length;
    if (delta) handle(delta);
  };
}

/**
 * Send a chat request. Streaming is used when `handlers` is provided;
 * otherwise the complete reply is returned.
 */
export interface ChatOptions {
  messages: ChatMessage[];
  system?: string;
  /** Override the configured max tokens for this request. */
  maxTokens?: number;
  /** Override the configured temperature for this request. */
  temperature?: number;
}

export async function chat(
  request: ChatOptions,
  handlers?: StreamHandlers,
  modelOverride?: string,
): Promise<string> {
  const cfg = resolveConfig(getProviderId(), modelOverride);
  return chatWithConfig(cfg, request, handlers);
}

export async function chatWithConfig(
  cfg: ResolvedConfig,
  request: ChatOptions,
  handlers?: StreamHandlers,
): Promise<string> {
  if (!cfg.model) {
    throw new Error("未设置模型名称，请先在插件设置中配置。");
  }
  if (!cfg.apiKey && cfg.provider !== "ollama" && cfg.provider !== "custom") {
    throw new Error(
      `未配置 ${cfg.providerName} 的 API Key，请在「设置 → Zotero AI Assistant」中填写。`,
    );
  }

  const temperature = request.temperature ?? cfg.temperature;
  const maxTokens = request.maxTokens ?? cfg.maxTokens;

  let url: string;
  let headers: Record<string, string>;
  let body: any;
  const stream = Boolean(handlers);

  if (cfg.style === "anthropic") {
    url = anthropicURL(cfg.baseURL);
    headers = {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
    body = {
      model: cfg.model,
      max_tokens: maxTokens,
      temperature,
      system: request.system || undefined,
      messages: request.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content })),
    };
    if (stream) body.stream = true;
  } else {
    url = openAICompatURL(cfg.baseURL);
    headers = {
      "Content-Type": "application/json",
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    };
    const messages = request.system
      ? [{ role: "system", content: request.system }, ...request.messages]
      : request.messages;
    // o-series and GPT-5 require max_completion_tokens and reject temperature.
    const isReasoning = /^(o[1-9](?:-|$)|gpt-5)/i.test(cfg.model);
    body = {
      model: cfg.model,
      messages,
      stream,
      ...(isReasoning
        ? { max_completion_tokens: maxTokens }
        : { max_tokens: maxTokens, temperature }),
    };
  }

  let cancelFn: (() => void) | undefined;
  let full = "";

  try {
    const xhr = await Zotero.HTTP.request("POST", url, {
      body: JSON.stringify(body),
      headers,
      responseType: stream ? "text" : "json",
      timeout: REQUEST_TIMEOUT,
      cancellerReceiver: (fn: () => void) => {
        cancelFn = fn;
        handlers?.registerCancel?.(() => {
          if (handlers.signal) handlers.signal.cancelled = true;
          try {
            fn();
          } catch {
            // already finished
          }
        });
      },
      requestObserver: (xmlhttp: XMLHttpRequest) => {
        if (!stream) return;
        if (cfg.style === "anthropic") {
          streamAnthropic(xmlhttp, {
            onDelta: (delta) => {
              full += delta;
              handlers?.onDelta(delta, full);
            },
            onDone: () => handlers?.onDone?.(full),
            signal: handlers?.signal,
          });
        } else {
          streamOpenAICompatible(xmlhttp, {
            onDelta: (delta) => {
              full += delta;
              handlers?.onDelta(delta, full);
            },
            onDone: () => handlers?.onDone?.(full),
            signal: handlers?.signal,
          });
        }
      },
    } as any);

    if (!stream) {
      const data: any = xhr?.response;
      const text =
        cfg.style === "anthropic"
          ? textFromAnthropicResponse(data)
          : textFromOpenAIResponse(data);
      if (!text) {
        throw new Error(
          `模型返回了空内容。原始响应：${JSON.stringify(data).slice(0, 400)}`,
        );
      }
      handlers?.onDelta(text, text);
      handlers?.onDone?.(text);
      return text.trim();
    }

    // Some environments never fire onprogress, and reasoning models can spend
    // the whole token budget on reasoning. Re-parse the complete SSE body as a
    // fallback before giving up.
    if (!full.trim()) {
      const rawBody = String((xhr as any)?.responseText || "");
      const recovered = collectSSEText(rawBody, cfg.style);
      if (recovered.trim()) {
        full = recovered;
        handlers?.onDelta(recovered, recovered);
      }
    }

    if (!full.trim()) {
      const finish = finishReasonOf(xhr);
      throw new Error(
        `模型返回了空内容${finish ? `（finish_reason=${finish}）` : ""}。` +
          "如果使用的是推理模型，请在设置里调高「最大 tokens」，推理过程会占用额度。",
      );
    }

    handlers?.onDone?.(full);
    return full;
  } catch (error) {
    if (handlers?.signal?.cancelled) {
      throw new Error("请求已取消。");
    }
    throw formatRequestError(error, cfg);
  } finally {
    // Nothing to do: cancellation is driven by the Stop button through the
    // function handed to registerCancel().
    void cancelFn;
  }
}

/** Quick connectivity / credential test. */
export async function testConnection(): Promise<string> {
  const cfg = resolveConfig();
  const reply = await chatWithConfig(cfg, {
    system: "你是连通性测试助手。",
    messages: [{ role: "user", content: "请只回复两个字：正常" }],
  });
  return `${cfg.providerName} · ${cfg.model}\n${reply}`;
}
