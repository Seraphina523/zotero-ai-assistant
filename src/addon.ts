import { config } from "../package.json";
import hooks from "./hooks";
import { resolveTargetItem, invalidateItemText } from "./services/itemText";
import { createZToolkit } from "./utils/ztoolkit";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    env: "development" | "production";
    initialized?: boolean;
    ztoolkit: ZToolkit;
    locale?: {
      current: any;
    };
    /** Invalidate the cached full text of the item behind an attachment. */
    invalidateText: (itemID: number) => void;
  };
  public hooks: typeof hooks;
  public api: {
    resolveTargetItem: typeof resolveTargetItem;
    invalidateItemText: typeof invalidateItemText;
  };

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
      ztoolkit: createZToolkit(),
      invalidateText: (itemID: number) => invalidateItemText(itemID),
    };
    this.hooks = hooks;
    this.api = {
      resolveTargetItem,
      invalidateItemText,
    };
  }
}

export default Addon;
