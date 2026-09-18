---
description: The client letter for a checked document - your assessment issued, here is the result against what we lodged, here is the due date - drafted from the record, never sent.
---

1. Confirm the document is checked: `npm run ato -- doc <ref>`. If it is not, `check <ref>` first; the client hears a checked number, never a raw one. If there is a variance with no explanation, stop and resolve that first (/variances).
2. Render the draft: `npm run docs -- client-letter-draft`. One HTML file per checked-but-untold document lands in `docs-out/client-letter-draft/`, carrying the document's facts, the position against the lodgment, and the check note, in the practice's brand.
3. If the operator wants the letter as an email instead, write it to `drafts/` in plain language: what arrived, the result (one number, plainly), what it was checked against, the due date and how to pay, what happens next. Facts only from the record; never invent an amount, a date, or a reason.
4. A person sends it. After they have: `npm run ato -- notify <ref>`, which also writes the contact log entry.

Never send anything from here, and never state a tax position that is not in the check note. Nothing here is tax advice.
