import { assert } from "chai";
import { config } from "../package.json";

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
