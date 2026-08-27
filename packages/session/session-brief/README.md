# @deepseek-ai/dsh-session-brief

English | [中文](README.zh.md)

Service Definition and coordinator for bounded generated Session briefs. The service owns provider registration, explicit and configured automatic refresh, per-Session revision fencing, cancellation, accepted-value validation, the latest-wins `sessionBrief` projection, and default telemetry minimization. Deterministic Session context remains available when no provider is registered.

## Semantics

`refresh(session, signal)` returns a typed `accepted`, `unavailable`, `busy`, or `failed` result. It runs through `Agent.runMaintenance()` when a live Agent exists, so generation never races a Turn. Newer meaningful activity aborts the reserved revision; provider, Session, and service disposal abort and drain active calls.

An accepted `session/brief` contains the complete current value, carries `ignorable: true`, and never enters the model surface. The service normalizes whitespace but rejects empty text, unknown fields, duplicate list items, out-of-request citations, excess items, and values over `maxBriefBytes`. Failure leaves the preceding valid brief unchanged.

## Configuration

| Field | Required behavior |
| --- | --- |
| `automaticTriggers` | Unique subset of `turn-end`, `goal-blocked`, and `turn-error`; empty keeps generation explicit |
| `minMeaningfulEvents` | Positive activity advance required after the last accepted automatic brief |
| `maxBriefBytes` | Positive UTF-8 limit for the complete accepted event value |
| `maxItemsPerField` | Positive cap for completed items, blockers, and source citations |

## Provider contract

One provider may register. It receives immutable events through one `sourceSeq`, the previous brief, the logged main-request route when available, service-owned output limits, and an `AbortSignal`. It returns a complete candidate, exact source event seqs, and the auxiliary provider/model route.

## Privacy

The canonical Session log retains the generated brief for replay. The package's `session-telemetry/record` rule replaces the outbound brief body with revision, freshness, item counts, route, and citation metadata, so generated text is not exported by default.

## Model Experience

None, as the service validates and projects provider output but does not assemble or send a model request itself.

#### KV Cache effect

None for main-Agent requests. The service neither changes derived history nor assembles a main request.

## Known Limitations and Deferred Work

- Automatic generation depends on a composed provider. The Web bundle enables Turn-end, Goal-blocked, and Turn-error checkpoints with a two-meaningful-event advance; other deployments choose their own subset or keep generation manual.
- The first implementation coordinates one Host process; it does not lease generation across multiple Hosts reading the same persistence directory.
- The service validates citations and structure, not factual truth. Deterministic Goal, Todo, activity, interaction, and Agent status remain authoritative.