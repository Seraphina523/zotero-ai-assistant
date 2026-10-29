import { loadModels, prettyName } from "../services/modelRegistry";
import { resolveConfig } from "../utils/prefs";
import { chatWithConfig } from "./client";

/**
 * Model availability check.
 *
 * Providers such as Volcengine Ark require each model to be activated in the
 * console before it can be called, so a long list of added models is mostly
 * unusable until each one is tested. This reports which ones work.
 */

export interface ModelTestResult {
  id: string;
  name: string;
  ok: boolean;
  message: string;
}

/** Send a minimal request and report whether the model accepted it. */
export async function testModel(
  modelId: string,
): Promise<ModelTestResult> {
  const cfg = resolveConfig();
  const name = prettyName(modelId, "");
  try {
    await chatWithConfig(
      { ...cfg, model: modelId },
      {
        system: "你是连通性测试助手。",
        messages: [{ role: "user", content: "回复：正常" }],
        maxTokens: 16,
      },
    );
    return { id: modelId, name, ok: true, message: "可用" };
  } catch (error: any) {
    const detail = String(error?.message || error);
    // Collapse the verbose provider payload into a short reason.
    const reason = detail
      .split(" · ")
      .slice(1)
      .join(" · ")
      .slice(0, 120);
    return { id: modelId, name, ok: false, message: reason || detail.slice(0, 120) };
  }
}

/** Test every model registered for a profile, concurrently but bounded. */
export async function testAllModels(
  onProgress?: (done: number, total: number, result: ModelTestResult) => void,
  concurrency = 3,
): Promise<ModelTestResult[]> {
  const cfg = resolveConfig();
  const models = loadModels(cfg.provider);
  const results: ModelTestResult[] = [];
  let cursor = 0;
  let done = 0;

  const worker = async () => {
    while (cursor < models.length) {
      const model = models[cursor++];
      const result = await testModel(model.id);
      results.push(result);
      done++;
      onProgress?.(done, models.length, result);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, models.length) }, worker),
  );
  return results;
}
