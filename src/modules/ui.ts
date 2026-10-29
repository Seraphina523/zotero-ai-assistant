import { config } from "../../package.json";
import {
  appendMessage,
  clearConversation,
  ensureRegistered,
  getConversation,
  toHistory,
} from "../services/storage";
import {
  askAboutItem,
  analyzeCritically,
  autoTagItem,
  buildLiteratureMatrix,
  generateGuidedQuestions,
  generateSummary,
  interpretFigures,
  translateItem,
} from "../ai/features";
import {
  appendSection,
  deleteNote,
  ensureNoteFormat,
  findNote,
  markdownToHTML,
  NOTE_TITLE,
} from "../services/notebook";
import { openAskDialog, PromptTemplate } from "./askDialog";
import { openIdeaDialog } from "./ideaDialog";
import { openTranslateDialog, TranslateDialogResult } from "./translateDialog";
import { discoverIdeas, IdeaResult } from "../ai/features";
import { SearchMode } from "../services/librarySearch";
import { loadModels } from "../services/modelRegistry";
import { ChatMessage } from "../ai/providers";
import { StreamHandlers } from "../ai/client";
import { resolveTargetItem } from "../services/itemText";
import { getLocaleID } from "../utils/locale";
import { getProviderId, isEnabled, resolveConfig } from "../utils/prefs";
import {
  findProfile,
  listProfiles,
  setActiveProfileId,
  upsertProfile,
} from "../ai/providers";

const chats = new Map<number, ChatMessage[]>();
/** Last user-triggered action per item, replayed by the Retry button. */
const lastActions = new Map<number, ActionType>();
const busySections = new Set<string>();

const AI_ICON = `chrome://${config.addonRef}/content/icons/ai.svg`;


/**
 * Turn an unknown error into a readable, diagnostic message.
 *
 * Includes the error name and the first stack frame so sandbox-specific
 * failures (missing globals, etc.) are obvious in the UI.
 */
function describeError(error: any): string {
  const name = error?.name || typeof error;
  const message = error?.message || String(error || "未知错误");
  const stack: string = error?.stack || "";
  const frame = stack
    .split("\n")
    .map((line: string) => line.trim())
    .find((line: string) => line.startsWith("at "));
  return frame ? `${name}: ${message}（${frame}）` : `${name}: ${message}`;
}

