# Qwen3.8 (llama.cpp) Compaction Fix

给 **llama.cpp 网关**(本机经 Unsloth Studio 启动的 `llama-server`)上的本地
**qwen3.8-27b** 修复 dsh(DeepSeek Harness)压缩(compaction)问题的插件。它做两件事:

1. **压缩时不思考**:dsh 发起的两个辅助调用(压缩摘要、会话标题生成)只针对这些调用
   关闭 thinking,并套用模型"非思考模式"推荐的采样参数;正常对话、子代理、其他模型
   一律原样透传,一个字节都不动。
2. **超大上下文切换救援**:当你先用 1M 上下文的模型聊了很久,再切到 250k 上下文的
   Qwen3.8-27B 时,dsh 的单次摘要调用装不下整段对话,会报"无法压缩"并反复溢出。
   本插件在 fetch 层检测到这种情况后,自动把对话切成多片逐片摘要、再合并成最终
   checkpoint,让压缩照常完成。

> **范围:llama.cpp 网关。** 本文档中的所有 wire 字段均在
> llama.cpp build 10798(Unsloth 团队编译)+ Unsloth Studio(:8880 OpenAI 兼容端点)
> + `Qwen3.8-27B-UD-Q4_K_XL.gguf` 上实测验证。其他引擎(vLLM、FastMTP、NInfer……)
> 的 wire 参数不同,不在本插件范围内(NInfer 版本见姊妹项目
> [dsh-qwen38-ninfer-compaction-fix](https://github.com/zhubaohi/dsh-qwen38-compaction-fix))。

---

## 需求抽象(这个插件到底在解决什么)

### R1 — 辅助调用不能思考

本地 qwen3.8-27b 的默认行为是**每次调用都思考**(实测:普通请求返回非空的
`reasoning_content`)。dsh 的压缩摘要和会话标题生成走的是对话自己的路由,输出预算很小
(标题只有 64 token)。模型把整个输出预算花在 reasoning token 上,`max_tokens` 用尽时
正文一个字都没写出来:

- 压缩 → `summarization truncated at the token cap (incomplete checkpoint)`,会话被压成一段截断文本;
- 标题 → 全部回退到"取第一句提示词"的兜底。

**对策(只作用于这两个辅助调用,绝不全局关思考):**

| 层 | 机制 | wire 字段 |
|---|---|---|
| `llm/stream` 瀑布 | 给 `purpose: compaction` 且模型在允许列表内的调用打上 `reasoningEffort: "off"`(仅当 settings.yaml 里该模型声明了可表达的 reasoning efforts 时生效) | 经 pi-ai 映射为 `reasoning_effort` |
| HTTP 压缩请求体 | 合并 `enable_thinking: false` 进 `chat_template_kwargs`(保留已有其他 kwarg);写入 `reasoning_effort`;套用非思考采样参数;把被 pi-ai 客户端钳制塌缩的 `max_tokens` 抬回 floor(只升不降) | `chat_template_kwargs.enable_thinking=false`、`reasoning_effort="none"`、`temperature/top_p/top_k/min_p/presence_penalty/repetition_penalty`、`max_tokens` |
| HTTP 标题请求体 | 同样写两个 thinking-off 字段;不动标题插件自己设的 `max_tokens` | 同上(前两个) |

两个 thinking-off 机制**都实测有效且互相独立**(llama.cpp build 10798 既接受
`chat_template_kwargs.enable_thinking`,也把 `reasoning_effort` 映射进 Qwen3 聊天模板),
默认同时下发,双保险;可分别关闭。

### R2 — 对话比目标模型窗口还大时,压缩必须还能完成(另一种 compact 策略)

dsh-compaction-basic 的摘要永远是**单次 LLM 调用**:把待压缩区间整段重放为输入。
在 1M 窗口模型下聊出的会话(比如 300k~900k token)切到 250k 窗口的 Qwen3.8-27B 后,
**摘要请求本身的输入就超过窗口**:服务端拒绝 → 每次重试同样溢出 → 表现为"无法压缩"
+ 每轮都报 context overflow,会话卡死。

单次摘要在数学上就不可能装下这种对话,所以必须换策略:**分片 map-reduce**。
本插件在 fetch 层(请求体已经定型、但还没发出去的地方)做这件事:

1. 估算压缩请求体的 prompt token 数(CJK 按 ~1 token/字保守估计,其余按 chars/4);
2. 超过 `chunkRatio × contextWindows[模型]` 时,**不再转发原请求**,改为:
   - 把消息区间切成连续分片(每片输入 ≤ 预算;leading system/developer 消息随每片重发并计入预算;`tool` 角色消息永不落在分片开头,避免与 assistant `tool_calls` 分离;单条消息超预算时仅对内部调用做头尾截断,**不动持久化的对话表面**);
   - 逐片顺序调用(非流式、thinking off、带采样参数),每片末尾原样附上 dsh 的压缩指令;
   - 用最后一次调用把各分片的 partial checkpoint(包在 `<compacted-summary>` 里)合并成最终 checkpoint(合并输入也超预算时自动做两级层次合并);
   - 以标准 OpenAI 响应格式把最终 checkpoint 交还给 dsh:原请求是流式就回 SSE 流(期间每 15s 发 keep-alive ping,防止 pi-ai 的 300s 流空闲超时杀掉多分钟的救援),非流式就回 JSON。
3. **失败语义全部 fail-open**:模型窗口未配置、分片数超过 `maxChunks`、请求体解析失败 → 原样转发(退化为今天的行为);救援中途某片/合并最终失败(各重试一次后)→ 流以**空正文**结束,dsh-compaction-basic 会干净地拒绝("summarization produced no text summary content")并保留完整对话表面——与今天溢出失败的结局相同,绝不更差。

注意:分片模式放弃了 KV cache 前缀复用(每片前缀不同),总 prompt 处理量 ≈ 整段对话
大小。对 27B 本地模型这是一次性的几分钟到几十分钟开销(只在切换模型后首次压缩时发生),
换来的是会话可以继续使用而不是卡死。

---

## 安装(一句命令)

前置:你的 DSH home 是 `~/.dsh-dev`(shell 函数 `dsh-dev()` 已设置
`DSH_HOME=$HOME/.dsh-dev`)。插件源码在
`~/Downloads/aigc/proj/deepseek/dsh-plugins/dsh-qwen38-llamacpp-compaction-fix/`。

**安装/重装就是这一句**(实测:`dsh plugin add` 会自动把插件写进 profile 的
`dependencies` **和** `dsh.profile.bundles` 两处,不需要手改任何配置文件):

```sh
dsh-dev plugin --profile web add /home/wwt/Downloads/aigc/proj/deepseek/dsh-plugins/dsh-qwen38-llamacpp-compaction-fix
```

然后**重启 `dsh web`**(或刷新 GUI 页面)即生效。装完后 profile 里是
`link:` 软链指向源码目录——改插件源码后重载/重启即可,无需重装。

嫌命令长可以加个别名(写进 `~/.bashrc`):

```sh
alias dshfix='dsh-dev plugin --profile web add /home/wwt/Downloads/aigc/proj/deepseek/dsh-plugins/dsh-qwen38-llamacpp-compaction-fix'
```

卸载:`dsh-dev plugin --profile web rm dsh-qwen38-llamacpp-compaction-fix`

### 从本仓库安装(新机器/新目录)

```sh
git clone https://github.com/IamWWT/dsh-qwen38-llamacpp-compaction-fix.git
dsh-dev plugin --profile web add <克隆路径>/dsh-qwen38-llamacpp-compaction-fix
# 重启 dsh web(或刷新 GUI 页面)
```

安装后按[使用与配置](#使用与配置)一节,把 `models` 和 `chunking.contextWindows`
改成你网关实际上报的模型 id 与上下文窗口。

**验证是否装上:**

- 触发一次压缩(或等自动压缩)后,dsh 日志里应出现:
  `qwen38-llamacpp-compaction-fix: rewriting compaction request bodies (thinking off, sampling: ...)`;
- 切小模型后的超大对话首次压缩时会出现:
  `qwen38-llamacpp-compaction-fix: compaction prompt (~N tokens) exceeds one call for "Qwen3.8-27B-GGUF" (...); running chunked map-reduce with K slices + merge`
  以及逐片的 `summarizing slice i/K`、`merging ... partial checkpoints`、`chunked compaction complete`。

> 插件源码目录里有一个指向 dsh 全局安装的 `node_modules` 软链(仅用于本地跑测试,
> 已 gitignore),不影响安装;删除后请在 profile 的 node_modules 路径下跑测试。

## 使用与配置

### 网页设置卡片(推荐)

dsh web 的 **设置 → 插件 → 插件配置** 里有本插件的卡片
(`Qwen3.8 llama.cpp 压缩修复`),全部字段可视化编辑:

- 常用项:适用模型 ID、上下文窗口(tokens)、压缩/标题调用关闭思考、
  reasoning_effort 字段值、max_tokens 下限、超大对话分片救援;
- “高级参数”折叠区:六个采样参数 + 四个分片调优参数。

编辑后点 **保存** 即写入 `settings.yaml` 并实时生效(无需重启);带“已覆盖默认值”
徽章的字段点徽章可暂存一个“恢复默认”操作,保存后该键从 settings.yaml 移除、
回落到插件内置默认。卡片与直接编辑 settings.yaml 等价——同一份数据、同一个
命名空间 `qwen38-llamacpp-compaction-fix`。

> 前提:插件通过 `dsh plugin add` 安装(见上节)。浏览器半是随包自带的
> `client.js`(自包含 bundle,无构建步骤);若你的 dsh 版本太老没有
> `dsh.client` 双半机制,卡片不会出现,但 settings.yaml 配置方式不受影响。

### 手改 settings.yaml(等价方式)

所有键都是可选的,默认值由 schema 补齐。优先级(高→低):

1. `$DSH_HOME/settings.yaml`(即 `~/.dsh-dev/settings.yaml`)里的
   `qwen38-llamacpp-compaction-fix:` 段 —— **实时生效,无需重启**;
2. profile 里插件行的 `config:` 块(`cordis.patch.yml`,下次 GUI 加载时生效);
3. 插件内置默认值。

`~/.dsh-dev/settings.yaml` 示例:

```yaml
qwen38-llamacpp-compaction-fix:
  effort: off            # "" 关闭 effort 策略
  models: [Qwen3.8-27B-GGUF]   # 精确 id;[] 关闭整个策略
  sampling:              # 原样写入压缩请求体(wire 字段名)
    temperature: 0.7
    top_p: 0.8
    top_k: 20
    min_p: 0.0
    presence_penalty: 1.5
    repetition_penalty: 1.0
  maxTokensFloor: 16384  # 0 关闭 floor
  wireReasoning: none    # "" 关闭 reasoning_effort 字段写入
  enableThinkingOff: true   # false 则从不写 chat_template_kwargs
  chunking:              # R2 救援策略
    enabled: true
    contextWindows:      # 模型 id -> 实际上下文窗口(token);未列出的模型绝不分片
      Qwen3.8-27B-GGUF: 262144
    chunkRatio: 0.7
    chunkMaxTokens: 8192
    mergeMaxTokens: 16384
    maxChunks: 8
```

| 键 | 默认 | 含义 |
|---|---|---|
| `effort` | `"off"` | 瀑布层给匹配调用打的 reasoning effort。取值顺序:配置值 → `off` → `low`;模型一个都不提供时保持模型默认(仅当 wire 层 thinking-off 也全关时才告警一次)。`""` 关闭该策略。 |
| `purposes` | `["compaction"]` | 瀑布层作用的 LLM 调用 purpose 标签。 |
| `models` | `["Qwen3.8-27B-GGUF"]` | 精确模型 id(大小写敏感,取 settings.yaml 中 `llm-pi-ai.providers.<provider>.models[].id`)。空列表关闭整个策略。**见下节"模型名必须匹配"。** |
| `sampling.*` | `{}` | 原样写入压缩请求体的采样参数;缺省键不写。默认值即 Qwen3 非思考模式官方推荐参数,且全部被 llama.cpp 接受(实测)。 |
| `maxTokensFloor` | `16384` | 压缩请求体 wire `max_tokens`/`max_completion_tokens` 至少抬到该值;绝不降低。`0` 关闭。 |
| `wireReasoning` | `"none"` | 写入匹配请求体的 `reasoning_effort` 值(llama.cpp build 10798 接受并映射进 Qwen3 模板)。`""` 关闭该字段写入。 |
| `enableThinkingOff` | `true` | true 时把 `enable_thinking: false` 合并进请求体 `chat_template_kwargs`(保留其他 kwarg);false 则从不触碰该字段。 |
| `chunking.enabled` | `true` | R2 救援总开关。 |
| `chunking.contextWindows` | `{}` | 精确模型 id → 上下文窗口(token)。**必须填 llama-server 实际运行的 n_ctx**(在 llama-server 端口查 `GET /v1/models` → `details.n_ctx`;Unsloth Studio 切换 GGUF 后可能变化)。未列出的模型绝不分片(fail-open)。 |
| `chunking.chunkRatio` | `0.7` | 单次内部调用的输入预算 = 窗口 × 该比例(其余留给指令、估算误差与输出上限),取值 (0,1]。 |
| `chunking.chunkMaxTokens` | `8192` | 单个分片摘要的输出上限。 |
| `chunking.mergeMaxTokens` | `16384` | 最终合并 checkpoint 的输出上限。 |
| `chunking.maxChunks` | `8` | 单次救援的分片数安全上限;超出的区间 fail-open(转发原请求并告警)。 |

调用自身显式携带的 `reasoningEffort` 永远优先于插件默认值。

### 会话已经卡死(CONTEXT_WINDOW_EXCEEDED)怎么办

本插件只能改写**实际发出的压缩调用**;如果 dsh 根本不发压缩调用,插件无物可改。
两个已踩过的坑:

1. **极简模式(minimal preset)不含压缩引擎**(standard 才有 `compaction-basic`)。
   minimal 会话溢出时不会自动压缩,每轮直接报 `CONTEXT_WINDOW_EXCEEDED` 卡死。
   解法:在会话输入框的预设选择器里把该会话从“极简模式”切到**标准模式**,再发任意
   消息——压力检查会先触发一次完整压缩(本插件保证这次调用关思考、带采样参数、
   超窗时自动分片),压缩完成后对话回到窗口内,即可继续。本地 27B 上首次压缩
   可能要十几分钟到半小时,属正常。
2. **给模型打 effort 戳的前提是模型声明了 reasoning 能力**。pi-ai 对“未声明
   reasoning 的模型 + 任意 `reasoningEffort`(包括 `off`)”直接抛
   `UNSUPPORTED_REASONING_EFFORT`——任何想给压缩调用关思考的上游组件(本插件的
   effort 层、或第三方压缩插件)都会因此让压缩整体失败。本插件对此是安全的:
   模型未声明能力时 effort 层自动静默,只靠 wire 层(`chat_template_kwargs` +
   `reasoning_effort`)关思考。若你在 settings.yaml 给模型声明了
   `reasoningEfforts`(至少含 `off` 和一个更高档),effort 层才会真正打戳。

### 模型名必须匹配:先读这段

插件只在出站请求的 `model` 字段命中 `models` 允许列表时动作:**精确 id 匹配,不是
家族/子串匹配**(写入的采样参数是这个模型专属的)。被比较的 id 是你在
`~/.dsh-dev/settings.yaml` 的 `llm-pi-ai.providers.qwen.models[].id` 里声明的值——
也就是 dsh 放进每个出站请求 `model` 字段的值,不是网关内部的名字。

本机现状:Unsloth Studio 把加载的 GGUF 以 **`Qwen3.8-27B-GGUF`** 上报(实测
`GET /v1/models`,无论底层是 UD-Q4_K_XL 还是其他量化),settings.yaml 里声明的也是它,
所以默认值直接可用。如果你在 Unsloth Studio 里切换了模型、或网关上报的 id 变了:

1. `curl http://127.0.0.1:<llama-server端口>/v1/models` 看实际 id;
2. 把它加进 `models`(R1)和 `chunking.contextWindows`(R2,值用该模型的 n_ctx)。

**没有任何匹配时插件静默不动作**:所有请求逐字节原样通过,不告警。装了插件却仍见
截断 checkpoint / "无法压缩",先查模型 id。

## 工作原理(五层)

1. **`llm/stream` 瀑布**:对 `purpose` ∈ `purposes` 且 `options.model` ∈ `models` 的调用,
   解析模型提供的 reasoning efforts 并就地打 effort 戳(配置 → `off` → `low`)。
2. **HTTP 压缩请求体 thinking-off + 采样 + floor**:包装进程全局 `fetch`;当 chat
   completion 请求体携带 dsh-compaction-basic 的压缩指令签名(稳定的首行,作为最后一条
   user 消息)且 `model` 命中允许列表时:合并 `chat_template_kwargs.enable_thinking=false`、
   写 `reasoning_effort`、套用采样、抬升 `max_tokens`(只升不降)。
3. **HTTP 标题请求体 thinking-off**:当请求体携带 dsh-session-title-llm 的系统提示签名
   (system/developer 角色前缀匹配)且 `model` 命中时,写同样的两个 thinking-off 字段;
   不动标题插件自己的 `max_tokens`(64)。
4. **HTTP 超大压缩救援**(R2):见上文"需求抽象 R2"。
5. 以上 HTTP 层的身份识别依赖 dsh 随版本发布的指令文本;若未来 dsh 改了这些指令,
   对应 HTTP 门会静默失配(请求保持 wire 默认值),effort 层不受影响,且所有守卫
   fail-open,永远不会弄坏 LLM 流量。

## 限制

- **引擎范围:llama.cpp。** 重写的 wire 字段是 llama.cpp(Unsloth build)解释的那套;
  其他网关请换用对应移植版。
- 模型匹配为**精确 id 匹配**,见上节。
- R2 的 token 估算是保守启发式(CJK ~1 token/字,其余 chars/4,图像块按 1024/块):
  宁可多切一片,不可漏切溢出。估算偏大会导致"本可单次完成却走了分片",代价只是慢一点。
- R2 分片模式无 KV cache 复用,总耗时 ≈ 整段对话的 prompt 处理时间(本地 27B 上为
  分钟~几十分钟级的一次性开销);若网关自身有请求超时且单片处理超过它,该次救援会
  fail-open 回原行为(日志有告警),可下调 `chunkRatio` 减小单片。
- 单条消息超预算时,仅对内部摘要调用做头尾截断;checkpoint 可能丢失该消息中间段内容
  (持久化对话表面不受影响,后续正常压缩会重新看到完整内容)。
- HTTP 层签名跟随特定 dsh 版本;dsh 升级后若失配,见"工作原理"第 5 条。

## 测试

- `test/smoke.mjs` — 门控逻辑冒烟(37 例):允许/拒绝模型、缺 model、空允许列表、
  签名引用回归用例、chat_template_kwargs 合并、thinking-off 关闭时采样/floor 仍生效、
  token 估算(CJK 保守)、分片(tool 配对、预算、截断)、内部请求体构造。
- `test/rescue-e2e.mjs` — R2 端到端(29 例,mock 传输):3 分片 + 1 合并的调用序列、
  每片 thinking-off/采样透传、tools 剔除、SSE 合成流(role delta → 单一 content chunk →
  stop → [DONE])。
- `test/integration-fetch.mjs` — 集成(11 例):用与 cordis.patch.yml 相同的配置驱动
  **真实安装的 fetch wrapper**:~405k token 的压缩请求触发救援(原请求绝不转发、
  4 次内部调用全部 thinking off + 采样、SSE 流合法);小压缩单次转发且就地改写;
  标题请求只写 thinking-off;非允许模型逐字节透传。
- 对真实网关的实测(llama.cpp build 10798,经 Unsloth Studio :8880):

| 用例 | 结果 |
|---|---|
| 默认请求(小问题) | `reasoning_content` 非空 —— 确认默认思考 |
| + `chat_template_kwargs.enable_thinking=false`(流式/非流式、含难题) | `reasoning_content` 恒为空 —— thinking 关闭生效 |
| + `reasoning_effort="none"` | 同上,独立生效 |
| + 全部采样字段(`temperature/top_p/top_k/min_p/presence_penalty/repetition_penalty`) | 正常接受,无报错 |

运行测试(插件目录内):

```sh
node test/smoke.mjs && node test/rescue-e2e.mjs && node test/integration-fetch.mjs
```

## License

MIT. See [LICENSE](./LICENSE).
