---
description: The rule book run against the records - TFN storage, turnaround, checked-before-told, variances explained, due-date notice, objection windows, payment plans, lodgments - each rule citing its source.
---

1. Run `npm run ato -- compliance`. Eight rules, each with its source, run against the live records. `compliance <rule>` runs one.
2. Report breaches worst first, exactly as the command orders them, with the source cited and the named fix beside each one.
3. For anything breached, draft the fix the operator can approve: the command to run, the letter to draft (to `docs-out/` via `npm run docs`, never sent), or the task to add.
4. The fuller reading behind each rule is [docs/compliance.md](../../docs/compliance.md). If a rule there looks out of date, say so and stop. Do not guess at law: the operator confirms the rule, then you update the doc and the check together (`/customise` does both).

Nothing here is tax advice or legal advice. The rules are the ones this practice has told the system to enforce, written down with sources so they can be checked, argued with, and changed.
