# Tack vault

This vault is managed by Tack and also read by Obsidian and AI agents. Notes are plain Markdown files.

## Folders

- `Inbox/` quick captures and unsorted notes
- `Meetings/` meeting notes
- `People/` one note per person
- `Projects/` one note per project
- `Knowledge/` reference notes
- `Weekly/` weekly reviews

## Frontmatter

```yaml
---
type: meeting | note | person | project | knowledge | weekly
created: YYYY-MM-DDTHH:mm
tags: []
people: []
project: ""
---
```

## Rules

- Never delete notes. Move them instead (for example to `Knowledge/`) or ask the user.
- Keep `[[wikilinks]]`, `> [!note]` callouts and `- [ ]` tasks intact.
- Do not rewrite frontmatter keys you do not understand.
