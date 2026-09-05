# 调研:Codex 的 token budget + 硬上下文切换 —— 本插件第三个功能的候选

> 状态:**仅调研,未实现**(2026-09-05)。结论先行:方向属实且已核实;
> 移植到本插件的可行形态是 `/qwen38-new-context`(硬重置命令),纯前端会话操作、
> 零 LLM 成本,建议作为 v0.4 候选。

## 1. Codex 在做什么(已核实的事实)

OpenAI Codex CLI 正在从"快满就让模型做摘要式 compaction"演进为
**"token budget 驱动 + 必要时硬切到全新上下文窗口 + 显式外部记忆(history/notes)"**。
截至 2026-09-05,这是**默认关闭的实验特性**,与仍在维护的摘要式 compaction 并存。

| 时间 | 事件 | 证据(均已在线核实) |
|---|---|---|
| 2026-06-20~24 | `Feature::TokenBudget` 内部 flag 系列:token 预算提示、context window lineage ID、`new_context`/`get_context_remaining` 工具、compaction 改硬重置 | openai/codex commits;PR [#29743](https://github.com/openai/codex/pull/29743) `core: reset context for token budget compaction`(merged 2026-06-23,描述原文:"compaction should behave like `new_context`: start a fresh context window … **without asking the server to summarize old history**") |
| 2026-08-21 | PR [#39827](https://github.com/openai/codex/pull/39827) 合并:`history`/`notes` 模型工具(列窗口/条目、读、搜索对话;持久化笔记的读写追加),解决"硬重置后怎么找回状态" | 同上,merged 2026-08-21 |
| **2026-09-03** | **rust-v0.153.0 正式发布**,发布说明白纸黑字:新增默认关闭的 `features.context_management.experimental_mode`;对符合条件的 ChatGPT Plus/Pro/Pro Lite + Codex 后端会话激活 token-budget context、history notes、`new_context` 工具;API key / 自定义 provider 被排除 | [release rust-v0.153.0](https://github.com/openai/codex/releases/tag/rust-v0.153.0)(published_at 2026-09-03T01:37:38Z,PR #42385) |

核心语义对比:

| | 旧式摘要 compaction | TokenBudget 硬切换 |
|---|---|---|
| 触发 | 上下文阈值 | token budget(模型可见剩余量) |
| 动作 | 调模型总结历史 → 替换 | **直接开新窗口,不调模型** |
| 记忆恢复 | 摘要本身 | `history.*` 查原始记录 + `notes.*` 持久化笔记 |
| lifecycle | compaction 事件(保留兼容) | 仍发 compaction 事件("叫 compaction,实际不做总结") |

动机:长任务里"摘要是状态"暴露问题——摘要漏掉路径/失败实验/边角配置,agent
反复重新探索(codex issue #34095:一个超长线程 24 次 compaction 后收敛性下降)。
新范式把"持久化"从 transcript 转移到环境本身(仓库、git、文件、笔记)——**对本地
coding agent 场景尤其成立:代码都在磁盘上,窗口可以丢**。

## 2. 对本插件的启示

本插件服务的是**本地 llama.cpp + Qwen3.8-27B + dsh** 场景。Codex 方案里:

- **token budget 感知注入**(每轮提示剩余 token)——dsh 没有给插件的 per-request
  上下文注入钩子,做不了(除非改 dsh 本体);
- **history/notes 工具**——dsh 会话日志本身就是完整 append-only 历史(压缩只改
  surface,不改事件流),`history.*` 的等价物其实已经存在:被 shadow 的节点仍在
  `session.v2.jsonl` 里可查;`notes.*` 等价于工作区文件。所以这两个工具**不需要实现**;
- **硬重置原语(`new_context`)**——dsh 的 surface `replace` 操作 + compaction 事件
  序列天然支持,插件层可实现(见下)。

## 3. 候选功能设计:`/qwen38-new-context`(v0.4)

**语义**:把会话 surface 整体替换为一个极小的"新窗口起点"标记,**不调用模型做摘要**。
与 `/qwen38-compact` 的关系:后者是"有损但尽量保信息"(要跑 LLM,大会话走分片,
本地 27B 上可能十几分钟);前者是"干脆利落地断片"(秒级、零 token 成本),赌的是
**任务状态在环境里**(代码/文档/git 都在磁盘上),模型可以重新从环境里读。

### 路径 A(建议先做):纯硬重置,零 LLM 调用

- 复用现有命令注册机制(`ctx.inject(['commands','sessions',...])`);
- 会话事件序列:`compaction/start` → `compaction/summary`(内容=固定短文本,如
  "[上下文已于 HH:MM 手动重置;此前对话历史已丢弃,环境与文件状态不变。]")→
  `user/message {surfaceOp:{op:'replace',start,end}}` → `compaction/end`;
- **实现前必须核实**:dsh session 层是否强制要求 `compaction/summary` 事件、
  summary 是否有格式校验(BasicCompactionEngine 总是发,但协议是否允许任意文本
  需查 core/session 的 commit 校验);若不允许,退路是走 `BasicCompactionEngine`
  但 monkey-patch 其 summarize(不可取)或直接构造最小合法 checkpoint;
- 保留策略可选:默认全丢(retainTokens=0),可加"保留最后 N 条"参数。

### 路径 B(后续增强):handoff note + 硬重置,一次廉价 LLM 调用

对应 Codex 的 "fallback buffer note-taking":重置前让模型**只基于最近一小段
surface**(不是全量历史!)写一份结构化交接——当前目标 / 已完成 / 下一步 / 关键
文件路径 / 未决问题(输出上限 ~2K tokens),然后 surface 替换为该 note。
- 提示词短 → 单次调用秒级完成,不受"超窗"困扰(这正是 Codex 用 notes 而非
  full-summary 的原因);
- 走现有 wire 层(关思考/采样/floor/去 tools)天然可靠;
- 对纯问答类会话(状态不在环境里)比路径 A 友好得多。

### 明确不做

- token budget 提示注入(dsh 无钩子);
- history/notes 工具(dsh 事件流 + 工作区文件已覆盖其价值)。

## 4. 风险与开放问题

1. **协议合规**:硬重置的 compaction 事件序列能否通过 session commit 校验(见上);
2. **UX 歧义**:用户可能分不清 `/qwen38-compact`(保信息、慢)与
   `/qwen38-new-context`(断片、快),命令名与提示文案要写清;
3. **不可逆性**:硬重置后模型视角的历史没了(事件流仍在磁盘,但 surface 不回滚);
   建议执行前在 UI 上明确二次确认语义(命令本身即显式动作,可接受);
4. Codex 自己的 followup 也印证这条路径还在打磨:模型切换时旧上下文元数据残留、
   `/compact` 后恢复会话基线丢失等——我们实现时应保留"重置前 surface 快照"的
   日志记录(事件流天然满足)。

## 5. 参考链接

- [rust-v0.153.0 release notes](https://github.com/openai/codex/releases/tag/rust-v0.153.0)
- [PR #29743 — reset context for token budget compaction](https://github.com/openai/codex/pull/29743)
- [PR #39827 — history and notes tools](https://github.com/openai/codex/pull/39827)
- [compact_token_budget.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/compact_token_budget.rs)
- [new_context_window tool spec](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/new_context_window_spec.rs)
- [issue #34095 — repeated auto-compaction degrades long tasks](https://github.com/openai/codex/issues/34095)
- [issue #33310 — atomic handoff primitive proposal](https://github.com/openai/codex/issues/33310)
