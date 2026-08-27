# Agent Note: DSH 信标

Status: proposed

[English](2026-08-25-session-context-hub.md) | 中文

## Problem

用户可以并行运行大量独立会话，但当前 Web 导航主要回答会话位于何处，以及它是否正在运行或等待已知交互。恢复工作仍然需要从每份 transcript（文本记录）中重建目标、当前重点、进度、阻塞项和最近结果。重复轮询与心理重建会成为并行使用 Agent 的主要成本。

仓库已经拥有持久会话事件、实时 Agent 状态、待处理交互帧、Goal 和 Todo 投影、冷投影缓存以及 Client 对象层。新功能必须组合这些权威来源，不能把它们复制到另一个可变状态模型中，不能把空闲 Agent 当作已完成工作，也不能让 LLM 摘要成为运行状态的权威来源。

## Proposal

完成单 Host Web profile 的 DSH 信标，并遵循[技术设计](../../../../docs/session-context-hub-technical-design.zh.md)中的需求、当前实现和剩余目标行为。

当前实现已提供活动与摘要投影、有界 LLM 提供方、自动与显式摘要生成、可拖动活动 beacon、Document Picture-in-Picture 活动窗口、按注意力排序的工作台、浏览器本地审阅偏好、现有交互适配器和 Session-scope Context tab。该 umbrella proposal 仍处于 proposed 状态，因为现有会话浏览器没有 DSH 信标贡献，`changed` 没有有界的时间顺序 delta 列表，多项目标管理操作仍不属于工作台，而且完整容量、重连、冷缓存、多标签页、授权、GIF 和已配置提供方证据尚未齐备。

该功能使用 3 类状态：

- 有界 `sessionActivity` 投影从持久事件中折叠最后有意义活动、最新轮次结果和未配对完成的工具调用。
- Client 从实时 Host 状态、待处理交互、队列与后台任务、现有 Goal 与 Todo 投影、活动以及用户本地审阅状态中推导注意力排序。
- 可选 `ctx.sessionBrief` 能力在稳定源修订处追加有界、结构化且只存在于日志中的摘要；确定性总览行为不依赖提供方。

Web 包在 `shell.overlay` 中注册实时活动 beacon 与按需全局工作台，并在 `conversation.view` 中注册每会话 Context entry。无数字、可在浏览器内定位的 beacon 负责环境式展示运行状态与待用户处理提醒；用户触发的 Document Picture-in-Picture 窗口可以让同一份实时投影在其他标签页与桌面应用上方保持可见。工作台负责跨会话比较、筛选、详情和管理操作，Session tab 在 Chat 与 Trajectory 旁负责有界确定性接管信息。工作台使用三个主要列，按条件增加 Workspace，折叠次要 context，并在窄屏使用独立列表与详情层级。三者只通过 Client 运行时读取会话业务状态，只有 root 界面共享包自有查看 store。

Client 列表对象层在注意状态旁保留当前可应答交互的已验证 request descriptor。工作台在点击时按 descriptor 的稳定 key 重新解析 approval、question 和 plan-review 响应，并通过现有 `PendingWait` 发送；steer 使用已选 Session 现有的 `prompt(..., 'steer')` 操作。这样可保留 Host receipt 与冲突行为，无需第二套交互协议或 React 拥有的业务镜像。

确定性 Client context 组合 Goal/标题、阻塞项或进行中 Todo 或活跃工具、有界已完成与待处理 Todo 文本、注意原因、bookmark 和活动序号。它为每个字段保留记录事实、Agent 维护和用户来源，并明确报告结构化进展缺失。生成摘要继续作为可选解释层，而不是 context 切换的前置条件。显式刷新使用现有 command Remote，因此 Context view 无需增加另一套 Host protocol 就能显示运行中状态，以及最终成功或不含敏感内容的失败。

Web composition 会在 Turn 结束、Goal 阻塞和 Turn 错误后自动生成，并要求至少两个新的有意义事件。协调器等待 Agent idle、合并来源 revision，而且在生成失败或 provider 缺失时保留确定性 context；其他 composition 可以保持空 trigger 集合。

## Status semantics

运行状态、轮次结果、检查清单进度和目标完成保持分离。`AgentStatus: idle` 只证明没有活跃 driver。`turn/end: completed` 只证明一个轮次正常关闭。已完成 Todo 项是 Agent 维护的检查清单声明。`goal.phase: complete` 是第一版实现消费的唯一现有显式目标完成状态。

注意力排序采用带原因代码的优先级：待人工操作、显式阻塞项、失败、运行、排队工作、显式 Goal 完成、上次查看后变化、暂停 Goal，最后是空闲。生成摘要文本不能使会话在这些类别之间移动。

## Persistence and freshness

活动和摘要值通过 Session Projection 注册表、API Proxy 现有列表基线和投影帧，以及用于冷会话的持久投影缓存传输。`session.list` 绝不会为了填充缺失值而打开每份冷日志。

