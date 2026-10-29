import { TranslateScope } from "../ai/features";

/**
 * Selective translation dialog.
 *
 * Lets the user choose what to translate (title / abstract / free text) and
 * the target language, instead of always translating title + abstract.
 */

export interface TranslateDialogResult {
  scope: TranslateScope;
}

const LANGS: Array<{ value: "" | "zh" | "en"; label: string }> = [
  { value: "", label: "自动（中→英，其他→中）" },
  { value: "zh", label: "简体中文" },
  { value: "en", label: "English" },
];

export function openTranslateDialog(
  hasTitle: boolean,
  hasAbstract: boolean,
  onSubmit: (result: TranslateDialogResult) => void,
): void {
  const dialogData: any = {
    title: hasTitle,
    abstract: hasAbstract,
    custom: "",
    target: "",
  };

  const dialogHelper = new ztoolkit.Dialog(5, 1)
    .addCell(0, 0, {
      tag: "h2",
      properties: { innerHTML: "选择性翻译" },
    })
    .addCell(1, 0, {
      tag: "div",
      styles: { display: "flex", flexDirection: "column", gap: "6px" },
      children: [
        checkboxRow("zai-tr-title", "标题", hasTitle, "title"),
        checkboxRow("zai-tr-abstract", "摘要", hasAbstract, "abstract"),
      ],
    })
    .addCell(2, 0, {
      tag: "div",
      children: [
        {
          tag: "label",
          namespace: "html",
          attributes: { for: "zai-tr-custom" },
          properties: {
            innerHTML: "附加文本（可选）：粘贴段落、图表说明或任意片段",
          },
        },
        {
          tag: "textarea",
          namespace: "html",
          id: "zai-tr-custom",
          styles: {
            width: "100%",
            minHeight: "110px",
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            padding: "7px 9px",
            fontSize: "12.5px",
            boxSizing: "border-box",
          },
          attributes: { "data-bind": "custom", "data-prop": "value" },
        },
      ],
    })
    .addCell(3, 0, {
      tag: "div",
      styles: { display: "flex", gap: "8px", alignItems: "center" },
      children: [
        {
          tag: "label",
          namespace: "html",
          attributes: { for: "zai-tr-target" },
          properties: { innerHTML: "目标语言" },
        },
        {
          tag: "select",
          namespace: "html",
          id: "zai-tr-target",
          styles: {
            flex: "1",
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            padding: "5px 7px",
            fontSize: "12px",
          },
          children: LANGS.map((lang) => ({
            tag: "option",
            properties: { innerHTML: lang.label, value: lang.value },
          })),
          attributes: { "data-bind": "target", "data-prop": "value" },
        },
      ],
    })
    .addButton("取消", "zai-cancel")
    .addButton("开始翻译", "zai-go")
    .setDialogData(dialogData)
    .open("Zotero AI · 选择性翻译", {
      centerscreen: true,
      resizable: true,
      width: 520,
      height: 520,
    });

  void dialogData.unloadLock.promise.then(() => {
    if (dialogData._lastButtonId !== "zai-go") return;
    const scope: TranslateScope = {
      title: Boolean(dialogData.title),
      abstract: Boolean(dialogData.abstract),
      custom: String(dialogData.custom || "").trim() || undefined,
      target: dialogData.target === "zh" || dialogData.target === "en"
        ? dialogData.target
        : undefined,
    };
    if (!scope.title && !scope.abstract && !scope.custom) return;
    onSubmit({ scope });
  });

  function checkboxRow(
    id: string,
    label: string,
    checked: boolean,
    bindKey: string,
  ) {
    return {
      tag: "label",
      namespace: "html",
      attributes: { for: id },
      styles: { display: "flex", alignItems: "center", gap: "6px" },
      children: [
        {
          tag: "input",
          namespace: "html",
          id,
          attributes: {
            type: "checkbox",
            "data-bind": bindKey,
            "data-prop": "checked",
          },
          properties: { checked },
        },
        {
          tag: "span",
          properties: {
            innerHTML: checked ? label : `${label}（该条目没有）`,
          },
          styles: { opacity: checked ? "1" : ".5" },
        },
      ],
    };
  }
}
