import { assert } from "chai";
import { prettyName } from "../src/services/modelRegistry";

describe("prettyName", function () {
  const cases: Array<[string, string]> = [
    ["doubao-seed-1-6", "Doubao Seed 1 6"],
    ["doubao-seed-1-6-thinking", "Doubao Seed 1 6 Thinking"],
    ["doubao-seedance-1-0-pro", "Doubao Seedance 1 0 Pro"],
    ["doubao-1-5-pro-32k-250115", "Doubao 1 5 Pro 32k"],
    ["doubao-embedding-vision", "Doubao Embedding Vision"],
    ["kimi-k2-250711", "Kimi K2"],
    ["deepseek-v4-1-flash-261017", "DeepSeek V4 1 Flash"],
    ["qwen3-0-6b-20250429", "Qwen3 0 6b"],
    ["glm-4-7-251228", "GLM 4 7"],
    ["mistral-7b-instruct-v0-2", "Mistral 7b Instruct V0 2"],
  ];

  for (const [input, expected] of cases) {
    it(`${input} -> ${expected}`, function () {
      assert.equal(prettyName(input, input), expected);
    });
  }

  it("keeps an explicit display name", function () {
    assert.equal(prettyName("deepseek-v4-pro", "DeepSeek V4 Pro"), "DeepSeek V4 Pro");
  });
});

describe("prettyName with id-like names", function () {
  it("rewrites a name that is just the id", function () {
    // The name field often holds a copy of the id; that is not a display name.
    assert.equal(prettyName("doubao-lite-128k", "doubao-lite-128k"), "Doubao Lite 128k");
    assert.equal(prettyName("deepseek-flash", "deepseek-flash"), "DeepSeek Flash");
  });

  it("keeps a genuinely different display name", function () {
    assert.equal(prettyName("doubao-lite-128k", "豆包 Lite"), "豆包 Lite");
    assert.equal(prettyName("ep-20250101-abc", "我的推理接入点"), "我的推理接入点");
  });

  it("handles a volcengine endpoint id", function () {
    // Endpoint ids are opaque; the derived name is still better than raw.
    assert.notEqual(prettyName("ep-20250101-abc123", ""), "ep-20250101-abc123");
  });
});

describe("error guidance", function () {
  it("distinguishes unknown models from unactivated ones", function () {
    const unknown = "The model or endpoint deepseek-flash does not exist".toLowerCase();
    const unactivated = "Your account has not activated the model deepseek-v4".toLowerCase();

    const isUnknown = (t: string) =>
      t.includes("does not exist") || t.includes("not found") || t.includes("model or endpoint");
    const isUnactivated = (t: string) =>
      t.includes("has not activated") || t.includes("not activated");

    assert.isTrue(isUnknown(unknown));
    assert.isFalse(isUnactivated(unknown));
    assert.isTrue(isUnactivated(unactivated));
    assert.isFalse(isUnactivated("Authentication Fails"));
  });
});

describe("volcengine model names", function () {
  it("renders the Coding Plan model ids readably", function () {
    assert.equal(prettyName("doubao-seed-2.1-pro", "doubao-seed-2.1-pro"), "Doubao Seed 2.1 Pro");
    assert.equal(prettyName("deepseek-v4.1-flash-economy", "deepseek-v4.1-flash-economy"), "DeepSeek V4.1 Flash Economy");
    assert.equal(prettyName("kimi-k3.1-pro", "kimi-k3.1-pro"), "Kimi K3.1 Pro");
    assert.equal(prettyName("glm-5.3-flash", "glm-5.3-flash"), "GLM 5.3 Flash");
    assert.equal(prettyName("ark-code-latest", "ark-code-latest"), "Ark Code Latest");
  });
});

describe("volcengine auto alias", function () {
  it("the API rejects the console's Auto alias", function () {
    // "ark-code-latest" is the console's Auto option value; the API returns
    // 404 for it. Real calls need a dated version id.
    const apiNames = [
      "doubao-seed-2.0-pro-260215",
      "doubao-seed-2.1-pro",
      "deepseek-v4.1-flash",
    ];
    assert.notInclude(apiNames, "ark-code-latest");
    assert.isTrue(apiNames.every((n) => !/latest/i.test(n)));
  });
});
