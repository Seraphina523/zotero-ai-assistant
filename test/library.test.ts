import { assert } from "chai";
import { extractTerms } from "../src/services/librarySearch";
import {
  buildConflictPrompt,
  buildExtendPrompt,
  buildGapPrompt,
  IDEA_SYSTEM,
} from "../src/ai/ideaPrompts";

describe("library search", function () {
  it("extracts english vocabulary", function () {
    const terms = extractTerms(
      "Super-resolution for historical Chinese document images. " +
        "Super-resolution models improve readability.",
    );
    assert.include(terms, "super");
    assert.include(terms, "resolution");
    assert.include(terms, "historical");
    assert.include(terms, "chinese");
    assert.isAtMost(terms.length, 12);
  });

  it("extracts chinese bigrams", function () {
    const terms = extractTerms("低分辨率图像的文字识别与超分辨率重建");
    assert.include(terms, "低分");
    assert.include(terms, "分辨");
    assert.include(terms, "率图");
    assert.include(terms, "超分");
  });

  it("ignores stopwords and very short latin fragments", function () {
    const terms = extractTerms("the a an of in on at to be is are was");
    assert.deepEqual(terms, []);
    // Four-letter words are kept: they carry meaning.
    assert.include(extractTerms("were"), "were");
  });

  it("handles empty input", function () {
    assert.deepEqual(extractTerms(""), []);
    assert.deepEqual(extractTerms("   "), []);
  });
});

describe("idea prompts", function () {
  const hits = [
    {
      title: "Paper A",
      year: "2023",
      venue: "CVPR",
      snippets: ["we found that …"],
    },
  ];

  it("forces chinese output regardless of question language", function () {
    assert.include(IDEA_SYSTEM, "一律使用简体中文");
    assert.include(IDEA_SYSTEM, "不要编造不存在的文献");
    assert.notInclude(IDEA_SYSTEM, "除非用户使用其他语言提问");
  });

  it("asks for gaps with explicit criteria", function () {
    const [message] = buildGapPrompt("How to improve OCR on facsimiles?", hits);
    assert.include(message.content, "How to improve OCR on facsimiles?");
    assert.include(message.content, "Paper A");
    assert.include(message.content, "研究空白");
    assert.include(message.content, "作者自己承认的局限");
  });

  it("asks for conflicts with a verification plan", function () {
    const [message] = buildConflictPrompt("Which method is better?", hits);
    assert.include(message.content, "互相矛盾");
    assert.include(message.content, "如何设计实验去验证");
  });

  it("uses the seed paper in extend mode", function () {
    const [message] = buildExtendPrompt(
      "What can I borrow?",
      "Seed paper abstract",
      hits,
    );
    assert.include(message.content, "Seed paper abstract");
    assert.include(message.content, "种子文献");
    assert.include(message.content, "可以借鉴或延伸");
  });
});