const SECTION_STYLE_ID = "zai-section-style";
const SECTION_CSS = `
/* ---- palette ---------------------------------------------------------- */
.zai-root {
  --zai-accent: #4f6ef7;
  --zai-accent-soft: rgba(79, 110, 247, .1);
  --zai-ink: var(--fill-primary, #1f2430);
  --zai-ink-dim: var(--fill-secondary, #5b6472);
  --zai-line: var(--fill-quinary, #e3e6ee);
  --zai-surface: var(--material-background, #ffffff);
  --zai-surface-alt: #f6f8fd;

  --zai-blue: #3b82f6;
  --zai-teal: #14b8a6;
  --zai-amber: #f59e0b;
  --zai-violet: #8b5cf6;
  --zai-rose: #f43f5e;
  --zai-cyan: #06b6d4;
  --zai-emerald: #10b981;
  --zai-slate: #64748b;

  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--zai-ink);
  padding: 2px 2px 12px;
}

/* ---- header ----------------------------------------------------------- */
.zai-status {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 11.5px;
  color: var(--zai-ink-dim);
  padding: 7px 11px;
  border-radius: 9px;
  background: linear-gradient(135deg, #eef2ff 0%, #f0f9ff 55%, #ecfdf5 100%);
  border: 1px solid #dbe4ff;
}
.zai-status::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--zai-emerald);
  box-shadow: 0 0 0 3px rgba(16, 185, 129, .18);
  flex: 0 0 auto;
}
.zai-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: .2px;
  background: var(--zai-accent-soft);
  color: var(--zai-accent);
  border: 1px solid rgba(79, 110, 247, .22);
}
.zai-badge.model {
  background: rgba(139, 92, 246, .1);
  color: #7c3aed;
  border-color: rgba(139, 92, 246, .22);
}
.zai-badge.budget {
  background: rgba(6, 182, 212, .1);
  color: #0891b2;
  border-color: rgba(6, 182, 212, .2);
}

/* ---- toolbar ---------------------------------------------------------- */
.zai-toolbar {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.zai-btn-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.zai-btn-group-title {
  font-size: 10px;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--zai-ink-dim);
  opacity: .75;
  font-weight: 600;
}
.zai-btn-group-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.zai-toolbar-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px dashed var(--zai-line);
}
.zai-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  color: #fff;
  background: var(--zai-slate);
  transition: transform .1s ease, box-shadow .12s ease, filter .12s ease;
}
.zai-btn-icon {
  font-size: 12px;
  line-height: 1;
  opacity: .95;
}
.zai-btn-label { line-height: 1.3; }
.zai-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 3px 10px rgba(15, 23, 42, .16);
  filter: brightness(1.06);
}
.zai-btn:active:not(:disabled) { transform: translateY(0); }
.zai-btn:disabled { opacity: .45; cursor: default; }

.zai-btn.primary   { background: linear-gradient(135deg, #6366f1, #3b82f6); }
.zai-btn.a-translate{ background: linear-gradient(135deg, #14b8a6, #0ea5e9); }
.zai-btn.a-tags    { background: linear-gradient(135deg, #f59e0b, #f97316); }
.zai-btn.a-figures { background: linear-gradient(135deg, #8b5cf6, #d946ef); }
.zai-btn.a-critique{ background: linear-gradient(135deg, #f43f5e, #ec4899); }
.zai-btn.a-questions{ background: linear-gradient(135deg, #06b6d4, #0ea5e9); }
.zai-btn.a-idea    { background: linear-gradient(135deg, #a855f7, #6366f1); }
.zai-btn.a-quick   { background: linear-gradient(135deg, #f59e0b, #ef4444); }

.zai-step {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.zai-step-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .04em;
  color: var(--zai-accent);
  padding-left: 2px;
}
.zai-step .zai-bubble.assistant {
  margin-top: 0;
}
.zai-btn.a-retry   { background: linear-gradient(135deg, #64748b, #475569); }
.zai-btn.a-save    { background: linear-gradient(135deg, #10b981, #059669); }
.zai-btn.a-clear   { background: #fff; color: var(--zai-ink-dim); border-color: var(--zai-line); }
.zai-btn.a-clear:hover:not(:disabled) { box-shadow: none; }

/* ---- chat ------------------------------------------------------------- */
.zai-chat {
  display: flex;
  flex-direction: column;
  gap: 9px;
  max-height: 420px;
  min-height: 48px;
  overflow-y: auto;
  padding: 11px;
  border-radius: 11px;
  border: 1px solid var(--zai-line);
  background:
    repeating-linear-gradient(0deg, transparent 0 26px, rgba(15, 23, 42, .015) 26px 27px),
    var(--zai-surface);
}
.zai-chat:empty::before {
  content: "选择上方按钮生成摘要 / 翻译 / 图表解读，或在下方直接提问。";
  opacity: .5;
  font-size: 12px;
}
.zai-bubble {
  border-radius: 10px;
  padding: 9px 12px;
  max-width: 100%;
  overflow-wrap: anywhere;
  font-size: 12.5px;
  line-height: 1.62;
}
.zai-bubble.user {
  align-self: flex-end;
  max-width: 90%;
  white-space: pre-wrap;
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #3b82f6);
  border-bottom-right-radius: 3px;
  box-shadow: 0 2px 8px rgba(59, 130, 246, .22);
}
.zai-bubble.assistant {
  background: var(--zai-surface);
  border: 1px solid var(--zai-line);
  border-left: 3px solid var(--zai-accent);
  border-radius: 10px 10px 10px 4px;
}
.zai-bubble.assistant.streaming {
  border-left-color: var(--zai-violet);
  background: linear-gradient(180deg, #fafbff, #fff);
}
.zai-bubble.error {
  color: #b91c1c;
  background: linear-gradient(135deg, #fef2f2, #fff1f2);
  border: 1px solid #fecaca;
  border-left: 3px solid #f43f5e;
  white-space: pre-wrap;
}
.zai-bubble p { margin: 0 0 .55em; }
.zai-bubble p:last-child { margin-bottom: 0; }
.zai-bubble h2, .zai-bubble h3, .zai-bubble h4 {
  margin: .35em 0 .4em;
  font-size: 13.5px;
  color: var(--zai-accent);
}
.zai-bubble ul { margin: .25em 0 .55em; padding-left: 1.25em; }
.zai-bubble li { margin: .15em 0; }
.zai-bubble strong { color: #1e293b; }
.zai-bubble code {
  background: rgba(79, 110, 247, .09);
  color: #4338ca;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 11.5px;
}
/* Zotero's pane stylesheet resets anchor colours, so be explicit. */
.zai-bubble a,
.zai-bubble a:visited,
.zai-bubble a:link {
  cursor: pointer;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  text-decoration: none;
  background: rgba(79, 110, 247, .14);
  color: #4f6ef7 !important;
}
.zai-bubble a:hover {
  background: rgba(79, 110, 247, .26) !important;
  color: #3b55d9 !important;
}

/* ---- guided questions ------------------------------------------------- */
.zai-questions {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 6px;
  margin-top: 4px;
}
.zai-q-btn {
  text-align: left;
  border: 1px solid rgba(6, 182, 212, .28);
  background: linear-gradient(135deg, #ecfeff, #f0f9ff);
  color: #0e7490;
  border-radius: 8px;
  padding: 6px 9px;
  font-size: 11.5px;
  cursor: pointer;
  transition: transform .1s ease, box-shadow .12s ease;
}
.zai-q-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 3px 9px rgba(6, 182, 212, .18);
  border-color: var(--zai-cyan);
}

/* ---- input ------------------------------------------------------------ */
.zai-modelbar { display: flex; align-items: center; gap: 8px; }
.zai-profile-tag {
  flex: 0 1 auto;
  font-size: 10.5px;
  color: var(--zai-ink-dim);
  opacity: .75;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 45%;
}
.zai-model-select {
  flex: 1;
  max-width: 340px;
  border: 1px solid var(--zai-line);
  border-radius: 7px;
  padding: 4px 8px;
  font: inherit;
  font-size: 12px;
  background: var(--zai-surface);
  color: var(--zai-ink);
  cursor: pointer;
  height: 28px;
}
/* focus ring */

.zai-model-select:focus {
  outline: none;
  border-color: var(--zai-accent);
  box-shadow: 0 0 0 3px rgba(79,110,247,.14);
}

.zai-inputbar { display: flex; gap: 6px; align-items: flex-end; }
.zai-input {
  flex: 1;
  min-height: 58px;
  max-height: 150px;
  resize: vertical;
  border: 1px solid var(--zai-line);
  border-radius: 9px;
  padding: 8px 10px;
  font: inherit;
  font-size: 12.5px;
  background: var(--zai-surface);
  color: var(--zai-ink);
  box-sizing: border-box;
  transition: border-color .12s ease, box-shadow .12s ease;
}
.zai-input:focus {
  outline: none;
  border-color: var(--zai-accent);
  box-shadow: 0 0 0 3px rgba(79, 110, 247, .14);
}
.zai-btn.zai-stop {
  background: linear-gradient(135deg, #f43f5e, #e11d48);
}
.zai-hint {
  font-size: 10.5px;
  color: var(--zai-ink-dim);
  opacity: .8;
}
.zai-busy {
  font-size: 11px;
  color: var(--zai-accent);
  font-weight: 500;
}

/* ---- dark mode -------------------------------------------------------- */
@media (prefers-color-scheme: dark) {
  .zai-root {
    --zai-ink: var(--fill-primary, #e5e9f2);
    --zai-ink-dim: var(--fill-secondary, #9aa3b2);
    --zai-line: var(--fill-quinary, #2c3242);
    --zai-surface: var(--material-background, #1a1d26);
    --zai-accent: #818cf8;
    --zai-accent-soft: rgba(129, 140, 248, .16);
  }
  .zai-status {
    background: linear-gradient(135deg, #1e2338, #16202e 55%, #14231f);
    border-color: #2b3350;
  }
  .zai-chat { background: var(--zai-surface); }
  .zai-bubble.assistant {
    background: rgba(255, 255, 255, .04);
    border-left-color: var(--zai-accent);
  }
  .zai-bubble.assistant.streaming { background: rgba(139, 92, 246, .07); }
  .zai-bubble.error {
    color: #fca5a5;
    background: rgba(244, 63, 94, .12);
    border-color: rgba(244, 63, 94, .3);
  }
  .zai-bubble strong { color: #f1f5f9; }
  .zai-bubble code { background: rgba(129, 140, 248, .18); color: #c7d2fe; }
  .zai-bubble h2, .zai-bubble h3, .zai-bubble h4 { color: #a5b4fc; }
  .zai-bubble a,
  .zai-bubble a:visited,
  .zai-bubble a:link {
    background: rgba(129, 140, 248, .22) !important;
    color: #c7d2fe !important;
  }
  .zai-bubble a:hover {
    background: rgba(129, 140, 248, .34) !important;
  }
  .zai-q-btn {
    background: rgba(6, 182, 212, .1);
    color: #67e8f9;
    border-color: rgba(6, 182, 212, .3);
  }
  .zai-btn.a-clear {
    background: rgba(255, 255, 255, .06);
    color: var(--zai-ink-dim);
  }
  .zai-input { background: rgba(255, 255, 255, .05); }
}
`;

function ensureStyle(doc: Document) {
  if (doc.getElementById(SECTION_STYLE_ID)) return;
  const style = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "style",
  ) as HTMLStyleElement;
  style.id = SECTION_STYLE_ID;
  style.textContent = SECTION_CSS;
  (doc.head || doc.documentElement)!.appendChild(style);
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    tag,
  ) as HTMLElementTagNameMap[K];
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function getHistory(itemID: number): ChatMessage[] {
  if (!chats.has(itemID)) {
    const stored = getConversation(itemID);
    chats.set(itemID, toHistory(stored));
  }
  return chats.get(itemID)!;
}

function persist(itemID: number, message: any) {
  const item = Zotero.Items.get(itemID);
  if (!item) return;
  appendMessage(item, message);
}

