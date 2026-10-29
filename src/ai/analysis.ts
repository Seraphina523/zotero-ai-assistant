import { ChatMessage } from "./providers";
import { wrapDocumentData } from "./prompts";

/**
 * Guided questions.
 *
 * A blank input box is the biggest usability problem for "chat with PDF".
 * Instead of asking the user to invent a question, we generate a short set of
 * reading-path questions from the document and let them click one.
 */

export interface SuggestedQuestion {
  /** Short label shown on the button. */
  label: string;
  /** The full question sent to the model. */
  question: string;
  /** Why this question is worth asking. */
  reason: string;
}

export function buildGuidedQuestionsPrompt(
  metadata: string,
  fullText: string,
): ChatMessage[] {
  return [
    {
      role: "user",
      content: `请根据下面的文献，生成 6 个能引导读者快速读懂这篇论文的问题。

要求：
- 覆盖阅读路径：研究动机 → 方法 → 实验 → 结果 → 局限 → 可延伸方向
- 每个问题 8–20 字，具体、可被原文回答，不要空泛（如“这篇论文讲了什么”这种不要）
- 用与文献一致的语言提问
- 只输出 JSON，格式为：
{"questions":[{"label":"简短标签","question":"完整问题","reason":"为什么值得问"}]}

===== 文献元数据 =====
${metadata}

===== 正文节选 =====
${wrapDocumentData(fullText.slice(0, 4000) || "（无正文）")}`,
    },
  ];
}

export function parseGuidedQuestions(text: string): SuggestedQuestion[] {
  const cleaned = text
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();

  let parsed: any = null;
  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      parsed = JSON.parse(objectMatch[0]);
    } catch {
      parsed = null;
    }
  }
  if (!parsed) {
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = null;
    }
  }

  const list = Array.isArray(parsed?.questions)
    ? parsed.questions
    : Array.isArray(parsed)
      ? parsed
      : [];
  return list
    .map((entry: any) => ({
      label: String(entry?.label || entry?.question || "").slice(0, 30),
      question: String(entry?.question || "").slice(0, 300),
      reason: String(entry?.reason || "").slice(0, 120),
    }))
    .filter((entry: SuggestedQuestion) => entry.question)
    .slice(0, 8);
}

/**
 * Critical appraisal.
 *
 * Summaries report what a paper says; this prompt asks the model to look for
 * what the paper does *not* say — methodological weaknesses, sampling issues,
 * and gaps between claims and evidence.
 */

export const CRITIQUE_SYSTEM = `你是一名研究方法学审稿人，擅长批判性阅读实证研究。
你的任务不是总结论文说了什么，而是指出它没有说清、或说得过于乐观的地方。
必须基于文献正文作答，不编造缺陷；如果某方面论文已经交代清楚，就如实说明。
输出使用 Markdown，语言精炼，避免空泛的套话。`;

export function buildCritiquePrompt(
  metadata: string,
  fullText: string,
): ChatMessage[] {
  return [
    {
      role: "user",
      content: `请以批判性视角审查下面的文献，输出一份方法学评估。

请覆盖以下方面（仅在原文有依据时展开，没有就写“原文未交代”）：
1. 研究设计与因果推断：是相关性还是因果？有没有混淆变量？
2. 样本与代表性：样本量、抽样方式、数据集来源与时间跨度是否足以支撑结论
3. 测量与指标：关键指标如何定义，是否存在循环论证或代理变量偏差
4. 基线与对比：对照组设置、基线模型选择是否公平
5. 结果解读：效应量与统计显著性是否被混淆，是否有过度外推
6. 可复现性：代码/数据/超参数是否可得
7. 结论与证据的逻辑跳跃：作者结论是否超出了数据能支持的范围

最后给出一句总体评价，并说明这篇论文最适合作为什么用途、不适合什么用途。

===== 文献元数据 =====
${metadata}

===== 正文 =====
${wrapDocumentData(fullText)}`,
    },
  ];
}

/**
 * Figure and table interpretation.
 *
 * The SDT tree marks images, math and tables as separate block types, so we
 * can ask the model about the *structure* of a figure even when the pixels are
 * not available. For actual pixel-level reading a multimodal model is needed;
 * this prompt works from captions, surrounding text and table cells.
 */

export const FIGURE_SYSTEM = `你是一名擅长解读学术图表的研究助理。
你会收到文献中图表的标题、坐标轴描述、表格内容与上下文文字。
请解释这些图表“在说什么”，而不是复述标题。
如果信息不足以判断，请明确说明，不要猜测具体数值。`;

export interface FigureStats {
  imageCount: number;
  tableCount: number;
  captionCount: number;
}

