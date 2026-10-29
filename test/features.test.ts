import { assert } from "chai";
import { parseTags, parseTranslation } from "../src/ai/prompts";
import {
  contextLimit,
  estimateTokens,
  fitHistory,
  fitToContext,
} from "../src/ai/tokens";
import {
  anchorPages,
  flattenPack,
  openSDTPack,
  parseTextMapPages,
} from "../src/services/sdt";
import {
  buildContextForQuestion,
  retrieveChunks,
  tokenize,
} from "../src/services/itemText";

describe("ai helpers", function () {
  it("parses a JSON tag array", function () {
    const tags = parseTags('```json\n["注意力机制", "模型压缩"]\n```');
    assert.deepEqual(tags, ["注意力机制", "模型压缩"]);
  });

  it("parses comma separated tags as a fallback", function () {
    const tags = parseTags("深度学习， 医学影像; 分割");
    assert.include(tags, "深度学习");
    assert.include(tags, "医学影像");
    assert.include(tags, "分割");
  });

  it("parses translation sections", function () {
    const parsed = parseTranslation(
      "【标题】\nA New Method\n\n【摘要】\nThis paper proposes...",
    );
    assert.equal(parsed.title, "A New Method");
    assert.equal(parsed.abstract, "This paper proposes...");
  });

  it("tokenizes Chinese into bigrams", function () {
    const tokens = tokenize("注意力机制");
    assert.include(tokens, "注意");
    assert.include(tokens, "意力");
  });

  it("retrieves the chunk that mentions the query", function () {
    const chunks = [
      { index: 0, text: "本文研究蛋白质结构预测。", pages: [1] },
      { index: 1, text: "实验使用 Transformer 模型进行序列建模。", pages: [2] },
      { index: 2, text: "附录列出了数据集的统计信息。", pages: [8] },
    ];
    const picked = retrieveChunks(chunks, "使用了什么模型？", 1);
    assert.include(picked[0].text, "Transformer");
    assert.deepEqual(picked[0].pages, [2]);
  });

  it("builds question context within the character budget", function () {
    const chunks = [
      { index: 0, text: "第一段。".repeat(200), pages: [1] },
      { index: 1, text: "第二段。".repeat(200), pages: [2] },
    ];
    const { text, pages } = buildContextForQuestion(chunks, "第一段", 300);
    assert.isAtMost(text.length, 400);
    assert.include(text, "第一段");
    assert.isTrue(pages.length >= 1);
  });

  it("reads page numbers from a text map", function () {
    const runs = [
      [0, 0, 0, 0, 10, 10, 5],
      [0, 0, 0, 20, 10, 30, 5],
      [0, 2, 0, 0, 10, 10, 5],
    ];
    const pages = parseTextMapPages(JSON.stringify(runs));
    assert.deepEqual(pages, [1, 3]);
  });

  it("reads page numbers from a page anchor", function () {
    const anchor = { pageRects: [[0, 0, 0, 100, 100], [3, 0, 0, 100, 100]] };
    assert.deepEqual(anchorPages(anchor), [1, 4]);
  });

  it("flattens a pack into sections", function () {
    const pack: any = {
      schemaVersion: "1.0.0",
      metadata: {},
      catalog: { pages: [] },
      content: [
        {
          type: "heading",
          anchor: { pageRects: [[0, 0, 0, 100, 20]] },
          content: [{ text: "Introduction" }],
        },
        {
          type: "paragraph",
          anchor: { pageRects: [[0, 0, 30, 100, 60]] },
          content: [{ text: "We study" }, { text: " protein folding." }],
        },
      ],
    };
    const sections = flattenPack(pack);
    assert.equal(sections.length, 2);
    assert.equal(sections[0].text, "Introduction");
    assert.equal(sections[1].text, "We study protein folding.");
    assert.deepEqual(sections[1].pages, [1]);
  });

  it("looks up model context limits", function () {
    assert.equal(contextLimit("gpt-4o"), 128000);
    assert.equal(contextLimit("claude-sonnet-4-5"), 200000);
    assert.equal(contextLimit("moonshot-v1-32k"), 32000);
    assert.equal(contextLimit("deepseek-chat"), 64000);
    assert.isAbove(contextLimit("some-unknown-model"), 0);
  });

  it("estimates tokens for mixed text", function () {
    assert.isAbove(estimateTokens("注意力机制"), 0);
    assert.isAbove(estimateTokens("attention mechanism"), 0);
    assert.isAbove(
      estimateTokens("注意力机制 attention mechanism"),
      estimateTokens("attention mechanism"),
    );
  });

  it("trims text to the model window", function () {
    const long = "x".repeat(200000);
    const fitted = fitToContext(long, "moonshot-v1-8k", 1024);
    assert.isTrue(fitted.trimmed);
    assert.isAtMost(estimateTokens(fitted.text), 7000);
    const short = fitToContext("hello", "gpt-4o", 1024);
    assert.isFalse(short.trimmed);
  });

  it("keeps only recent history that fits", function () {
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: "user" as const,
      content: "message ".repeat(200) + i,
    }));
    const kept = fitHistory(history, "moonshot-v1-8k", 1024);
    assert.isAbove(kept.length, 0);
    assert.isBelow(kept.length, history.length);
    assert.deepEqual(kept[kept.length - 1], history[history.length - 1]);
  });

  it("rejects a pack with a bad magic number", async function () {
    let message = "";
    try {
      await openSDTPack(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]));
    } catch (error: any) {
      message = error.message;
    }
    assert.include(message, "Invalid SDTPack");
  });
});