function setBusy(root: HTMLElement, busy: boolean, label?: string) {
  root.querySelectorAll("button.zai-stop").forEach((node: Element) => {
    const stop = node as HTMLButtonElement;
    stop.style.display = busy ? "inline-block" : "none";
    // Reset the abort state so a fresh run can be stopped again.
    stop.disabled = false;
    stop.textContent = "停止";
  });
  root
    .querySelectorAll("button.zai-btn:not(.zai-stop)")
    .forEach((node: Element) => {
      (node as HTMLButtonElement).disabled = busy;
    });
  const input = root.querySelector<HTMLTextAreaElement>(".zai-input");
  if (input) input.disabled = busy;
  const status = root.querySelector<HTMLElement>(".zai-busy");
  if (status) {
    status.textContent = busy ? label || "正在请求模型…" : "";
    status.style.display = busy ? "block" : "none";
  }
}

/**
 * Render an assistant reply with clickable page citations.
 *
 * Page references written as [p.4] or [p.4–6] become links that open the item
 * in the reader at that page.
 */
function renderAnswer(
  doc: Document,
  text: string,
  target: Zotero.Item,
  attachmentID: number | undefined,
): HTMLElement {
  const bubble = el(doc, "div", "zai-bubble assistant");
  bubble.innerHTML = markdownToHTML(text);

  const pageLink = (label: string, page: number) => {
    const anchor = el(doc, "a", "", label);
    anchor.setAttribute("href", "#");
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      void openReader(target, attachmentID, page);
    });
    return anchor;
  };

  // Replace [p.4] / [p.4-6] / [p.4,5] markers with links.
  //
  // NodeFilter is not exposed in the plugin sandbox, so collect text nodes
  // by walking the DOM ourselves.
  const collectTextNodes = (root: Node): Text[] => {
    const found: Text[] = [];
    const visit = (node: Node) => {
      if (node.nodeType === 3 /* Node.TEXT_NODE */) {
        found.push(node as Text);
        return;
      }
      let child = node.firstChild;
      while (child) {
        visit(child);
        child = child.nextSibling;
      }
    };
    visit(root);
    return found;
  };

  bubble.querySelectorAll("p, li, h2, h3, h4").forEach((node: Element) => {
    const targets = collectTextNodes(node);
    for (const textNode of targets) {
      const value = textNode.nodeValue || "";
      const pattern = /\[p\.([^\]]+)\]/g;
      if (!pattern.test(value)) continue;
      pattern.lastIndex = 0;
      const fragment = doc.createDocumentFragment();
      let last = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(value))) {
        if (match.index > last) {
          fragment.appendChild(doc.createTextNode(value.slice(last, match.index)));
        }
        const pages = match[1].split(/[,\-–]/).map((p) => parseInt(p, 10));
        const first = pages.find((page) => Number.isFinite(page));
        if (first) {
          fragment.appendChild(pageLink(match[0], first));
        } else {
          fragment.appendChild(doc.createTextNode(match[0]));
        }
        last = match.index + match[0].length;
      }
      if (last < value.length) {
        fragment.appendChild(doc.createTextNode(value.slice(last)));
      }
      textNode.parentNode?.replaceChild(fragment, textNode);
    }
  });

  return bubble;
}

function appendBubble(
  chat: HTMLElement,
  role: "user" | "assistant" | "error",
  content: string,
) {
  const bubble = el(chat.ownerDocument!, "div", `zai-bubble ${role}`);
  if (role === "assistant") {
    bubble.innerHTML = markdownToHTML(content);
  } else {
    bubble.textContent = content;
  }
  chat.appendChild(bubble);
  chat.scrollTop = chat.scrollHeight;
}

/** Open the reader for an item at a specific page. */
async function openReader(
  item: Zotero.Item,
  attachmentID: number | undefined,
  pageIndex: number,
) {
  const target = attachmentID ?? item.id;
  try {
    await Zotero.Reader.open(target, { pageIndex: Math.max(0, pageIndex - 1) });
  } catch (error) {
    ztoolkit.log("Failed to open reader", error);
  }
}

/** Ask before wiping the accumulated AI note. */
async function resetNoteFor(item: Zotero.Item) {
  const note = findNote(item);
  if (!note) return;
  const win = Zotero.getMainWindow();
  const message = `「${NOTE_TITLE}」笔记中已有内容，确定要清空吗？`;
  const ok = win?.confirm?.(message);
  if (!ok) return;
  await deleteNote(item);
}

function attachmentOf(item: Zotero.Item): number | undefined {
  try {
    const ids = item.getAttachments() || [];
    return ids[0];
  } catch {
    return undefined;
  }
}

function describeSaved(result: {
  savedTo?: string;
  savedNote?: Zotero.Item;
}): string {
  if (result.savedNote) return "已保存为该条目的子笔记";
  if (result.savedTo === "abstract") return "已写入「摘要」字段";
  return "未自动保存";
}

interface SectionContext {
  /** Model chosen in the pane, overriding the profile default. */
  modelOverride?: string;
  /** Profile the chosen model belongs to; keeps endpoint and key in sync. */
  profileId?: string;
  root: HTMLElement;
  chat: HTMLElement;
  status: HTMLElement;
  item: Zotero.Item;
  target: Zotero.Item;
  attachmentID: number | undefined;
  stream: { cancelled: boolean; started: boolean; cancel?: () => void };
}

type ActionType =
  | "summary"
  | "translate"
  | "tags"
  | "save"
  | "retry"
  | "critique"
  | "figures"
  | "questions"
  | "idea"
  | "quick";

const STREAMING_ACTIONS: ActionType[] = [
  "summary",
  "translate",
  "retry",
  "critique",
  "figures",
];

/** Accent class per action, used by the toolbar buttons. */
const ACTION_CLASS: Record<ActionType, string> = {
  summary: "primary",
  translate: "a-translate",
  tags: "a-tags",
  figures: "a-figures",
  critique: "a-critique",
  questions: "a-questions",
  idea: "a-idea",
  quick: "a-quick",
  retry: "a-retry",
  save: "a-save",
};

const ACTION_LABELS: Record<ActionType, string> = {
  summary: "正在生成摘要…",
  translate: "正在翻译…",
  tags: "正在生成智能标签…",
  save: "正在保存对话…",
  retry: "正在重新生成…",
  critique: "正在进行批判性分析…",
  figures: "正在解读图表…",
  questions: "正在生成引导问题…",
  idea: "正在检索文献库…",
  quick: "正在一键生成摘要、标签与图表解读…",
};

