import { config } from "../../package.json";

/**
 * One AI note per paper.
 *
 * All AI output for an item goes into a single child note. Sections are stored
 * as structured records in prefs, and the note HTML is rebuilt from them, so:
 *
 *   - repeated appends never interleave markdown and HTML,
 *   - a formatting change can be applied to existing notes by rebuilding,
 *   - the note can be regenerated without losing content.
 *
 * Zotero notes render semantic HTML (h2, p, ul, blockquote, hr), so we emit
 * that and let Zotero's own note stylesheet handle the appearance.
 */

export const NOTE_TITLE = "AI 助手";
const SECTIONS_PREFIX = "noteSections";

export interface NoteSection {
  id: string;
  heading: string;
  /** Markdown body. */
  body: string;
  time: number;
  meta?: string;
  accent?: string;
}

function sectionsKey(itemID: number) {
  return `${SECTIONS_PREFIX}.${itemID}`;
}

export function loadSections(itemID: number): NoteSection[] {
  try {
    const raw = Zotero.Prefs.get(
      `${config.prefsPrefix}.${sectionsKey(itemID)}`,
      true,
    );
    if (!raw) return [];
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (section: any) =>
        section && typeof section.heading === "string" && typeof section.body === "string",
    );
  } catch {
    return [];
  }
}

function saveSections(itemID: number, sections: NoteSection[]) {
  Zotero.Prefs.set(
    `${config.prefsPrefix}.${sectionsKey(itemID)}`,
    JSON.stringify(sections),
    true,
  );
}

function noteTitleOf(note: Zotero.Item): string {
  try {
    return note.getNoteTitle() || "";
  } catch {
    return "";
  }
}

/** Find the existing AI note for an item, if any. */
export function findNote(item: Zotero.Item): Zotero.Item | null {
  try {
    const ids = item.getNotes(true) || [];
    for (const id of ids) {
      const note = Zotero.Items.get(id);
      if (!note || note.deleted) continue;
      if (noteTitleOf(note).trim() === NOTE_TITLE) return note;
    }
  } catch (error) {
    Zotero.debug(`[Zotero AI] Finding note failed: ${error}`);
  }
  return null;
}

function introHTML(): string {
  return `<p><em>本文档由 Zotero AI Assistant 生成，汇总该文献的摘要、翻译、图表解读、批判性分析与问答记录。</em></p>`;
}

/**
 * Get or create the single AI note for an item.
 *
 * The save is awaited on purpose: `Zotero.Item.saveTx()` clears the
 * "itemTypeID changed" flag after the first write, so a second unsaved save on
 * a brand-new item would issue an INSERT without itemTypeID and fail the
 * NOT NULL constraint.
 */
export async function getOrCreateNote(item: Zotero.Item): Promise<Zotero.Item> {
  const existing = findNote(item);
  if (existing) return existing;

  const note = new Zotero.Item("note");
  note.libraryID = item.libraryID;
  note.parentID = item.id;
  // Notes derive their title from the body, so the first line is the title.
  note.setNote(`${NOTE_TITLE}\n${introHTML()}`);
  await note.saveTx();
  return note;
}

/**
 * Legacy notes were written as plain Markdown text. When no structured
 * sections exist yet but a note does, fold its text into a single "历史记录"
 * section so the next rebuild produces clean HTML.
 */
function migrateLegacy(item: Zotero.Item, sections: NoteSection[]): NoteSection[] {
  if (sections.length) return sections;
  const note = findNote(item);
  if (!note) return sections;

  const text = plainText(String(note.getNote() || ""))
    .replace(new RegExp(`^${NOTE_TITLE}\\s*`), "")
    .replace(/本文档由 Zotero AI Assistant 生成[^\n]*/g, "")
    .trim();

  if (!text) return sections;
  return [
    {
      id: `legacy-${Date.now()}`,
      heading: "历史记录",
      body: text,
      time: Date.now(),
      meta: "由旧版本写入，已重新排版",
      accent: "#9ca3af",
    },
  ];
}

/** Rebuild the note HTML from its structured sections. */
export function renderSections(sections: NoteSection[]): string {
  if (!sections.length) {
    return `${NOTE_TITLE}\n${introHTML()}`;
  }

  const blocks = sections.map((section) => {
    const stamp = new Date(section.time).toLocaleString("zh-CN", {
      hour12: false,
    });
    const accent = section.accent || "#4f6ef7";
    return [
      `<blockquote style="border-left:3px solid ${accent};margin:18px 0 6px;padding:2px 0 2px 10px;">`,
      `<h2 style="color:${accent};margin:0;font-size:16px;">${escapeHTML(
        section.heading,
      )}</h2>`,
      `<p style="margin:2px 0 0;font-size:11px;color:#8b93a7;">${escapeHTML(
        stamp,
      )}${section.meta ? ` · ${escapeHTML(section.meta)}` : ""}</p>`,
      `</blockquote>`,
      markdownToHTML(section.body),
      `<hr/>`,
    ].join("\n");
  });

  return [`${NOTE_TITLE}\n${introHTML()}`, ...blocks].join("\n");
}

/** Rewrite the note from the stored sections. */
async function rebuildNote(item: Zotero.Item, sections: NoteSection[]): Promise<Zotero.Item> {
  const note = await getOrCreateNote(item);
  note.setNote(renderSections(sections));
  await note.saveTx();
  return note;
}

