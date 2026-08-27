# @deepseek-ai/dsh-client-ui-session-overview

[English](README.md) | 中文

DSH 信标是一个浏览器插件，提供三个职责明确的会话界面：`shell.overlay` 中的实时活动 beacon 与按注意力排序并采用虚拟化的工作台，以及 `conversation.view` 中的当前会话 Context tab。它们都通过框架 hooks 读取会话与工作区对象层快照，只存储浏览器本地的展示和 review state。该插件不会修改现有会话浏览器行；工作台只列出未归档顶层会话，并排除子会话和来源为 subagent 的会话。

## 展示层级

悬浮活动 beacon 是唯一的全局入口，不显示数字徽标：最多 4 个蓝色轨道点表示当前运行中的会话；只有待批准、待回答或待计划审核时才显示细琥珀色外环与**需要你处理**短标签。鼠标拖动可以在 viewport 安全边距内移动 beacon；归一化球心会跨刷新持久化，并在 viewport 变化后保持可用。悬停或键盘聚焦会展开有界预览，最多列出 3 个运行中和 3 个待处理会话标题；点击 beacon 打开工作台。图标、无障碍标签和礼貌的实时状态共同区分安静、运行中和待处理状态，不只依赖颜色。

实现 Document Picture-in-Picture 的浏览器会在预览中提供**在其他窗口上方保持显示**。该操作需要用户主动触发，会打开一个由浏览器管理的置顶活动窗口；用户切到其他浏览器标签页或桌面应用时它仍然可见，并实时接收同一份安静、运行中和待处理更新。点击小窗会把焦点带回主页面并打开工作台。不支持该 API 的浏览器不会显示此控件，也不会退化为普通弹窗。

完整工作台负责筛选、比较、选择、review state 和管理操作。桌面列表展示会话、状态/当前重点和更新时间；只有存在多个 Workspace 时才显示 Workspace，缺失进度不会形成重复显示不可用值的列。360–400 像素详情区域把 Needs-you 事实置顶，Completed 和 AI 摘要默认折叠，打开会话是主操作，置顶、稍后提醒、标记已查看和归档位于次级菜单。窄屏从会话列表进入全高详情页并显式返回，因此列表和详情不会形成上下两个滚动区。

Session-scope **上下文** tab 注册在 Chat 和 Trajectory 旁边。它展示同一份确定性 context，并补充状态、Workspace、Todo 进度、运行中后代和活跃工具名称，因此用户无需打开全局工作台或离开当前会话即可查看接管事实。刷新操作会调用 `/brief`，在 Host handler 结束前保持 busy，并在页面内显示成功或命令提供的不含敏感内容的失败文本。

## 确定性 Context

工作台详情区域与 Context tab 共享一套有界 context 推导。Task 优先来自 Goal 目标，否则使用持久会话标题。Current focus 依次选择 Goal 阻塞项、第一个进行中 Todo 和活跃工具名称。Completed 最多包含最近 3 个已完成 Todo。Next 依次来自第一个待处理 Todo 和用户 bookmark。待交互、阻塞和错误原因提供 Needs you；活动序号提供 Freshness。

UI 为每个字段保留来源类别：记录事实、Agent 维护状态或用户备注。没有 Goal/Todo context 的会话仍然展示任务、注意原因和新鲜度。存在 `sessionBrief` 投影时，独立生成式解读区域会显示 provider/model 来源、解释后的进展、来源序号和新鲜或陈旧状态；只有在所有确定性 focus 来源都缺失时，其 current focus 才作为行摘要的 fallback。它永远不会替换确定性事实，也不会控制注意力排序。

## 注意力语义

行按以下确定性优先级排列：待批准、问题或计划审核；显式 Goal 或轮次阻塞；最近轮次错误；运行中的会话或 subagent 后代；后台任务；显式 Goal 完成；`lastViewedSeq` 之后的有意义活动；暂停的 Goal；空闲。置顶和稍后提醒只改变同一类别内的顺序。待交互和失败行不能被稍后提醒。

正常的 `turn/end: completed`、全部 Todo 完成和 Agent 空闲状态与 `goal.phase: complete` 保持分离。生成文本永远不控制注意力排序。

工作台将 `sessionActivity`、Goal 和 Todo 投影与 live 会话、subagent、job 和 pending-interaction mirror 组合。缺失的投影显示为不可用事实，不推断默认值。超过虚拟化阈值的行使用 `@tanstack/react-virtual` 和稳定的 64 像素估算值。

## Review state 与操作

共享 root store 在 `dsh.session-overview.view.v1` 下持久化筛选、选择、置顶、稍后提醒、书签和显式 `lastViewedSeq` 值。稍后提醒会把符合条件会话的截止时间设为一小时后；待交互行和失败行不能稍后提醒。已删除会话的记录和过期的稍后提醒会根据当前列表清理。

打开、取消、归档、steer、pending interaction 响应和显式摘要刷新委托给现有 Client 会话、工作区、carrier 和命令 API。approval、question 和 plan-review 决策在发送前按稳定 request key 重新解析当前 `PendingWait`；过期 key、变化的交互种类、被拒绝的 receipt 或传输失败会保留在工作台中，不替换最近的有效行。选择**标记已查看**会把 `lastViewedSeq` 推进到当前确定性活动序号；打开 DSH 信标、选择行、打开 Context 或导航到 Chat 都不会改变 review state。

## 组合

```yaml
- id: ui-session-overview
  name: '@deepseek-ai/dsh-client-ui-session-overview'
```

浏览器半侧注入 `slots`、`sessions`、`workspaces` 和 `locale`。它通过 `ctx.slots.inject()` 等待 `shell.overlay` 与 `conversation.view` 声明。beacon 与工作台共享 root overlay 和同一个 store handle；Session-scope Context tab 只读取框架 hooks，不拥有重复 store。

## 模型体验

间接通过 Context 刷新操作：它调用 `/brief`，并把所有辅助请求委托给 Host 命令和已注册 brief provider。

#### KV Cache 影响

不影响主 Agent 请求；可选辅助 provider 拥有自己的独立请求。

## 已知限制与延期工作

- **审批命令详情仍限定在会话内** — 总览显示经过验证的工具名称和理由，但不会把工具参数或结果复制到列表行；理由不足以支持决定时，应打开会话检查对应命令。
- **冷会话的 queue 可见性不完整** — 全局列表携带后台 job，但不携带未打开会话的 inbox queue；因此只有存在权威 job 信号时才显示 queued 状态。
- **Review state 是浏览器本地状态** — 整个展示 store 持久化在 localStorage 中，不通过 Host principal 同步，也不通过 storage event 在标签页间同步。
- **Changed 状态是序号标记而不是 delta 列表** — 投影携带最新有意义序号，但不携带有界事件描述；当前 UI 不渲染详细变化列表。
- **丰富确定性 context 依赖 Goal 和 Todo 的采用** — 同时缺少两者的会话只能提供标题、运行事实、活跃工具、bookmark 和新鲜度，除非已接纳的生成摘要补充解释。
- **Context 不会概括任意 transcript 或工具输出** — 确定性 context 使用有界领域投影；面向用户的最近结果解释仍属于可选摘要提供方。
- **跨窗口活动依赖 Document Picture-in-Picture** — 当前 Chrome、Edge 等 Chromium 浏览器提供置顶小窗；不支持的浏览器只保留页面内可拖拽 beacon。浏览器安全策略要求用户显式点击才能打开小窗，且来源 DSH 标签页必须保持打开和连接，实时更新才会继续。
