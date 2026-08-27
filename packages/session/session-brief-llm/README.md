# @deepseek-ai/dsh-session-brief-llm

English | [中文](README.zh.md)

Concrete `ctx.sessionBrief` provider that generates a structured catch-up value through `ctx.llm`. It selects current Session facts under an exact UTF-8 budget, logs the dispatchable request before the call, applies an end-to-end deadline, validates one raw JSON object, and records content-free route, outcome, duration, and token usage.

## Input policy

Selection uses the current folded message surface plus the latest title, Goal, Todo, Turn outcome, and unmatched tool names through the coordinator's fixed `sourceSeq`. It excludes shadowed messages, reasoning, tool arguments, tool results, credentials, and files. Newest facts are retained under `maxInputBytes`; the JSON frame reports omitted facts.

Transcript strings are untrusted data. The system instruction forbids following embedded instructions, permission claims, role text, and tool requests. The request exposes no tools and uses `purpose: 'session-brief'`; the DeepSeek adapter disables thinking for this purpose.

## Output policy

The provider accepts only schema-version-1 JSON with the documented fields. Markdown wrappers, surrounding text, unknown keys, empty required text, excess arrays, tool calls, non-stop finishes, and citations outside the exact selected seq set fail generation. Each local rejection records a stable `SESSION_BRIEF_*` code without provider output; the coordinator performs the final duplicate, byte, revision, and stale-source checks.

## Configuration

| Field | Required behavior |
| --- | --- |
| `maxInputBytes` | Positive limit for the exact JSON-framed user input |
| `maxOutputTokens` | Positive auxiliary output-token limit |
| `timeoutMs` | Positive end-to-end deadline no greater than the runtime timer limit |
| `provider`, `model` | Optional non-empty route pair; when absent, use the logged Session route |

## Audit and privacy

`session/brief-llm-request` records exact system text, messages, selected seqs, route, schema version, and token cap before dispatch. `session/brief-llm-result` records duration, outcome, provider-reported token usage, and a content-free error code. Both carry `ignorable: true` and remain outside derived model history.

The canonical log retains the exact request for local audit and replay. The package's telemetry rule removes system and message content before outbound reporting while retaining route, source seqs, schema version, and token cap. The repository has no provider-neutral monetary pricing registry; token usage is the durable billing input.

## Model Experience

### Auxiliary Session brief request

#### What the model sees

The auxiliary model receives the fixed injection-resistant system instruction and one bounded JSON user message containing selected current Session facts. It receives no main-Agent tools, reasoning history, tool arguments, tool results, credentials, or files.

#### Token effect

The separate request consumes the selected input plus at most `maxOutputTokens`; provider-reported usage is recorded without content. Generated output controls no permission, scheduling, cancellation, operational status, or attention precedence.

#### KV Cache effect

None for the main Agent. The provider makes a separate one-shot request and does not change the main request prefix.

## Known Limitations and Deferred Work

- Provider-reported token usage may be absent; no monetary amount is inferred without route-specific pricing authority.
- Input selection recognizes current recorded text and structured facts but does not inspect arbitrary tool output or files.
- Offline structural tests reject unsupported claims mechanically; factual quality still requires real-provider evaluation.