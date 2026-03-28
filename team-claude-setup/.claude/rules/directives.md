---
globs: ["directives/**/*.md", "directives/**"]
---

# Directive Layer Rules

Directives are living SOPs — the system's instruction set. Handle with care.

- Never delete or overwrite a directive without asking first
- When updating a directive, add what you learned — don't remove existing working instructions
- Keep the structure consistent: Goal → Inputs → Steps → Tools/Scripts → Outputs → Edge Cases
- Reference specific script filenames in `execution/` — not vague descriptions
- When you discover an API limitation, rate limit, timing issue, or edge case: add it to the relevant directive immediately
- Date-stamp significant updates with a brief note at the bottom (e.g., `Updated 2026-03-22: Added batch endpoint for rate limit workaround`)
- If a directive references a script that doesn't exist yet, flag it — don't silently skip
- Keep directives readable by a mid-level employee — no jargon without explanation
