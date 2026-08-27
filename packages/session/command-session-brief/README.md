# @deepseek-ai/dsh-command-session-brief

English | [中文](README.zh.md)

Human-command Consumer that registers argument-free `/brief` and calls `ctx.sessionBrief.refresh()` for the receiving Agent's Session. It maps typed capability absence, busy, cancellation, stale revision, validation, and provider failures to human-only command outcomes.

The command does not send its text to the model, open a Turn, or alter attention ordering. The generated brief's own projection event updates Context consumers.

## Model Experience

Indirectly, through `ctx.sessionBrief`, whose registered provider may initiate a separately bounded auxiliary request.

#### KV Cache effect

None for main-Agent requests.

## Known Limitations and Deferred Work

- A Client receives command admission separately from the rendered command outcome; generation failures appear in the command flow and leave the previous brief unchanged.
- The command accepts no custom prompt or source-selection arguments.