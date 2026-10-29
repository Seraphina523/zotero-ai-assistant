import { chat } from "../ai/client";
import {
  DATA_SAFETY_INSTRUCTION,
  QA_SYSTEM,
  SUMMARY_SYSTEM,
  buildQAPrompt,
  buildSummaryPrompt,
  buildTagPrompt,
  buildTranslationPrompt,
  parseTags,
  parseTranslation,
  SummaryLength,
} from "../ai/prompts";
import { ChatMessage } from "../ai/providers";
import { StreamHandlers } from "../ai/client";
import { fitHistory, fitToContext } from "../ai/tokens";
import {
  buildContextForQuestion,
  buildItemContext,
  formatPages,
  resolveTargetItem,
} from "../services/itemText";
import { getContextChars, getPref, resolveConfig } from "../utils/prefs";
import { appendSection, markdownToHTML } from "../services/notebook";
import {
  CRITIQUE_SYSTEM,
  FIGURE_SYSTEM,
  MATRIX_SYSTEM,
  MatrixEntry,
  SuggestedQuestion,
  buildCritiquePrompt,
  buildFigurePrompt,
  buildGuidedQuestionsPrompt,
  buildMatrixPrompt,
  matrixToMarkdown,
  parseGuidedQuestions,
  parseMatrix,
} from "../ai/analysis";
import { blockText, openSDTPack } from "../services/sdt";
import {
  IDEA_SYSTEM,
  buildConflictPrompt,
  buildExtendPrompt,
  buildGapPrompt,
} from "../ai/ideaPrompts";
import {
  LibraryHit,
  SearchMode,
  extractTerms,
  itemTextForTerms,
  searchLibrary,
} from "../services/librarySearch";

export function escapeHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*/g, ""))
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)")
    .trim();
}

function setExtraLines(item: Zotero.Item, entries: Record<string, string>) {
  const keys = Object.keys(entries);
  const extra = String(item.getField("extra") || "");
  const kept = extra
    .split("\n")
    .filter(
      (line) =>
        !keys.some((key) =>
          line.toLowerCase().startsWith(`${key.toLowerCase()}:`),
        ),
    )
    .join("\n")
    .trim();
  const added = keys
    .filter((key) => entries[key])
    .map((key) => `${key}: ${entries[key].replace(/\s*\n+\s*/g, " ").trim()}`);
  item.setField("extra", [kept, ...added].filter(Boolean).join("\n"));
}

export interface SummaryResult {
  text: string;
  item: Zotero.Item;
  savedNote?: Zotero.Item;
  savedTo: string;
  source: string;
  truncated: boolean;
}

export async function generateSummary(
  item: Zotero.Item,
  options: {
    save?: boolean;
    handlers?: StreamHandlers;
    modelOverride?: string;
  } = {},
): Promise<SummaryResult> {
  const save = options.save !== false;
  const modelOverride = options.modelOverride;
  const context = await buildItemContext(item);
  const language = (
    getPref<string>("summaryLanguage", "zh") === "en" ? "en" : "zh"
  ) as "zh" | "en";
  const cfg = resolveConfig(undefined, modelOverride);
  const length = getPref<string>("summaryLength", "standard") as SummaryLength;

  // Give the reply its own budget: a detailed summary can be 2000+ Chinese
  // characters, and reasoning models spend extra tokens before answering.
  const replyBudget = Math.min(
    16000,
    Math.max(
      cfg.maxTokens,
      length === "detailed" ? 8192 : length === "brief" ? 3072 : 6144,
    ),
  );
  const body = fitToContext(context.fullText, cfg.model, replyBudget);
  const text = await chat(
    {
      system: `${SUMMARY_SYSTEM}\n${DATA_SAFETY_INSTRUCTION}`,
      messages: buildSummaryPrompt(context.metadata, body.text, language, length),
      maxTokens: replyBudget,
    },
    options.handlers,
    modelOverride,
  );

  const result: SummaryResult = {
    text,
    item: context.target,
    savedTo: "none",
    source: context.source,
    truncated: context.truncated || body.trimmed,
  };

  if (save) {
    const action = getPref<string>("summaryAction", "note");
    if (action === "abstract") {
      context.target.setField("abstractNote", stripMarkdown(text));
      await context.target.saveTx();
      result.savedTo = "abstract";
    } else if (action === "note") {
      result.savedNote = await appendSection(context.target, {
        heading: "摘要",
        body: text,
        accent: "#4f6ef7",
        meta: `由 ${resolveConfig().providerName} · ${resolveConfig().model} 生成`,
      });
      result.savedTo = "note";
    }
  }

  return result;
}

