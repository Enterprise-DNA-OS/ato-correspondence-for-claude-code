---
description: Every payment plan and its next instalment date. One missed instalment defaults an ATO plan, quietly.
---

1. Run `npm run ato -- plans`.
2. Anything overdue gets the phone call today: was it paid? If yes, `plan paid <client>` (the balance steps down and the next date sets itself). If no, the client pays now or the arrangement is renegotiated with the ATO before the default letter.
3. `plan add <client> --total= --instalment= --frequency= --next=` when a new arrangement is made; `plan defaulted` or `plan completed` when one ends.
4. `npm run docs` renders a payment-plan schedule per active plan, in the practice's brand, for the client file or the client themselves.
