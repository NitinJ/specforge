---
name: export
user-invocable: false
description: |
  Export a spec from the store to Google Docs. Auto-invoked when the owning
  session's Stop/UserPromptSubmit hook surfaces a queued export (the human clicked
  "Export to Google Docs" in the review UI); can also be run manually. Reads the
  spec HTML, creates a Google Doc via the connected Google Drive MCP, and reports
  the Doc link back so the dropdown shows it.
allowed-tools: Read Bash mcp__claude_ai_Google_Drive__create_file mcp__claude_ai_Google_Drive__get_file_metadata
---

# export

Export one or more specs from the store to **Google Docs**. The browser can't call
the Drive MCP — only this session can — so the UI queues a request and the hook
routes here. The hook message lists each queued spec **id** and title.

SpecForge is on PATH as `specforge` and `spec-nav`; `specforge root` prints where it is installed. Specs live at `~/.specforge/specs/<id>/spec.html`.

> **Before anything else, check there is work.** The spec's meta must carry an
> `export` request. If it does not, say so and stop: this skill answers a button
> somebody pressed, and running it unasked writes a document nobody expects.
> Some agent CLIs hide this skill from their users and some do not, so the check
> lives here rather than in frontmatter.

## 1. Locate the spec file

For each queued spec id:

```
specforge comments <id>
```

prints `{ specId, htmlPath, ... }`. `htmlPath` is the on-disk spec (clean content —
the review layer is injected only at serve time, so the file is plain house HTML).
Use the spec **title** from the hook message for the Doc title.

## 2. Mark it in-progress

So the dropdown shows "Exporting…" (the hook already does this when it routes here;
do it explicitly for a manual run):

```
specforge export-working <id>
```

## 3. Create the Google Doc via the Drive MCP

Read the full `htmlPath` contents, then create the doc with your connected Google
Drive MCP's create-file tool (`mcp__claude_ai_Google_Drive__create_file`, or the
equivalent on whatever Drive MCP is connected):

- `title`: the spec title
- `textContent`: the full spec HTML
- `contentMimeType`: `text/html`

Drive converts HTML → a Google Doc (headings, lists, tables, bold/links survive;
the rich CSS/charts/`<script>` are dropped — this is a structural export). The
response carries `mimeType` and `viewUrl`.

**Verify the conversion:** the response `mimeType` must be
`application/vnd.google-apps.document`. If it isn't (the upload stayed an `.html`
file), delete nothing — instead re-create with the body text extracted to plain
text and `contentMimeType: text/plain` (always converts to a Doc, just unstyled).

The shareable link is the response's `viewUrl` (shape:
`https://docs.google.com/document/d/<fileId>/edit`).

## 4. Report the link back

```
specforge export-done <id> --url "<viewUrl>"
```

On any failure (MCP not connected, auth, conversion both ways failed):

```
specforge export-done <id> --error "<short reason>"
```

The dropdown shows the **Open Google Doc** link (or the error) on its next poll.

## 5. Report

Briefly tell the human: which spec(s) exported and the Doc link(s).
