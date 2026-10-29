import { config } from "../../package.json";
import { SuggestedQuestion } from "../ai/analysis";
import { resolveTargetItem } from "../services/itemText";
import { getString } from "../utils/locale";

/**
 * Prompt templates offered in the ask dialog.
 *
 * Users can pick one, or edit it freely. Custom templates are remembered so a
 * tuned prompt survives between sessions.
 */

export interface PromptTemplate {
  id: string;
  /** Label shown in the selector. */
  label: string;
  /** System prompt. */
  system: string;
  /** Question prefix placed before the user's text. */
  prefix: string;
  /** Hint shown under the textarea. */
  hint: string;
  /** Whether this template asks for page citations. */
  citePages: boolean;
}

export const BUILT_IN_TEMPLATES: PromptTemplate[] = [
  {
    id: "paper-qa",
    label: "论文精读问答",
    system: `你是一名阅读助手，正在帮助用户理解一篇学术文献。
仅根据提供的文献内容回答；如果文中没有相关信息，请明确说明“文献中未提及”。
引用规则：每条关键结论后用方括号标注页码，例如 [p.4]；跨页用 [p.4–6]。
不要编造页码；如果检索片段没有页码，直接陈述即可。`,
    prefix: "",
    hint: "针对这篇文献提问，AI 会检索全文并给出带页码的回答。",
    citePages: true,
  },
  {
    id: "explain",
    label: "通俗讲解",
    system: `你是一名善于把复杂概念讲清楚的老师。
用通俗的语言解释文献中的方法、公式和实验，必要时用类比。
避免堆砌术语；第一次出现的术语要简短解释。`,
    prefix: "请用通俗的语言解释：",
    hint: "适合第一次接触该领域，或想快速抓住核心思想。",
    citePages: true,
  },
  {
    id: "compare",
    label: "对比与辨析",
    system: `你是一名擅长对比分析的研究者。
当用户提到多篇文献或多个方法时，从研究问题、方法、数据、结论、局限五个维度对比。
明确指出它们的异同，以及各自更适合什么场景。`,
    prefix: "请对比：",
    hint: "适合梳理同一问题的不同解法。",
    citePages: true,
  },
  {
    id: "reproduce",
    label: "复现指南",
    system: `你是一名注重可复现性的工程向导。
根据文献内容，列出复现该工作需要的步骤：环境依赖、数据准备、模型结构要点、训练配置、评价方式。
文献没写清楚的地方，明确标注“原文未给出，需自行确定”。`,
    prefix: "请给出复现步骤：",
    hint: "适合决定要不要跟着做一遍。",
    citePages: true,
  },
  {
    id: "weakness",
    label: "找漏洞",
    system: `你是一名挑剔的审稿人。
专注于找出这篇论文的薄弱环节：实验设计、样本、基线、指标定义、结论外推。
每条批评都要指出原文中的具体位置或原文的沉默，不要泛泛而谈。`,
    prefix: "请指出问题：",
    hint: "适合投稿前自查，或批判性阅读。",
    citePages: true,
  },
  {
    id: "custom",
    label: "自定义",
    system: "",
    prefix: "",
    hint: "在下方输入你自己的提示词。",
    citePages: false,
  },
];

const CUSTOM_KEY = "customPrompts";
const ACTIVE_KEY = "activePromptId";

export function loadCustomTemplates(): PromptTemplate[] {
  try {
    const raw = Zotero.Prefs.get(
      `${config.prefsPrefix}.${CUSTOM_KEY}`,
      true,
    );
    if (!raw) return [];
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) => item && typeof item.id === "string" && typeof item.system === "string",
    );
  } catch {
    return [];
  }
}

export function saveCustomTemplates(templates: PromptTemplate[]) {
  Zotero.Prefs.set(
    `${config.prefsPrefix}.${CUSTOM_KEY}`,
    JSON.stringify(templates),
    true,
  );
}

export function getTemplates(): PromptTemplate[] {
  return [...BUILT_IN_TEMPLATES, ...loadCustomTemplates()];
}

