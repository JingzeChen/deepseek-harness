# @deepseek-ai/dsh-session-activity

[English](README.md) | 中文

注册 `sessionActivity` 投影单元的函数插件。它将持久会话事件折叠为有界的最新活动、最近轮次和未配对工具事实，供列表与总览客户端使用。投影不包含消息文本、工具参数、工具结果或错误消息。

## 投影语义

- 已完成组装的用户和 assistant 消息更新 `lastKind: 'message'`。
- 工具调用和结果更新 `lastKind: 'tool'`。未配对调用保持模型顺序；客户端值最多包含 `maxOpenTools` 条记录，其余数量写入 `openToolsOmitted`。
- `turn/end` 为已知核心原因更新 `lastTurn`，并清除该轮次的未配对调用。正常结束的轮次不表示目标已经完成。
- Goal 变更、Todo 写入、持久 Workflow 记录和成功的压缩结束事件更新各自的活动类型，不复制领域载荷。
- 原始 chunk、请求记录、失败的压缩尝试、投影内部记录和无关扩展事件返回同一个状态引用，不发出投影变更。

错误结果只暴露受 UTF-8 字节上限约束且与 provider 无关的 `errorCode`。provider 消息保留在会话日志中，不复制到跨会话投影。

## 配置

| 字段 | 必需行为 |
| --- | --- |
| `maxOpenTools` | wire 值中未配对工具记录的正整数上限 |
| `maxErrorBytes` | 对外暴露错误 code 的正整数 UTF-8 字节上限 |

状态和 wire schema 会强制执行这些上限。降低 `maxErrorBytes` 时，如果旧 checkpoint 中存储的 code 超过当前上限，该 checkpoint 会被拒绝，因此投影注册表会在提供结果前重新折叠会话日志。

## 组合

```yaml
- id: session-activity
  name: '@deepseek-ai/dsh-session-activity'
  config:
    maxOpenTools: 3
    maxErrorBytes: 64
```

插件注入 `sessionProjections`。未提供投影注册表的 assembly 不会注册此单元。

## 模型体验

无，因为插件只根据已记录的会话事件计算面向客户端的读取模型，不接触 prompt、消息、工具 schema、provider 请求或工具结果。

#### KV Cache 影响

无；插件不会组装或发送模型请求。

## 已知限制与延期工作

- **父会话中没有持久的 subagent settlement 事件** — fold 不从 live `subagent/end` 事件或子会话 descriptor 推断 settlement；未来可通过持久的父会话事件增加 `lastKind: 'subagent'`，而不把进程本地状态当作可重放事实。
- **投影不提供错误消息** — 在经过审查的脱敏策略能够保证选定消息文本可安全用于跨会话显示之前，只暴露有界且与 provider 无关的 code。
- **活动只记录事实，不判断目标真伪** — 空闲状态、已结束轮次和已完成 Todo 与显式 Goal 完成保持分离，由消费方 Client 推导。
- **仅挂载于 Web app bundle** — 其他 assembly 只有显式组合此插件才会提供 `sessionActivity` key。