export function buildFigurePrompt(
  metadata: string,
  figures: string,
  stats?: FigureStats,
): ChatMessage[] {
  const summary = stats
    ? `本次从文献中提取到 ${stats.imageCount} 张图、${stats.tableCount} 个表格、${stats.captionCount} 个图表标题。`
    : "";

  return [
    {
      role: "user",
      content: `请解读下面文献中的图表。

${summary}
提取到的内容带有 [image] / [table] / [caption] / [math] 标记，后面是该块内可提取的文本。
注意：纯图片里没有像素信息，你只能依据标题、表头、单元格与上下文判断；信息不足时请明确说明，不要编造具体数值。

按下面的结构输出：

## 图表清单
逐个列出你识别到的图表（用标题或编号指代），并猜测其类型（框架图 / 折线图 / 柱状图 / 表格等）。

## 重点解读
挑 1–3 个最关键的图表，逐一说明：
- 它在比较什么
- 坐标轴或表头的含义
- 呈现的趋势或对比结论
- 对论文核心主张的支撑作用

## 值得注意的细节
- 缺少的基线或对照组
- 单位、量级或标注可能引起误读的地方
- 与正文结论不一致、或正文未提及的图表信息

## 局限
说明哪些图表因为缺少图像或文字信息而无法可靠解读。

===== 文献元数据 =====
${metadata}

===== 图表相关文本 =====
${wrapDocumentData(figures || "（未提取到图表相关文本）")}`,
    },
  ];
}

/**
 * Structured extraction for literature matrices.
 *
 * Produces a compact JSON record per paper so several papers can be compared
 * side by side in a table.
 */

export const MATRIX_SYSTEM = `你是一名系统性综述研究助理，擅长从论文中抽取可比较的结构化字段。
只抽取原文明确写出的内容；缺失的字段填 null，不要推测。
只输出 JSON。`;

export function buildMatrixPrompt(
  entries: Array<{ id: string; metadata: string; fullText: string }>,
): ChatMessage[] {
  const payload = entries
    .map(
      (entry, index) =>
        `### 文献 ${index + 1}（id=${entry.id}）\n${entry.metadata}\n\n${wrapDocumentData(
          entry.fullText.slice(0, 20000),
        )}`,
    )
    .join("\n\n");

  return [
    {
      role: "user",
      content: `请从下面的多篇文献中抽取结构化字段，输出一个 JSON 数组。

每个元素必须包含：
{
  "id": "原样保留传入的 id",
  "title": "标题",
  "year": 年份数字或 null,
  "venue": "期刊/会议",
  "researchQuestion": "研究问题",
  "method": "方法/模型",
  "dataset": "数据集与规模",
  "sampleSize": "样本量",
  "keyFinding": "核心发现（含关键数值）",
  "metrics": "评价指标",
  "baselines": "对比基线",
  "limitations": "作者承认的局限",
  "codeDataAvailable": true/false/null
}

要求：
- 字段值用中文简述，尽量保留原文数字
- 不确定的填 null，不要编造
- 只输出 JSON 数组，不要输出任何其他内容

===== 文献 =====
${payload}`,
    },
  ];
}

export interface MatrixEntry {
  id: string;
  title: string | null;
  year: number | null;
  venue: string | null;
  researchQuestion: string | null;
  method: string | null;
  dataset: string | null;
  sampleSize: string | null;
  keyFinding: string | null;
  metrics: string | null;
  baselines: string | null;
  limitations: string | null;
  codeDataAvailable: boolean | null;
}

export function parseMatrix(text: string): MatrixEntry[] {
  const cleaned = text
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  let parsed: any[] = [];
  try {
    parsed = JSON.parse(arrayMatch ? arrayMatch[0] : cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((entry: any) => ({
      id: String(entry?.id ?? ""),
      title: entry?.title ?? null,
      year: Number.isFinite(Number(entry?.year)) ? Number(entry.year) : null,
      venue: entry?.venue ?? null,
      researchQuestion: entry?.researchQuestion ?? null,
      method: entry?.method ?? null,
      dataset: entry?.dataset ?? null,
      sampleSize: entry?.sampleSize ?? null,
      keyFinding: entry?.keyFinding ?? null,
      metrics: entry?.metrics ?? null,
      baselines: entry?.baselines ?? null,
      limitations: entry?.limitations ?? null,
      codeDataAvailable:
        typeof entry?.codeDataAvailable === "boolean"
          ? entry.codeDataAvailable
          : null,
    }))
    .filter((entry) => entry.id || entry.title);
}

export function matrixToMarkdown(entries: MatrixEntry[]): string {
  const header = [
    "| 标题 | 年份 | 方法 | 数据集/样本 | 核心发现 | 指标 | 基线 | 局限 | 代码数据 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const rows = entries.map((entry) => {
    const cell = (value: string | number | boolean | null) => {
      if (value === null || value === undefined || value === "") return "—";
      return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
    };
    const code = entry.codeDataAvailable === null
      ? "—"
      : entry.codeDataAvailable
        ? "有"
        : "无";
    return [
      `| ${cell(entry.title)}`,
      cell(entry.year),
      cell(entry.method),
      `${cell(entry.dataset)}${entry.sampleSize ? ` / ${cell(entry.sampleSize)}` : ""}`,
      cell(entry.keyFinding),
      cell(entry.metrics),
      cell(entry.baselines),
      cell(entry.limitations),
      code,
      "|",
    ].join(" | ");
  });
  return [...header, ...rows].join("\n");
}
