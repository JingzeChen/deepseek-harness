# @deepseek-ai/dsh-client-ui-session-overview

English | [中文](README.zh.md)

DSH Beacon is a browser plugin providing three distinct Session surfaces: a realtime activity beacon and attention-ordered virtualized workbench in `shell.overlay`, plus a current-Session Context tab in `conversation.view`. They read Session and Workspace object-layer snapshots through framework hooks and store only browser-local presentation and review state. The plugin does not modify existing Session-browser rows; its workbench lists unarchived top-level Sessions and excludes child and subagent-origin Sessions.

## Presentation levels

The floating activity beacon is the sole global entry. It carries no numeric badge: up to four blue orbit markers represent currently running Sessions, while a thin amber ring and **Needs you** flag appear only for a pending approval, question, or plan review. Pointer dragging moves the beacon inside viewport-safe margins; its normalized center persists across reloads and remains usable after viewport changes. Hover or keyboard focus opens a bounded preview containing at most three running and three actionable Session titles; selecting the beacon opens the workbench. The icon, accessible label, and polite live status distinguish quiet, running, and needs-action states without relying on color.

On browsers implementing Document Picture-in-Picture, the preview exposes **Keep visible across windows**. This user-triggered operation opens a browser-managed, always-on-top activity window that remains visible over other browser tabs and desktop applications, receives the same live quiet/running/needs-action updates, and returns focus to the main page and workbench when selected. Unsupported browsers omit the control rather than opening an ordinary popup.

The full workbench owns filtering, comparison, selection, review state, and management actions. Its desktop list shows Session, status/current focus, and update time; Workspace appears only when multiple Workspaces exist, while absent progress does not create a column of repeated unavailable values. Needs-you facts lead the 360–400-pixel details pane, Completed and AI summary sections start collapsed, Open Session is primary, and pin, snooze, mark-reviewed, and archive live in a secondary menu. At narrow widths, users navigate from the Session list to a full-height details page and return explicitly, so the list and details never form two stacked scroll areas.

The Session-scoped **Context** tab registers beside Chat and Trajectory. It renders the same deterministic context with status, Workspace, Todo progress, running descendants, and active tool names, so users can inspect catch-up facts without opening the global workbench or leaving the current Session. Its refresh action invokes `/brief`, remains busy until the Host handler settles, and renders success or the command's content-safe failure text inline.

## Deterministic context

The workbench details pane and Context tab share one bounded context derivation. Task comes from the Goal objective when present, otherwise the durable Session title. Current focus prefers a Goal blocker, then the first in-progress Todo, then active tool names. Completed contains at most the latest three completed Todo items. Next comes from the first pending Todo, then the user's bookmark. Pending interaction, blocker, and error reason supply Needs you; the activity sequence supplies Freshness.

Every field retains its provenance class in the UI: recorded fact, Agent-maintained state, or user note. A Session without Goal/Todo context still shows its task, attention reason, and freshness. When the `sessionBrief` projection is present, a separate generated-interpretation section shows provider/model provenance, interpreted progress, source sequence, and fresh or stale status; its current focus is also the row's fallback only when every deterministic focus source is absent. It never replaces deterministic facts or controls attention ordering.

## Attention semantics

Rows use this deterministic precedence: pending approval, question, or plan review; explicit Goal or Turn blocker; latest Turn error; running Session or subagent descendant; background job; explicit Goal completion; meaningful activity after `lastViewedSeq`; paused Goal; idle. Pin and snooze change order only inside one class. Pending interaction and failure rows cannot be snoozed.

Normal `turn/end: completed`, every Todo being complete, and Agent idle state remain separate from `goal.phase: complete`. Generated text never controls attention ordering.

The workbench combines `sessionActivity`, Goal, and Todo projections with live Session, subagent, job, and pending-interaction mirrors. Missing projections render as unavailable facts rather than inferred defaults. Rows above the virtualization threshold use `@tanstack/react-virtual` with stable 64-pixel estimates.

## Review state and actions

The shared root store persists filters, selection, pin, snooze, bookmark, and explicit `lastViewedSeq` values under `dsh.session-overview.view.v1`. Snooze sets an eligible Session's deadline one hour ahead; pending-interaction and failure rows cannot be snoozed. Entries for removed Sessions and expired snoozes are pruned against the current list.

Open, cancel, archive, steering, pending-interaction responses, and explicit brief refresh delegate to existing Client Session, Workspace, carrier, and command APIs. Approval, question, and plan-review decisions re-resolve the current `PendingWait` by stable request key before sending; a stale key, changed interaction kind, rejected receipt, or transport failure remains visible without replacing the last valid rows. Selecting **Mark reviewed** advances `lastViewedSeq` to the current deterministic activity sequence; opening DSH Beacon, selecting a row, opening Context, or navigating to Chat does not change review state.

## Composition

```yaml
- id: ui-session-overview
  name: '@deepseek-ai/dsh-client-ui-session-overview'
```

The browser half injects `slots`, `sessions`, `workspaces`, and `locale`. It waits for `shell.overlay` and `conversation.view` declarations through `ctx.slots.inject()`. The beacon and workbench share the root overlay and one store handle; the Session-scoped Context tab reads only framework hooks and owns no duplicate store.

## Model Experience

Indirectly, through the Context refresh action, which invokes `/brief` and delegates any auxiliary request to the Host command and registered brief provider.

#### KV Cache effect

None for main-Agent requests; the optional auxiliary provider owns its independent request.

## Known Limitations and Deferred Work

- **Approval command details remain Session-scoped** — the overview displays the validated tool name and reason but does not copy tool arguments or results into list rows; open the Session to inspect the paired command before deciding when the reason is insufficient.
- **Queue visibility is incomplete for cold Sessions** — the global list carries background jobs but not unopened per-Session inbox queues; queued status therefore appears only when an authoritative job signal exists.
- **Review state is browser-local** — the whole presentation store persists in localStorage and does not synchronize through a Host principal or storage events across tabs.
- **Changed state is a sequence marker, not a delta list** — the projection carries the latest meaningful sequence but not bounded event descriptions, and the current UI renders no detailed change list.
- **Rich deterministic context depends on Goal and Todo adoption** — a Session that records neither exposes only title, operational facts, active tools, bookmark, and freshness unless an accepted generated brief adds interpretation.
- **Context does not summarize arbitrary transcript or tool output** — deterministic context uses bounded domain projections; user-visible recent-result interpretation remains the optional brief provider's responsibility.
- **Cross-window activity requires Document Picture-in-Picture** — current Chromium browsers such as Chrome and Edge provide the always-on-top window; unsupported browsers retain only the in-page draggable beacon. Browser security requires an explicit user click to open it, and the originating DSH tab must remain open and connected for live updates.