async function runAction(
  action: ActionType,
  ctx: SectionContext,
  extra?: { question?: string },
) {
  if (!isEnabled()) {
    appendBubble(ctx.chat, "error", "插件已在设置中停用。");
    return;
  }
  const key = `${ctx.target.id}:${action}`;
  if (busySections.has(key)) return;
  busySections.add(key);

  // Remember what was run so Retry can replay it. Retry and save are
  // meta-actions and must not overwrite the remembered action.
  if (action !== "retry" && action !== "save") {
    lastActions.set(ctx.target.id, action);
  }
  ctx.stream = { cancelled: false, started: false };
  setBusy(ctx.root, true, ACTION_LABELS[action]);

  const doc = ctx.root.ownerDocument!;

  try {
    const handlers: StreamHandlers | undefined = STREAMING_ACTIONS.includes(
      action,
    )
      ? {
          signal: ctx.stream,
          registerCancel: (cancel) => {
            ctx.stream.cancel = cancel;
          },
          onDelta: (delta, full) => {
            ctx.stream.started = true;
            let bubble = ctx.chat.querySelector<HTMLElement>(
              ".zai-bubble.streaming",
            );
            if (!bubble) {
              bubble = el(doc, "div", "zai-bubble assistant streaming");
              bubble.setAttribute("data-streaming", "1");
              ctx.chat.appendChild(bubble);
            }
            bubble.innerHTML = markdownToHTML(full + delta);
            ctx.chat.scrollTop = ctx.chat.scrollHeight;
          },
        }
      : undefined;

    if (action === "quick") {
      await runQuickBundle(ctx);
    } else if (action === "questions") {
      const result = await generateGuidedQuestions(ctx.item);
      ctx.chat.querySelector(".zai-bubble.streaming")?.remove();
      if (!result.questions.length) {
        appendBubble(ctx.chat, "error", "未能生成引导问题，请稍后重试。");
        return;
      }
      const bubble = el(doc, "div", "zai-bubble assistant");
      bubble.appendChild(el(doc, "div", "zai-hint", "点击下方问题开始提问："));
      const box = el(doc, "div", "zai-questions");
      for (const entry of result.questions) {
        const btn = el(doc, "button", "zai-q-btn", entry.label || entry.question);
        btn.title = entry.reason;
        btn.addEventListener("click", () => {
          openAskDialog(ctx.item, result.questions, (answer) => {
            void sendQuestion(ctx, answer.question, answer.template);
          });
        });
        box.appendChild(btn);
      }
      bubble.appendChild(box);
      ctx.chat.appendChild(bubble);
      ctx.chat.scrollTop = ctx.chat.scrollHeight;
    } else if (action === "idea") {
      ctx.chat.querySelector(".zai-bubble.streaming")?.remove();
      openIdeaDialog(Boolean(ctx.item), (answer) => {
        void runIdea(ctx, answer.question, answer.mode);
      });
    } else if (action === "critique") {
      const result = await analyzeCritically(
        ctx.item,
        handlers,
        ctx.modelOverride,
      );
      ctx.chat.querySelector(".zai-bubble.streaming")?.remove();
      const bubble = renderAnswer(doc, result.text, ctx.target, ctx.attachmentID);
      ctx.chat.appendChild(bubble);
      await appendSection(ctx.target, {
        heading: "批判性分析",
        body: result.text,
        accent: "#f43f5e",
        meta: "方法学评估：研究设计、样本、测量、基线、可复现性",
      });
      appendBubble(ctx.chat, "assistant", "*已追加到该条目的 AI 笔记。*");
      ctx.chat.scrollTop = ctx.chat.scrollHeight;
    } else if (action === "figures") {
      const result = await interpretFigures(
        ctx.item,
        handlers,
        ctx.modelOverride,
      );
      ctx.chat.querySelector(".zai-bubble.streaming")?.remove();
      const bubble = renderAnswer(doc, result.text, ctx.target, ctx.attachmentID);
      ctx.chat.appendChild(bubble);
      await appendSection(ctx.target, {
        heading: "图表解读",
        body: result.text,
        accent: "#8b5cf6",
        meta:
          result.figuresFound > 0
            ? `提取到 ${result.figuresFound} 个图表/表格相关片段`
            : "未提取到图表结构化信息",
      });
      appendBubble(ctx.chat, "assistant", "*已追加到该条目的 AI 笔记。*");
      ctx.chat.scrollTop = ctx.chat.scrollHeight;
    } else if (action === "summary") {
      const result = await generateSummary(ctx.item, {
        save: true,
        handlers,
        modelOverride: ctx.modelOverride,
      });
      ctx.chat.querySelector(".zai-bubble.streaming")?.remove();
      const bubble = renderAnswer(doc, result.text, ctx.target, ctx.attachmentID);
      ctx.chat.appendChild(bubble);
      appendBubble(
        ctx.chat,
        "assistant",
        `---\n*${describeSaved(result)}；文本来源：${
          result.source === "metadata" ? "仅元数据" : "全文"
        }${result.truncated ? "（已截断）" : ""}*`,
      );
      ctx.chat.scrollTop = ctx.chat.scrollHeight;
    } else if (action === "translate") {
      // Ask what to translate before spending tokens.
      const trTarget = resolveTargetItem(ctx.item);
      openTranslateDialog(
        Boolean(String(trTarget.getField("title") || "").trim()),
        Boolean(String(trTarget.getField("abstractNote") || "").trim()),
        (answer) => {
          void runTranslate(ctx, answer);
        },
      );
    } else if (action === "tags") {
      const result = await autoTagItem(ctx.item, {
        save: true,
        modelOverride: ctx.modelOverride,
      });
      appendBubble(
        ctx.chat,
        "assistant",
        [
          `**生成标签**：${result.tags.join("、")}`,
          result.added.length
            ? `**新增**：${result.added.join("、")}`
            : "所有标签均已存在，未重复添加。",
        ].join("\n\n"),
      );
    } else if (action === "retry") {
      // Replay the last real action instead of depending on chat history:
      // summary / tags / figures never write to the conversation log.
      const previous = lastActions.get(ctx.target.id);
      if (!previous || previous === "retry" || previous === "save") {
        appendBubble(
          ctx.chat,
          "error",
          "还没有执行过可重复的操作。请先生成摘要、标签、图表、批判性分析或问答。",
        );
        return;
      }

      const history = getHistory(ctx.target.id);
      const lastUser = [...history].reverse().find((m) => m.role === "user");

      // Generation actions can simply be re-run.
      if (!lastUser && previous !== "questions") {
        appendBubble(ctx.chat, "assistant", "*正在重新生成上一步操作…*");
        busySections.delete(key);
        setBusy(ctx.root, false);
        await runAction(previous, ctx);
        return;
      }

      if (!lastUser) {
        appendBubble(ctx.chat, "error", "没有可重新生成的问题。");
        return;
      }

      ctx.chat.querySelector(".zai-bubble.streaming")?.remove();
      const answer = await askAboutItem(
        ctx.item,
        lastUser.content,
        history.slice(0, -1),
        handlers,
        undefined,
        ctx.modelOverride,
      );
      ctx.chat.querySelector(".zai-bubble.streaming")?.remove();
      const bubble = renderAnswer(
        doc,
        answer.text,
        ctx.target,
        ctx.attachmentID,
      );
      ctx.chat.appendChild(bubble);
      ctx.chat.scrollTop = ctx.chat.scrollHeight;
      persist(ctx.target.id, {
        role: "assistant",
        content: answer.text,
        pages: answer.pages,
        time: Date.now(),
      });
    } else if (action === "save") {
      // Every result is written to the note as it is produced, so this button
      // opens the note instead of asking for a chat transcript.
      const note = findNote(ctx.target);
      if (!note) {
        appendBubble(
          ctx.chat,
          "assistant",
          "*还没有生成任何内容，AI 笔记尚未创建。先点「一键生成」或「摘要」。*",
        );
        return;
      }
      try {
        const win = Zotero.getMainWindow() as any;
        win?.ZoteroPane?.selectItem?.(note.id);
        const tabID = win?.Zotero_Tabs?.getTabIDByItemID?.(note.id);
        if (tabID) win.Zotero_Tabs.select(tabID, true);
        appendBubble(
          ctx.chat,
          "assistant",
          "*已定位到该条目的 AI 笔记。所有生成结果都会自动写入它，可随时打开查看。*",
        );
      } catch (error) {
        appendBubble(ctx.chat, "error", describeError(error));
      }
    }
  } catch (error: any) {
    ctx.chat.querySelector(".zai-bubble.streaming")?.remove();
    appendBubble(
      ctx.chat,
      "error",
      describeError(error),
    );
  } finally {
    busySections.delete(key);
    setBusy(ctx.root, false);
  }
}

