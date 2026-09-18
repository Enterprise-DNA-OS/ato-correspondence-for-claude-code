---
description: Turn a stack of ATO letters (PDFs dropped in inbox/, or described out loud) into register entries, each one received, matched and ready to check. The data-entry half of the incumbent, done by reading.
---

The operator has new ATO mail: PDFs saved into `inbox/`, paper letters they will describe, or a list from their ATO practice mail download. Turn each one into a register entry.

1. For each PDF in `inbox/` (or each letter described), read it and extract: the taxpayer name, the document type (notice of assessment, statement of account, debt letter, PAYG instalment notice, lodgment demand, audit or review letter, payment plan confirmation, general), the period, any amount (payable or refund), the payment due date, and the issue date. The last three digits of any TFN on the letter are useful for matching; NEVER record more than three digits of it, anywhere, including in your own replies.
2. Find the client: `npm run ato -- client "<name>"`. Confirm the match against the letter (the card shows TFN last-three and ABN). If nothing matches confidently, record it unmatched rather than guessing.
3. Record it:
   - matched: `npm run ato -- receive "<client>" --type=<type> --title="<title>" --period=<period> --payable=<dollars>|--refund=<dollars> --due=<date> --issued=<date>`
   - unclear: `npm run ato -- receive --unmatched --type=<type> --title="<title>" --note="what makes it unclear"`
4. After the batch, run `npm run ato -- inbox` and report: how many recorded, how many unmatched, and which ones now need `check` because they carry numbers.
5. Move each processed PDF out of `inbox/` into the operator's document store if asked, and put the store path on the record at `file` time.

Never invent an amount or a date: if the letter is unreadable, record it unmatched with a note. Nothing here is tax advice.
