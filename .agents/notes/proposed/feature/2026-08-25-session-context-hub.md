# Agent Note: DSH Beacon

Status: proposed

English | [中文](2026-08-25-session-context-hub.zh.md)

## Problem

Users can run many independent Sessions concurrently, but the current Web navigation primarily answers where a Session is and whether it is running or waiting for a known interaction. Resuming work still requires reconstructing objective, current focus, progress, blockers, and recent outcomes from each transcript. Repeated polling and mental reconstruction become the limiting cost of parallel Agent use.

The repository already owns durable Session events, live Agent state, pending interaction frames, Goal and Todo projections, cold projection caching, and a Client object layer. A new feature must compose those authorities without copying them into another mutable state model, treating an idle Agent as completed work, or making an LLM summary the authority for operational status.

## Proposal

Complete DSH Beacon for the single-Host Web profile, following the requirements, current implementation, and remaining target behavior in [the technical design](../../../../docs/session-context-hub-technical-design.md).

The current implementation provides the activity and brief projections, bounded LLM provider, automatic and explicit brief generation, draggable activity beacon, Document Picture-in-Picture activity window, attention-ordered workbench, browser-local review preferences, existing interaction adapters, and Session-scoped Context tab. This umbrella proposal remains open because the existing Session browser has no DSH Beacon contribution, `changed` has no bounded chronological delta list, several target management actions remain outside the workbench, and the complete capacity, reconnect, cold-cache, multi-tab, authorization, GIF, and configured-provider evidence is not yet present.

The feature will use three kinds of state:

- A bounded `sessionActivity` projection will fold last meaningful activity, the latest Turn outcome, and unmatched tool calls from durable events.
- The Client will derive attention ordering from live Host state, pending interactions, queue and jobs, existing Goal and Todo projections, activity, and user-local review state.
- An optional `ctx.sessionBrief` capability will append bounded, structured, log-only briefs generated at stable source revisions; deterministic overview behavior will not depend on a provider.

The Web package registers a realtime activity beacon and on-demand global workbench in `shell.overlay`, plus a per-Session Context entry in `conversation.view`. The number-free, browser-positioned beacon owns ambient running and pending-human-action awareness; a user-triggered Document Picture-in-Picture window can keep the same live projection visible over other tabs and desktop applications. The workbench owns cross-Session comparison, filtering, details, and management actions, and the Session tab owns bounded deterministic catch-up beside Chat and Trajectory. The workbench uses three primary columns, conditionally adds Workspace, collapses secondary context, and uses separate list and detail levels on narrow screens. All read Session business state only through the Client runtime, while only the root surfaces share the package-owned viewing store.

The Client list object layer retains the current answerable interaction as a validated request descriptor beside its attention status. The workbench resolves approval, question, and plan-review responses against the descriptor's stable key at click time and sends through the existing `PendingWait`; steering uses the selected Session's existing `prompt(..., 'steer')` operation. This preserves Host receipt and conflict behavior without a second interaction protocol or React-owned business mirror.

The deterministic Client context combines Goal/title, blocker or in-progress Todo or active tools, bounded completed and pending Todo text, attention reason, bookmark, and activity sequence. It preserves recorded, Agent-maintained, and user provenance per field and reports missing structured progress explicitly. Generated briefs remain an optional interpretation layer rather than a prerequisite for context switching. Explicit refresh uses the existing command Remote, so the Context view shows running and final success or content-safe failure without adding another Host protocol.

The Web composition enables automatic generation for Turn end, Goal block, and Turn error after at least two new meaningful events. The coordinator waits for Agent idle, coalesces source revisions, and leaves deterministic context intact when generation fails or the provider is absent; other compositions may keep the trigger set empty.

## Status semantics

Operational state, Turn outcome, checklist progress, and objective completion remain separate. `AgentStatus: idle` proves only that no driver is active. `turn/end: completed` proves only that one Turn closed normally. Completed Todo items are Agent-maintained checklist claims. `goal.phase: complete` is the only existing explicit objective-completion state consumed by the first implementation.

Attention ordering is a reason-coded precedence: pending human action, explicit blocker, failure, running, queued work, explicit Goal completion, changed-since-view, paused Goal, then idle. Generated brief text cannot move a Session between these classes.

## Persistence and freshness

Activity and brief values ride the Session Projection registry, the API Proxy's existing list baseline and projection frames, and the persisted projection cache for cold Sessions. `session.list` never opens every cold log to fill missing values.