/** Translate the parts the user picked, then render them. */
async function runTranslate(ctx: SectionContext, answer: TranslateDialogResult) {
  const key = `${ctx.target.id}:translate`;
  if (busySections.has(key)) return;
  busySections.add(key);
  ctx.stream = { cancelled: false, started: false };
  setBusy(ctx.root, true, "正在翻译…");

  const doc = ctx.root.ownerDocument!;

  try {
    const result = await translateItem(ctx.item, {
      save: true,
      scope: answer.scope,
      modelOverride: ctx.modelOverride,
      handlers: {
        signal: ctx.stream,
        registerCancel: (cancel) => {
          ctx.stream.cancel = cancel;
        },
        onDelta: (delta, full) => {
          ctx.stream.started = true;
          let bubble = ctx.chat.querySelector<HTMLElement>(
            ".zai-bubble.streaming",
          );
          if (!bubble) {
            bubble = el(doc, "div", "zai-bubble assistant streaming");
            ctx.chat.appendChild(bubble);
          }
          bubble.innerHTML = markdownToHTML(full + delta);
          ctx.chat.scrollTop = ctx.chat.scrollHeight;
        },
      },
    });
    ctx.chat.querySelector(".zai-bubble.streaming")?.remove();

    const lines = [
      result.title ? `**标题**：${result.title}` : "",
      result.abstract ? `**摘要**：${result.abstract}` : "",
      result.custom ? `**文本**：${result.custom}` : "",
    ].filter(Boolean);
    const bubble = el(doc, "div", "zai-bubble assistant");
    bubble.innerHTML = markdownToHTML(lines.join("\n\n"));
    ctx.chat.appendChild(bubble);
    appendBubble(ctx.chat, "assistant", `---` + String.fromCharCode(10) + `*${describeSaved(result)}*`);
    ctx.chat.scrollTop = ctx.chat.scrollHeight;
  } catch (error: any) {
    ctx.chat.querySelector(".zai-bubble.streaming")?.remove();
    appendBubble(ctx.chat, "error", describeError(error));
  } finally {
    busySections.delete(key);
    setBusy(ctx.root, false);
  }
}

/**
 * One-click bundle: summary + tags + figures.
 *
 * Runs sequentially so the user sees progress step by step and can stop
 * between steps. Each step appends its own section to the AI note, and a
 * failure in one step does not abort the others.
 */
async function runQuickBundle(ctx: SectionContext) {
  const steps: Array<{
    key: "summary" | "tags" | "figures";
    label: string;
    run: () => Promise<string>;
  }> = [
    {
      key: "summary",
      label: "摘要",
      run: async () => {
        const result = await generateSummary(ctx.item, {
          save: true,
          modelOverride: ctx.modelOverride,
        });
        return result.text;
      },
    },
    {
      key: "tags",
      label: "标签",
      run: async () => {
        const result = await autoTagItem(ctx.item, {
          save: true,
          modelOverride: ctx.modelOverride,
        });
        return [
          `**生成标签**：${result.tags.join("、")}`,
          result.added.length
            ? `**新增**：${result.added.join("、")}`
            : "所有标签均已存在，未重复添加。",
        ].join("\n\n");
      },
    },
    {
      key: "figures",
      label: "图表解读",
      run: async () => {
        const result = await interpretFigures(ctx.item, undefined, ctx.modelOverride);
        await appendSection(ctx.target, {
          heading: "图表解读",
          body: result.text,
          accent: "#8b5cf6",
          meta:
            result.figuresFound > 0
              ? `提取到 ${result.figuresFound} 个图表/表格相关片段`
              : "未提取到图表结构化信息",
        });
        return result.text;
      },
    },
  ];

  const doc = ctx.root.ownerDocument!;
  const done: string[] = [];
  const failed: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    if (ctx.stream.cancelled) {
      appendBubble(
        ctx.chat,
        "assistant",
        `*已停止：完成 ${done.length} / ${steps.length} 步${done.length ? `（${done.join("、")}）` : ""}*`,
      );
      return;
    }

    const step = steps[i];
    const progress = el(
      doc,
      "div",
      "zai-hint",
      `[${i + 1}/${steps.length}] 正在处理：${step.label}…`,
    );
    ctx.chat.appendChild(progress);
    ctx.chat.scrollTop = ctx.chat.scrollHeight;

    try {
      const text = await step.run();
      progress.remove();
      const bubble = renderAnswer(doc, text, ctx.target, ctx.attachmentID);
      const header = el(doc, "div", "zai-step-title", `${step.label}`);
      const wrapper = el(doc, "div", "zai-step");
      wrapper.appendChild(header);
      wrapper.appendChild(bubble);
      ctx.chat.appendChild(wrapper);
      ctx.chat.scrollTop = ctx.chat.scrollHeight;
      done.push(step.label);
    } catch (error: any) {
      progress.remove();
      appendBubble(
        ctx.chat,
        "error",
        `${step.label}失败：${describeError(error)}`,
      );
      failed.push(step.label);
    }
  }

  appendBubble(
    ctx.chat,
    "assistant",
    `*一键完成：成功 ${done.length}/${steps.length}${failed.length ? `，失败：${failed.join("、")}` : ""}。所有结果已写入 AI 笔记。*`,
  );
  ctx.chat.scrollTop = ctx.chat.scrollHeight;
}

/**
 * Run a library-wide idea search and render the result.
 *
 * The dialog supplies the question and mode; this streams the analysis into
 * the chat and appends it to the note.
 */