import {
  matrixToMarkdown,
  parseGuidedQuestions,
  parseMatrix,
} from "../src/ai/analysis";

describe("analysis helpers", function () {
  it("parses guided questions", function () {
    const raw = `{"questions":[
      {"label":"研究动机","question":"作者要解决什么问题？","reason":"先理解动机"},
      {"label":"方法","question":"用了什么模型？","reason":"方法决定可复现性"}
    ]}`;
    const parsed = parseGuidedQuestions(raw);
    assert.lengthOf(parsed, 2);
    assert.equal(parsed[0].label, "研究动机");
    assert.equal(parsed[1].question, "用了什么模型？");
  });

  it("falls back to an empty list on bad output", function () {
    assert.deepEqual(parseGuidedQuestions("not json at all"), []);
  });

  it("parses a literature matrix", function () {
    const raw = `[
      {"id":"1","title":"Paper A","year":2023,"venue":"CVPR","method":"CNN","dataset":"ImageNet","sampleSize":"1M","keyFinding":"90% acc","metrics":"Accuracy","baselines":"ResNet","limitations":"small data","codeDataAvailable":true},
      {"id":"2","title":"Paper B","year":2024,"venue":"NeurIPS","method":"Transformer","dataset":"COCO","keyFinding":"88% acc","codeDataAvailable":null}
    ]`;
    const entries = parseMatrix(raw);
    assert.lengthOf(entries, 2);
    assert.equal(entries[0].year, 2023);
    assert.equal(entries[0].codeDataAvailable, true);
    assert.isNull(entries[1].codeDataAvailable);
    assert.isNull(entries[1].sampleSize);
  });

  it("renders a matrix table", function () {
    const raw = `[{"id":"1","title":"A","year":2023,"method":"CNN","dataset":"D","keyFinding":"F","codeDataAvailable":true}]`;
    const markdown = matrixToMarkdown(parseMatrix(raw));
    assert.include(markdown, "| 标题 |");
    assert.include(markdown, "| A |");
    assert.include(markdown, "| 有 |");
  });
});

import { QA_SYSTEM, buildQAPrompt } from "../src/ai/prompts";

describe("qa language", function () {
  it("forbids switching to English", function () {
    assert.include(QA_SYSTEM, "一律使用简体中文");
    assert.include(QA_SYSTEM, "不要因为用户用英文提问就改用英文");
    assert.include(QA_SYSTEM, "不要大段照抄英文原文");
    // The old wording allowed an exception for non-Chinese questions.
    assert.notInclude(QA_SYSTEM, "除非用户使用其他语言提问");
  });

  it("repeats the language rule in the user message", function () {
    const [message] = buildQAPrompt("Which models were tested?", "body", "meta");
    assert.include(message.content, "用简体中文回答");
    assert.include(message.content, "不要大段复制英文原文");
  });
});

import { buildFigurePrompt } from "../src/ai/analysis";
import { buildSummaryPrompt } from "../src/ai/prompts";
import { collectSSEText } from "../src/ai/client";

describe("reply budgets and prompts", function () {
  it("summary prompt scales with the chosen length", function () {
    const brief = buildSummaryPrompt("meta", "body", "zh", "brief")[0].content;
    const standard = buildSummaryPrompt("meta", "body", "zh", "standard")[0]
      .content;
    const detailed = buildSummaryPrompt("meta", "body", "zh", "detailed")[0]
      .content;

    assert.include(brief, "250–400 字");
    assert.include(standard, "600–1000 字");
    assert.include(detailed, "1200–2000 字");
    // The old fixed limit must be gone.
    assert.notInclude(detailed, "篇幅 300–600 字");
  });

  it("figure prompt states what was extracted and forbids invented numbers", function () {
    const [message] = buildFigurePrompt("meta", "[image] fig", {
      imageCount: 10,
      tableCount: 2,
      captionCount: 11,
    });
    assert.include(message.content, "10 张图");
    assert.include(message.content, "2 个表格");
    assert.include(message.content, "不要编造具体数值");
    assert.include(message.content, "## 图表清单");
  });

  it("recovers text from a complete SSE body", function () {
    const openai = [
      'data: {"choices":[{"delta":{"content":"你好"}}]}',
      'data: {"choices":[{"delta":{"content":"，世界"}}]}',
      "data: [DONE]",
    ].join("\n\n");
    assert.equal(collectSSEText(openai, "openai"), "你好，世界");

    const anthropic = [
      'data: {"type":"content_block_delta","delta":{"text":"Hello"}}',
      'data: {"type":"content_block_delta","delta":{"text":" world"}}',
    ].join("\n\n");
    assert.equal(collectSSEText(anthropic, "anthropic"), "Hello world");
  });

  it("returns empty string for a body without events", function () {
    assert.equal(collectSSEText("", "openai"), "");
    assert.equal(collectSSEText("not sse at all", "openai"), "");
  });
});