export interface TranslationResult {
  title: string;
  abstract: string;
  /** Translation of user-supplied text, when one was provided. */
  custom?: string;
  raw: string;
  item: Zotero.Item;
  savedNote?: Zotero.Item;
}

function detectTargetLanguage(title: string, abstract: string): "zh" | "en" {
  const configured = getPref<string>("translateTarget", "auto");
  if (configured === "zh" || configured === "en") return configured;
  return /[\u4e00-\u9fff]/.test(`${title}${abstract}`) ? "en" : "zh";
}

/** Which parts of an item to translate. */
export interface TranslateScope {
  title: boolean;
  abstract: boolean;
  /** Free text supplied by the user (a paragraph, a quote, a section). */
  custom?: string;
  /** Force a target language instead of auto-detecting. */
  target?: "zh" | "en";
}

export async function translateItem(
  item: Zotero.Item,
  options: {
    save?: boolean;
    handlers?: StreamHandlers;
    scope?: TranslateScope;
    modelOverride?: string;
  } = {},
): Promise<TranslationResult> {
  const save = options.save !== false;
  const modelOverride = options.modelOverride;
  const target = resolveTargetItem(item);
  const fullTitle = String(target.getField("title") || "");
  const fullAbstract = String(target.getField("abstractNote") || "");

  const scope: TranslateScope = options.scope ?? {
    title: true,
    abstract: true,
  };
  const custom = (scope.custom || "").trim();

  const title = scope.title ? fullTitle : "";
  const abstract = scope.abstract ? fullAbstract : "";

  if (!title && !abstract && !custom) {
    throw new Error("请至少选择标题、摘要，或输入要翻译的文本。");
  }

  const sample = [title, abstract, custom].filter(Boolean).join(" ");
  const language =
    scope.target === "zh" || scope.target === "en"
      ? scope.target
      : detectTargetLanguage(sample, sample);

  const raw = await chat(
    {
      system: `你是一名专业的学术翻译，译文准确、术语规范，不添加原文没有的信息。\n${DATA_SAFETY_INSTRUCTION}`,
      messages: buildTranslationPrompt(
        title,
        abstract,
        language,
        custom || undefined,
      ),
      maxTokens: Math.min(12000, Math.max(resolveConfig().maxTokens, 4096)),
    },
    options.handlers,
    modelOverride,
  );
  const parsed = parseTranslation(raw);

  const result: TranslationResult = {
    title: parsed.title,
    abstract: parsed.abstract,
    custom: parsed.custom,
    raw,
    item: target,
  };

  if (save) {
    const parts: string[] = [];
    if (parsed.title) parts.push(`**标题**：${parsed.title}`);
    if (parsed.abstract) parts.push(`**摘要**：${parsed.abstract}`);
    if (parsed.custom) parts.push(`**文本**：${parsed.custom}`);

    // Only overwrite the Extra fields when we actually translated those parts.
    const extra = getPref<boolean>("translateToExtra", true);
    if (extra && (parsed.title || parsed.abstract)) {
      const entries: Record<string, string> = {};
      if (parsed.title) entries.titleTranslation = parsed.title;
      if (parsed.abstract) entries.abstractTranslation = parsed.abstract;
      setExtraLines(target, entries);
      await target.saveTx();
    }

    const targetName = language === "zh" ? "中文" : "English";
    const headingParts = [
      parsed.title ? "标题" : "",
      parsed.abstract ? "摘要" : "",
      parsed.custom ? "文本" : "",
    ].filter(Boolean);
    result.savedNote = await appendSection(target, {
      heading: `翻译（${targetName}）· ${headingParts.join("+")}`,
      accent: "#14b8a6",
      body: parts.join("\n\n"),
    });
  }

  return result;
}

export interface TagResult {
  tags: string[];
  added: string[];
  item: Zotero.Item;
}

export async function autoTagItem(
  item: Zotero.Item,
  options: {
    save?: boolean;
    handlers?: StreamHandlers;
    modelOverride?: string;
  } = {},
): Promise<TagResult> {
  const save = options.save !== false;
  const modelOverride = options.modelOverride;
  const context = await buildItemContext(item);
  const raw = await chat(
    {
      system: `你是一名文献管理专家，擅长提炼准确、可复用的学术标签。只输出 JSON 数组。\n${DATA_SAFETY_INSTRUCTION}`,
      messages: buildTagPrompt(context.metadata, context.fullText),
    },
    options.handlers,
    modelOverride,
  );
  const tags = parseTags(raw);
  if (!tags.length) {
    throw new Error(
      `未能解析出标签。模型原始输出：${raw.slice(0, 300)}`,
    );
  }

  const existingTags = context.target.getTags() || [];
  const existing = existingTags.map((tag: any) => tag.tag as string);
  const added = tags.filter((tag) => !existing.includes(tag));

  if (save && added.length) {
    context.target.setTags([
      ...existingTags,
      ...added.map((tag) => ({ tag, type: 0 })),
    ] as any);
    await context.target.saveTx();
  }

  return { tags, added, item: context.target };
}

