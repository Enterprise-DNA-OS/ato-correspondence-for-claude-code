<h1 align="center">ATO Correspondence for Claude Code</h1>

<p align="center">
  <strong>The open-source ATO correspondence system for accounting firms that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your ATOmate data brought across.<br/><a href="https://calendly.com/sam-mckay/discovery-call">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/atomate">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#compliance-checked-against-the-data">Compliance</a> &bull;
  <a href="#ten-questions-atomate-cannot-answer">Ten questions</a> &bull;
  <a href="#instead-of-atomate">Instead of ATOmate</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

<!-- three-doors -->
<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, a web front end if you want one, your ATOmate data brought across.<br/><a href="https://calendly.com/sam-mckay/discovery-call">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/atomate">How it works</a></td>
  </tr>
</table>

<p align="center">Works with Claude Code, Codex, OpenCode or Cursor (see <a href="AGENTS.md">AGENTS.md</a>).</p>

## What is this

ATO Correspondence for Claude Code does the job you pay ATOmate or ATO SmartDocs for, as a Postgres database and a set of Claude Code commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) and work the mail in plain language. It runs the right query, and it can answer questions the incumbent's dashboard cannot.

An Australian tax practice drowns in ATO mail: notices of assessment, statements of account, debt letters, PAYG instalment notices, lodgment demands, audit letters, payment plan confirmations, per client, all season. The tools that process it charge a setup fee and a subscription priced on your document volume (ATO SmartDocs publishes A$395 to A$660 a month on top of setup; ATOmate quotes each practice privately), and what they sell is a pipeline: capture the document, match it to the client, check the assessment against the return, tell the client, file it.

This repo is that pipeline over Postgres, with the reading done by the agent you already have:

```
/process-mail                     PDFs in inbox/ read, matched and registered, ready to check
/inbox                            everything not yet in front of the client, oldest first
/attention                        everything that wants a decision this morning, worst first
/due                              money due to the ATO, and whether each client has been told
/variances                        what the ATO assessed against what you lodged, gaps loud
/payment-plans                    every plan and its next instalment (one miss defaults it)
/lodgments                        the calendar, overdue first, expected results recorded
/client Gable                     one client's whole ATO relationship before the phone call
/doc 1007                         one document: the numbers, the check, the trail
/compliance                       eight rules from the Acts and the TPB Code, run against your records
/weekly-review                    the Monday review, written from three commands
```

The pipeline is five verbs: `receive`, `match`, `check`, `notify`, `file`. Amounts are signed (payable or refund), every assessment is checked against the lodgment you recorded, and the client hears a checked number, never a raw one; the CLI refuses to have it any other way.

