---
description: Money due to the ATO across the client base, and whether each client has been told. The list that protects the practice's relationships.
---

1. Run `npm run ato -- due` (30 days by default; `--days=60` widens it).
2. The column that matters is `client told`. A NO with a near date is a client about to be surprised by their own tax bill, and that is how a practice loses them.
3. For each NO: `check <ref>` if it has not been checked, draft the letter (`npm run docs`, the due date in the first line), a person sends it, then `notify <ref>`.
4. If the client cannot pay, the conversation is a payment plan: once arranged with the ATO, `plan add <client> --total= --instalment= --next=`.
