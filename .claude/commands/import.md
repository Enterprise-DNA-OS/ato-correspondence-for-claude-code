---
description: Bring the practice across from ATOmate, Xero Practice Manager or a plain CSV. Clients, the correspondence register, the lodgment record. Dry run first, TFNs truncated on the way in, gaps flagged honestly.
---

The operator has exports from the old system. The full walkthrough is [docs/replace-atomate.md](../../docs/replace-atomate.md); the short version:

1. Three files, any of them optional except clients on the first run:
   - **Clients** (XPM or practice management export): name, email, phone, type, ABN, group.
   - **Documents** (the correspondence register or processed-documents report): client, type, title, date received, amount, due date, status.
   - **Lodgments**: client, kind, period, due or lodged date, expected result.
   The importer matches column names case-insensitively and accepts the common variants; nothing needs renaming.
2. Dry run first, always:
   `npm run ato -- import atomate --clients=clients.csv --documents=documents.csv --lodgments=lodgments.csv --dry-run`
   Nothing is written. Read the counts and every skip reason. The usual skip is a document whose client name does not match the client file exactly.
3. Then the same command without `--dry-run`. XPM client exports go through `xpm`; anything else through `csv`.
4. Check it: `stats`, `clients`, `register --all`, `lodgments --all`.

What the import deliberately does on the way in:
- **TFN columns are truncated to their last three digits.** The full numbers never land, and the import says how many it truncated (Privacy (Tax File Number) Rule 2015).
- **Documents with no matching client arrive unmatched**, not guessed. `match` them one at a time.
- **History arrives filed; live items arrive matched.** Anything mid-pipeline gets walked through check and notify here, because the old system's word is not a check.
