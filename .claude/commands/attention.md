---
description: Everything that wants a decision this morning, worst first. Missed due dates, clients not yet told, open variances, unmatched mail, overdue instalments, overdue lodgments.
---

1. Run `npm run ato -- attention`.
2. The list is already ordered by how much each item can cost. Read it in that order and do not reorder it by ease:
   - **A payment due date missed with the client never told** outranks everything. The client is now accruing the general interest charge on a bill they do not know about. Ring first, letter second.
   - **Money due inside fourteen days, client not told** is the same failure, still preventable today.
   - **An overdue lodgment** is accruing failure-to-lodge penalties per 28-day period. Lodge or get the deferral on record.
   - **A payment plan instalment overdue** can default the whole plan quietly. Confirm whether it was paid before assuming anything.
   - **An audit or review letter open** has a response window running at the ATO's end, not ours.
   - **A variance undecided** is an objection right expiring. Accept, amend or object.
   - **Unmatched and stale mail** is the pipeline silting up: the seven-day standard exists so nothing above ever happens.
3. For each item, say the one action: the command to run, the call to make, or the letter to draft. Name the staff member who owns it.
4. Anything that needs a letter is drafted, never sent: `npm run docs`, then a person sends.

If the operator asks "what should I do today", pick the top three and say why those three.