/** Append a section and rebuild the note. */
export async function appendSection(
  item: Zotero.Item,
  section: Omit<NoteSection, "id" | "time"> & {
    time?: number;
    /** Keep an existing section with the same heading instead of adding a duplicate. */
    replaceSameHeading?: boolean;
  },
): Promise<Zotero.Item> {
  const existing = migrateLegacy(item, loadSections(item.id));
  const replaceSameHeading = section.replaceSameHeading !== false;

  const entry: NoteSection = {
    id: `sec-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    heading: section.heading,
    body: section.body,
    time: section.time ?? Date.now(),
    meta: section.meta,
    accent: section.accent,
  };

  // Repeated clicks used to pile up identical sections. Overwrite in place so
  // the note keeps one block per kind of output.
  const sameIndex = replaceSameHeading
    ? existing.findIndex((entry2) => entry2.heading === entry.heading)
    : -1;

  if (sameIndex >= 0) {
    existing[sameIndex] = { ...entry, id: existing[sameIndex].id };
  } else {
    existing.push(entry);
  }

  saveSections(item.id, existing);
  return rebuildNote(item, existing);
}

/** Re-render the note after a formatting update, preserving content. */
export async function rebuildFromStorage(item: Zotero.Item): Promise<boolean> {
  const sections = migrateLegacy(item, loadSections(item.id));
  if (!sections.length) return false;
  saveSections(item.id, sections);
  await rebuildNote(item, sections);
  return true;
}

/**
 * Run once per item when the pane opens: if a legacy note exists but no
 * structured sections are stored yet, migrate it and rewrite the note so the
 * old plain-text content becomes properly formatted HTML.
 */
/**
 * Collapse sections that share a heading, keeping the newest one.
 *
 * Older builds appended a new section on every click, so notes accumulated
 * duplicate "摘要" / "图表解读" blocks. Running this on open repairs them.
 */
export function dedupeSections(sections: NoteSection[]): NoteSection[] {
  const byHeading = new Map<string, NoteSection>();
  const order: string[] = [];

  for (const section of sections) {
    const key = section.heading;
    const existing = byHeading.get(key);
    if (!existing) {
      order.push(key);
      byHeading.set(key, section);
      continue;
    }
    // Keep the more recent version.
    if ((section.time || 0) >= (existing.time || 0)) {
      byHeading.set(key, section);
    }
  }

  return order
    .map((key) => byHeading.get(key))
    .filter((section): section is NoteSection => Boolean(section));
}

/**
 * Run once per item when the pane opens:
 *   - migrate a legacy plain-text note into structured sections,
 *   - drop duplicate headings left by older versions.
 */
export async function ensureNoteFormat(item: Zotero.Item): Promise<boolean> {
  const stored = loadSections(item.id);

  if (!stored.length) {
    const note = findNote(item);
    if (!note) return false;
    return rebuildFromStorage(item);
  }

  const deduped = dedupeSections(stored);
  if (deduped.length === stored.length) return false;

  saveSections(item.id, deduped);
  await rebuildNote(item, deduped);
  return true;
}

/** Replace the AI note with a fresh one, dropping previous content. */
export async function resetNote(item: Zotero.Item): Promise<void> {
  saveSections(item.id, []);
  const note = findNote(item);
  if (!note) return;
  note.setNote(`${NOTE_TITLE}\n${introHTML()}`);
  await note.saveTx();
}

/** Delete the AI note entirely. */
export async function deleteNote(item: Zotero.Item): Promise<void> {
  saveSections(item.id, []);
  const note = findNote(item);
  if (!note) return;
  note.deleted = true;
  await note.saveTx();
}

/** Read the plain text of the AI note, for review / export. */
export function readNoteText(item: Zotero.Item): string {
  const note = findNote(item);
  if (!note) return "";
  return plainText(String(note.getNote() || ""));
}

function plainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function escapeHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Minimal Markdown → HTML, tuned for Zotero notes.
 *
 * Emits semantic tags only; Zotero's note stylesheet supplies the look, which
 * also keeps the output intact if the note is exported.
 */
export function markdownToHTML(markdown: string): string {
  const escaped = escapeHTML(markdown);
  const blocks = escaped.split(/\n{2,}/);
  const html = blocks.map((block) => {
    const lines = block.split("\n");

    const heading = block.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = Math.min(4, heading[1].length + 1);
      return `<h${level}>${inline(heading[2])}</h${level}>`;
    }

    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      const items = lines
        .map((line) => line.replace(/^\s*[-*]\s+/, ""))
        .map((line) => `<li>${inline(line)}</li>`)
        .join("");
      return `<ul>${items}</ul>`;
    }

    if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
      const items = lines
        .map((line) => line.replace(/^\s*\d+[.)]\s+/, ""))
        .map((line) => `<li>${inline(line)}</li>`)
        .join("");
      return `<ol>${items}</ol>`;
    }

    if (/^\s*(---+|\*\*\*+)\s*$/.test(block)) return `<hr/>`;

    if (lines.every((line) => /^\s*>\s?/.test(line))) {
      const text = lines
        .map((line) => line.replace(/^\s*>\s?/, ""))
        .join("<br/>");
      return `<blockquote>${inline(text)}</blockquote>`;
    }

    return `<p>${lines.map(inline).join("<br/>")}</p>`;
  });
  return html.filter(Boolean).join("\n");

  function inline(text: string): string {
    return text
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
  }
}
