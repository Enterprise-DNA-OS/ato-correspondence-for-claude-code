---
description: The lodgment calendar - what is due, what is overdue, and the expected result recorded so the assessment can be checked when it lands.
---

1. Run `npm run ato -- lodgments` (`--all` includes lodged and assessed history).
2. Overdue rows accrue failure-to-lodge penalties per 28-day period: lodge, or record the deferral in the note.
3. When a return goes in, record it WITH the expected result: `lodge done <client> --on= --expected=<payable dollars>` or `--expected-refund=`. That number is what the notice of assessment gets checked against; a lodgment recorded without it makes the later check blind.
4. New obligations: `lodge add <client> --kind=itr|bas|ias|fbt|smsf_return|tpar --period= --due=`.