async function runIdea(
  ctx: SectionContext,
  question: string,
  mode: SearchMode,
) {
  if (!isEnabled()) {
    appendBubble(ctx.chat, "error", "插件已在设置中停用。");
    return;
  }
  const key = `${ctx.target.id}:idea`;
  if (busySections.has(key)) return;
  busySections.add(key);

  ctx.stream = { cancelled: false, started: false };
  appendBubble(ctx.chat, "user", question);
  setBusy(ctx.root, true, "正在检索文献库…");

  const doc = ctx.root.ownerDocument!;
  const label = mode === "gap" ? "找研究空白" : mode === "conflict" ? "找结论冲突" : "找相邻工作";

  try {
    const result = await discoverIdeas(
      ctx.item,
      question,
      mode,
      {
        signal: ctx.stream,
        registerCancel: (cancel) => {
          ctx.stream.cancel = cancel;
        },
        onDelta: (delta, full) => {
          ctx.stream.started = true;
          let bubble = ctx.chat.querySelector<HTMLElement>(
            ".zai-bubble.streaming",
          );
          if (!bubble) {
            bubble = el(doc, "div", "zai-bubble assistant streaming");
            ctx.chat.appendChild(bubble);
          }
          bubble.innerHTML = markdownToHTML(full + delta);
          ctx.chat.scrollTop = ctx.chat.scrollHeight;
        },
      },
      ctx.modelOverride,
    );
    ctx.chat.querySelector(".zai-bubble.streaming")?.remove();

    // Summarise how many papers were actually examined.
    const bubble = el(doc, "div", "zai-bubble assistant");
    bubble.innerHTML = markdownToHTML(result.text);
    ctx.chat.appendChild(bubble);

    if (result.hits.length) {
      const meta = el(doc, "div", "zai-hint");
      meta.textContent = `检索到 ${result.hits.length} 篇相关文献`;
      bubble.appendChild(meta);
    }

    ctx.chat.scrollTop = ctx.chat.scrollHeight;

    if (result.hits.length) {
      await appendSection(ctx.target, {
        heading: label,
        body: result.text,
        accent: "#a855f7",
        meta: `基于文献库 ${result.hits.length} 篇相关文献`,
      });
    }
  } catch (error: any) {
    ctx.chat.querySelector(".zai-bubble.streaming")?.remove();
    appendBubble(ctx.chat, "error", describeError(error));
  } finally {
    busySections.delete(key);
    setBusy(ctx.root, false);
  }
}

async function sendQuestion(
  ctx: SectionContext,
  text: string,
  template?: PromptTemplate,
) {
  const question = text.trim();
  if (!question) return;
  if (!isEnabled()) {
    appendBubble(ctx.chat, "error", "插件已在设置中停用。");
    return;
  }
  const key = `${ctx.target.id}:ask`;
  if (busySections.has(key)) return;
  busySections.add(key);

  const history = getHistory(ctx.target.id);
  const previous = [...history];
  history.push({ role: "user", content: question });
  appendBubble(ctx.chat, "user", question);
  persist(ctx.target.id, { role: "user", content: question });
  ctx.root.querySelector<HTMLTextAreaElement>(".zai-input")!.value = "";
  ctx.stream = { cancelled: false, started: false };
  setBusy(ctx.root, true, "正在检索文献并思考…");

  const doc = ctx.root.ownerDocument!;
  let streamed = "";

  try {
    const answer = await askAboutItem(
      ctx.item,
      question,
      previous,
      {
        signal: ctx.stream,
        registerCancel: (cancel) => {
          ctx.stream.cancel = cancel;
        },
        onDelta: (delta, full) => {
          ctx.stream.started = true;
          streamed = full;
          let bubble = ctx.chat.querySelector<HTMLElement>(
            ".zai-bubble.streaming",
          );
          if (!bubble) {
            bubble = el(doc, "div", "zai-bubble assistant streaming");
            ctx.chat.appendChild(bubble);
          }
          bubble.innerHTML = markdownToHTML(full + delta);
          ctx.chat.scrollTop = ctx.chat.scrollHeight;
        },
      },
      template,
      ctx.modelOverride,
    );
    ctx.chat.querySelector(".zai-bubble.streaming")?.remove();
    const bubble = renderAnswer(doc, answer.text, ctx.target, ctx.attachmentID);
    ctx.chat.appendChild(bubble);
    ctx.chat.scrollTop = ctx.chat.scrollHeight;
    history.push({ role: "assistant", content: answer.text });
    if (history.length > 40) history.splice(0, history.length - 40);
    persist(ctx.target.id, {
      role: "assistant",
      content: answer.text,
      pages: answer.pages,
      time: Date.now(),
    });
  } catch (error: any) {
    ctx.chat.querySelector(".zai-bubble.streaming")?.remove();
    if (streamed) {
      // Keep whatever was produced before the failure.
      const bubble = el(doc, "div", "zai-bubble assistant");
      bubble.innerHTML = markdownToHTML(streamed);
      ctx.chat.appendChild(bubble);
    }
    appendBubble(
      ctx.chat,
      "error",
      describeError(error),
    );
  } finally {
    busySections.delete(key);
    setBusy(ctx.root, false);
  }
}

