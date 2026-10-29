import { assert } from "chai";
import { buildTranslationPrompt, parseTranslation } from "../src/ai/prompts";

describe("selective translation", function () {
  it("parses all three sections", function () {
    const parsed = parseTranslation(
      [
        "【标题】",
        "A New Method",
        "",
        "【摘要】",
        "This paper proposes...",
        "",
        "【文本】",
        "The model is trained with Adam.",
      ].join("\n"),
    );
    assert.equal(parsed.title, "A New Method");
    assert.equal(parsed.abstract, "This paper proposes...");
    assert.equal(parsed.custom, "The model is trained with Adam.");
  });

  it("parses a custom-only response", function () {
    const parsed = parseTranslation("【文本】\n仅翻译这一段");
    assert.equal(parsed.custom, "仅翻译这一段");
    assert.equal(parsed.title, "");
    assert.equal(parsed.abstract, "");
  });

  it("strips angle-bracket placeholders", function () {
    const parsed = parseTranslation("【标题】\n<翻译后的标题>");
    assert.equal(parsed.title, "翻译后的标题");
  });

  it("only asks for the requested sections", function () {
    const [onlyCustom] = buildTranslationPrompt("", "", "zh", "原文段落");
    assert.include(onlyCustom.content, "【文本】");
    assert.notInclude(onlyCustom.content, "【标题】");
    assert.notInclude(onlyCustom.content, "【摘要】");
    assert.include(onlyCustom.content, "原文段落");

    const [titleOnly] = buildTranslationPrompt("Original title", "", "en");
    assert.include(titleOnly.content, "【标题】");
    assert.notInclude(titleOnly.content, "【摘要】");
  });

  it("returns an empty result for unrelated text", function () {
    const parsed = parseTranslation("no headers here");
    assert.equal(parsed.title, "");
    assert.equal(parsed.abstract, "");
    assert.equal(parsed.custom, "");
  });
});
