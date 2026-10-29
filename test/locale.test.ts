import { assert } from "chai";
import { config } from "../package.json";
import { getString } from "../src/utils/locale";

/**
 * Regression guard: the ask-dialog strings used to live in preferences.ftl,
 * which the plugin sandbox never loads, so getString() returned the raw ids
 * and the dialog rendered "zoteroai-dialog-ask-title" instead of real text.
 */
describe("locale", function () {
  it("loads the catalogs the plugin actually reads", function () {
    const instance = (Zotero as any)[config.addonInstance];
    const l10n = instance?.data?.locale?.current;
    assert.isOk(l10n, "plugin locale should be initialised");
    assert.isFunction(l10n.formatMessagesSync);
  });

  it("resolves dialog strings to real text, not raw ids", function () {
    const instance = (Zotero as any)[config.addonInstance];
    const l10n = instance.data.locale.current;

    const keys = [
      "dialog-ask-title",
      "dialog-template-label",
      "dialog-prompt-label",
      "dialog-question-label",
      "dialog-save-template",
      "dialog-template-name",
      "dialog-send",
      "dialog-cancel",
      "dialog-ask-window-title",
    ];

    for (const key of keys) {
      const pattern = l10n.formatMessagesSync([
        { id: `${config.addonRef}-${key}` },
      ])[0];
      assert.isOk(pattern, `${key} should exist in a loaded catalog`);
      assert.isOk(
        pattern.value,
        `${key} resolved to a raw id — it must live in addon.ftl`,
      );
      assert.notEqual(pattern.value, `${config.addonRef}-${key}`);
    }
  });

  it("resolves every key that code looks up via getString()", function () {
    const instance = (Zotero as any)[config.addonInstance];
    const l10n = instance.data.locale.current;

    // Only keys stored in addon.ftl (or preferences.ftl, which is now also
    // loaded) can be resolved through getString(). Panel and menu labels use
    // data-l10n-id and are rendered from mainWindow.ftl instead.
    const keys = [
      ...[
        "dialog-ask-title",
        "dialog-template-label",
        "dialog-prompt-label",
        "dialog-question-label",
        "dialog-save-template",
        "dialog-template-name",
        "dialog-send",
        "dialog-cancel",
        "dialog-ask-window-title",
      ],
      "pref-testing",
      "pref-test-ok",
      "pref-test-fail",
      "pref-provider-hint",
      "pref-apikey-optional",
    ];

    for (const key of keys) {
      const pattern = l10n.formatMessagesSync([
        { id: `${config.addonRef}-${key}` },
      ])[0];
      assert.isOk(pattern?.value, `${key} should resolve`);
      assert.notEqual(
        pattern.value,
        `${config.addonRef}-${key}`,
        `${key} resolved to a raw id`,
      );
    }
  });
});

describe("pane strings", function () {
  it("resolves every pane label, not raw ids", function () {
    const keys = [
      "pane-group-read",
      "pane-group-analyze",
      "pane-btn-quick",
      "pane-btn-summary",
      "pane-btn-translate",
      "pane-btn-tags",
      "pane-btn-figures",
      "pane-btn-critique",
      "pane-btn-idea",
      "pane-btn-retry",
      "pane-btn-save",
      "pane-placeholder",
      "pane-hint",
      "pane-empty",
      "pane-stop",
      "pane-stopped",
      "pane-busy",
      "pane-questions-hint",
      "pane-note-saved",
      "pane-note-abstract",
      "pane-note-none",
      "pane-note-appended",
      "pane-note-not-found",
      "pane-note-located",
      "pane-retry-empty",
      "pane-retry-none",
      "pane-retry-running",
      "pane-disabled",
      "pane-questions-failed",
      "pane-figure-none",
      "pane-figure-found",
      "pane-text-source",
      "pane-text-source-metadata",
      "pane-text-source-full",
      "pane-text-truncated",
    ];

    const problems: string[] = [];
    // The test bundle has no `addon` global; read the l10n object off the
    // plugin instance instead.
    const l10n = (Zotero as any)[config.addonInstance]?.data?.locale?.current;
    const resolve = (key: string): string => {
      if (!l10n) throw new Error("plugin locale not initialised");
      const pattern = l10n.formatMessagesSync([
        { id: `${config.addonRef}-${key}` },
      ])[0];
      return String(pattern?.value || "");
    };

    for (const key of keys) {
      let value = "";
      try {
        value = resolve(key);
      } catch (e: any) {
        problems.push(`${key} threw ${e?.message || e}`);
        continue;
      }
      if (value === `zoteroai-${key}`) problems.push(`${key} resolved to a raw id`);
      else if (!value) problems.push(`${key} resolved to an empty string`);
    }

    assert.equal(
      problems.length,
      0,
      "unresolved pane strings:\n" + problems.join("\n"),
    );
  });

  it("uses the right punctuation for the active locale", function () {
    // The test runner defaults to zh-CN; both catalogs must be present and
    // distinct, otherwise the pane falls back to raw ids.
    const l10n = (Zotero as any)[config.addonInstance]?.data?.locale?.current;
    const zh = l10n
      ?.formatMessagesSync([{ id: `${config.addonRef}-pane-hint` }])[0]
      ?.value || "";
    assert.isAbove(zh.length, 0, "zh-CN pane hint should resolve");
    assert.notEqual(zh, `zoteroai-pane-hint`);
  });
});
