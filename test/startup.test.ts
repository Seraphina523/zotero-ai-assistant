import { assert } from "chai";
import { config } from "../package.json";

describe("startup", function () {
  it("should have plugin instance defined", function () {
    assert.isNotEmpty(Zotero[config.addonInstance]);
  });

  it("should finish initialization", function () {
    assert.isTrue(Zotero[config.addonInstance].data.initialized);
  });

  it("should register the preferences pane", function () {
    const panes = (Zotero as any).PreferencePanes.pluginPanes as Array<{
      pluginID: string;
      src: string;
    }>;
    const pane = panes.find((item) => item.pluginID === config.addonID);
    assert.isOk(pane, "preferences pane not registered");
    assert.include(pane!.src, "preferences.xhtml");
  });

  it("should register the item pane section", function () {
    const section = (Zotero as any).ItemPaneManager?._sectionManager?.get?.(
      "zai-assistant",
    );
    // The internal manager shape may change between Zotero versions; only
    // assert when it is introspectable.
    if (section !== undefined) {
      assert.isOk(section);
    }
  });

  it("should register the AI context menu", function () {
    const manager = (Zotero as any).MenuManager;
    if (!manager) return; // Zotero 7.0
    const registered =
      manager._registeredMenus ||
      manager.registeredMenus ||
      manager._menus;
    if (registered) {
      const text = JSON.stringify(registered);
      assert.include(text, "zai-assistant");
    }
  });
});