function renderSection(
  body: HTMLDivElement,
  item: Zotero.Item | undefined,
): void {
  const doc = body.ownerDocument!;
  body.replaceChildren();
  if (!item) return;
  ensureStyle(doc);

  const target = resolveTargetItem(item);
  const cfg = resolveConfig();
  const attachmentID = attachmentOf(target);

  const root = el(doc, "div", "zai-root");

  // The header line that used to sit here (version / model / budget) moved
  // into the preferences pane, so the pane starts directly with actions.  // Toolbar: grouped so nine actions stay readable in a narrow pane.
  const toolbar = el(doc, "div", "zai-toolbar");

  const makeButton = (
    label: string,
    action: ActionType,
    opts: { primary?: boolean; icon?: string; title?: string } = {},
  ) => {
    const cls = opts.primary ? "primary" : ACTION_CLASS[action] || "";
    const btn = el(doc, "button", `zai-btn${cls ? ` ${cls}` : ""}`);
    if (opts.icon) {
      const icon = el(doc, "span", "zai-btn-icon", opts.icon);
      btn.appendChild(icon);
    }
    btn.appendChild(el(doc, "span", "zai-btn-label", label));
    if (opts.title) btn.title = opts.title;
    btn.addEventListener("click", () => {
      void runAction(action, ctx);
    });
    return btn;
  };

  const addGroup = (caption: string, buttons: HTMLElement[]) => {
    const group = el(doc, "div", "zai-btn-group");
    group.appendChild(el(doc, "div", "zai-btn-group-title", caption));
    const row = el(doc, "div", "zai-btn-group-row");
    for (const b of buttons) row.appendChild(b);
    group.appendChild(row);
    toolbar.appendChild(group);
  };

  addGroup("阅读与理解", [
    makeButton("一键生成", "quick", {
      icon: "⚡",
      title: "一次生成摘要、标签与图表解读（可中途停止）",
    }),
    makeButton("摘要", "summary", {
      primary: true,
      icon: "📝",
      title: "根据全文生成结构化摘要",
    }),
    makeButton("翻译", "translate", { icon: "🌐", title: "翻译标题与摘要" }),
    makeButton("标签", "tags", { icon: "🏷️", title: "生成学术标签" }),
    makeButton("图表", "figures", { icon: "📊", title: "解读图表与表格" }),
  ]);

  addGroup("分析与发现", [
    makeButton("批判", "critique", { icon: "🔍", title: "方法学批判性评估" }),
    makeButton("找 idea", "idea", { icon: "✨", title: "在文献库中找研究空白" }),
  ]);

  const toolsRow = el(doc, "div", "zai-toolbar-tools");
  toolsRow.appendChild(
    makeButton("重新生成", "retry", { icon: "↻", title: "重复上一次操作" }),
  );
  toolsRow.appendChild(
    makeButton("打开笔记", "save", { icon: "📂", title: "定位到该条目的 AI 笔记" }),
  );
  const clearBtn = el(doc, "button", "zai-btn a-clear", "清空");
  clearBtn.title = "清空对话与 AI 笔记";
  clearBtn.addEventListener("click", () => {
    clearConversation(target.id);
    chats.delete(target.id);
    chat.replaceChildren();
    void resetNoteFor(target);
  });
  toolsRow.appendChild(clearBtn);
  toolbar.appendChild(toolsRow);

  const chat = el(doc, "div", "zai-chat");
  const busyLine = el(doc, "div", "zai-hint zai-busy");
  busyLine.style.display = "none";

  // Model picker: switches the model for this item without opening settings.
  //
  // Only the active profile's models are listed, so the picker stays short
  // and never offers a model belonging to another provider.
  const modelBar = el(doc, "div", "zai-modelbar");
  const modelSelect = el(doc, "select", "zai-model-select");

  const profileTag = el(doc, "span", "zai-profile-tag");
  const updateProfileTag = () => {
    const current = findProfile(getProviderId());
    if (!current) {
      profileTag.textContent = "";
      return;
    }
    const host = (current.baseURL || "")
      .replace("https://", "")
      .replace("http://", "")
      .split("/")[0];
    profileTag.textContent = `${current.name} · ${host}`;
    const style = current.style === "anthropic" ? "Claude Messages" : "OpenAI 兼容";
    profileTag.title = `${current.name} · ${style} · ${current.baseURL}`;
  };

  const placeholder = el(doc, "option", "", "跟随配置（默认模型）");
  placeholder.value = "";
  modelSelect.appendChild(placeholder);

  let activeProfileId = getProviderId();
  const cfgNow = resolveConfig(activeProfileId);

  // Only the active profile's models are listed, so the picker stays short.
  // Switching profiles from the settings pane changes what appears here.
  const models = loadModels(activeProfileId);
  for (const model of models) {
    const opt = el(doc, "option", "", model.name || model.id);
    opt.value = model.id;
    modelSelect.appendChild(opt);
  }

  if (cfgNow.model && !models.some((m) => m.id === cfgNow.model)) {
    const opt = el(doc, "option", "", cfgNow.model);
    opt.value = cfgNow.model;
    modelSelect.appendChild(opt);
  }

  if (cfgNow.model) modelSelect.value = cfgNow.model;
  modelSelect.addEventListener("change", () => {
    ctx.modelOverride = modelSelect.value || undefined;
    updateProfileTag();
  });

  updateProfileTag();
  modelBar.append(modelSelect, profileTag);

  // The settings pane can change the active profile while this pane is open,
  // so poll for it rather than assuming the value is stable.
  const profileWatcher = Zotero.getMainWindow().setInterval(() => {
    const current = getProviderId();
    if (current !== activeProfileId) {
      ctx.profileId = current;
      activeProfileId = current;
      ctx.modelOverride = undefined;
      const cfg = resolveConfig(current);
      const fresh = loadModels(current);
      modelSelect.replaceChildren();
      modelSelect.appendChild(placeholder);
      for (const model of fresh) {
        const opt = el(doc, "option", "", model.name || model.id);
        opt.value = model.id;
        modelSelect.appendChild(opt);
      }
      if (cfg.model) modelSelect.value = cfg.model;
      updateProfileTag();
    }
  }, 1200);
  Zotero.getMainWindow().addEventListener(
    "unload",
    () => Zotero.getMainWindow().clearInterval(profileWatcher),
  );
  const inputbar = el(doc, "div", "zai-inputbar");
  const input = el(doc, "textarea", "zai-input");
  input.placeholder = "针对这篇文献提问，例如：这篇论文的核心创新点是什么？";
  const sendBtn = el(doc, "button", "zai-btn primary", "发送");
  sendBtn.addEventListener("click", () => {
    void sendQuestion(ctx, input.value);
  });
  const stopBtn = el(doc, "button", "zai-btn zai-stop", "停止");
  stopBtn.style.display = "none";
  stopBtn.addEventListener("click", () => {
    ctx.stream.cancelled = true;
    // Abort the in-flight XHR right away instead of waiting for it to finish.
    try {
      ctx.stream.cancel?.();
    } catch {
      // already finished
    }
    stopBtn.disabled = true;
    stopBtn.textContent = "已停止";
  });
  input.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void sendQuestion(ctx, input.value);
    }
  });
  inputbar.appendChild(input);
  inputbar.appendChild(sendBtn);
  inputbar.appendChild(stopBtn);

  const hint = el(
    doc,
    "div",
    "zai-hint",
    "问答会检索该条目的 PDF/EPUB 全文（首次读取稍慢）。回答中的页码可点击跳转到阅读器。Enter 发送，Shift+Enter 换行。",
  );

  root.append(toolbar, chat, busyLine, modelBar, inputbar, hint);
  body.appendChild(root);

  const ctx: SectionContext = {
    root,
    chat,
    status: null as unknown as HTMLElement,
    item,
    target,
    attachmentID,
    profileId: activeProfileId,
    stream: { cancelled: false, started: false } as SectionContext["stream"],
  };

  // Restore the persisted conversation.
  ensureRegistered(target.id);
  // Migrate a legacy note (plain Markdown text) into structured HTML, so old
  // content gets the new formatting without being lost.
  void ensureNoteFormat(target);

  const history = getHistory(target.id);
  for (const message of history) {
    if (message.role === "user") appendBubble(chat, "user", message.content);
    else if (message.role === "assistant") {
      const bubble = renderAnswer(
        doc,
        message.content,
        target,
        attachmentID,
      );
      chat.appendChild(bubble);
    }
  }
  chat.scrollTop = chat.scrollHeight;
}

export function registerItemPaneSection() {
  const manager = (Zotero as any).ItemPaneManager;
  if (!manager?.registerSection) {
    ztoolkit.log("ItemPaneManager is not available in this Zotero version");
    return;
  }
  manager.registerSection({
    paneID: "zai-assistant",
    pluginID: config.addonID,
    header: {
      l10nID: getLocaleID("section-head"),
      icon: AI_ICON,
    },
    sidenav: {
      l10nID: getLocaleID("section-sidenav"),
      icon: AI_ICON,
    },
    onRender: ({ body, item }: { body: HTMLDivElement; item?: Zotero.Item }) => {
      try {
        renderSection(body, item);
      } catch (error) {
        ztoolkit.log("renderSection failed", error);
      }
    },
  });
}

function getContextItems(context: any): Zotero.Item[] {
  const items = context?.items;
  if (Array.isArray(items)) return items.filter((item: any) => item?.id);
  try {
    const pane = (Zotero as any).getActiveZoteroPane();
    return pane?.getSelectedItems?.() || [];
  } catch {
    return [];
  }
}

