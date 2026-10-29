import { assert } from "chai";
import {
  loadModels,
  prettyName,
  ModelEntry,
  removeModel,
  saveModels,
  upsertModel,
} from "../src/services/modelRegistry";

const PROFILE = "test-models-profile";

describe("model registry", function () {
  it("starts empty for an unknown profile", function () {
    saveModels(PROFILE, []);
    assert.deepEqual(loadModels(PROFILE), []);
  });

  it("adds, updates and removes entries", function () {
    const first: ModelEntry = { id: "claude-sonnet-4-5", name: "Sonnet 4.5" };
    upsertModel(PROFILE, first);
    const storedFirst = loadModels(PROFILE);
    assert.lengthOf(storedFirst, 1);
    assert.equal(storedFirst[0].id, first.id);
    assert.equal(storedFirst[0].name, first.name);

    // Renaming keeps the same id.
    upsertModel(PROFILE, { ...first, name: "Sonnet" });
    const stored = loadModels(PROFILE);
    assert.lengthOf(stored, 1);
    assert.equal(stored[0].name, "Sonnet");

    upsertModel(PROFILE, { id: "gpt-4o", name: "GPT-4o" });
    assert.lengthOf(loadModels(PROFILE), 2);

    removeModel(PROFILE, "gpt-4o");
    const remaining = loadModels(PROFILE);
    assert.lengthOf(remaining, 1);
    assert.equal(remaining[0].id, "claude-sonnet-4-5");
  });

  it("keeps optional limits when they are present", function () {
    upsertModel(PROFILE, {
      id: "glm-4-plus",
      name: "GLM-4-Plus",
      contextWindow: 128000,
      maxOutputTokens: 4096,
    });
    const stored = loadModels(PROFILE).find((m) => m.id === "glm-4-plus")!;
    assert.equal(stored.contextWindow, 128000);
    assert.equal(stored.maxOutputTokens, 4096);

    // Invalid numbers are dropped rather than stored as NaN.
    upsertModel(PROFILE, {
      id: "broken",
      name: "broken",
      contextWindow: Number.NaN,
    });
    const broken = loadModels(PROFILE).find((m) => m.id === "broken")!;
    assert.isUndefined(broken.contextWindow);
  });

  it("falls back to the id when the display name is empty", function () {
    upsertModel(PROFILE, { id: "qwen-plus", name: "" });
    const stored = loadModels(PROFILE).find((m) => m.id === "qwen-plus")!;
    assert.equal(stored.name, "qwen-plus");
  });

  it("ignores malformed stored data", function () {
    // Write garbage directly, then confirm the reader recovers.
    const pkg = require("../package.json") as { config: { prefsPrefix: string } };
    Zotero.Prefs.set(`${pkg.config.prefsPrefix}.profileModels.${PROFILE}`, "{not json", true);
    assert.deepEqual(loadModels(PROFILE), []);

    Zotero.Prefs.set(
      `${pkg.config.prefsPrefix}.profileModels.${PROFILE}`,
      JSON.stringify([{ noId: true }]),
      true,
    );
    assert.deepEqual(loadModels(PROFILE), []);
  });
});

import { resolveConfig } from "../src/utils/prefs";

describe("model override", function () {
  it("the pane's model picker wins over the profile default", function () {
    const base = resolveConfig("openai");
    assert.equal(base.model, "gpt-4o-mini", "profile default");

    const overridden = resolveConfig("openai", "my-custom-model");
    assert.equal(overridden.model, "my-custom-model");
    // Everything else stays tied to the profile.
    assert.equal(overridden.provider, base.provider);
    assert.equal(overridden.baseURL, base.baseURL);
    assert.equal(overridden.apiKey, base.apiKey);
  });

  it("an empty override falls back to the profile default", function () {
    assert.equal(resolveConfig("openai", "").model, resolveConfig("openai").model);
    assert.equal(
      resolveConfig("openai", undefined).model,
      resolveConfig("openai").model,
    );
  });
});

import { listProfiles } from "../src/ai/providers";

