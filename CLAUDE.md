# ATO Correspondence for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Practice:** [YOUR PRACTICE], an accounting and tax practice in [city, Australia]
- **Operator:** [YOUR NAME], [partner / practice manager / administrator]
- **The clients:** [roughly who: individuals, companies, trusts, SMSFs, and in what mix; which family groups matter most]
- **The team:** [who processes the mail, who signs off assessments, who talks to which clients]
- **The registered agent:** [who holds the tax agent registration; decisions on variances and objections are theirs]
- **Where documents live:** [your document store. The PDFs stay there; this system records the register and the `file` reference.]
- **What matters most:** [for example: no client ever surprised by a due date, every assessment checked before the letter, mail cleared inside three days, plans never allowed to default]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything for a client, run `doc <ref>` and `client <name>` and read the whole card: the amounts, the check, the history.
3. **Plain language.** Short sentences. No filler. Numbers in tables. The profession's words, not software words: a notice of assessment, a statement of account, a lodgment, a variance, an instalment, the general interest charge, a family group.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a client or the ATO waits for a yes in this session.
6. **Never invent a fact.** Names, amounts, periods and dates come from the letter, the operator or the database. If a fact is missing, say which one.
7. **Never state a tax position.** This system records what the ATO issued, what was lodged, and the difference. What to do about a difference (accept, amend, object) is the registered agent's decision, made outside this system and recorded in it. The rules in `docs/compliance.md` cite their sources; quote the source. Nothing here is tax advice.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| The morning mail run (PDFs in inbox/, or letters in hand) | `/process-mail` |
| What is sitting unprocessed | `/inbox` |
| What needs a decision today | `/attention` |
| Who owes the ATO money and have we told them | `/due` |
| Did the assessment match what we lodged | `/variances`; one document is `doc <ref>` |
| A new piece of mail, one at a time | `receive <client> --type= --title= ...` |
| Whose letter is this scan | `match <ref> <client>` (confirm on TFN last-three) |
| Check the numbers | `check <ref>` (against the lodgment record) |
| The client letter | `/draft-client-letter`, then a person sends, then `notify <ref>` |
| It is done, put it away | `file <ref> --ref="<document store path>"` |
| We lodged a return, a BAS | `lodge done <client> --on= --expected=` |
| A new obligation on the calendar | `lodge add <client> --kind= --period= --due=` |
| What is due to be lodged | `/lodgments` |
| A payment plan was arranged, an instalment paid | `plan add`, `plan paid` |
| The plans and the one about to default | `/payment-plans` |
| I spoke to them, note the file | `/log` |
| Everything about one client, one document | `/client`, `/doc` |
| The register, sliced any way | `/register` |
| Who is holding what, how fast are we | `/workload` |
| The Monday review | `/weekly-review` |
| Are we compliant, what would the TPB find | `/compliance` |
| Bring the practice over from ATOmate | `/import` |
| Change how this system works | `/customise` |
| A new page to look at | `/new-view` |
| The paperwork, in our brand | `npm run docs` |

If an ask fits nothing here, run the CLI directly (`npm run ato -- help`) and then propose a new command for it.

## Hard rules

- **Never record more than three digits of a tax file number.** Not in the database (the schema refuses), not in a note, not in a draft, not in your own replies. The Privacy (Tax File Number) Rule 2015 is binding; the last three digits are for confirming a letter against a client and nothing else. If a full TFN appears in a source document, use it to confirm the match and let it go.
- **No ATO credentials, ever.** This system does not connect to ATO Online, SBR or any practitioner service, and no key or login for them lands in this repo. Mail arrives however it arrives.
- Never send email or letters from here. Draft to `docs-out/` or `drafts/`, a person sends. Then `notify <ref>` records that it happened.
- Never notify an unchecked assessment, statement or instalment. The CLI refuses; `--force` is for a document genuinely checked outside this system, and then the check gets recorded immediately.
- Never file a notifiable document the client was never told about. The CLI refuses; `--no-letter` needs the reason in `--note=`.
- Never leave a variance without its explanation. The number that differs from the return has a reason, and the reason goes on the record before the client hears the number.
- Never delete records without an explicit yes in this session. A client who leaves is `client set <name> --status=former`; documents stay filed. The register is the practice's memory.
- Never invent a record. If a name or a reference is ambiguous, list the candidates and ask. The CLI already does this.
- The database is the source of truth. If the answer is not in it, say so.

## Words this practice uses

- A **notice of assessment** is the ATO's answer to a lodged return. It gets **checked** against the **lodgment record** (what we lodged and what we expected), and the difference is a **variance**: accepted, amended or objected to, never ignored.
- A **statement of account** is the running balance on an ATO account; a **debt letter** escalates one. Both carry due dates the client must hear about early.
- The **pipeline** is received, matched, checked, notified, filed. Every piece of mail walks it, and the **inbox** is everything still on it.
- A **family group** is the set of entities reviewed together: the individuals, the company, the trust, the SMSF. Mail is worked per group the way clients actually think.
- A **payment plan** is the ATO instalment arrangement; one missed instalment can default it and the **general interest charge** has been running the whole time.
- The **lodgment program** is the agent's calendar of due dates; **failure-to-lodge** penalties accrue per 28-day period once one is behind.
- **Turnaround** is received to client-notified, per person, measured from the records.

## Where things live

- `scripts/ato.mjs` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it. Never edit an applied migration; add the next one.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `inbox/` where letter PDFs land for `/process-mail`. `brand.json`, `views.json`, `documents.json` the HTML output: whose name is on it, what pages, what paperwork.
- `docs/compliance.md` the rules `/compliance` checks, each with its source. `docs/replace-atomate.md` moving off the incumbent. `docs/why-no-front-end.md` the honest trade-offs.
- `exports/` whole database dumps. `drafts/` and `docs-out/` anything written for a person to send.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/atomate