**No full tax file number is stored here, ever.** The schema and the CLI both cap TFN material at the last three digits (enough to confirm a letter in your hand), imports truncate TFN columns on the way in and count what they dropped, and the Privacy (Tax File Number) Rule 2015 is the reason. **Nothing connects to the ATO and nothing sends to a client.** Mail arrives however it arrives; letters draft to `docs-out/` and a person sends them. Nothing here is tax advice.

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your correspondence register sits in plain Postgres tables you own. Any tool can read them. No export request, no access ending when a subscription does.
- No document-volume pricing, no per-practice quote, no add-on tier for the checking. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/ato-correspondence-for-claude-code.git
cd ato-correspondence-for-claude-code
npm install
npm run demo
```

`npm run demo` creates the database, loads Banksia Partners (a demo Brisbane practice with four staff, sixteen clients, and a fortnight of mail gone slightly wrong: an $18,400 assessment due in nine days the client has not heard about, a statement whose due date passed three days ago, an assessment $1,840 off the lodged return with no explanation recorded, a payment plan instalment five days overdue and a BAS six days late), then prints the inbox, the due list, the attention list and the compliance check.

Then open the folder in Claude Code and type:

```
/attention
```

Try `/inbox`, `/due`, `/variances`, `/payment-plans`, `/client Gable`, `/doc 1008`, `/weekly-review`. When you are ready for real data, delete `.data/` and start with `/import`, or drop this week's PDFs into `inbox/` and run `/process-mail`.

Fill in the "Who this is for" block in [CLAUDE.md](CLAUDE.md) so letters come out in your practice's voice, and put your name and colours in [brand.json](brand.json) so every letter and dashboard carries them.

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee. A practice shares one database: each person clones the repo, points at the same `DATABASE_URL`, sets `ATO_STAFF` to their own name, and works in their own Claude Code.

## The commands

| Command | What it does |
|---|---|
| `/process-mail` | Read the PDFs in `inbox/` (or letters described out loud), extract the facts, register each one matched to its client. The data-entry half of the incumbent, done by reading. |
| `/inbox` | Everything not yet in front of the client, oldest first, with the next verb named per row. |
| `/attention` | Everything that wants a decision, worst first: missed due dates outrank all. |
| `/due` | Money due to the ATO across the client base, and whether each client has been told. |
| `/variances` | Assessed against lodged, per document. Accept, amend or object, and the unexplained ones are loud. |
| `/payment-plans` | Every plan, its next instalment, and the overdue ones. `plan paid` steps the balance down. |
| `/lodgments` | The calendar with expected results recorded, so the next assessment gets checked against something. |
| `/workload` | Who holds what at which stage, and each person's real received-to-notified turnaround. |
| `/client` | One client's whole ATO relationship: correspondence, lodgments, plans, contact history. |
| `/doc` | One document in full: the numbers, the check, the variance, the trail. |
| `/register` | The correspondence register, filtered by client, type, period or status. |
| `/compliance` | Eight rules from the Acts and the TPB Code, run against your records, each with its source. |
| `/weekly-review` | The Monday review, written from three commands. |
| `/draft-client-letter` | The client letter for a checked document, drafted from the record into `docs-out/`. Never sent. |
| `/log` | A call, an email, a meeting, onto the contact log against the client or the document. |
| `/import` | Bring the practice across from ATOmate, XPM or plain CSV. TFNs truncated on the way in. |
| `/customise` | Add a field, rename types, change a rule, in plain language. Writes and applies the migration. |
| `/new-view` | Add a read-only HTML dashboard from a description. |

Everything the commands do, the CLI does: `npm run ato -- help`. Any command takes `--json`.

### Documents and views, in your brand

```bash
npm run docs    # client letter drafts, payment plan schedules, staff day reports, client ATO position pages
npm run view    # the mailroom and the season, as read-only HTML dashboards
```

Both read [brand.json](brand.json), so your practice's name, logo and colours are one file away. Documents land in `docs-out/`, views in `views/`. Print either to PDF from the browser. `/new-view` adds a view, `documents.json` adds a document.

## Compliance, checked against the data

`/compliance` runs the rules in [docs/compliance.md](docs/compliance.md) against your records and reports what is breached. Each rule cites its source, and the CLI enforces the sharpest ones at the gate: no flag will store a full TFN, an assessment cannot be checked against nothing, an unchecked number cannot be sent to a client, and a notifiable document cannot be filed with the client never told.

1. No full tax file number stored, anywhere (Privacy (Tax File Number) Rule 2015, binding under s 17 Privacy Act 1988).
2. Every document actioned within seven days of receipt (TASA 2009 s 30-10 item 7, and the practice's own standard).
3. The client hears a checked number, never a raw one (s 30-10 items 9 and 10, reasonable care).
4. Every variance carries its explanation (s 30-10 item 9).
5. The client told at least fourteen days before money is due (s 30-10 item 12).
6. No variance left undecided past thirty days, because objection windows expire (TAA 1953 Part IVC).
7. No payment plan instalment overdue, because one miss can default the plan and the general interest charge has been running the whole time.
8. No lodgment past its due date (TAA 1953 s 8C, and failure-to-lodge penalties per 28-day period).

Nothing there is tax advice. It is the rule book you point the system at, and you change it to match your practice.

## Ten questions ATOmate cannot answer

Every one of these is answered by the demo data today. Yours will be different, and that is the point.

1. Which clients have money due to the ATO in the next fourteen days and have not yet been told, and who owns each one?
2. Which assessments this season differed from the return as lodged, by how much, and which differences still have no recorded explanation?
3. What is each staff member's real turnaround from document received to client notified, and whose oldest held item is oldest?
4. Which payment plans will hit their next instalment date this week, and which have already missed one?
5. What is the total the client base owes the ATO across every payable document with a future due date, and who holds the most of it?
6. Which clients got a debt letter this quarter, and what does the rest of their file (plans, lodgments, correspondence) say about why?
7. Which lodgments are overdue right now and accruing failure-to-lodge penalties, and which fall due in the next fortnight?
8. Which audit or review letters are open, how long has each one been open, and is the response task on anyone's list?
9. Which documents were notified to clients but never filed, so the letter went out and the record is dangling?
10. Which family group has the most open items across all of its entities, counted as a group the way you actually review them?

## Your first hour: ten things to ask for

Open the folder in Claude Code and say these in your own words. Each one changes the system to fit your practice.

1. "Put our team in with their roles, and make me the partner on the Smith and Nguyen groups."
2. "Put our logo and colours on the letters and dashboards, and change the practice name to ours."
3. "Our turnaround standard is three days, not seven. Change the rule and the check together."
4. "Add a `division_293` document type; we see a lot of them."
5. "Import our XPM client list, then register this folder of PDFs."
6. "Add a rule to `/compliance`: no SMSF client without an annual return on the lodgment record."
7. "Track the ATO's own reference number on every document, and show it on the letters."
8. "Build me a page per accountant for Monday: their pipeline, their due dates, their tasks."
9. "When a debt letter arrives for a client on a payment plan, flag it against the plan automatically."
10. "Write me a command that drafts the payment plan proposal letter from a client's open payable documents."

`/customise` writes the migration, applies it, updates every command that touches the change, and runs the tests.

## Instead of ATOmate

Export your client list from your practice management system and the processed-documents report from ATOmate, run one command, and the register comes with you. Step by step, with what maps and what deliberately does not: [docs/replace-atomate.md](docs/replace-atomate.md).

```bash
npm run ato -- import atomate --clients=clients.csv --documents=documents.csv --lodgments=lodgments.csv --dry-run
npm run ato -- import atomate --clients=clients.csv --documents=documents.csv --lodgments=lodgments.csv
```

XPM client exports go through the same command with `xpm` in place of `atomate`; anything else works with `csv`. TFN columns are truncated to their last three digits on the way in, and the import tells you how many it truncated.

## Architecture

```
ato-correspondence-for-claude-code/
  CLAUDE.md                 how the practice wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  brand.json                your practice's name, logo and colours on every letter and view
  views.json                the HTML dashboards npm run view renders
  documents.json            the paperwork npm run docs renders
  .claude/commands/         the slash commands
  inbox/                    drop ATO letter PDFs here; /process-mail registers them
  scripts/ato.mjs           the CLI the commands drive
  scripts/view.mjs          read-only HTML dashboards from the SQL views
  scripts/docs.mjs          the documents, one HTML file per record
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema, tables and views
  supabase/seed.sql         demo data
  docs/compliance.md        the rules /compliance checks, each with its source
  docs/replace-atomate.md   moving off the incumbent
  docs/why-no-front-end.md  the honest trade-offs
  exports/                  whole database dumps
  drafts/                   anything written for a person to send
```

## Built with Claude Code

This repository was built with Claude Code as the primary development tool, from the schema to the commands, and it is meant to be extended the same way. Ask for a new command and it writes one.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end, no full TFNs, no ATO credentials, and nothing that sends to a client.

## Want it installed and run for you?

Enterprise DNA installs ATO Correspondence for Claude Code for your practice, migrates your ATOmate data, wires your document intake, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: https://calendly.com/sam-mckay/discovery-call
- Read more: https://enterprisedna.co/omni/instead-of/atomate

## License

MIT. Copyright (c) 2026 Enterprise DNA.
