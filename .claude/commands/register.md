---
description: The correspondence register, filtered any way the operator asks - by client, type, period or status.
---

1. `npm run ato -- register` takes `--client=`, `--type=`, `--status=`, `--period=` and `--all`. Combine them to answer the ask ("all the debt letters this year", "everything still open for the Gables").
2. For a family group, resolve the group members first (`clients`, group column) and run per client, or filter the `--json` output on `group_name`.
3. Present as returned. If the operator asks a question the flags cannot answer ("which clients got debt letters AND have an overdue lodgment"), take the `--json` output of the relevant commands and join them yourself, then show the working.
