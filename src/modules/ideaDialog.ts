import { config } from "../../package.json";
import { SearchMode, searchModeLabel } from "../services/librarySearch";
import { PromptTemplate } from "./askDialog";

/**
 * Idea discovery dialog.
 *
 * The user describes what they are looking for, picks a mode, and optionally
 * uses the selected paper as the seed. The prompt template selector is shared
 * with the ask dialog so a tuned prompt carries over.
 */

export interface IdeaDialogResult {
  question: string;
  mode: SearchMode;
  template?: PromptTemplate;
}

export function ideaModes(): SearchMode[] {
  return ["gap", "conflict", "extend"];
}

const MODE_HINTS: Record<SearchMode, string> = {
  gap: "在文献库中找「被提到但没被解决」的问题，输出潜在研究空白。",
  conflict: "找结论互相矛盾的文献，分析差异来源并给出验证思路。",
  extend: "以当前选中的文献为种子，找可借鉴或延伸的相邻工作。",
};

export function openIdeaDialog(
  hasSelection: boolean,
  onSubmit: (result: IdeaDialogResult) => void,
): void {
  const dialogData: any = {
    mode: "gap",
    questionText: "",
    loadCallback: () => {
      const question = dialogHelper.window.document.querySelector(
        "#zai-idea-question",
      ) as HTMLTextAreaElement | null;
      question?.focus();
      updateHint();
    },
  };

  function updateHint() {
    const hint = dialogHelper.window.document.querySelector("#zai-idea-hint");
    if (hint) hint.innerHTML = MODE_HINTS[dialogData.mode as SearchMode];
  }

  const dialogHelper = new ztoolkit.Dialog(5, 1)
    .addCell(0, 0, {
      tag: "h2",
      properties: { innerHTML: "在文献库中找 idea" },
    })
    .addCell(1, 0, {
      tag: "div",
      styles: { display: "flex", flexWrap: "wrap", gap: "6px" },
      children: ideaModes().map((mode: SearchMode) => ({
        tag: "button",
        namespace: "html",
        id: `zai-mode-${mode}`,
        styles: {
          border: "1px solid #d1d5db",
          background: "#fff",
          borderRadius: "7px",
          padding: "5px 11px",
          fontSize: "12px",
          cursor: "pointer",
        },
        properties: { innerHTML: searchModeLabel(mode) },
        listeners: [
          {
            type: "click",
            listener: () => {
              dialogData.mode = mode;
              for (const m of ideaModes()) {
                const btn = dialogHelper.window.document.querySelector(
                  `#zai-mode-${m}`,
                ) as HTMLElement | null;
                if (!btn) continue;
                const active = m === mode;
                btn.style.background = active ? "#4f6ef7" : "#fff";
                btn.style.color = active ? "#fff" : "#334155";
                btn.style.borderColor = active ? "#4f6ef7" : "#d1d5db";
                btn.style.fontWeight = active ? "600" : "400";
              }
              updateHint();
            },
          },
        ],
      })),
    })
    .addCell(2, 0, {
      tag: "div",
      children: [
        {
          tag: "label",
          namespace: "html",
          attributes: { for: "zai-idea-question" },
          properties: { innerHTML: "你想找什么？" },
        },
        {
          tag: "textarea",
          namespace: "html",
          id: "zai-idea-question",
          styles: {
            width: "100%",
            minHeight: "84px",
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            padding: "7px 9px",
            fontSize: "12.5px",
            boxSizing: "border-box",
          },
          attributes: { "data-bind": "questionText", "data-prop": "value" },
        },
        {
          tag: "div",
          namespace: "html",
          id: "zai-idea-hint",
          styles: { fontSize: "11px", color: "#6b7280", marginTop: "3px" },
          properties: { innerHTML: MODE_HINTS.gap },
        },
        {
          tag: "div",
          namespace: "html",
          id: "zai-idea-note",
          styles: {
            fontSize: "11px",
            color: "#6b7280",
            marginTop: "6px",
            display: hasSelection ? "block" : "none",
          },
          properties: {
            innerHTML: "「找相邻工作」模式会以当前选中的文献为种子扩展检索范围。",
          },
        },
      ],
    })
    .addButton("取消", "zai-cancel")
    .addButton("开始检索", "zai-go")
    .setDialogData(dialogData)
    .open("Zotero AI · 找 idea", {
      centerscreen: true,
      resizable: true,
      width: 520,
      height: 460,
    });

  // Highlight the default mode once the window is up.
  dialogData.loadLock?.promise.then(() => {
    const btn = dialogHelper.window.document.querySelector("#zai-mode-gap") as HTMLElement | null;
    if (btn) {
      btn.style.background = "#4f6ef7";
      btn.style.color = "#fff";
      btn.style.borderColor = "#4f6ef7";
      btn.style.fontWeight = "600";
    }
  });

  void dialogData.unloadLock.promise.then(() => {
    const question = (dialogData.questionText || "").trim();
    if (dialogData._lastButtonId === "zai-go" && question) {
      onSubmit({ question, mode: dialogData.mode as SearchMode });
    }
  });
}
