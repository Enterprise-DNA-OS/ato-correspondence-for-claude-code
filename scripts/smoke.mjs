#!/usr/bin/env node
// End-to-end smoke test on a throwaway embedded database.
// Runs migrate, seed, then every CLI command that matters, and asserts on the JSON.
// Passes on Windows and Linux. No network, no Postgres install.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'ato-smoke-'));
const env = { ...process.env, DATA_DIR: dataDir };
delete env.DATABASE_URL; // the smoke test always runs embedded
delete env.ATO_STAFF;

let step = 0;
function run(label, args, { json = true, expectFail = false } = {}) {
  step++;
  const argv = [path.join(root, 'scripts', args[0]), ...args.slice(1), ...(json ? ['--json'] : [])];
  const res = spawnSync(process.execPath, argv, { cwd: root, env, encoding: 'utf8' });
  const ok = expectFail ? res.status !== 0 : res.status === 0;
  if (!ok) {
    console.error(`\nFAIL step ${step} (${label}): exit ${res.status}\n--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`);
    process.exit(1);
  }
  console.log(`  ok  ${String(step).padStart(2)}  ${label}`);
  if (!json || expectFail) return { stdout: res.stdout, stderr: res.stderr };
  try {
    return JSON.parse(res.stdout);
  } catch {
    console.error(`\nFAIL step ${step} (${label}): output is not JSON\n${res.stdout}\n${res.stderr}`);
    process.exit(1);
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`\nFAIL assertion: ${msg}`);
    process.exit(1);
  }
}

const n = (v) => Number(v ?? 0);

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// Local date, the same way the CLI computes "today". Never UTC: Brisbane is
// ten hours ahead of it.
const todayIso = (() => {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
})();