export interface AnswerResult {
  text: string;
  /** Pages cited by the model. */
  pages: number[];
  /** Pages present in the retrieved context. */
  contextPages: number[];
}

export async function askAboutItem(
  item: Zotero.Item,
  question: string,
  history: ChatMessage[] = [],
  handlers?: StreamHandlers,
  template?: { system: string; citePages: boolean },
  modelOverride?: string,
): Promise<AnswerResult> {
  const context = await buildItemContext(item);
  const { text: retrieved, pages } = buildContextForQuestion(
    context.chunks,
    question,
    getContextChars(),
  );
  const prompt = buildQAPrompt(question, retrieved, context.metadata);
  const cfg = resolveConfig();

  const recentHistory = fitHistory(
    history.filter((message) => message.role !== "system"),
    cfg.model,
    cfg.maxTokens,
  ).slice(-6);

  // A chosen prompt template replaces the default system prompt; the data
  // safety instruction is always appended so untrusted document text stays
  // sandboxed regardless of what the user typed.
  const system = template?.system?.trim()
    ? `${template.system}\n${DATA_SAFETY_INSTRUCTION}`
    : `${QA_SYSTEM}\n${DATA_SAFETY_INSTRUCTION}`;

  const text = await chat(
    {
      system,
      messages: [...recentHistory, ...prompt],
      maxTokens: Math.min(12000, Math.max(cfg.maxTokens, 4096)),
    },
    handlers,
    modelOverride,
  );

  return { text, pages, contextPages: pages };
}

export interface GuidedQuestionsResult {
  questions: SuggestedQuestion[];
}

export async function generateGuidedQuestions(
  item: Zotero.Item,
): Promise<GuidedQuestionsResult> {
  const context = await buildItemContext(item);
  const raw = await chat({
    system: `你擅长设计阅读路径，能提出具体、可回答的问题。\n${DATA_SAFETY_INSTRUCTION}`,
    messages: buildGuidedQuestionsPrompt(context.metadata, context.fullText),
  });
  return { questions: parseGuidedQuestions(raw) };
}

export interface CritiqueResult {
  text: string;
}

export async function analyzeCritically(
  item: Zotero.Item,
  handlers?: StreamHandlers,
  modelOverride?: string,
): Promise<CritiqueResult> {
  const context = await buildItemContext(item);
  const body = fitToContext(context.fullText, resolveConfig().model, resolveConfig().maxTokens);
  const text = await chat(
    {
      system: `${CRITIQUE_SYSTEM}\n${DATA_SAFETY_INSTRUCTION}`,
      messages: buildCritiquePrompt(context.metadata, body.text),
    },
    handlers,
    modelOverride,
  );
  return { text };
}

export interface FigureResult {
  text: string;
  figuresFound: number;
}

/** Collect figure/table/caption text from the SDT tree. */
export async function collectFigures(item: Zotero.Item): Promise<string> {
  const target = resolveTargetItem(item);
  const ids = new Set<number>();
  if (item.isAttachment()) ids.add(item.id);
  for (const id of target.getAttachments() || []) ids.add(id);

  const chunks: string[] = [];
  for (const id of ids) {
    const attachment = Zotero.Items.get(id);
    if (!attachment?.isAttachment()) continue;
    try {
      const result = await (Zotero as any).SDT.getPack(attachment.id);
      if (!result?.ok || !result.bytes) continue;
      const reader = await openSDTPack(new Uint8Array(result.bytes));
      const pack = await reader.materialize();
      const collect = (block: any) => {
        if (!block || typeof block !== "object") return;
        const type = String(block.type || "");
        if (
          type === "image" ||
          type === "table" ||
          type === "caption" ||
          type === "math" ||
          type === "preformatted"
        ) {
          const text = blockText(block);
          if (text) chunks.push(`[${type}] ${text}`);
        }
        if (Array.isArray(block.content)) {
          for (const child of block.content) collect(child);
        }
      };
      for (const block of pack.content || []) collect(block);
    } catch (error) {
      Zotero.debug(`[Zotero AI] Figure collection failed: ${error}`);
    }
  }
  return chunks.join("\n\n");
}

