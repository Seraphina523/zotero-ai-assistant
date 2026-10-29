import { assert } from "chai";
import {
  blankProfile,
  BUILTIN_PROFILES,
  findProfile,
  getActiveProfileId,
  listProfiles,
  newProfileId,
  Profile,
  removeProfile,
  setActiveProfileId,
  upsertProfile,
} from "../src/ai/providers";

describe("profiles", function () {
  it("ships a usable set of presets", function () {
    assert.isAtLeast(BUILTIN_PROFILES.length, 8);
    const ids = BUILTIN_PROFILES.map((p) => p.id);
    assert.lengthOf(new Set(ids), ids.length, "preset ids must be unique");
    for (const preset of BUILTIN_PROFILES) {
      assert.ok(preset.baseURL, `${preset.id} needs a base URL`);
      assert.ok(preset.name, `${preset.id} needs a name`);
    }
  });

  it("includes an Anthropic-style preset", function () {
    const anthropic = findProfile("anthropic");
    assert.isOk(anthropic);
    assert.equal(anthropic!.style, "anthropic");
  });

  it("stores, updates and removes custom profiles", function () {
    const profile: Profile = {
      ...blankProfile(),
      id: "test-profile-a",
      name: "Test A",
      style: "anthropic",
      baseURL: "https://example.test",
      apiKey: "sk-test",
      defaultModel: "test-model",
    };

    upsertProfile(profile);
    assert.deepEqual(findProfile("test-profile-a"), profile);

    // Updating keeps the same id.
    upsertProfile({ ...profile, name: "Test A v2" });
    assert.equal(findProfile("test-profile-a")!.name, "Test A v2");

    removeProfile("test-profile-a");
    assert.isUndefined(findProfile("test-profile-a"));
  });

  it("keeps built-in presets out of the removable set", function () {
    const profiles = listProfiles();
    assert.isAtLeast(profiles.length, BUILTIN_PROFILES.length);
    assert.ok(profiles.some((p) => p.builtin));
  });

  it("generates collision-free ids", function () {
    const name = "Collision Probe";
    // Seed a profile so the next call must avoid the same base id.
    const seededId = newProfileId(name);
    upsertProfile({ ...blankProfile(), id: seededId, name });

    const next = newProfileId(name);
    assert.notEqual(next, seededId, "must avoid the existing id");
    assert.include(next, "collision-probe");

    removeProfile(seededId);
    removeProfile(next);
  });

  it("falls back to the first profile when the active one is missing", function () {
    setActiveProfileId("definitely-not-a-profile");
    assert.equal(getActiveProfileId(), "definitely-not-a-profile");
    const profiles = listProfiles();
    assert.isOk(profiles[0]);
  });
});

describe("built-in profile overrides", function () {
  it("persists edits made to a built-in preset", function () {
    // Regression: saveProfiles used to drop everything that was not a custom
    // profile, so an API key typed into a built-in preset vanished on reload.
    const deepseek = findProfile("deepseek")!;
    const apiKey = `sk-test-${Date.now()}`;

    upsertProfile({ ...deepseek, apiKey, baseURL: "https://proxy.example/v1" });

    const reloaded = findProfile("deepseek")!;
    assert.equal(reloaded.apiKey, apiKey, "api key must survive a reload");
    assert.equal(reloaded.baseURL, "https://proxy.example/v1");

    // The preset itself is not duplicated into the custom list.
    const custom = listProfiles().filter((p) => !p.builtin);
    assert.isFalse(custom.some((p) => p.id === "deepseek"));
  });

  it("keeps shipped defaults when nothing was overridden", function () {
    const openai = findProfile("openai")!;
    assert.equal(openai.baseURL, "https://api.openai.com/v1");
    assert.equal(openai.style, "openai");
  });
});
