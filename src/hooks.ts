import { config } from "../package.json";
import { registerItemPaneSection, registerMenus } from "./modules/ui";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { getString, initLocale } from "./utils/locale";
import { createZToolkit } from "./utils/ztoolkit";

let notifierID: string | false | undefined;

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  // Preferences pane
  try {
    await Zotero.PreferencePanes.register({
      pluginID: config.addonID,
      src: rootURI + "content/preferences.xhtml",
      label: getString("prefs-title"),
      image: `chrome://${config.addonRef}/content/icons/favicon.png`,
      stylesheets: [rootURI + "content/preferences.css"],
    });
  } catch (error) {
    Zotero.logError(error as Error);
  }

  // Item pane section (library + reader)
  registerItemPaneSection();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Context menu (official Zotero.MenuManager API, Zotero 8+)
  registerMenus();

  // Invalidate cached full text when attachments are modified.
  try {
    notifierID = Zotero.Notifier.registerObserver(
      {
        notify: async (event, type, ids, extraData) => {
          await onNotify(event, type, ids as Array<string | number>, extraData);
        },
      },
      ["item"],
      config.addonRef,
    );
  } catch (error) {
    ztoolkit.log("Failed to register notifier", error);
  }

  addon.data.initialized = true;
  ztoolkit.log(`${config.addonName} started`);
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();

  try {
    win.MozXULElement.insertFTLIfNeeded(
      `${config.addonRef}-mainWindow.ftl`,
    );
  } catch (error) {
    ztoolkit.log("Failed to load main window FTL", error);
  }
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  // The assistant keeps no per-window UI state of its own.
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  if (notifierID) {
    try {
      Zotero.Notifier.unregisterObserver(notifierID);
    } catch (error) {
      ztoolkit.log("Failed to unregister notifier", error);
    }
    notifierID = undefined;
  }

  try {
    (Zotero as any).ItemPaneManager?.unregisterSection?.("zai-assistant");
    (Zotero as any).MenuManager?.unregisterMenu?.("zai-assistant");
  } catch (error) {
    ztoolkit.log("Failed to unregister UI", error);
  }

  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[config.addonInstance];
}

/**
 * Dispatcher for notifier events. Used to invalidate cached full text when an
 * attachment changes.
 */
async function onNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  _extraData: { [key: string]: any },
) {
  if (event !== "modify" || type !== "item") return;
  try {
    for (const id of ids) {
      const item = Zotero.Items.get(Number(id));
      if (!item) continue;
      if (item.isAttachment() && item.parentID) {
        addon.data.invalidateText(item.parentID);
      } else if (item.isRegularItem()) {
        addon.data.invalidateText(item.id);
      }
    }
  } catch (error) {
    ztoolkit.log("Notifier error", error);
  }
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  if (type === "load") {
    registerPrefsScripts(data.window);
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
};
