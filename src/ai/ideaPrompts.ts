import { ChatMessage } from "./providers";
import { wrapDocumentData } from "./prompts";

/**
 * Idea discovery prompts.
 *
 * Each mode asks a different question of the same candidate set, so the
 * prompts share a common output contract: a ranked list with reasons, backed by
 * the snippets the plugin found.
 */

export const IDEA_SYSTEM = `你是一名帮助用户寻找研究方向的学术伙伴。
你会在用户的整个文献库中检索，并基于检索到的文献回答问题。

【回答语言】
无论用户用什么语言提问，回答一律使用简体中文。

【事实约束】
只依据下面提供的文献信息与片段作答。
不要编造不存在的文献、作者、年份或结论。
如果检索结果不足以支撑某个判断，直接说明“证据不足”。

【输出格式】
使用 Markdown。先给出一句总体判断，然后分条列出发现。
每条发现要说明：涉及哪些文献、发现了什么、为什么这对找 idea 有价值。
最后给出 2–3 个可操作的研究方向建议。`;

export function buildGapPrompt(
  question: string,
  hits: Array<{ title: string; year: string; venue: string; snippets: string[] }>,
): ChatMessage[] {
  const payload = hits
    .map(
      (hit, index) =>
        `### 文献 ${index + 1}\n标题：${hit.title}\n年份：${hit.year || "未知"}\n期刊/会议：${
          hit.venue || "未知"
        }\n相关片段：\n${hit.snippets.map((s) => `- ${s}`).join("\n") || "（无片段）"}`,
    )
    .join("\n\n");

  return [
    {
      role: "user",
      content: `用户的疑问：${question}

请阅读下面的候选文献，找出其中尚未被解决的问题，也就是潜在的研究空白。

判断标准：
- 作者自己承认的局限（limitations、future work）
- 只在特定条件下成立、外推性存疑的结论
- 多篇文献都没有覆盖到的场景或对象
- 已有方法明显不适用的领域

不要只罗列“未来可以研究 X”，要说明这个空白为什么重要、现在为什么没人做、以及可行的切入点。

===== 候选文献 =====
${wrapDocumentData(payload || "（未检索到相关文献）")}`,
    },
  ];
}

export function buildConflictPrompt(
  question: string,
  hits: Array<{ title: string; year: string; venue: string; snippets: string[] }>,
): ChatMessage[] {
  const payload = hits
    .map(
      (hit, index) =>
        `### 文献 ${index + 1}\n标题：${hit.title}\n年份：${hit.year || "未知"}\n期刊/会议：${
          hit.venue || "未知"
        }\n相关片段：\n${hit.snippets.map((s) => `- ${s}`).join("\n") || "（无片段）"}`,
    )
    .join("\n\n");

  return [
    {
      role: "user",
      content: `用户的疑问：${question}

请阅读下面的候选文献，找出它们之间互相矛盾或结论不一致的地方。

关注：
- 同样的方法在不同数据集/场景下结论相反
- 一方报告显著提升，另一方报告提升不显著或无效
- 对同一个假设，不同文献给出不同解释
- 实验设置差异导致的不可比结论

对每处冲突，说明：两篇文献各自主张什么、差异可能来自哪里（数据、指标、设置、规模）、以及如何设计实验去验证哪一种更可信。

===== 候选文献 =====
${wrapDocumentData(payload || "（未检索到相关文献）")}`,
    },
  ];
}

export function buildExtendPrompt(
  question: string,
  seed: string,
  hits: Array<{ title: string; year: string; venue: string; snippets: string[] }>,
): ChatMessage[] {
  const payload = hits
    .map(
      (hit, index) =>
        `### 文献 ${index + 1}\n标题：${hit.title}\n年份：${hit.year || "未知"}\n期刊/会议：${
          hit.venue || "未知"
        }\n相关片段：\n${hit.snippets.map((s) => `- ${s}`).join("\n") || "（无片段）"}`,
    )
    .join("\n\n");

  return [
    {
      role: "user",
      content: `用户当前的种子文献：
${seed}

用户的疑问：${question}

请阅读下面的相关文献，找出可以借鉴或延伸的方向。

关注：
- 使用了相似方法但应用场景不同的工作
- 可以迁移到用户问题上的技术或数据集
- 提供了用户可能没考虑到的评价指标或基线
- 在相近问题上取得更好结果的关键改动

对每篇文献，说明它具体能提供什么可操作的启发，而不是泛泛地说“有参考价值”。

===== 相关文献 =====
${wrapDocumentData(payload || "（未检索到相关文献）")}`,
    },
  ];
}
