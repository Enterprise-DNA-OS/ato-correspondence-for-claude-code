---
description: The morning mail run's worklist, everything not yet in front of the client, oldest first.
---

1. Run `npm run ato -- inbox`.
2. Present it oldest first, exactly as returned. Flag anything held more than seven days: that is the practice's own standard breaking.
3. For each item, the next step is mechanical and the CLI names it:
   - unmatched: `match <ref> <client>` (the client card shows the last three TFN digits to confirm against the letter)
   - matched assessment, statement or instalment: `check <ref>`
   - checked: `notify <ref>` after the letter is drafted (`npm run docs`) and a person has sent it
   - notified: `file <ref> --ref="<where the PDF lives>"`
4. If the operator wants to work the list, walk it top to bottom, one document at a time, confirming each action before running it.
