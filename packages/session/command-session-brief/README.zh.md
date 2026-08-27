# @deepseek-ai/dsh-command-session-brief

[English](README.md) | 中文

注册无参数 `/brief` 的 human-command Consumer。它针对接收 Agent 的会话调用 `ctx.sessionBrief.refresh()`，并把带类型的能力缺失、busy、取消、陈旧 revision、校验和 provider 失败映射为只面向人类的命令结果。

该命令不会把命令文本发送给模型，不会打开 Turn，也不会改变注意力排序。生成摘要自己的投影事件会更新 Context 消费方。

## 模型体验

间接通过 `ctx.sessionBrief`；其已注册 provider 可以启动独立的有界辅助请求。

#### KV Cache 影响

不影响主 Agent 请求。

## 已知限制与延期工作

- Client 接收命令 admission 与渲染后的命令结果是分离的；生成失败显示在命令 flow 中，并保留上一份摘要。
- 命令不接受自定义 prompt 或来源选择参数。