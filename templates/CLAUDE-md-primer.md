<!-- BEGIN filescope -->
## FileScopeMCP — Operating Protocol

This project is indexed by FileScopeMCP. Before grep, Read, or Bash, consider whether a FileScopeMCP tool answers your question more directly. The MCP tools are registered with Claude Code; they appear automatically in your tool list.

### Operating rules

- **Before editing any file** you have not previously summarized in this session: call `get_file_summary(filepath)` first. Source tells you what the file is; summary tells you who *uses* it. You need both to make a safe change.
- **Before searching for callers of a function**: try `find_callers(name)` before falling back to `grep`. Falls back gracefully if the language is not yet supported.
- **Before navigating to a symbol**: try `find_symbol(name)` before opening files manually.
- **For a concept search across the codebase** (e.g., "where is auth handled", "where do we cache results"): use `search(query)` instead of grep — it understands intent because it searches LLM-generated summaries.
- **At session start**, if `status()` returns `NOT_INITIALIZED`, call `set_base_directory(cwd)` once.

### Trigger summary

| Situation | Tool |
|-----------|------|
| Orient to a new repo | `find_important_files(maxItems: 10)` |
| Pre-edit briefing | `get_file_summary(filepath)` |
| "What calls this?" | `find_callers(name)` |
| Concept search | `search(query)` |
| "What changed?" | `list_changed_since(since)` |
| Cycle hunting | `detect_cycles()` |

These tools are not optional. They exist because they answer questions cheaper and more accurately than re-reading source code. Use them.

### When the tool is wrong

If a tool returns stale or incorrect data, prefer correcting the underlying state (`scan_all`, `set_file_summary`) over working around it with grep. Stale metadata is a bug to fix, not a reason to bypass.
<!-- END filescope -->
