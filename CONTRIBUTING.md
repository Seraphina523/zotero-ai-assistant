# 参与贡献

感谢你的兴趣！这个插件的代码量不大，但**测试覆盖很扎实**（105 项测试在真实 Zotero 实例中运行），改动后请务必跑通。

## 开发环境

```bash
npm install
cp .env.example .env   # 填入你的 Zotero 路径和测试 profile
npm start              # 启动 Zotero 热重载
```

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm start` | 开发模式，启动 Zotero 并热重载插件 |
| `npm run build` | 生产构建，输出 `.scaffold/build/*.xpi` |
| `npm test` | 在真实 Zotero 中运行测试 |
| `npx tsc --noEmit` | 仅类型检查 |

## 提交前检查清单

- [ ] `npx tsc --noEmit` 无错误
- [ ] `npm run build` 成功
- [ ] `npm test` 全部通过
- [ ] 新增功能有对应测试

## 代码风格

- **TypeScript**，严格模式
- 注释用中文，代码标识符用英文
- 每个模块职责单一，通过 `src/ai/features.ts` 编排
- 提示词集中在 `src/ai/prompts.ts` 和 `src/ai/analysis.ts`

## 测试约定

测试文件放 `test/`，命名 `*.test.ts`。

**优先给这些地方加测试**：

| 类型 | 例子 |
| --- | --- |
| 纯函数 | 标签解析、翻译解析、名称推导、页码提取 |
| 数据结构 | 模型列表增删、配置增改 |
| 提示词 | 输出格式是否符合预期 |
| 启动注册 | 面板 / 菜单 / 设置是否注册成功 |

**不建议**为 UI 布局写测试——Zotero 沙箱里 DOM 断言脆弱。

## 提交 PR

1. Fork 本仓库
2. 从 `main` 新建分支，命名建议：
   - `feat/xxx` 新功能
   - `fix/xxx` 修复
   - `docs/xxx` 文档
3. 提交改动，**在 PR 描述里写清楚**：
   - 解决了什么问题
   - 如何验证的（截图或测试输出）
   - 是否影响现有行为

## 报告问题

提 Issue 时请包含：

- Zotero 版本（如 10.0.6）
- 插件版本（面板顶部有标记）
- 完整的错误信息
- 复现步骤

**不要**在 Issue 里贴 API Key。

## 开发约定

### 新增服务商

在 `src/ai/providers.ts` 的 `BUILTIN_PROFILES` 里加一条：

```ts
{
  id: "your-provider",
  name: "显示名",
  style: "openai",                    // 或 "anthropic"
  baseURL: "https://api.example.com/v1",
  apiKey: "",
  defaultModel: "model-id",
  models: ["model-id", "other-id"],
  hint: "获取 Key 的地址 / 注意事项",
  builtin: true,
}
```

同时在 `addon/prefs.js` 里**不需要**加任何东西——配置存在 `profiles` 键里。

### 新增 AI 功能

1. 在 `src/ai/prompts.ts` 或 `analysis.ts` 写提示词
2. 在 `src/ai/features.ts` 写编排函数
3. 在 `src/modules/ui.ts` 加入口（按钮或对话框）
4. 加测试

### 页码引用

如果新功能需要页码，用 `src/services/sdt.ts`：

```ts
const pack = await reader.materialize();
// block.anchor.pageRects → 页码
```

**注意**：SDT 包解码有 5 个易错点（见 `sdt.ts` 顶部注释），改动时务必跑测试。

## 架构速览

```
用户点击
  → modules/ui.ts（界面）
    → ai/features.ts（编排：读全文、裁剪、调模型）
      → services/itemText.ts（全文提取 + 分块）
      → ai/tokens.ts（上下文预算）
      → ai/client.ts（请求 + 流式）
    → services/notebook.ts（写入笔记）
```

## 许可

贡献即表示你同意以 AGPL-3.0-or-later 发布你的代码。
