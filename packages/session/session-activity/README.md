# @deepseek-ai/dsh-session-activity

English | [中文](README.zh.md)

Function plugin registering the `sessionActivity` projection unit. It folds durable Session events into bounded last-activity, latest-Turn, and unmatched-tool facts for list and overview clients. The projection contains no message text, tool arguments, tool results, or error messages.

## Projection semantics

- Finalized user and assistant messages update `lastKind: 'message'`.
- Tool calls and results update `lastKind: 'tool'`. Unmatched calls preserve model order; the client value includes at most `maxOpenTools` entries and reports the remainder in `openToolsOmitted`.
- `turn/end` updates `lastTurn` for the known core reasons and clears unmatched calls from that Turn. A normally completed Turn does not assert objective completion.
- Goal changes, Todo writes, durable Workflow records, and successful compaction ends update their own activity kind without copying domain payloads.
- Raw chunks, request records, failed compaction attempts, projection bookkeeping, and unrelated extension events return the same state reference and emit no projection change.

Error outcomes expose only a UTF-8-bounded provider-neutral `errorCode`. The provider message remains in the Session log and is not copied into the cross-Session projection.

## Configuration

| Field | Required behavior |
| --- | --- |
| `maxOpenTools` | Positive maximum unmatched tool entries included in the wire value |
| `maxErrorBytes` | Positive UTF-8 byte limit for the exposed error code |

State and wire schemas enforce these bounds. Reducing `maxErrorBytes` rejects an older checkpoint whose stored code exceeds the current limit, so the projection registry refolds the Session log before serving it.

## Composition

```yaml
- id: session-activity
  name: '@deepseek-ai/dsh-session-activity'
  config:
    maxOpenTools: 3
    maxErrorBytes: 64
```

The plugin injects `sessionProjections`. Assemblies without the projection registry do not register the unit.

## Model Experience

None, as the plugin only computes a client-facing read model from logged Session events and touches no prompt, message, tool schema, provider request, or tool result.

#### KV Cache effect

None; the plugin never assembles or sends a model request.

## Known Limitations and Deferred Work

- **No durable parent-Session subagent settlement exists** — the fold does not infer settlement from live `subagent/end` events or a child descriptor; a future durable parent event can add `lastKind: 'subagent'` without treating process-local state as replayable fact.
- **Error messages are unavailable in the projection** — only the bounded provider-neutral code is exposed until a reviewed redaction policy can make selected message text safe for cross-Session display.
- **Activity records facts, not objective truth** — idle state, a completed Turn, and completed Todos remain separate from explicit Goal completion in the consuming Client derivation.
- **Mounted only in the Web app bundle** — other assemblies serve no `sessionActivity` key unless they compose the plugin explicitly.