每个已接受摘要事件都携带完整有界值、它覆盖的有意义源序列号、准确有序的源事件序列号、生成时间和提供方路由。更新的有意义事件会使该值可观测地变得陈旧。如果辅助结果的源修订在接受前不再是当前值，修订隔离会拒绝它。精确的分发前请求保留在规范日志中；独立且不含内容的结果记录携带路由、耗时、结果和 provider 报告的 token usage，用于成本计量。

用户审阅状态属于展示状态，而不是会话事实。第一版实现把它持久化到浏览器。跨设备审阅状态需要主体所有的 Host sidecar，不能从会话事件中推断。

## Scope limit

第一版实现观察附加到单个 Host 进程的 Agent。持久会话日志无法证明另一个进程中的 Agent 是否 live。因此，多 Host 支持需要独立的 presence 协调器，其中包括实例身份、Agent lease、heartbeat、失效、授权和聚合。

Agent Teams 任务仍然属于 Team 领域状态。独立顶层会话注意力不会重新解释 Team roster 或任务记录。未来的 Team 投影可以通过相同 Client 组合贡献有界概述。

## Model experience

确定性投影和浏览器查看状态不增加模型可见内容。`session/brief-llm-request`、`session/brief-llm-result` 和 `session/brief` 只存在于日志中，绝不会进入 `deriveMessages()`、系统提示词、工具 schema 或 `agent.inject()`。可选辅助请求有自己受限的 token 用量且不带工具；它不会使主 Agent 的 KV Cache 失效。Telemetry 默认只导出精确请求和生成摘要的元数据形式，而规范日志为本地重放保留两者。

## Alternatives considered

**完全使用 LLM 生成每一行。** 拒绝，因为运行、等待、失败和完成语义已经有权威来源。模型结果更慢、成本更高、执行期间会变陈旧，并且可能虚构完成或隐藏待决事项。

**复用压缩摘要作为用户接管摘要。** 拒绝，因为压缩针对模型上下文压力选择并重写历史。用户接管摘要在不同检查点选择当前目标、进度、阻塞项和下一步，而且必须在没有发生压缩时仍然有用。

**在会话日志之外存储一个非规范化总览对象。** 拒绝，因为它会重复 Goal、Todo、轮次和活动权威来源，并需要独立的回放与一致性协议。会话投影已经提供纯折叠、缓存检查点、列表基线和实时更新。

**直接向默认 Agent loop 添加状态字段。** 拒绝，因为 loop 已经发出所需持久事实和实时事实。产品解释应通过已记录扩展点中的独立投影和 Client 推导实现。

**把每个会话都视为 Agent Teams 成员。** 拒绝，因为独立会话没有共享 Lead、Team 任务 DAG、mailbox 或 Team 权限。用户级总览跨越会话，但不改变其协作模型。

**从最后一个持久事件推断跨进程运行状态。** 拒绝，因为崩溃、断线或长时间工具调用会使持久打开轮次具有歧义。正确的分布式 presence 需要 lease 和失效。

## Acceptance criteria

- 确定性总览在没有摘要提供方时正常工作，并且不会加载每份冷会话日志。
- 待人工交互优先于被动工作，状态文案绝不会把空闲、正常轮次关闭或 Todo 完成等同于目标完成。
- 生成摘要有界、通过 schema 校验、带源序列号、可取消、带来源标签，并且在接受前变得陈旧时被拒绝。
- 重连、Agent dispose、会话移除、fork、压缩、并行工具和运行中的 subagent 后代通过现有 Host 与 Client 状态所有者收敛。
- 总览操作使用现有授权与冲突行为；该功能不增加批量批准或自动回答。
- 投影和遥测默认排除原始工具参数、结果、推理内容、凭据和不受限 transcript 内容。
- 包、Host、Client 运行时、GUI、无密钥浏览器 snapshot（快照）、真实流程 GIF 和已配置提供方 e2e 覆盖符合技术设计的测试矩阵。

## Risks

生成摘要仍然可能遗漏上下文或把 Agent 声明表达得过强。UI 会保持确定性事实可见、标记来源、展示源新鲜度，并且绝不会从生成文本推导优先级。

总览本身可能成为另一个高密度认知负担来源。设计会按会话聚合、使用一个主原因、限制行内容、支持筛选与暂缓，并只为新的可操作状态发出通知。

无密钥 assembled-browser 场景 `apps/web/tests/session-overview.e2e.ts` 创建一个会话，并在不调用模型的情况下固定无数字活动 beacon、安静状态 Picture-in-Picture 窗口、待处理状态转换、Context tab、扫描与详情工作台、桌面溢出约束，以及 390 像素 viewport 下独立的列表/详情导航。并行会话排序、冷缓存和重连证据仍属于验收标准。

浏览器本地的最后查看和书签状态不会跨设备同步。这是明确的第一版限制；在缺少主体所有权时迁移它们会产生隐私和授权缺陷。

在存在可靠写入集合来源之前，workspace 冲突仍然无法检测。仅凭 cwd 相等不足以判断，而且不能产生错误安全声明。
