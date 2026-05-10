# Claude Code Hook Templates for FileScopeMCP

> **Layering rule:** FileScopeMCP never auto-writes to your `.claude/settings.json`. The snippets below are templates you paste into your own settings if you want them. They are documented as building blocks, not shipped as auto-install.

## Why

Without hooks, FileScopeMCP tools are registered but agents only invoke them when a user prompt's noun semantically matches a tool name. The hooks below convert "remember to call FileScope" into "the harness reminds you for me" — they fire before `Read`, `Edit`, and `Write` tool calls and inject the relevant FileScopeMCP context into the agent's transcript.

## Prerequisites

- Claude Code installed and FileScopeMCP registered (`./build.sh` or `npm run register-mcp`).
- `node` and `scripts/filescope-helper.mjs` available — built by `./build.sh`. The helper runs the actual MCP tool calls; the hooks invoke the helper.

## PreToolUse hook (Read / Edit / Write)

Add to `.claude/settings.json` in the project root:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Read|Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/FileScopeMCP/scripts/filescope-helper.mjs pre-tool-use"
          }
        ]
      }
    ]
  }
}
```

The helper reads `tool_input.file_path` from the hook payload, calls `get_file_summary` for that file, and emits the result as a `system-reminder` injection. If the file is not tracked by FileScopeMCP, the helper exits 0 silently — the hook does not block the underlying tool call.

## SessionStart hook

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/FileScopeMCP/scripts/filescope-helper.mjs session-start"
          }
        ]
      }
    ]
  }
}
```

The helper calls `find_important_files(maxItems: 5)` and `list_changed_since(<24h-ago>)` and emits a sub-1-KB orientation digest as a session-start system-reminder.

## Combined example

If you want both hooks, merge them under a single `hooks` object:

```json
{
  "hooks": {
    "PreToolUse": [ /* ... as above ... */ ],
    "SessionStart": [ /* ... as above ... */ ]
  }
}
```

## Kill switch

The helper checks for the `FILESCOPE_HOOKS` environment variable. Set it to `off` to disable hook output without removing the hook config:

```bash
FILESCOPE_HOOKS=off claude
```

The helper still runs, but exits 0 immediately and produces no output.

## Caveats

- **Layering:** these snippets must be added by the user. FileScopeMCP's `filescope-install` command prints them and the URL to this doc but does not modify `.claude/settings.json`.
- **Latency:** the helper targets sub-100 ms response time. If you observe perceptible delay, check that the FileScopeMCP server is running in `--daemon` mode and the SQLite DB has been built (`status()` returns `initialized: true`).
- **Phase 1 measurement bound:** per the roadmap, hook efficacy is testable only by maintainers running with-rig sessions, since most users will not paste these snippets in. This is intentional.