export async function interpretFigures(
  item: Zotero.Item,
  handlers?: StreamHandlers,
  modelOverride?: string,
): Promise<FigureResult> {
  const context = await buildItemContext(item);
  const figures = await collectFigures(item);
  if (!figures.trim()) {
    return {
      text: "未从该文献中提取到图表或表格的结构化信息。可能原因：文献为扫描版、图表为纯图片且无标题，或该文献尚未建立全文索引。",
      figuresFound: 0,
    };
  }

  const imageCount = (figures.match(/\[image\]/g) || []).length;
  const tableCount = (figures.match(/\[table\]/g) || []).length;
  const captionCount = (figures.match(/\[caption\]/g) || []).length;
  const figuresFound = imageCount + tableCount;

  const cfg = resolveConfig();
  const replyBudget = Math.min(12000, Math.max(cfg.maxTokens, 6144));

  const text = await chat(
    {
      system: `${FIGURE_SYSTEM}\n${DATA_SAFETY_INSTRUCTION}`,
      messages: buildFigurePrompt(
        context.metadata,
        figures.slice(0, 24000),
        { imageCount, tableCount, captionCount },
      ),
      maxTokens: replyBudget,
    },
    handlers,
    modelOverride,
  );

  return {
    text:
      text.trim() ||
      `已提取到 ${imageCount} 张图、${tableCount} 个表格、${captionCount} 个标题，但模型没有返回解读内容。请重试或换一个模型。`,
    figuresFound,
  };
}

export interface MatrixResult {
  entries: MatrixEntry[];
  markdown: string;
  raw: string;
}

export async function buildLiteratureMatrix(
  items: Zotero.Item[],
): Promise<MatrixResult> {
  const entries: Array<{ id: string; metadata: string; fullText: string }> = [];
  for (const item of items.slice(0, 10)) {
    const context = await buildItemContext(item);
    entries.push({
      id: `${context.target.id}`,
      metadata: context.metadata,
      fullText: context.fullText,
    });
  }
  if (!entries.length) {
    return { entries: [], markdown: "", raw: "" };
  }
  const raw = await chat({
    system: `${MATRIX_SYSTEM}\n${DATA_SAFETY_INSTRUCTION}`,
    messages: buildMatrixPrompt(entries),
  });
  const parsed = parseMatrix(raw);
  return {
    entries: parsed,
    markdown: matrixToMarkdown(parsed),
    raw,
  };
}

export interface IdeaResult {
  text: string;
  hits: LibraryHit[];
  mode: SearchMode;
}

/**
 * Search the whole library for papers relevant to a question, then ask the
 * model to find research gaps / conflicts / extensions among them.
 */
export async function discoverIdeas(
  item: Zotero.Item | undefined,
  question: string,
  mode: SearchMode,
  handlers?: StreamHandlers,
  modelOverride?: string,
): Promise<IdeaResult> {
  const terms = extractTerms(question, 20);
  if (!terms.length) {
    throw new Error("请提供更具体的描述，例如「低分辨率图像的文字识别」");
  }

  // For the "extend" mode, borrow vocabulary from the selected paper so the
  // search covers its neighbourhood even when the question is vague.
  if (mode === "extend" && item) {
    const body = await itemTextForTerms(item);
    const seedTerms = extractTerms(body, 20);
    const merged = [...terms];
    for (const term of seedTerms) {
      if (!merged.includes(term) && merged.length < 20) merged.push(term);
    }
    terms.splice(0, terms.length, ...merged);
  }

  const hits = await searchLibrary(terms, {
    mode,
    limit: 12,
    excludeItemID: item?.id,
  });

  if (!hits.length) {
    return {
      text: "在文献库中没有检索到与该问题相关的文献。\n\n可能的原因：\n- 相关文献尚未建立全文索引\n- 检索词过于具体，可以换用更常见的表述\n- 该主题确实不在你的文献库范围内\n\n建议先确认文献库中存在相关主题的 PDF，并让 Zotero 完成索引。",
      hits: [],
      mode,
    };
  }

  const payload = hits.map((hit) => ({
    title: hit.title,
    year: hit.year,
    venue: hit.venue,
    snippets: hit.snippets,
  }));

  const system = `${IDEA_SYSTEM}\n${DATA_SAFETY_INSTRUCTION}`;
  const messages =
    mode === "gap"
      ? buildGapPrompt(question, payload)
      : mode === "conflict"
        ? buildConflictPrompt(question, payload)
        : buildExtendPrompt(
            question,
            item ? `${String(item.getField("title") || "")} ${String(item.getField("abstractNote") || "")}` : "",
            payload,
          );

  const text = await chat(
    { system, messages, maxTokens: Math.min(12000, Math.max(resolveConfig().maxTokens, 6144)) },
    handlers,
    modelOverride,
  );
  return { text, hits, mode };
}