Every accepted brief event carries a complete bounded value, the meaningful source sequence it covers, exact ordered source-event sequences, generation time, and provider route. A newer meaningful event makes the value observably stale. Revision fencing rejects an auxiliary result if its source revision stopped being current before acceptance. The exact pre-dispatch request remains in the canonical log; a separate content-free result record carries route, duration, outcome, and provider-reported token usage for cost accounting.

User review state is presentation state rather than a Session fact. The first implementation persists it in the browser. Cross-device review state requires a principal-owned Host sidecar and is not inferred from Session events.

## Scope limit

The first implementation observes Agents attached to one Host process. Persisted Session logs cannot prove that an Agent in another process is live. Multi-Host support therefore requires a separate presence coordinator with instance identity, Agent leases, heartbeat, expiry, authorization, and aggregation.

Agent Teams tasks remain Team-domain state. Independent top-level Session attention does not reinterpret Team roster or task records. A later Team projection may contribute a bounded summary through the same Client composition.

## Model experience

Deterministic projections and browser viewing state add no model-visible content. `session/brief-llm-request`, `session/brief-llm-result`, and `session/brief` are log-only and never enter `deriveMessages()`, a system prompt, a tool schema, or `agent.inject()`. The optional auxiliary request has its own bounded token use and no tools; it does not invalidate the main Agent's KV Cache. Telemetry exports metadata-only forms of the exact request and generated brief by default, while the canonical log retains both for local replay.

## Alternatives considered

**Generate every row entirely with an LLM.** Rejected because running, waiting, failure, and completion semantics already have authoritative sources. A model result would be slower, more expensive, stale during execution, and capable of inventing completion or hiding a pending decision.

**Reuse compaction summaries as user catch-up summaries.** Rejected because compaction selects and rewrites history for model context pressure. A user catch-up brief selects current objective, progress, blockers, and next action at different checkpoints and must remain useful when no compaction occurred.

**Store one denormalized overview object outside the Session log.** Rejected because it would duplicate Goal, Todo, Turn, and activity authorities and need a separate replay and consistency protocol. Session projections already provide pure folds, cache checkpoints, list baselines, and live updates.

**Add status fields directly to the default Agent loop.** Rejected because the loop already emits the required durable and live facts. Product interpretation belongs in independent projections and Client derivation on documented extension points.

**Treat every Session as an Agent Teams member.** Rejected because independent Sessions have no shared Lead, Team task DAG, mailbox, or Team authority. The user-level overview spans Sessions without changing their collaboration model.

**Infer cross-process running state from the last durable event.** Rejected because a crash, disconnect, or long tool call makes a durable open Turn ambiguous. Correct distributed presence requires leases and expiry.

## Acceptance criteria

- The deterministic overview works with no brief provider and does not load every cold Session log.
- Pending human interaction outranks passive work, while status copy never equates idle, normal Turn close, or Todo completion with objective completion.
- Generated briefs are bounded, schema-validated, source-sequenced, cancellable, provenance-labeled, and rejected when stale before acceptance.
- Reconnect, Agent disposal, Session removal, forks, compaction, parallel tools, and running subagent descendants converge through existing Host and Client state owners.
- Overview actions use existing authorization and conflict behavior; the feature adds no bulk approval or automatic answer.
- Projections and telemetry exclude raw tool arguments, results, reasoning, credentials, and unrestricted transcript content by default.
- Package, Host, Client runtime, GUI, keyless browser snapshot, real-flow GIF, and configured-provider e2e coverage match the technical design's test matrix.

## Risks

Generated summaries may still omit context or phrase an Agent claim too strongly. The UI keeps deterministic facts visible, labels provenance, shows source freshness, and never derives precedence from generated text.

The overview itself may become another high-density source of cognitive load. The design aggregates by Session, uses one primary reason, limits row content, supports filters and snooze, and reserves notifications for newly actionable states.

The keyless assembled-browser scenario `apps/web/tests/session-overview.e2e.ts` creates one Session and pins the number-free activity beacon, quiet Picture-in-Picture window, needs-action transition, Context tab, scan-and-details workbench, desktop overflow constraints, and separate list/detail navigation at a 390-pixel viewport without invoking a model. Concurrent-Session ordering, cold-cache, and reconnect evidence remain part of the acceptance criteria.

Browser-local last-viewed and bookmark state does not synchronize across devices. This is an explicit first-version limit; moving it without principal ownership would create a privacy and authorization defect.

Workspace conflicts remain undetected until a reliable write-set source exists. Cwd equality alone is insufficient and must not produce a false safety claim.
