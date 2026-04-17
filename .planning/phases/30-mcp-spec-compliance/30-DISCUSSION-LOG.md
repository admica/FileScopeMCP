# Phase 30: MCP Spec Compliance - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-17
**Phase:** 30-mcp-spec-compliance
**Areas discussed:** listChanged capability, Error code taxonomy, Tool annotation classification, Migration approach, Tool description quality, Response format consistency, openWorldHint usage

---

## listChanged Capability

| Option | Description | Selected |
|--------|-------------|----------|
| Remove it (Recommended) | Delete listChanged: true from capabilities. Tool list is static. | ✓ |
| Implement it | Wire up sendToolListChanged() — but tools don't change at runtime. | |
| You decide | Claude picks pragmatic option. | |

**User's choice:** Remove it
**Notes:** Tool list is static, no runtime changes. Simplest and most honest.

---

## Error Code Taxonomy

| Option | Description | Selected |
|--------|-------------|----------|
| Structured JSON codes | Return { ok: false, error: "CODE", message: "..." } with ~6-8 distinct codes. | |
| Simple code + message | Single generic code, human-readable message. | |
| You decide | Claude picks granularity. | ✓ |

**User's choice:** You decide
**Notes:** Claude discretion. Decision: structured codes with small set (~4-5 codes).

---

## Tool Annotation Classification

| Option | Description | Selected |
|--------|-------------|----------|
| Only exclude = destructive | exclude_and_remove gets destructiveHint. set_* and scan_all don't. Rest = readOnlyHint. | |
| All writers = destructive | Any state-modifying tool gets destructiveHint. Conservative. | |
| You decide | Claude classifies based on MCP spec intent. | ✓ |

**User's choice:** You decide
**Notes:** Claude discretion. Decision: 4-tier classification (read-only, metadata writers, destructive, external interaction). Research revealed SDK defaults are worst-case, so ALL tools must be annotated.

---

## Migration Approach

| Option | Description | Selected |
|--------|-------------|----------|
| Researcher verifies first (Recommended) | Read SDK source/docs to find correct API before planning. | ✓ |
| Trust requirements as-is | Assume registerTool() is right per REQUIREMENTS.md. | |
| You decide | Claude picks based on risk. | |

**User's choice:** Researcher verifies first
**Notes:** Research completed in-session. Confirmed: server.tool() is deprecated in SDK 1.27.1, registerTool() is the correct replacement API. REQUIREMENTS.md was right.

---

## Tool Description Quality

| Option | Description | Selected |
|--------|-------------|----------|
| Rich descriptions | State return format, when to use, preconditions. | ✓ |
| Keep minimal | Brief descriptions as-is. | |

**User's choice:** Rich descriptions (via "all good" confirmation)
**Notes:** User emphasized "this tool is for LLMs to use, not humans" — descriptions optimized for machine consumption.

---

## Response Format Consistency

| Option | Description | Selected |
|--------|-------------|----------|
| Uniform JSON objects | All tools return consistent { ok: true, ...data } shape. | ✓ |
| Leave flexible | Keep current mixed format. | |

**User's choice:** Uniform JSON (via "all good" confirmation)
**Notes:** Research found registerTool supports outputSchema for SDK-enforced validation. Native approach, no custom wrapper needed.

---

## openWorldHint Usage

| Option | Description | Selected |
|--------|-------------|----------|
| scan_all only | Only scan_all triggers external Ollama calls. Everything else is local. | ✓ |
| Skip entirely | Don't use openWorldHint. | |

**User's choice:** scan_all only (via "all good" confirmation)
**Notes:** scan_all is the only tool that triggers network calls to Ollama via broker.

---

## Claude's Discretion

- Error code granularity (structured ~4-5 codes)
- Tool annotation 4-tier classification
- Tool description wording
- outputSchema usage scope

## Deferred Ideas

None — discussion stayed within phase scope.
