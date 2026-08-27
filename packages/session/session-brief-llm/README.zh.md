# @deepseek-ai/dsh-session-brief-llm

[English](README.md) | 中文

通过 `ctx.llm` 生成结构化恢复工作摘要的具体 `ctx.sessionBrief` provider。它在精确 UTF-8 预算内选择当前会话事实，在调用前记录可分发请求，执行端到端 deadline，验证单个原始 JSON object，并记录不含内容的路由、结果、耗时和 token usage。

## 输入策略

选择过程使用当前折叠消息 surface，以及截至协调器固定 `sourceSeq` 的最新标题、Goal、Todo、Turn 结果和未配对工具名称。它排除被替换的消息、reasoning、工具参数、工具结果、凭据和文件。`maxInputBytes` 内优先保留最新事实；JSON frame 会报告省略的事实数量。

Transcript 字符串是不可信数据。系统指令禁止执行嵌入其中的指令、权限声明、角色文本和工具请求。请求不暴露工具，并使用 `purpose: 'session-brief'`；DeepSeek adapter 会为该 purpose 关闭 thinking。

## 输出策略

Provider 只接纳符合文档字段的 schema version 1 JSON。Markdown wrapper、外围文本、未知 key、空必需文本、超限数组、工具调用、非 stop finish 和不属于精确选定 seq 集合的引用都会使生成失败。每个本地拒绝都会记录稳定的 `SESSION_BRIEF_*` code，但不记录 provider 输出；协调器执行最终的重复项、字节、revision 和陈旧来源检查。

## 配置

| 字段 | 必需行为 |
| --- | --- |
| `maxInputBytes` | 精确 JSON-framed 用户输入的正整数上限 |
| `maxOutputTokens` | 辅助输出 token 的正整数上限 |
| `timeoutMs` | 不超过运行时 timer 上限的正整数端到端 deadline |
| `provider`, `model` | 可选的非空路由对；缺席时使用已记录的会话路由 |

## 审计与隐私

`session/brief-llm-request` 在分发前记录精确 system 文本、messages、选定 seq、路由、schema version 和 token 上限。`session/brief-llm-result` 记录耗时、结果、provider 报告的 token usage 和不含内容的错误 code。两者都携带 `ignorable: true`，并位于派生模型历史之外。

规范日志保留精确请求以供本地审计和重放。本包的 telemetry 规则会在对外报告前删除 system 和 message 内容，同时保留路由、来源 seq、schema version 和 token 上限。仓库没有 provider-neutral 的货币定价注册表；token usage 是持久的计费输入。

## 模型体验

### 辅助会话摘要请求

#### 模型可见内容

辅助模型接收固定的抗注入系统指令，以及一条包含选定当前会话事实的有界 JSON 用户消息。它不会收到主 Agent 工具、reasoning 历史、工具参数、工具结果、凭据或文件。

#### Token 影响

独立请求消耗选定输入和最多 `maxOutputTokens`；provider 报告的 usage 会在不包含内容的情况下记录。生成输出不控制权限、调度、取消、运行状态或注意力优先级。

#### KV Cache 影响

不影响主 Agent。Provider 发起独立的一次性请求，不改变主请求前缀。

## 已知限制与延期工作

- Provider 可能不报告 token usage；没有路由特定的定价权威时不会推断货币金额。
- 输入选择识别当前已记录文本和结构化事实，但不检查任意工具输出或文件。
- 离线结构测试会机械拒绝不支持的 claim；事实质量仍需真实 provider 评估。