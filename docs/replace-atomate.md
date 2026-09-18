# Moving off ATOmate

ATOmate (and ATO SmartDocs, its main rival) sits between the ATO's mail and your practice management system: it reads each document, matches it to a client, checks the assessment against the return, files the PDF and drafts the client email. This system does the same job as a Postgres register plus an agent that can read, and the move is one afternoon of exports and one command, then the pipeline just starts running here.

## 1. Get your data out

There are three files to assemble. Column names are matched case-insensitively and the common variants are accepted; nothing needs renaming.

- **Clients**, from your practice management system, not from ATOmate (it reads your client list from XPM, APS, MYOB AE or HowNow rather than owning it). Xero Practice Manager: Business, then Clients, then Export. Take name, email, phone, client type, ABN, and group if you use family groups. A TFN column can stay in the file: the importer keeps the last three digits and drops the rest, and tells you how many it truncated.
- **Documents**: ATOmate's processed-documents or activity report (or SmartDocs' equivalent), as CSV: client, document type, title, date received or processed, amount, due date, status. If the report will not export, your document management system's index of the ATO folder gets you the same columns.
- **Lodgments** (optional but worth it): client, form kind, period, lodged date, expected result. XPM's tax return status report is the usual source. This is the table assessments get checked against, so the more history it has, the more the variance check can do from day one.

Export while your subscription is live. Departing practices have found report access ends at the subscription boundary.

## 2. Import here

Dry run first, always:

```bash
npm run ato -- import atomate --clients=clients.csv --documents=documents.csv --lodgments=lodgments.csv --dry-run
```

Nothing is written. Read the counts and every skip reason; the usual skip is a document whose client name does not match the client file exactly. Then the same command without `--dry-run`.

## 3. What maps

| ATOmate / your stack | Here |
|---|---|
| Client list (from XPM, APS, MYOB) | `clients`, with `external_ref` holding the practice management id |
| Family groups | `group_name`, and the mail gets reviewed per group again |
| Processed documents | `documents`, history arriving as filed |
| Document type | `doc_type`, mapped from the words in the export |
| Assessment vs return check | `lodgments.expected_cents` against `documents.amount_cents`: the variance is one subtraction |
| Payment due dates | `due_on`, and the due list watches them |
| The client email templates | `npm run docs` letter drafts in your brand, from `brand.json` |
| TFN columns | truncated to the last three digits on the way in, deliberately |

Re-running the import updates rather than duplicates: clients match on name or id, documents on their document id where the export has one.

## 4. What does not carry over, deliberately

- **The ATO feed.** ATOmate's connection to the ATO (and the DSP registration behind it) is its own credentialed pipe. Here, mail arrives however it arrives: the practice's ATO Online download, scans, paper. `/process-mail` reads a folder of PDFs and registers each one. A practice that wants the feed wired in has that built as its own adapter, with its own credentials, outside this repo.
- **Full tax file numbers.** Never stored here. The last three digits survive for letter-matching; the rest is dropped and counted.
- **Auto-sent client emails.** Nothing sends from this system. Letters draft to `docs-out/`; a person reads and sends. That is a feature, not a gap: the day a wrong assessment letter goes out unread is the day the automation cost more than it saved.
- **Mid-pipeline state.** History arrives filed; live documents arrive matched and get walked through `check` and `notify` here, because the old system's word is not a check.
- **The document PDFs themselves.** They stay in your document store (that was always where ATOmate filed them). This register records where: `file <ref> --ref="<path>"`.

## 5. Verify

```bash
npm run ato -- stats
npm run ato -- clients
npm run ato -- register --all
npm run ato -- lodgments --all
npm run ato -- compliance
```

The client count and a spot-check of ten documents against the old system are the two things worth an hour. Then run one week's mail through `/process-mail` in parallel with the old system before the subscription lapses, and compare the registers on Friday.