console.log(`smoke: data dir ${dataDir}`);
try {
  run('migrate', ['migrate.mjs'], { json: false });
  run('migrate again (idempotent)', ['migrate.mjs'], { json: false });
  run('seed', ['seed.mjs'], { json: false });
  run('seed again (idempotent)', ['seed.mjs'], { json: false });

  // ---- the practice ---------------------------------------------------------

  const staff = run('staff', ['ato.mjs', 'staff']);
  assert(staff.length === 4, `four staff (${staff.length})`);

  const clients = run('clients', ['ato.mjs', 'clients']);
  assert(clients.length === 16, `sixteen active clients (${clients.length})`);
  assert(clients.some((c) => n(c.payable_ahead_cents) > 0), 'money ahead of somebody shows');

  const client = run('client card', ['ato.mjs', 'client', 'Gable Plumbing']);
  assert(client.client.name === 'Gable Plumbing Pty Ltd', 'resolved by partial name');
  assert(client.client.tfn_last3 === '482', 'and only the last three TFN digits exist');
  assert(client.documents.length >= 2, 'with its correspondence attached');

  const noSuch = run('an unknown client exits 1', ['ato.mjs', 'client', 'nobody at all'], { json: false, expectFail: true });
  assert(/No client matches/.test(noSuch.stderr), 'and says so plainly');

  const ambiguous = run('an ambiguous name exits 1 and lists candidates', ['ato.mjs', 'client', 'a'], { json: false, expectFail: true });
  assert(/matches \d+ client records/.test(ambiguous.stderr), 'with the candidates listed');

  const group = run('a family group resolves through fuzzy match', ['ato.mjs', 'client', 'Karvelas Family']);
  assert(group.client.group_name === 'Karvelas', 'the trust is in the Karvelas group');

  // ---- the register ---------------------------------------------------------

  const inbox = run('inbox', ['ato.mjs', 'inbox']);
  assert(inbox.length === 8, `eight documents not yet in front of the client (${inbox.length})`);
  assert(inbox.some((d) => !d.client_id), 'including the unmatched scan');
  assert(inbox[0].days_held >= inbox[inbox.length - 1].days_held, 'oldest first');

  const register = run('register', ['ato.mjs', 'register', '--all']);
  assert(register.length === 15, `fifteen documents on the register (${register.length})`);

  const byType = run('register filtered by type', ['ato.mjs', 'register', '--type=assessment', '--all']);
  assert(byType.length === 4 && byType.every((d) => d.doc_type === 'assessment'), 'four assessments');

  const doc = run('doc card by bare number', ['ato.mjs', 'doc', '1007']);
  assert(doc.document.ref === 'ATO-1007', 'ATO-1007 resolves from "1007"');
  assert(doc.document.client === 'Gable Plumbing Pty Ltd', 'with its client');
  assert(doc.lodgment && n(doc.lodgment.expected_cents) === 1840000, 'and the lodgment it was checked against');
  assert(doc.variance === null, 'no variance on the clean one');

  const varDoc = run('doc card with a variance', ['ato.mjs', 'doc', 'ATO-1008']);
  assert(n(varDoc.variance.variance_cents) === 184000, `the Marchetti variance is $1,840 (${varDoc.variance.variance_cents})`);

  // ---- the money and the calendar ------------------------------------------

  const due = run('due', ['ato.mjs', 'due']);
  assert(due.some((d) => d.ref === 'ATO-1007' && !d.client_notified), 'the $18,400 due in nine days shows, client not told');
  assert(due.some((d) => d.ref === 'ATO-1009' && n(d.days_to_due) < 0), 'so does the one already missed');

  const variances = run('variances', ['ato.mjs', 'variances']);
  assert(variances.length === 1 && variances[0].ref === 'ATO-1008', 'one open variance');
  assert(!variances[0].check_note, 'and its explanation is missing, loudly');

  const lodgments = run('lodgments still due', ['ato.mjs', 'lodgments']);
  assert(lodgments.length === 4, `four lodgments due (${lodgments.length})`);
  assert(lodgments.some((l) => l.kind === 'bas' && n(l.days_to_due) < 0), 'the overdue BAS shows');

  const plans = run('payment plans', ['ato.mjs', 'plans']);
  assert(plans.length === 2, `two active plans (${plans.length})`);
  assert(plans.some((p) => n(p.days_to_next) < 0), 'one instalment overdue');

  const workload = run('workload', ['ato.mjs', 'workload']);
  assert(workload.some((w) => w.avg_days_to_notify !== null), 'turnaround computes');

  // ---- compliance and attention ----------------------------------------------

  const compliance = run('compliance', ['ato.mjs', 'compliance']);
  assert(compliance.length === 8, 'eight rules in the book');
  const failed = compliance.filter((r) => r.breaches.length);
  assert(failed.map((r) => r.key).sort().join(',') === 'due-notice,lodgments,objection,plans,turnaround,variance',
    `the seeded breaches are exactly the story (${failed.map((r) => r.key).join(',')})`);
  assert(!failed.some((r) => r.key === 'tfn'), 'the TFN rule passes because the gate makes it impossible to fail');

  const oneRule = run('one compliance rule', ['ato.mjs', 'compliance', 'plans']);
  assert(oneRule.length === 1 && oneRule[0].breaches.length === 1, 'run one rule on its own');

  const attention = run('attention', ['ato.mjs', 'attention']);
  assert(attention.length >= 12, `the attention list is loud (${attention.length})`);
  for (const reason of ['due_missed', 'due_soon_unnotified', 'variance_open', 'doc_unmatched', 'doc_stale', 'audit_open', 'plan_overdue', 'lodgment_overdue', 'unfiled', 'task_overdue']) {
    assert(attention.some((a) => a.reason === reason), `attention carries ${reason}`);
  }
  assert(attention[0].reason === 'due_missed', 'the missed due date outranks everything');

  run('stats', ['ato.mjs', 'stats']);

  // ---- the TFN gate ------------------------------------------------------------

  const tfnRefused = run('a full TFN is refused at the gate', ['ato.mjs', 'add', 'client', 'Test Taxpayer', '--tfn=123456789'], { json: false, expectFail: true });
  assert(/does not store tax file numbers/.test(tfnRefused.stderr), 'and the refusal cites the TFN Rule');

  const tfnLong = run('four digits are refused too', ['ato.mjs', 'add', 'client', 'Test Taxpayer', '--tfn-last3=1234'], { json: false, expectFail: true });
  assert(/at most three digits/.test(tfnLong.stderr), 'three is the ceiling');

  // ---- a piece of mail, end to end ----------------------------------------------

  run('add a client', ['ato.mjs', 'add', 'client', 'Priya & Co Consulting Pty Ltd', '--type=company', '--tfn-last3=204', '--staff=Dave']);

  const lodged = run('record the lodgment', ['ato.mjs', 'lodge', 'add', 'Priya & Co', '--kind=itr', '--period=2025-26', '--expected=5200', '--lodged=' + addDays(todayIso, -20)]);
  assert(lodged.status === 'lodged', 'lodged with an expected result');

  const received = run('receive the assessment', ['ato.mjs', 'receive', 'Priya & Co', '--type=assessment',
    '--title=Notice of assessment 2025-26', '--period=2025-26', '--payable=6100', '--due=' + addDays(todayIso, 21)]);
  const ref = received.ref;
  assert(/^ATO-\d+$/.test(ref), `the ref is minted (${ref})`);
  assert(received.status === 'matched', 'received against a known client lands matched');

  const blockedNotify = run('notifying before the check is refused', ['ato.mjs', 'notify', ref], { json: false, expectFail: true });
  assert(/checked number, never a raw one/.test(blockedNotify.stderr), 'and the refusal says why');

  const checked = run('check finds the lodgment and the variance', ['ato.mjs', 'check', ref]);
  assert(n(checked.baseline_cents) === 520000, 'checked against the recorded lodgment');
  assert(n(checked.variance_cents) === 90000, `the $900 variance computes (${checked.variance_cents})`);

  run('record the explanation', ['ato.mjs', 'check', ref, '--note=ATO data matching added bank interest the client had not provided.']);

  const blockedFile = run('filing before the client is told is refused', ['ato.mjs', 'file', ref], { json: false, expectFail: true });
  assert(/has not been told/.test(blockedFile.stderr), 'the letter comes before the filing');

  run('notify', ['ato.mjs', 'notify', ref]);
  const filed = run('file it with its document store ref', ['ato.mjs', 'file', ref, '--ref=DM:PriyaCo/2026/NoA.pdf']);
  assert(filed.status === 'filed' && filed.file_ref === 'DM:PriyaCo/2026/NoA.pdf', 'filed with the reference');

  const trail = run('the trail reads back', ['ato.mjs', 'doc', ref]);
  assert(trail.document.status === 'filed', 'status says so');
  assert(trail.notes.length >= 1, 'the notify wrote the contact log entry');

  // ---- an unchecked assessment cannot check against nothing -----------------------

  const rawNoa = run('receive an assessment with no lodgment on record', ['ato.mjs', 'receive', 'McAdam', '--type=assessment',
    '--title=Notice of assessment 2025-26', '--period=2025-26', '--payable=3300']);
  const blockedCheck = run('checking it against nothing is refused', ['ato.mjs', 'check', rawNoa.ref], { json: false, expectFail: true });
  assert(/Check .* against what/.test(blockedCheck.stderr), 'and the refusal names the fix');
  const expChecked = run('check with an explicit expected amount', ['ato.mjs', 'check', rawNoa.ref, '--expected=3300', '--note=Company return prepared by the previous agent; figures agreed to their workpapers.']);
  assert(n(expChecked.variance_cents) === 0, 'and it matches');

  // ---- unmatched mail, matched -----------------------------------------------------

  const scan = run('the scanned instalment notice resolves', ['ato.mjs', 'doc', 'ATO-1010']);
  assert(!scan.document.client_id, 'still unmatched');
  const matched = run('match it', ['ato.mjs', 'match', 'ATO-1010', 'Willoughby']);
  assert(matched.status === 'matched', 'matched now');

  // ---- plans and lodgments move ----------------------------------------------------

  const paid = run('the overdue instalment gets paid', ['ato.mjs', 'plan', 'paid', 'Crestline']);
  assert(n(paid.remaining_cents) === 1320000, `the balance steps down (${paid.remaining_cents})`);
  assert(paid.next_due_on, 'and the next date is set');

  const plansAfter = run('no plan overdue now', ['ato.mjs', 'plans']);
  assert(!plansAfter.some((p) => n(p.days_to_next) < 0), 'the attention item clears');

  run('the BAS goes in', ['ato.mjs', 'lodge', 'done', 'Northgate', '--kind=bas', '--period=Q4 2025-26', '--expected=4100']);
  const complianceAfter = run('compliance improves', ['ato.mjs', 'compliance']);
  const failedAfter = complianceAfter.filter((r) => r.breaches.length).map((r) => r.key);
  assert(!failedAfter.includes('plans') && !failedAfter.includes('lodgments'),
    `the fixed rules now pass (${failedAfter.join(',')})`);

  run('log a call', ['ato.mjs', 'log', 'ATO-1012', 'Tomasz has the logbook; meeting Thursday to assemble the response.', '--staff=Meredith']);
  run('task add', ['ato.mjs', 'task', 'add', 'Draft the Wojcik review response', '--doc=ATO-1012', '--due=' + addDays(todayIso, 3), '--staff=Meredith']);
  run('task done', ['ato.mjs', 'task', 'done', 'Compile Wojcik substantiation']);

  // ---- import ------------------------------------------------------------------

  const clientsCsv = path.join(dataDir, 'clients.csv');
  const docsCsv = path.join(dataDir, 'documents.csv');
  const lodgCsv = path.join(dataDir, 'lodgments.csv');
  writeFileSync(clientsCsv, [
    'Client Name,Email,Phone,Client Type,ABN,TFN,Client ID',
    '"Yasmin Holt",y.holt@example.au,0412 111 001,Individual,,123456782,XPM-9001',
    '"Holt Electrical Pty Ltd",accounts@holtelectrical.example.au,07 3555 0400,Company,64 009 111 222,987654325,XPM-9002',
    '"Gable Plumbing Pty Ltd",accounts@gableplumbing.example.au,07 3555 0201,Company,53 004 085 616,,XPM-8001',
  ].join('\n'));
  writeFileSync(docsCsv, [
    'Client,Document Type,Title,Date Received,Amount,Due Date,Status,Document ID',
    '"Yasmin Holt",Notice of Assessment,Notice of assessment 2024-25,' + addDays(todayIso, -200) + ',-1150,,Processed,AM-501',
    '"Holt Electrical Pty Ltd",Statement of Account,Statement of account 2025-26,' + addDays(todayIso, -3) + ',2400,' + addDays(todayIso, 20) + ',,AM-502',
    '"Nobody We Know",Notice of Assessment,Notice of assessment 2024-25,' + addDays(todayIso, -10) + ',500,,,AM-503',
  ].join('\n'));
  writeFileSync(lodgCsv, [
    'Client,Kind,Period,Due,Lodged,Expected',
    '"Yasmin Holt",ITR,2024-25,,' + addDays(todayIso, -220) + ',-1150',
    '"Holt Electrical Pty Ltd",BAS,Q1 2026-27,' + addDays(todayIso, 40) + ',,',
  ].join('\n'));

  const dry = run('import dry run writes nothing', ['ato.mjs', 'import', 'atomate', `--clients=${clientsCsv}`, `--documents=${docsCsv}`, `--lodgments=${lodgCsv}`, '--dry-run', '--staff=Terri']);
  assert(n(dry.clients) === 2 && n(dry.clients_updated) === 1, 'the dry run counts what it would do');
  assert(n(dry.tfn_truncated) === 2, 'and reports the TFNs it would truncate');
  assert(dry.skips.length === 1, 'the unknown client is a named skip, not a silent one');

  const imported = run('import for real', ['ato.mjs', 'import', 'atomate', `--clients=${clientsCsv}`, `--documents=${docsCsv}`, `--lodgments=${lodgCsv}`, '--staff=Terri']);
  assert(n(imported.clients) === 2 && n(imported.documents) === 2 && n(imported.lodgments) === 2, 'and the real run does it');

  const holt = run('the imported client reads back', ['ato.mjs', 'client', 'Yasmin Holt']);
  assert(holt.client.tfn_last3 === '782', 'with only the last three TFN digits surviving the import');
  assert(holt.documents.length === 1 && holt.documents[0].status === 'filed', 'her processed assessment landed filed');

  const reimport = run('re-importing updates rather than duplicating', ['ato.mjs', 'import', 'atomate', `--clients=${clientsCsv}`, `--documents=${docsCsv}`, '--staff=Terri']);
  assert(n(reimport.clients) === 0 && n(reimport.clients_updated) === 3 && n(reimport.documents) === 0 && n(reimport.documents_updated) === 2, 'the second run creates nothing new');

  const missingFile = run('a missing import file fails loudly', ['ato.mjs', 'import', 'csv', `--clients=${path.join(dataDir, 'not-there.csv')}`], { json: false, expectFail: true });
  assert(/No clients file/.test(missingFile.stderr), 'it exits non zero rather than importing nothing quietly');

  // ---- export --------------------------------------------------------------------

  const outFile = path.join(dataDir, 'dump.json');
  const dump = run('export', ['ato.mjs', 'export', `--out=${outFile}`]);
  assert(existsSync(outFile), 'the export file is on disk');
  const parsed = JSON.parse(readFileSync(outFile, 'utf8'));
  assert(parsed.documents.length === n(dump.counts.documents), 'the counts match the file');
  assert(!parsed.clients.some((c) => c.tfn_last3 && String(c.tfn_last3).length > 3), 'no export row carries more than three TFN digits');

  // ---- the branded HTML -----------------------------------------------------------

  const views = run('npm run view', ['view.mjs'], { json: false });
  assert(/views[\\/]mailroom\.html/.test(views.stdout) && /views[\\/]season\.html/.test(views.stdout), 'both views rendered');
  const mailroomHtml = readFileSync(path.join(root, 'views', 'mailroom.html'), 'utf8');
  assert(mailroomHtml.includes('Needs a decision') && mailroomHtml.includes('The inbox'), 'the mailroom view has its sections');
  assert(mailroomHtml.includes('Money due to the ATO') && mailroomHtml.includes('Variances'), 'and the money half');
  const seasonHtml = readFileSync(path.join(root, 'views', 'season.html'), 'utf8');
  assert(seasonHtml.includes('Lodgments') && seasonHtml.includes('Turnaround'), 'the season view has its sections');

  const docsOut = run('npm run docs', ['docs.mjs'], { json: false });
  assert(/client-letter-draft/.test(docsOut.stdout), 'the client letter drafts rendered');
  assert(/payment-plan-schedule/.test(docsOut.stdout), 'the payment plan schedules rendered');
  assert(/staff-day-report/.test(docsOut.stdout), 'the staff day reports rendered');
  const letterFiles = docsOut.stdout.split('\n').filter((l) => l.includes('client-letter-draft'));
  assert(letterFiles.length >= 2, 'a letter per checked-but-untold document');
  const letter = readFileSync(path.join(root, letterFiles[0].replace(/^doc: /, '').trim()), 'utf8');
  assert(letter.includes('draft') && letter.includes('The document'), 'the letter is plainly a draft with the facts attached');

  // ---- the human readable side ------------------------------------------------------

  run('staff (text)', ['ato.mjs', 'staff'], { json: false });
  run('clients (text)', ['ato.mjs', 'clients'], { json: false });
  run('client (text)', ['ato.mjs', 'client', 'Crestline'], { json: false });
  run('inbox (text)', ['ato.mjs', 'inbox'], { json: false });
  run('register (text)', ['ato.mjs', 'register'], { json: false });
  run('doc (text)', ['ato.mjs', 'doc', 'ATO-1008'], { json: false });
  run('variances (text)', ['ato.mjs', 'variances'], { json: false });
  run('due (text)', ['ato.mjs', 'due', '--days=45'], { json: false });
  run('lodgments (text)', ['ato.mjs', 'lodgments', '--all'], { json: false });
  run('plans (text)', ['ato.mjs', 'plans', '--all'], { json: false });
  run('workload (text)', ['ato.mjs', 'workload'], { json: false });
  run('attention (text)', ['ato.mjs', 'attention'], { json: false });
  run('compliance (text)', ['ato.mjs', 'compliance'], { json: false });
  run('tasks (text)', ['ato.mjs', 'tasks', '--all'], { json: false });
  run('stats (text)', ['ato.mjs', 'stats'], { json: false });
  run('help', ['ato.mjs', 'help'], { json: false });
  run('an unknown command exits 1', ['ato.mjs', 'nonsense'], { json: false, expectFail: true });

  console.log(`\n${step} checks, PASS`);
} finally {
  if (existsSync(dataDir)) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // Windows can hold the handle briefly; a leftover temp dir is harmless.
    }
  }
}
