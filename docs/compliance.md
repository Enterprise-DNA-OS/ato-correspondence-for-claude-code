# The rule book /compliance runs

`npm run ato -- compliance` checks the records against the rules below and reports what is breached, with the source cited. The CLI also enforces the sharpest ones at the gate: no flag will store a full tax file number, an assessment cannot be checked against nothing, a checkable document cannot be notified unchecked, and a notifiable document cannot be filed with the client never told.

**None of this is tax advice or legal advice.** It is a rule book an Australian suburban accounting practice pointed this system at, written down with sources so it can be checked, argued with, and changed. Your obligations are defined by the Acts, the Tax Practitioners Board, your professional body and your own engagement terms; edit this file and the checks together (`/customise` does both).

## The eight rules

### 1. tfn: no full tax file number stored, anywhere

**Source:** the Privacy (Tax File Number) Rule 2015, issued under s 17 of the Privacy Act 1988 and legally binding on all TFN recipients. Unauthorised use or disclosure of TFNs is also an offence under the Taxation Administration Act 1953 (s 8WB).
**The check:** no client row carries more than three TFN digits. The schema's check constraint and the CLI's refusal of `--tfn=` make a breach close to impossible; the rule stays in the book so the run says so out loud.
**The design:** the safest TFN store is the one that does not exist. The last three digits are enough to confirm a letter in your hand belongs to the client on your screen, and that is all this system will hold. Imports truncate TFN columns on the way in and report the count.

### 2. turnaround: every document actioned within seven days of receipt

**Source:** Tax Agent Services Act 2009, s 30-10 Code of Professional Conduct item 7 (services provided competently), and the standard the practice sets for itself. Seven days is a choice, not a law; change it in `scripts/ato.mjs` and here together.
**The check:** nothing sits in received, matched or checked for more than seven days.
**Fix:** the inbox lists them oldest first; walk the pipeline on each.

### 3. checked: the client hears a checked number, never a raw one

**Source:** TASA 2009 s 30-10 items 9 and 10: reasonable care in ascertaining a client's state of affairs and in applying the taxation laws. Forwarding an unverified assessment figure is how a data-matching error becomes the client's problem.
**The check:** no assessment, statement or instalment notice was notified with no check on record.
**The gate:** `notify` refuses an unchecked document; `--force` exists for one genuinely checked outside this system, and then the check gets recorded immediately.

### 4. variance: every variance carries its explanation

**Source:** TASA 2009 s 30-10 item 9. A number that differs from the return as lodged has a reason (a data-matching add-back, a denied deduction, an ATO adjustment, a missed instalment credit), and the reason belongs on the record before the client hears the number.
**The check:** no open variance is missing its check note.
**Fix:** find the reason, then `check <ref> --note="the reason"`. The client letter renders it.

### 5. due-notice: the client told at least fourteen days before money is due

**Source:** TASA 2009 s 30-10 item 12 (advising the client of their rights and obligations under the taxation laws). The general interest charge runs from the due date whether or not the client knew; fourteen days is the practice's own standard for never letting that happen.
**The check:** no payable document with a due date inside fourteen days (or already past) has the client untold.
**Fix:** `notify <ref>` today, the letter drafted with `npm run docs` and the due date in its first line.

### 6. objection: no variance left undecided past thirty days

**Source:** Taxation Administration Act 1953, Part IVC. Objection periods are real deadlines: broadly two years from the notice of assessment for most individuals and small business entities, four years for other taxpayers, and as short as sixty days for some other decisions (s 14ZW sets the table). A variance parked in a tray is a right quietly expiring.
**The check:** no open variance has been known for more than thirty days without a decision.
**Fix:** decide: accept (file it, note recorded), amend, or object. If objecting, confirm the window for this taxpayer's actual circumstances and diarise it today. This system flags age; it does not compute anyone's objection deadline.

### 7. plans: no payment plan instalment overdue

**Source:** ATO payment plan practice: a missed instalment can default the arrangement, the whole balance falls due, and the general interest charge has been accruing the entire time. The ATO's own guidance says as much on ato.gov.au (managing payment plans).
**The check:** no active plan's next instalment date is in the past.
**Fix:** ring the client today. Paid: `plan paid <client>`. Not paid: pay now or renegotiate before the default letter is issued.

### 8. lodgments: no lodgment past its due date

**Source:** TAA 1953 s 8C (failure to lodge when required is an offence) and the failure-to-lodge penalty regime (one penalty unit per 28-day period, size-multiplied, under Division 286 of Schedule 1). An agent's lodgment program protects the dates it is ahead of, not the ones already behind.
**The check:** nothing on the lodgment record with status due has a due date in the past.
**Fix:** lodge it (`lodge done <client> --on= --expected=`), or record the deferral in the note.

## The boundaries this system keeps on purpose

- **No ATO connection.** No practitioner credentials, no SBR, no digital service provider registration, no scraping of ATO Online. Mail arrives however it arrives; this is the register, the checker and the drafter behind it. A practice that wants its ATO feed wired in has that built as its own adapter with its own credentials, outside this repo.
- **No full TFNs**, per rule 1. Not in the database, not in notes, not in drafts, not in exports.
- **Nothing sends.** Letters render to `docs-out/`, drafts to `drafts/`, and a person sends them.
- **No tax positions.** The system records what the ATO issued, what the practice lodged, and the difference. What to do about a difference is a decision by a registered agent, made outside this system and recorded in it.
