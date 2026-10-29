import { getPref, setPref } from "../utils/prefs";
import { buildItemContext } from "../services/itemText";

/**
 * Conversation persistence.
 *
 * Each item gets one JSON blob stored in the plugin preference store. The
 * payload is small (messages + metadata), so keeping it in prefs avoids
 * creating a note per conversation.
 */

const MAX_MESSAGES = 60;
const STORAGE_VERSION = 1;

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  /** Page numbers cited in this message, if any. */
  pages?: number[];
  /** When the message was produced. */
  time?: number;
}

export interface Conversation {
  version: number;
  itemID: number;
  libraryID: number;
  title?: string;
  createdAt: number;
  updatedAt: number;
  source?: string;
  messages: StoredMessage[];
}

export interface ConversationSummary {
  itemID: number;
  libraryID: number;
  title: string;
  updatedAt: number;
  count: number;
  source?: string;
}

function storageKey(itemID: number): string {
  return `chat.${itemID}`;
}

export function getConversation(itemID: number): Conversation | null {
  try {
    const raw = getPref<string>(storageKey(itemID), "");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.messages)) return null;
    return {
      version: STORAGE_VERSION,
      itemID: parsed.itemID ?? itemID,
      libraryID: parsed.libraryID ?? 1,
      title: parsed.title,
      createdAt: parsed.createdAt ?? 0,
      updatedAt: parsed.updatedAt ?? 0,
      source: parsed.source,
      messages: parsed.messages.slice(0, MAX_MESSAGES),
    };
  } catch {
    return null;
  }
}

export function appendMessage(
  item: Zotero.Item,
  message: StoredMessage,
  source?: string,
): Conversation {
  const existing = getConversation(item.id);
  const now = Date.now();
  const messages = [...(existing?.messages || []), message].slice(
    -MAX_MESSAGES,
  );
  const conversation: Conversation = {
    version: STORAGE_VERSION,
    itemID: item.id,
    libraryID: item.libraryID,
    title: String(item.getField("title") || "").slice(0, 200),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    source: source ?? existing?.source,
    messages,
  };
  setPref(storageKey(item.id), JSON.stringify(conversation));
  return conversation;
}

export function replaceLastMessage(
  item: Zotero.Item,
  message: StoredMessage,
): Conversation | null {
  const existing = getConversation(item.id);
  if (!existing) return null;
  const messages = existing.messages.slice(0, -1);
  messages.push(message);
  const conversation: Conversation = {
    ...existing,
    messages,
    updatedAt: Date.now(),
  };
  setPref(storageKey(item.id), JSON.stringify(conversation));
  return conversation;
}

export function clearConversation(itemID: number) {
  setPref(storageKey(itemID), "");
}

/** Summaries of every stored conversation, newest first. */
export function listConversations(): ConversationSummary[] {
  const summaries: ConversationSummary[] = [];
  try {
    // Enumerate stored conversation keys through the item list: we keep a
    // registry of known conversations to avoid scanning all prefs.
    const registry = getPref<string>("chatRegistry", "[]");
    const ids: number[] = JSON.parse(registry);
    for (const id of ids) {
      const conversation = getConversation(id);
      if (conversation) summaries.push(toSummary(conversation));
    }
  } catch {
    // ignore malformed registry
  }
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

function toSummary(conversation: Conversation): ConversationSummary {
  return {
    itemID: conversation.itemID,
    libraryID: conversation.libraryID,
    title: conversation.title || "(无标题)",
    updatedAt: conversation.updatedAt,
    count: conversation.messages.length,
    source: conversation.source,
  };
}

function registerConversation(itemID: number) {
  try {
    const registry = getPref<string>("chatRegistry", "[]");
    const ids: number[] = JSON.parse(registry);
    if (!ids.includes(itemID)) {
      ids.push(itemID);
      setPref("chatRegistry", JSON.stringify(ids.slice(-200)));
    }
  } catch {
    // ignore
  }
}

export function ensureRegistered(itemID: number) {
  registerConversation(itemID);
}

/** Convert a stored conversation into API history. */
export function toHistory(conversation: Conversation | null) {
  if (!conversation) return [];
  return conversation.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

