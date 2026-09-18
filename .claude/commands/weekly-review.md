---
description: The Monday review, written from three commands. The mailroom, the money, the calendar, then the five things that matter this week.
---

Run these three, in this order, and write the review from what they return. Do not write anything they do not support.

```
npm run ato -- attention
npm run ato -- due
npm run ato -- lodgments
```

Then write it in this shape, no more than a page:

1. **The week in one line.** Documents in the pipeline, the oldest held, money due across the client base in the next 30 days, open variances, lodgments still due.
2. **Clients about to be surprised.** Every payable amount due inside 14 days where the client has not been told. Each with its staff owner and the single next action. This section empty is the whole system working.
3. **The calendar.** Lodgments overdue and due this fortnight. Failure-to-lodge penalties accrue per 28-day period; say which rows are accruing now.
4. **The decisions.** Open variances (accept, amend or object) and any audit or review letter, each with its days-open count.
5. **The plans.** Payment plan instalments due this week, and any already overdue.
6. **Turnaround.** One line per person from `workload`: what they hold, the oldest, the average days to notify.
7. **The five things to do this week.** Picked from the attention list, weighted by what costs the client money first, and say why each made the list.
8. **One thing to decide.** The single item that needs a person, not a process.

Add `npm run view -- mailroom` and `npm run view -- season` if the operator wants pages for a partners' meeting: same numbers, the practice's brand, and they print.

Numbers come from the commands. If a number is not in the output, it does not go in the review.