export function getActiveTemplateId(): string {
  const id = Zotero.Prefs.get(`${config.prefsPrefix}.${ACTIVE_KEY}`, true);
  return typeof id === "string" && id ? id : "paper-qa";
}

export function setActiveTemplateId(id: string) {
  Zotero.Prefs.set(`${config.prefsPrefix}.${ACTIVE_KEY}`, id, true);
}

export function findTemplate(id: string): PromptTemplate {
  return getTemplates().find((template) => template.id === id) || BUILT_IN_TEMPLATES[0];
}

export interface AskDialogResult {
  question: string;
  template: PromptTemplate;
  /** Whether the user added a new custom template. */
  savedTemplate?: PromptTemplate;
}

export interface AskDialogData {
  questions: SuggestedQuestion[];
  onSubmit: (result: AskDialogResult) => void;
}

/**
 * Open the ask dialog.
 *
 * Shows suggested questions, a prompt-template selector and an editable
 * prompt body, then hands the result back to the caller.
 */
export function openAskDialog(
  item: Zotero.Item,
  questions: SuggestedQuestion[],
  onSubmit: (result: AskDialogResult) => void,
): void {
  const templates = getTemplates();
  const activeId = getActiveTemplateId();
  const active = findTemplate(activeId);

  const dialogData: AskDialogData & {
    [key: string]: any;
    templateId: string;
    promptText: string;
    questionText: string;
  } = {
    questions,
    onSubmit,
    templateId: active.id,
    promptText: active.system,
    questionText: "",
    loadCallback: () => {
      // Fill the prompt editor once the window is up.
      const promptArea = dialogHelper.window.document.querySelector(
        "#zai-prompt",
      ) as HTMLTextAreaElement | null;
      if (promptArea) {
        promptArea.value = active.system;
        promptArea.dispatchEvent(new dialogHelper.window.Event("input"));
      }
      const questionInput = dialogHelper.window.document.querySelector(
        "#zai-question",
      ) as HTMLTextAreaElement | null;
      if (questionInput) {
        questionInput.focus();
      }
    },
  };

  const dialogHelper = new ztoolkit.Dialog(6, 1)
    .addCell(0, 0, {
      tag: "h2",
      properties: { innerHTML: getString("dialog-ask-title") },
    });

  // Suggested questions, if any were generated.
  if (questions.length) {
    dialogHelper.addCell(1, 0, {
      tag: "div",
      styles: { display: "flex", flexWrap: "wrap", gap: "6px" },
      children: questions.map((entry, index) => ({
        tag: "button",
        namespace: "html",
        styles: {
          border: "1px solid rgba(6,182,212,.3)",
          background: "#ecfeff",
          color: "#0e7490",
          borderRadius: "7px",
          padding: "5px 9px",
          fontSize: "12px",
          cursor: "pointer",
        },
        properties: { innerHTML: entry.label || entry.question },
        attributes: { title: entry.reason || "" },
        listeners: [
          {
            type: "click",
            listener: () => {
              const input = dialogHelper.window.document.querySelector(
                "#zai-question",
              ) as HTMLTextAreaElement | null;
              if (input) {
                input.value = entry.question;
                input.focus();
                input.dispatchEvent(new dialogHelper.window.Event("input"));
              }
            },
          },
        ],
      })),
    });
  }

  dialogHelper
    .addCell(2, 0, {
      tag: "label",
      namespace: "html",
      attributes: { for: "zai-template" },
      properties: { innerHTML: getString("dialog-template-label") },
    })
    .addCell(3, 0, {
      tag: "div",
      styles: { display: "flex", gap: "8px", alignItems: "flex-start" },
      children: [
        {
          tag: "select",
          namespace: "html",
          id: "zai-template",
          styles: {
            flex: "0 0 168px",
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            padding: "5px 7px",
            fontSize: "12px",
          },
          children: templates.map((template) => ({
            tag: "option",
            properties: { innerHTML: template.label, value: template.id },
          })),
          attributes: { "data-bind": "templateId", "data-prop": "value" },
          listeners: [
            {
              type: "change",
              listener: (event: Event) => {
                const value = (event.target as HTMLSelectElement).value;
                const template = findTemplate(value);
                const promptArea = dialogHelper.window.document.querySelector(
                  "#zai-prompt",
                ) as HTMLTextAreaElement | null;
                if (promptArea) {
                  promptArea.value = template.system;
                  promptArea.dispatchEvent(new dialogHelper.window.Event("input"));
                }
                dialogData.templateId = value;
                setActiveTemplateId(value);
                const hint = dialogHelper.window.document.querySelector(
                  "#zai-hint",
                );
                if (hint) hint.innerHTML = template.hint;
              },
            },
          ],
        },
        {
          tag: "button",
          namespace: "html",
          properties: { innerHTML: getString("dialog-save-template") },
          styles: {
            border: "1px solid #d1d5db",
            background: "#fff",
            borderRadius: "6px",
            padding: "5px 10px",
            fontSize: "12px",
            cursor: "pointer",
          },
          listeners: [
            {
              type: "click",
              listener: () => {
                const promptArea = dialogHelper.window.document.querySelector(
                  "#zai-prompt",
                ) as HTMLTextAreaElement | null;
                const body = promptArea?.value || "";
                if (!body.trim()) return;
                const name = dialogHelper.window.prompt(
                  getString("dialog-template-name"),
                );
                if (!name) return;
                const template: PromptTemplate = {
                  id: `custom-${Date.now()}`,
                  label: name.slice(0, 24),
                  system: body,
                  prefix: "",
                  hint: "自定义提示词。",
                  citePages: false,
                };
                const custom = loadCustomTemplates();
                custom.push(template);
                saveCustomTemplates(custom);
                dialogData.savedTemplate = template;
                const select = dialogHelper.window.document.querySelector(
                  "#zai-template",
                ) as HTMLSelectElement | null;
                if (select) {
                  const option = dialogHelper.window.document.createElement("option");
                  option.value = template.id;
                  option.textContent = template.label;
                  select.appendChild(option);
                  select.value = template.id;
                }
              },
            },
          ],
        },
      ],
    })
    .addCell(4, 0, {
      tag: "div",
      children: [
        {
          tag: "label",
          namespace: "html",
          attributes: { for: "zai-prompt" },
          properties: { innerHTML: getString("dialog-prompt-label") },
        },
        {
          tag: "textarea",
          namespace: "html",
          id: "zai-prompt",
          styles: {
            width: "100%",
            minHeight: "96px",
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            padding: "7px 9px",
            fontSize: "12px",
            fontFamily: "ui-monospace, monospace",
            boxSizing: "border-box",
          },
          attributes: { "data-bind": "promptText", "data-prop": "value" },
        },
        {
          tag: "div",
          namespace: "html",
          id: "zai-hint",
          styles: { fontSize: "11px", color: "#6b7280", marginTop: "3px" },
          properties: { innerHTML: active.hint },
        },
        {
          tag: "label",
          namespace: "html",
          attributes: { for: "zai-question" },
          properties: { innerHTML: getString("dialog-question-label") },
          styles: { marginTop: "8px" },
        },
        {
          tag: "textarea",
          namespace: "html",
          id: "zai-question",
          styles: {
            width: "100%",
            minHeight: "64px",
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            padding: "7px 9px",
            fontSize: "12.5px",
            boxSizing: "border-box",
          },
          attributes: { "data-bind": "questionText", "data-prop": "value" },
        },
      ],
    })
    .addButton(getString("dialog-cancel"), "zai-cancel")
    .addButton(getString("dialog-send"), "zai-send")
    .setDialogData(dialogData)
    .open(getString("dialog-ask-window-title"), {
      centerscreen: true,
      resizable: true,
      width: 520,
      height: 620,
    });

  // The send button must not close the window before we read the values.
  void dialogData.unloadLock.promise.then(() => {
    const template = findTemplate(dialogData.templateId || active.id);
    const question = (dialogData.questionText || "").trim();
    if (dialogData._lastButtonId === "zai-send" && question) {
      onSubmit({ question, template, savedTemplate: dialogData.savedTemplate });
    }
  });
}