async function runMenuAction(
  action: MenuAction,
  items: Zotero.Item[],
) {
  const labels = {
    summary: "正在生成摘要",
    translate: "正在翻译标题与摘要",
    tags: "正在生成智能标签",
  };
  const total = items.length;
  const progress = new ztoolkit.ProgressWindow(config.addonName, {
    closeOtherProgressWindows: true,
    closeTime: -1,
  })
    .createLine({
      text: `${labels[action]}（0/${total}）`,
      type: "default",
      progress: 0,
    })
    .show();

  let done = 0;
  let failed = 0;

  for (const item of items) {
    progress.changeLine({
      text: `${labels[action]}（${done}/${total}）`,
      progress: Math.round((done / Math.max(1, total)) * 100),
    });
    try {
      if (action === "summary") {
        const result = await generateSummary(item, { save: true });
        progress.changeLine({
          text: `摘要已生成（${done + 1}/${total}），${describeSaved(result)}`,
          type: "success",
          progress: Math.round(((done + 1) / Math.max(1, total)) * 100),
        });
      } else if (action === "translate") {
        const result = await translateItem(item, { save: true });
        progress.changeLine({
          text: `翻译完成（${done + 1}/${total}），${describeSaved(result)}`,
          type: "success",
          progress: Math.round(((done + 1) / Math.max(1, total)) * 100),
        });
      } else {
        const result = await autoTagItem(item, { save: true });
        progress.changeLine({
          text: result.added.length
            ? `已添加标签（${done + 1}/${total}）：${result.added.join("、")}`
            : `标签均已存在（${done + 1}/${total}）`,
          type: "success",
          progress: Math.round(((done + 1) / Math.max(1, total)) * 100),
        });
      }
      done++;
    } catch (error: any) {
      failed++;
      const title = String(item.getField("title") || "").slice(0, 40);
      progress.changeLine({
        text: `失败（${done + 1}/${total}）${title}：${
          error?.message || error
        }`,
        type: "fail",
        progress: Math.round(((done + 1) / Math.max(1, total)) * 100),
      });
      done++;
    }
  }

  progress.changeLine({
    text: `完成：成功 ${done - failed}，失败 ${failed}`,
    type: failed ? "fail" : "success",
    progress: 100,
  });
  progress.startCloseTimer(6000);
}

type MenuAction = "summary" | "translate" | "tags";

/** Library-wide idea search from the context menu. */
async function runMenuIdea(
  seed: Zotero.Item | undefined,
  question: string,
  mode: SearchMode,
) {
  const progress = new ztoolkit.ProgressWindow(config.addonName, {
    closeOtherProgressWindows: true,
    closeTime: -1,
  })
    .createLine({ text: "正在检索文献库…", type: "default", progress: 30 })
    .show();

  try {
    const result = await discoverIdeas(seed, question, mode);
    progress.changeLine({
      text: `检索到 ${result.hits.length} 篇相关文献`,
      type: result.hits.length ? "success" : "default",
      progress: 100,
    });
    progress.startCloseTimer(4000);

    if (!result.hits.length) {
      new ztoolkit.ProgressWindow(config.addonName)
        .createLine({ text: "未检索到相关文献", type: "default" })
        .show();
      return;
    }

    const note = new Zotero.Item("note");
    note.libraryID = seed?.libraryID ?? Zotero.Libraries.userLibraryID;
    note.setNote(
      `<h1>找 idea · ${markdownToHTML(question)}</h1>\n<p>共检索到 ${result.hits.length} 篇相关文献。</p>\n${markdownToHTML(
        result.text,
      )}`,
    );
    await note.saveTx();
    new ztoolkit.ProgressWindow(config.addonName)
      .createLine({ text: "结果已保存为独立笔记", type: "success" })
      .show();
  } catch (error: any) {
    progress.changeLine({
      text: `失败：${describeError(error)}`,
      type: "fail",
      progress: 100,
    });
    progress.startCloseTimer(8000);
  }
}

/** Build a comparison matrix across several papers. */
async function runMatrix(items: Zotero.Item[]) {
  const progress = new ztoolkit.ProgressWindow(config.addonName, {
    closeOtherProgressWindows: true,
    closeTime: -1,
  })
    .createLine({
      text: `正在抽取 ${items.length} 篇文献的结构化字段…`,
      type: "default",
      progress: 20,
    })
    .show();

  try {
    const result = await buildLiteratureMatrix(items);
    progress.changeLine({
      text: `已抽取 ${result.entries.length} 篇文献`,
      type: "success",
      progress: 100,
    });
    progress.startCloseTimer(4000);

    if (!result.markdown) {
      new ztoolkit.ProgressWindow(config.addonName)
        .createLine({
          text: "模型未返回可解析的矩阵数据",
          type: "fail",
        })
        .show();
      return;
    }

    const first = items[0];
    const note = new Zotero.Item("note");
    note.libraryID = first.libraryID;
    note.setNote(
      `<h1>文献对比矩阵</h1>\n<p>共 ${result.entries.length} 篇，由 Zotero AI Assistant 生成。</p>\n${markdownToHTML(
        result.markdown,
      )}`,
    );
    await note.saveTx();
    new ztoolkit.ProgressWindow(config.addonName)
      .createLine({
        text: "矩阵已保存为独立笔记",
        type: "success",
      })
      .show();
  } catch (error: any) {
    progress.changeLine({
      text: `失败：${describeError(error)}`,
      type: "fail",
      progress: 100,
    });
    progress.startCloseTimer(8000);
  }
}

export function registerMenus() {
  const menuManager = (Zotero as any).MenuManager;
  if (!menuManager?.registerMenu) {
    ztoolkit.log("MenuManager is not available; skip menu registration");
    return;
  }

  const command = (action: MenuAction) => {
    return (_event: Event, context: any) => {
      const items = getContextItems(context);
      if (!items.length) {
        ztoolkit.log("No item selected for AI action");
        return;
      }
      void runMenuAction(action, items.slice(0, 20));
    };
  };

  try {
    menuManager.registerMenu({
      menuID: "zai-assistant",
      pluginID: config.addonID,
      target: "main/library/item",
      menus: [
        {
          menuType: "submenu",
          l10nID: getLocaleID("menu-root"),
          icon: AI_ICON,
          menus: [
            {
              menuType: "menuitem",
              l10nID: getLocaleID("menu-summary"),
              onCommand: command("summary"),
            },
            {
              menuType: "menuitem",
              l10nID: getLocaleID("menu-translate"),
              onCommand: command("translate"),
            },
            {
              menuType: "menuitem",
              l10nID: getLocaleID("menu-tags"),
              onCommand: command("tags"),
            },
            { menuType: "menuseparator" },
            {
              menuType: "menuitem",
              l10nID: getLocaleID("menu-idea"),
              onCommand: (_event: Event, context: any) => {
                const items = getContextItems(context);
                const seed = items[0];
                openIdeaDialog(Boolean(seed), (answer) => {
                  void runMenuIdea(seed, answer.question, answer.mode);
                });
              },
            },
            {
              menuType: "menuitem",
              l10nID: getLocaleID("menu-matrix"),
              onCommand: (_event: Event, context: any) => {
                const items = getContextItems(context);
                if (items.length < 2) {
                  new ztoolkit.ProgressWindow(config.addonName)
                    .createLine({
                      text: "请至少选中 2 篇文献再生成对比矩阵",
                      type: "default",
                    })
                    .show();
                  return;
                }
                void runMatrix(items.slice(0, 10));
              },
            },
          ],
        },
      ],
    });
  } catch (error) {
    ztoolkit.log("Failed to register AI menus", error);
  }
}
