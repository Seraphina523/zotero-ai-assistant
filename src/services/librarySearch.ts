import { config } from "../../package.json";

/**
 * Idea discovery across the whole library.
 *
 * Three different questions need three different search strategies, so this
 * module exposes a single `searchLibrary` entry point that picks one:
 *
 *   - "gap"     : find papers that mention a concept but don't solve it
 *   - "conflict": find papers that reach opposite conclusions
 *   - "extend"  : find papers adjacent to a seed item (shared vocabulary)
 */

export type SearchMode = "gap" | "conflict" | "extend";

export interface LibraryHit {
  item: Zotero.Item;
  /** Title, authors, year and venue. */
  title: string;
  year: string;
  venue: string;
  /** Snippets of matching full-text. */
  snippets: string[];
  /** Why this item matched, in the model's own words. */
  reason?: string;
}

function safeField(item: Zotero.Item, field: string): string {
  try {
    const value = item.getField(field as any);
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

export function describeItem(item: Zotero.Item): string {
  const authors = (item.getCreators() || [])
    .slice(0, 3)
    .map((creator: any) =>
      creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(" "),
    )
    .filter(Boolean)
    .join(", ");
  return [
    safeField(item, "date"),
    authors,
    safeField(item, "publicationTitle"),
    safeField(item, "title"),
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Run a Zotero full-text search.
 *
 * `fulltextContent` is backed by SQLite FTS5, so it is fast even on large
 * libraries (unlike the removed `fulltextWord` condition).
 */
export async function searchLibrary(
  terms: string[],
  options: {
    mode?: SearchMode;
    limit?: number;
    excludeItemID?: number;
    libraryID?: number;
  } = {},
): Promise<LibraryHit[]> {
  const limit = Math.min(30, Math.max(1, options.limit ?? 12));
  if (!terms.length) return [];

  const search = new Zotero.Search();
  if (options.libraryID) {
    search.addCondition("libraryID", "is", String(options.libraryID));
  }
  // Full-text content, not just metadata.
  search.addCondition("fulltextContent", "contains", terms[0]);
  for (const term of terms.slice(1)) {
    search.addCondition("fulltextContent", "contains", term);
  }

  let ids = await search.search();
  if (!ids.length) return [];

  if (options.excludeItemID) {
    ids = ids.filter((id) => id !== options.excludeItemID);
  }

  const hits: LibraryHit[] = [];
  for (const id of ids.slice(0, limit)) {
    const item = Zotero.Items.get(id);
    if (!item || !item.isRegularItem()) continue;
    hits.push({
      item,
      title: safeField(item, "title"),
      year: safeField(item, "date"),
      venue: safeField(item, "publicationTitle"),
      snippets: await snippetsFor(item, terms),
    });
  }
  return hits;
}

/** Pull short text fragments around each term from an item's full text. */
async function snippetsFor(item: Zotero.Item, terms: string[]): Promise<string[]> {
  try {
    const attachments = item.getAttachments() || [];
    for (const attachmentID of attachments.slice(0, 3)) {
      const attachment = Zotero.Items.get(attachmentID);
      if (!attachment?.isAttachment()) continue;

      const cacheFile = Zotero.Fulltext.getItemCacheFile(attachment);
      if (!cacheFile?.path) continue;
      const exists = await (async () => { try { return await OS.File.exists(cacheFile.path); } catch { return false; } })();
      if (!exists) continue;

      const text = await Zotero.File.getContentsAsync(cacheFile.path);
      const body = String(text || "");
      if (!body) continue;

      const found: string[] = [];
      for (const term of terms) {
        const index = body.toLowerCase().indexOf(term.toLowerCase());
        if (index < 0) continue;
        const start = Math.max(0, index - 90);
        const end = Math.min(body.length, index + term.length + 110);
        found.push(
          `…${body
            .slice(start, end)
            .replace(/\s+/g, " ")
            .trim()}…`,
        );
        if (found.length >= 2) break;
      }
      if (found.length) return found;
    }
  } catch (error) {
    Zotero.debug(`[Zotero AI] Snippet extraction failed: ${error}`);
  }
  return [];
}

/**
 * Extract the vocabulary of a seed item, used to find adjacent work.
 *
 * Chinese text is reduced to bigrams and Latin text to words. Bigrams are
 * kept in document order rather than by frequency, because every bigram of a
 * single sentence has the same count and a frequency sort would drop terms
 * arbitrarily.
 */
export function extractTerms(text: string, maxTerms = 20): string[] {
  if (!text) return [];

  const lower = text.toLowerCase();
  const words = lower.match(/[a-z][a-z0-9]{3,}/g) || [];
  const cjkRuns = text.match(/[\u4e00-\u9fff]{2,}/g) || [];

  const wordCounts = new Map<string, number>();
  for (const word of words) {
    wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
  }
  const rankedWords = [...wordCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([term]) => term);

  // Bigrams in document order, deduplicated.
  const bigrams: string[] = [];
  const seen = new Set<string>();
  for (const run of cjkRuns) {
    for (let i = 0; i < run.length - 1; i++) {
      const bigram = run.slice(i, i + 2);
      if (seen.has(bigram)) continue;
      seen.add(bigram);
      bigrams.push(bigram);
    }
  }

  const latin = rankedWords.filter((word) => !seen.has(word));
  return [...bigrams, ...latin].slice(0, maxTerms);
}
export async function itemTextForTerms(item: Zotero.Item): Promise<string> {
  const metadata = [
    safeField(item, "title"),
    safeField(item, "abstractNote"),
    (item.getTags() || []).map((tag: any) => tag.tag).join(" "),
  ].join(" ");

  const attachments = item.getAttachments() || [];
  for (const attachmentID of attachments.slice(0, 2)) {
    const attachment = Zotero.Items.get(attachmentID);
    if (!attachment?.isAttachment()) continue;
    try {
      const cacheFile = Zotero.Fulltext.getItemCacheFile(attachment);
      if (!cacheFile?.path) continue;
      const exists = await (async () => {
        try {
          return await OS.File.exists(cacheFile.path);
        } catch {
          return false;
        }
      })();
      if (!exists) continue;
      const text = await Zotero.File.getContentsAsync(cacheFile.path);
      const body = String(text || "");
      if (body) return `${metadata}\n${body.slice(0, 4000)}`;
    } catch {
      // try the next attachment
    }
  }
  return metadata;
}

export function searchModeLabel(mode: SearchMode): string {
  const labels: Record<SearchMode, string> = {
    gap: "找研究空白",
    conflict: "找结论冲突",
    extend: "找相邻工作",
  };
  return labels[mode];
}

export function prefsPrefix(): string {
  return config.prefsPrefix;
}
