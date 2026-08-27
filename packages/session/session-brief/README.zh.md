# @deepseek-ai/dsh-session-brief

[English](README.md) | 中文

有界生成式会话摘要的 Service Definition 与协调器。服务负责 provider 注册、显式刷新与配置驱动的自动刷新、每会话 revision 隔离、取消、接纳值校验、后写覆盖的 `sessionBrief` 投影以及默认 telemetry 最小化。没有注册 provider 时，确定性会话上下文仍然可用。

## 语义

`refresh(session, signal)` 返回带类型的 `accepted`、`unavailable`、`busy` 或 `failed` 结果。存在 live Agent 时，它通过 `Agent.runMaintenance()` 运行，因此生成不会与 Turn 竞争。更新的有意义活动会取消已保留的 revision；provider、会话与服务卸载会取消并等待活动调用收敛。

已接纳的 `session/brief` 包含完整当前值，携带 `ignorable: true`，且绝不会进入模型 surface。服务会规范化空白，但拒绝空文本、未知字段、重复列表项、请求之外的引用、超出数量限制的条目和超过 `maxBriefBytes` 的值。失败时保留上一份有效摘要。

## 配置

| 字段 | 必需行为 |
| --- | --- |
| `automaticTriggers` | `turn-end`、`goal-blocked` 和 `turn-error` 的唯一子集；空数组只允许显式生成 |
| `minMeaningfulEvents` | 上一份已接纳自动摘要之后所需的正整数活动增量 |
| `maxBriefBytes` | 完整已接纳事件值的正整数 UTF-8 上限 |
| `maxItemsPerField` | completed、blocker 和来源引用的正整数条目上限 |

## Provider contract

只能注册一个 provider。它接收截至固定 `sourceSeq` 的不可变事件、上一份摘要、可用时已记录的主请求路由、服务拥有的输出限制和 `AbortSignal`。它返回完整候选值、精确来源事件 seq 和辅助 provider/model 路由。

## 隐私

规范会话日志保留生成摘要以支持重放。本包的 `session-telemetry/record` 规则会把对外摘要 body 替换为 revision、新鲜度、条目数量、路由和引用元数据，因此默认不会导出生成文本。

## 模型体验

无，因为服务会校验并投影 provider 输出，但本身不组装或发送模型请求。

#### KV Cache 影响

不影响主 Agent 请求。服务既不改变派生历史，也不组装主请求。

## 已知限制与延期工作

- 自动生成依赖已组合的 provider。Web bundle 启用 Turn-end、Goal-blocked 和 Turn-error checkpoint，并要求两个有意义事件的增量；其他 deployment 可以选择自己的子集或保持手动生成。
- 首个实现只协调一个 Host 进程；多个 Host 读取同一持久化目录时不会通过 lease 协调生成。
- 服务验证引用和结构，不判断事实真伪。确定性的 Goal、Todo、活动、交互和 Agent 状态仍是权威来源。