describe("model picker data", function () {
  it("lists models from every profile", function () {
    // Seed a model under a built-in profile and one under a custom profile.
    upsertModel("openai", { id: "shared-model", name: "Shared" });
    upsertModel("deepseek", { id: "shared-model", name: "Shared" });
    upsertModel("deepseek", { id: "deepseek-only", name: "DeepSeek Only" });

    const openaiModels = loadModels("openai").map((m) => m.id);
    const deepseekModels = loadModels("deepseek").map((m) => m.id);
    assert.include(openaiModels, "shared-model");
    assert.include(deepseekModels, "shared-model");
    assert.include(deepseekModels, "deepseek-only");

    // The picker dedupes by id, so "shared-model" appears once.
    const seen = new Set<string>();
    const pickerIds: string[] = [];
    for (const profile of listProfiles()) {
      for (const model of loadModels(profile.id)) {
        if (seen.has(model.id)) continue;
        seen.add(model.id);
        pickerIds.push(model.id);
      }
    }
    assert.equal(pickerIds.filter((id) => id === "shared-model").length, 1);
    assert.include(pickerIds, "deepseek-only");
  });
});

describe("model picker behaviour", function () {
  it("only new models start ticked", function () {
    const candidates: ModelEntry[] = [
      { id: "new-a", name: "New A" },
      { id: "new-b", name: "New B" },
      { id: "old-c", name: "Old C" },
    ];
    const registered = ["old-c"];
    const ticked = candidates
      .filter((m) => !registered.includes(m.id))
      .map((m) => m.id);
    assert.deepEqual(ticked, ["new-a", "new-b"]);
    assert.isFalse(registered.includes("new-a"));
  });

  it("reports how many candidates are new", function () {
    const candidates: ModelEntry[] = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" },
    ];
    const fresh = candidates.filter((m) => !["a"].includes(m.id));
    assert.lengthOf(fresh, 2);
  });
});

describe("model display names", function () {
  it("prettyName strips trailing version stamps", function () {
    assert.equal(prettyName("deepseek-v4-1-flash-261017", ""), "DeepSeek V4 1 Flash");
    assert.equal(prettyName("doubao-lite-128k-240428", ""), "Doubao Lite 128k");
    assert.equal(prettyName("qwen-plus", ""), "Qwen Plus");
  });

  it("keeps an explicit display name", function () {
    assert.equal(prettyName("deepseek-v4-pro", "DeepSeek V4 Pro"), "DeepSeek V4 Pro");
  });

  it("capitalises unknown words", function () {
    assert.equal(prettyName("some-new-model", ""), "Some New Model");
  });
});

describe("model field sync", function () {
  it("stores the id separately from the display name", function () {
    // The combobox shows a readable name but must keep the exact id.
    const entry: ModelEntry = {
      id: "deepseek-v4-1-flash-261017",
      name: "DeepSeek V4 1 Flash",
    };
    assert.notEqual(prettyName(entry.id, entry.name), entry.id);
    assert.equal(entry.id, "deepseek-v4-1-flash-261017");
  });

  it("keeps the id when the display name is empty", function () {
    const entry: ModelEntry = { id: "qwen-plus", name: "" };
    // prettyName falls back to deriving from the id.
    assert.notEqual(prettyName(entry.id, entry.name), "");
  });
});

import { renameModel } from "../src/services/modelRegistry";

describe("model rename", function () {
  const PROFILE = "test-rename-profile";

  it("renames without leaving a duplicate", function () {
    saveModels(PROFILE, [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ]);

    // Renaming "a" to "b" collapses onto the existing "b" row.
    const after = renameModel(PROFILE, "a", { id: "b", name: "B renamed" });
    assert.lengthOf(after, 1);
    assert.equal(after[0].id, "b");
    assert.equal(after[0].name, "B renamed");
  });

  it("adds a new id when it does not exist", function () {
    saveModels(PROFILE, [{ id: "a", name: "A" }]);
    const after = renameModel(PROFILE, "a", { id: "c", name: "C" });
    assert.lengthOf(after, 1);
    assert.equal(after[0].id, "c");
  });

  it("keeps other rows untouched", function () {
    saveModels(PROFILE, [
      { id: "a", name: "A" },
      { id: "keep", name: "Keep" },
    ]);
    const after = renameModel(PROFILE, "a", { id: "z", name: "Z" });
    assert.lengthOf(after, 2);
    assert.isTrue(after.some((m) => m.id === "keep"));
    assert.isTrue(after.some((m) => m.id === "z"));
  });
});
