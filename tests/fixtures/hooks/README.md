# Codex lifecycle hook stdin fixtures (FR31)

These are **Codex lifecycle-hook stdin payloads** — a single JSON object delivered
on stdin to the `.codex/hooks.json` command handlers (`blastcheck hook codex
<name>`), exactly as `src/hooks/*` consume them. They are the contract the
`codex-lifecycle` adapter (`src/trajectory/adapters/codex-lifecycle.ts`) and the
Codex hook handlers are tested against.

| File | Event | Covers |
|------|-------|--------|
| `codex-session-start.sample.json` | `SessionStart` | `source:"startup"` reset semantics |
| `codex-post-tool-use.sample.json` | `PostToolUse` | exec/`shell` tool → canonical `cmd` (argv `["bash","-lc",…]` unwrap) |
| `codex-post-tool-use-apply-patch.sample.json` | `PostToolUse` | `apply_patch` body → canonical `path` |
| `codex-stop.sample.json` | `Stop` | `stop_hook_active`, `last_assistant_message` |

## NOT the rollout fixture

Do **not** confuse these with `tests/fixtures/trajectories/codex-rollout.sample.jsonl`
— that is a multi-line `rollout-*.jsonl` **log** consumed by the separate rollout
adapter (`adapt --from codex`). These hook fixtures are single stdin payloads for
the live lifecycle (hook) path. The two paths are independent (AC8).

## Source / provenance

Shapes verified against the OpenAI Codex hooks documentation (June 2026):
- https://developers.openai.com/codex/hooks — lifecycle events + stdin payload fields
- https://developers.openai.com/codex/config-advanced — `hooks.json` command handlers

⚠️ **Owed: a live-captured sample (FR31).** A live Codex session was not reachable
in this dev environment, so these are the closest verifiable real-shape payloads
built from the documented field contract rather than captured from a running
Codex instance. The OpenAI docs explicitly warn the transcript/payload format is
**not a stable interface**, so when a live Codex session is available these should
be replaced/confirmed with an actually-captured `PostToolUse` payload (e.g. via a
temporary logging hook that `cat`s stdin to a file). Until then, the liberal
`common.ts` parsing + these fixtures are the hedge — not a rigid schema.
