import { wrapDocumentData } from "../ai/prompts";
import { anchorPages, openSDTPack } from "./sdt";
import { getMaxPdfChars } from "../utils/prefs";

export interface TextChunk {
  index: number;
  text: string;
  /** 1-based page numbers this chunk spans. Empty when unknown. */
  pages: number[];
}

export interface ItemContext {
  target: Zotero.Item;
  metadata: string;
  fullText: string;
  source: "pdf" | "epub" | "cache" | "sdt" | "metadata";
  truncated: boolean;
  chunks: TextChunk[];
  /** Total pages reported by Zotero, when available. */
  pageCount: number;
  /** True when the text layer was empty (e.g. scanned PDF). */
  hasText: boolean;
}

interface CachedText {
  text: string;
  source: ItemContext["source"];
  timestamp: number;
}

const textCache = new Map<number, CachedText>();

function safeField(item: Zotero.Item, field: string): string {
  try {
    const value = item.getField(field as any);
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

function creatorLine(item: Zotero.Item): string {
  try {
    return (item.getCreators() || [])
      .map((creator: any) => {
        if (creator.name) return creator.name;
        return [creator.firstName, creator.lastName].filter(Boolean).join(" ");
      })
      .filter(Boolean)
      .join(", ");
  } catch {
    return "";
  }
}

export function resolveTargetItem(item: Zotero.Item): Zotero.Item {
  if (item.isAttachment() && item.parentID) {
    const parent = Zotero.Items.get(item.parentID);
    if (parent) return parent;
  }
  if (item.isNote() && item.parentID) {
    const parent = Zotero.Items.get(item.parentID);
    if (parent) return parent;
  }
  return item;
}

export function buildMetadata(item: Zotero.Item): string {
  const lines: string[] = [];
  const push = (label: string, value: string) => {
    if (value) lines.push(`${label}：${value}`);
  };

  push("类型", Zotero.ItemTypes.getLocalizedString(item.itemTypeID));
  push("标题", safeField(item, "title"));
  push("作者", creatorLine(item));
  push("日期", safeField(item, "date"));
  push(
    "期刊/会议",
    safeField(item, "publicationTitle") || safeField(item, "proceedingsTitle"),
  );
  push("出版社", safeField(item, "publisher"));
  push(
    "卷/期/页",
    [safeField(item, "volume"), safeField(item, "issue"), safeField(item, "pages")]
      .filter(Boolean)
      .join(" / "),
  );
  push("DOI", safeField(item, "DOI"));
  push("语言", safeField(item, "language"));
  push("摘要", safeField(item, "abstractNote"));
  push("现有标签", (item.getTags() || []).map((tag: any) => tag.tag).join(", "));
  const extra = safeField(item, "extra");
  if (extra) push("Extra", extra);

  return lines.join("\n");
}

function attachmentIDs(item: Zotero.Item): number[] {
  try {
    return item.getAttachments() || [];
  } catch {
    return [];
  }
}

async function pageCountOf(attachment: Zotero.Item): Promise<number> {
  try {
    const pages = await Zotero.Fulltext.getPages(attachment.id);
    if (pages && typeof pages.total === "number") return pages.total;
  } catch {
    // ignore
  }
  return 0;
}

/** Split plain text into chunks, inserting page markers for known page breaks. */
function splitWithPageMarks(
  text: string,
  pageCount: number,
  chunkSize: number,
  overlap: number,
  pageMarks: Map<number, number>,
): TextChunk[] {
  // Normalise first so page offsets are stable.
  const normalized = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");

  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < normalized.length) {
    let end = Math.min(normalized.length, start + chunkSize);
    if (end < normalized.length) {
      const boundary = Math.max(
        normalized.lastIndexOf("\n", end),
        normalized.lastIndexOf("。", end),
        normalized.lastIndexOf(". ", end),
      );
      if (boundary > start + chunkSize * 0.55) end = boundary + 1;
    }
    const chunkText = normalized.slice(start, end).trim();
    if (chunkText) {
      chunks.push({
        index: index++,
        text: chunkText,
        pages: pagesAround(pageMarks, start, end, pageCount),
      });
    }
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

/** Map a character range to 1-based page numbers. */
function pagesAround(
  marks: Map<number, number>,
  start: number,
  end: number,
  pageCount: number,
): number[] {
  if (!marks.size) return [];
  const pages = new Set<number>();
  for (const [offset, page] of marks) {
    if (offset >= start && offset < end) pages.add(page);
  }
  if (!pages.size && pageCount) {
    // Fall back to proportional mapping.
    const estimate = Math.min(
      pageCount,
      Math.max(1, Math.ceil(((start + end) / 2 / pageCount) * pageCount)),
    );
    pages.add(estimate);
  }
  return [...pages].sort((a, b) => a - b);
}

/**
 * Build page-offset markers from an SDT text map, which records the page of
 * every text run.
 */
function buildPageMarks(
  textMapPages: number[],
  textLength: number,
  pageCount: number,
): Map<number, number> {
  const marks = new Map<number, number>();
  if (!textMapPages.length || !textLength) return marks;
  const pages = [...new Set(textMapPages)].sort((a, b) => a - b);
  // Distribute the known pages evenly across the extracted text.
  const span = textLength / pages.length;
  pages.forEach((page, i) => {
    marks.set(Math.min(textLength, Math.floor(i * span)), page);
  });
  if (pageCount && !marks.has(textLength - 1)) {
    marks.set(textLength - 1, pageCount);
  }
  return marks;
}

async function readStructuredPack(
  attachment: Zotero.Item,
): Promise<{ text: string; chunks: TextChunk[]; pageCount: number } | null> {
  try {
    const result = await (Zotero as any).SDT.getPack(attachment.id);
    if (!result?.ok || !result.bytes) return null;
    const bytes = new Uint8Array(result.bytes);
    const reader = await openSDTPack(bytes);
    const pack = await reader.materialize();
    const sections: string[] = [];
    const pageMarks: number[] = [];

    const walk = (block: any) => {
      if (!block || typeof block !== "object") return;
      if (typeof block.text === "string") {
        sections.push(block.text);
      }
      if (Array.isArray(block.content)) {
        for (const child of block.content) {
          walk(child);
        }
      }
    };
    for (const block of pack.content || []) walk(block);

    // Collect page anchors from every block that carries one.
    const collectPages = (block: any) => {
      if (!block || typeof block !== "object") return;
      for (const page of anchorPages(block.anchor)) {
        if (!pageMarks.includes(page)) pageMarks.push(page);
      }
      if (Array.isArray(block.content)) {
        for (const child of block.content) collectPages(child);
      }
    };
    for (const block of pack.content || []) collectPages(block);

    const catalogPages = pack.catalog?.pages || [];
    const pageCount = catalogPages.length || pageMarks.length || 0;
    const text = sections.join("\n\n");
    const marks = buildPageMarks(
      pageMarks,
      text.length,
      pageCount,
    );
    const chunks = splitWithPageMarks(text, pageCount, 1500, 200, marks);
    return { text, chunks, pageCount };
  } catch (error) {
    Zotero.debug(`[Zotero AI] SDT pack reading failed: ${error}`);
    return null;
  }
}

async function readAttachmentText(
  attachment: Zotero.Item,
): Promise<{
  text: string;
  source: ItemContext["source"];
  pageCount: number;
  textMapPages: number[];
} | null> {
  const contentType = attachment.attachmentContentType || "";
  const isPDF = contentType === "application/pdf";
  const isEPUB = contentType === "application/epub+zip";
  const pageCount = await pageCountOf(attachment);

  // Prefer the SDT pack for page-anchored text.
  if (isPDF || isEPUB) {
    const pack = await readStructuredPack(attachment);
    if (pack && pack.text.trim()) {
      return {
        text: pack.text,
        source: "sdt",
        pageCount: pack.pageCount || pageCount,
        textMapPages: [],
      };
    }
  }

  // Zotero's full-text cache is fast and already produced by the indexer.
  try {
    const cacheFile = Zotero.Fulltext.getItemCacheFile(attachment);
    if (cacheFile?.path) {
      const text = await Zotero.File.getContentsAsync(cacheFile.path);
      if (text && String(text).trim()) {
        return {
          text: String(text),
          source: isEPUB ? "epub" : isPDF ? "pdf" : "cache",
          pageCount,
          textMapPages: [],
        };
      }
    }
  } catch (error) {
    Zotero.debug(`[Zotero AI] Reading full-text cache failed: ${error}`);
  }

  // Fall back to extracting the PDF on demand (e.g. not indexed yet).
  if (isPDF) {
    try {
      const result = await Zotero.PDFWorker.getFullText(attachment.id);
      if (result?.text && String(result.text).trim()) {
        const textMapPages = (result?.pages || [])
          .map((page: any) => Number(page))
          .filter((page: any) => Number.isFinite(page));
        return {
          text: String(result.text),
          source: "pdf",
          pageCount: result.totalPages || pageCount,
          textMapPages,
        };
      }
    } catch (error) {
      Zotero.debug(`[Zotero AI] PDF text extraction failed: ${error}`);
    }
  }

  return null;
}

export async function getItemFullText(
  item: Zotero.Item,
): Promise<{ text: string; source: ItemContext["source"]; pageCount: number }> {
  const target = resolveTargetItem(item);
  const cached = textCache.get(target.id);
  if (cached) {
    return { text: cached.text, source: cached.source, pageCount: 0 };
  }

  const ids = new Set<number>();
  if (item.isAttachment()) ids.add(item.id);
  for (const id of attachmentIDs(target)) ids.add(id);

  for (const id of ids) {
    const attachment = Zotero.Items.get(id);
    if (!attachment || !attachment.isAttachment()) continue;
    const result = await readAttachmentText(attachment);
    if (result) {
      textCache.set(target.id, {
        text: result.text,
        source: result.source,
        timestamp: Date.now(),
      });
      return {
        text: result.text,
        source: result.source,
        pageCount: result.pageCount,
      };
    }
  }

  return { text: "", source: "metadata", pageCount: 0 };
}

export function invalidateItemText(itemID: number) {
  textCache.delete(itemID);
}

export async function buildItemContext(
  item: Zotero.Item,
): Promise<ItemContext> {
  const target = resolveTargetItem(item);
  const metadata = buildMetadata(target);
  const { text, source, pageCount } = await getItemFullText(item);
  const maxChars = getMaxPdfChars();
  const truncated = text.length > maxChars;
  const limited = truncated ? text.slice(0, maxChars) : text;
  const chunks = splitWithPageMarks(limited, pageCount, 1500, 200, new Map());

  return {
    target,
    metadata,
    fullText: limited,
    source,
    truncated,
    chunks,
    pageCount,
    hasText: Boolean(limited.trim()),
  };
}

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
const CJK_RUN_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]+/g;
const LATIN_RE = /[a-z0-9][a-z0-9_\-]{1,}/g;

export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens: string[] = lower.match(LATIN_RE) || [];
  const cjkRuns = text.match(CJK_RUN_RE) || [];
  for (const run of cjkRuns) {
    if (run.length === 1) {
      tokens.push(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i++) {
      tokens.push(run.slice(i, i + 2));
    }
  }
  return tokens.filter((token) => token.length > 1 || CJK_RE.test(token));
}

export function retrieveChunks(
  chunks: TextChunk[],
  query: string,
  k = 6,
): TextChunk[] {
  if (chunks.length <= k) return chunks;
  const queryTokens = new Set(tokenize(query));
  if (!queryTokens.size) return chunks.slice(0, k);

  const scored = chunks.map((chunk) => {
    const chunkTokens = new Set(tokenize(chunk.text));
    let score = 0;
    for (const token of queryTokens) {
      if (chunkTokens.has(token)) {
        score += token.length > 1 ? 2 : 1;
      }
    }
    return {
      chunk,
      index: chunk.index,
      score: score / Math.sqrt(Math.max(1, chunkTokens.size)),
    };
  });

  const top = scored
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, k)
    .map((row) => row.chunk);

  return top.length ? top : chunks.slice(0, k);
}

/** Build the context window for a question, staying within maxChars. */
export function buildContextForQuestion(
  chunks: TextChunk[],
  question: string,
  maxChars: number,
): { text: string; pages: number[] } {
  if (!chunks.length) return { text: "", pages: [] };
  const picked = retrieveChunks(chunks, question, 6);
  const pageSet = new Set<number>();
  let context = "";
  for (const chunk of picked) {
    if (context.length + chunk.text.length > maxChars) break;
    context +=
      (context ? "\n\n" : "") +
      wrapDocumentData(chunk.text) +
      (chunk.pages.length ? ` [p.${chunk.pages.join(",")}]` : "");
    for (const page of chunk.pages) pageSet.add(page);
  }
  if (!context) {
    const first = chunks[0];
    context = wrapDocumentData(first.text.slice(0, maxChars));
    for (const page of first.pages) pageSet.add(page);
  }
  return { text: context, pages: [...pageSet].sort((a, b) => a - b) };
}

export function formatPages(pages: number[]): string {
  return pages.length ? pages.map((page) => `p.${page}`).join(", ") : "";
}
