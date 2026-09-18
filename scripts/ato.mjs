#!/usr/bin/env node
// ato-correspondence-for-claude-code: the one CLI. Claude Code slash commands
// call this; so can you.
//
//   node scripts/ato.mjs <command> [args] [--flags] [--json]
//
// Run with no arguments (or `help`) for the command list.
//
// This system is an accounting practice's register for ATO correspondence:
// received -> matched -> checked -> notified -> filed. It holds NO full tax
// file number (the last three digits at most, and the schema enforces it), it
// connects to nothing at the ATO, and it never sends anything to a client:
// letters are drafted to docs-out/ and a person sends them. Nothing here is
// tax advice.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table, money as moneyRaw, isoDate, short, truncate, heading } from './lib/format.mjs';

const money = (cents) => moneyRaw(cents, 'AUD');

// ---------------------------------------------------------------------------
// Argument parsing

const BOOL_FLAGS = new Set(['json', 'help', 'all', 'dry-run', 'force', 'no-letter', 'unmatched', 'due']);

function parseArgv(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      flags.help = true;
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let name;
      let value;
      if (eq > -1) {
        name = a.slice(2, eq);
        value = a.slice(eq + 1);
      } else {
        name = a.slice(2);
        const next = argv[i + 1];
        if (BOOL_FLAGS.has(name) || next === undefined || next.startsWith('--')) value = true;
        else value = argv[++i];
      }
      flags[name] = value;
    } else {
      args.push(a);
    }
  }
  return { args, flags };
}

class CliError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

const num = (v) => Number(v ?? 0);
const str = (v) => (v === true || v === undefined || v === null ? '' : String(v));

// ---------------------------------------------------------------------------
// Dates and signed money (payable positive, refund negative)

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDate(v, what = 'date') {
  if (!v || v === true) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const lower = s.toLowerCase();
  if (lower === 'today') return today();
  if (lower === 'yesterday') return addDays(today(), -1);
  if (lower === 'tomorrow') return addDays(today(), 1);
  // Australian exports and letters write DD/MM/YYYY, so the first number is
  // the day unless the second one is too big to be a month.
  const slash = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const [day, month] = b > 12 ? [b, a] : [a, b];
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new CliError(`"${v}" is not a ${what}. Use YYYY-MM-DD.`);
  return isoDate(d);
}

function parseMoney(v, what = 'amount') {
  if (v === undefined || v === null || v === '' || v === true) return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  if (Number.isNaN(n)) throw new CliError(`"${v}" is not an ${what}. Money in dollars: 1840 means $1,840.`);
  return Math.round(n * 100);
}

// --payable=18400 or --refund=950. One signed number inside.
function signedAmount(flags) {
  const payable = parseMoney(flags.payable, 'amount');
  const refund = parseMoney(flags.refund, 'amount');
  if (payable !== null && refund !== null) throw new CliError('One of --payable= or --refund=, not both.');
  if (payable !== null) return Math.abs(payable);
  if (refund !== null) return -Math.abs(refund);
  return null;
}

function amountLabel(cents) {
  if (cents === null || cents === undefined || cents === '') return '';
  const n = Number(cents);
  if (n === 0) return 'nil';
  return n > 0 ? `${money(n)} payable` : `${money(-n)} refund`;
}

// ---------------------------------------------------------------------------
// The pipeline

const DOC_TYPES = ['assessment', 'statement', 'debt', 'payment_plan', 'instalment', 'lodgment_demand', 'audit', 'remission', 'super', 'general'];
const LODGMENT_KINDS = ['itr', 'bas', 'ias', 'fbt', 'smsf_return', 'tpar'];
// Checked before the client hears a number; notified before the file closes.
const CHECKABLE = new Set(['assessment', 'statement', 'instalment']);
const NOTIFIABLE = new Set(['assessment', 'statement', 'instalment', 'debt', 'audit', 'lodgment_demand']);

// ---------------------------------------------------------------------------
// Lookups: full id, first 4+ characters of an id, exact ref or name, then
// contains. One hit wins. Several hits list the candidates and exit 1.

const RESOLVERS = {
  client: {
    from: 'clients c left join staff s on s.id = c.staff_id',
    cols: 'c.*, s.full_name as staff_name',
    exact: "lower(c.name) = lower($1) or lower(coalesce(c.email, '')) = lower($1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.name ilike $1 or c.email ilike $1 or c.group_name ilike $1',
    label: (r) => `${r.name}${r.client_type === 'individual' ? '' : ` (${r.client_type})`}`,
    order: 'c.name',
    listing: 'clients --all',
  },
  staff: {
    from: 'staff c',
    cols: 'c.*',
    exact: "lower(c.full_name) = lower($1) or lower(coalesce(c.code, '')) = lower($1) or lower(coalesce(c.email, '')) = lower($1)",
    fuzzy: 'c.full_name ilike $1 or c.code ilike $1',
    label: (r) => `${r.full_name} (${r.role})`,
    order: 'c.full_name',
    listing: 'staff',
  },
  document: {
    from: 'documents c left join clients cl on cl.id = c.client_id',
    cols: 'c.*, cl.name as client_name',
    exact: "lower(coalesce(c.ref, '')) = lower($1) or lower(coalesce(c.ref, '')) = lower('ATO-' || $1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.ref ilike $1 or cl.name ilike $1 or c.title ilike $1',
    label: (r) => `${r.ref}  ${r.client_name || '(unmatched)'}: ${truncate(r.title, 44)} (${r.status})`,
    order: 'c.received_on desc',
    listing: 'register --all',
  },
  task: {
    from: 'tasks c left join clients cl on cl.id = c.client_id',
    cols: 'c.*, cl.name as client_name',
    exact: 'lower(c.title) = lower($1)',
    fuzzy: 'c.title ilike $1 or cl.name ilike $1',
    label: (r) => `${short(r.id)}  ${truncate(r.title, 50)} (${r.status})`,
    order: 'c.due_on',
    listing: 'tasks --all',
  },
};

const ID_RE = /^[0-9a-f]{4,8}(-[0-9a-f-]*)?$/i;

async function resolve(db, kind, q, { optional = false } = {}) {
  const spec = RESOLVERS[kind];
  q = String(q ?? '').trim();
  if (!q || q === 'true') {
    if (optional) return null;
    throw new CliError(`Give me a ${kind} name, reference or id.`);
  }
  const select = `select ${spec.cols} from ${spec.from}`;
  let rows = [];
  if (ID_RE.test(q)) {
    rows = await db.query(`${select} where c.id::text like $1 order by ${spec.order}`, [q.toLowerCase() + '%']);
    if (rows.length === 1) return rows[0];
  }
  if (!rows.length) rows = await db.query(`${select} where ${spec.exact} order by ${spec.order}`, [q]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) rows = await db.query(`${select} where ${spec.fuzzy} order by ${spec.order}`, [`%${q}%`]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) {
    if (optional) return null;
    throw new CliError(`No ${kind} matches "${q}". Run \`${spec.listing}\` to see what exists.`);
  }
  throw new CliError(
    `"${q}" matches ${rows.length} ${kind} records. Use a reference, an id, or a longer name:\n` +
      rows.map((r) => `  ${short(r.id)}  ${spec.label(r)}`).join('\n'),
  );
}

// The person doing the work: --staff, ATO_STAFF, or the only active person.
async function whoIs(db, flags, { optional = true } = {}) {
  const named = flags.staff || process.env.ATO_STAFF;
  if (named && named !== true) return resolve(db, 'staff', named);
  const rows = await db.query('select * from staff where active order by full_name');
  if (rows.length === 1) return rows[0];
  if (optional) return null;
  if (!rows.length) throw new CliError('Nobody on the staff list yet. Add someone: add staff "<name>"');
  throw new CliError(
    'Several people work here. Pass --staff= (or set ATO_STAFF):\n' +
      rows.map((r) => `  ${r.code || short(r.id)}  ${r.full_name}`).join('\n'),
  );
}

// The one gate on tax file numbers: the flag that would store one is refused.
function refuseFullTfn(flags) {
  if (flags.tfn !== undefined) {
    throw new CliError(
      'No. This system does not store tax file numbers, deliberately.\n' +
        'The Privacy (Tax File Number) Rule 2015 is legally binding, and the safest TFN store is the one\n' +
        'that does not exist. Record the LAST THREE digits only, for matching letters: --tfn-last3=482',
    );
  }
  const last3 = str(flags['tfn-last3']);
  if (last3 && !/^\d{1,3}$/.test(last3)) {
    throw new CliError('--tfn-last3= takes at most three digits. Not four. The schema will refuse anything longer too.');
  }
  return last3 || null;
}

async function nextRef(db) {
  const [r] = await db.query(
    "select coalesce(max(substring(ref from 5)::int), 1000) + 1 as n from documents where ref ~ '^ATO-[0-9]+$'",
  );
  return `ATO-${r.n}`;
}

// ---------------------------------------------------------------------------
// Shared column sets for text tables

const REGISTER_COLS = [
  { key: 'ref', label: 'ref' },
  { key: 'client', label: 'client', width: 26 },
  { key: 'doc_type', label: 'type' },
  { key: 'title', label: 'document', width: 42 },
  { key: 'amount_cents', label: 'amount', align: 'right', format: (v) => amountLabel(v) },
  { key: 'due_on', label: 'due', format: (v) => isoDate(v) },
  { key: 'status', label: 'status' },
  { key: 'days_held', label: 'held', align: 'right', format: (v) => (v === null || v === undefined ? '' : `${v}d`) },
  { key: 'staff', label: 'staff', width: 16 },
];

// ---------------------------------------------------------------------------
// Reads

async function cmdStaff(db) {
  const rows = await db.query('select * from staff order by full_name');
  return {
    json: rows,
    text:
      heading('The team') +
      '\n' +
      table(rows, [
        { key: 'code', label: 'code' },
        { key: 'full_name', label: 'name' },
        { key: 'role', label: 'role' },
        { key: 'email', label: 'email' },
        { key: 'active', label: 'active', format: (v) => (v ? 'yes' : 'no') },
      ]),
  };
}

async function cmdClients(db, args, flags) {
  const rows = await db.query(
    `select * from v_client_position where status = 'active' or $1 order by client`,
    [Boolean(flags.all)],
  );
  return {
    json: rows,
    text:
      heading(`Clients (${rows.length})`) +
      '\n' +
      table(rows, [
        { key: 'client', label: 'client', width: 30 },
        { key: 'client_type', label: 'type' },
        { key: 'group_name', label: 'group' },
        { key: 'staff', label: 'staff', width: 16 },
        { key: 'open_documents', label: 'open docs', align: 'right' },
        { key: 'payable_ahead_cents', label: 'payable ahead', align: 'right', format: (v) => (num(v) ? money(v) : '') },
        { key: 'next_payment_due_on', label: 'next due', format: (v) => isoDate(v) },
        { key: 'overdue_lodgments', label: 'overdue lodg.', align: 'right', format: (v) => (num(v) ? String(v) : '') },
      ]),
  };
}

async function cmdClient(db, args) {
  const c = await resolve(db, 'client', args.join(' '));
  const [position] = await db.query('select * from v_client_position where client_id = $1', [c.id]);
  const docs = await db.query('select * from v_register where client_id = $1 order by received_on desc limit 25', [c.id]);
  const lodgments = await db.query('select * from v_lodgments l join lodgments raw on raw.id = l.lodgment_id where raw.client_id = $1 order by l.due_on nulls last', [c.id]);
  const plans = await db.query('select p.* from v_payment_plans p join payment_plans raw on raw.id = p.plan_id where raw.client_id = $1', [c.id]);
  const notes = await db.query(
    'select n.noted_on, n.channel, n.note, s.full_name as staff from client_notes n left join staff s on s.id = n.staff_id where n.client_id = $1 order by n.noted_on desc limit 12',
    [c.id],
  );
  const json = { client: c, position, documents: docs, lodgments, plans, notes };
  let text = heading(c.name) + `\n  ${c.client_type}${c.group_name ? ` | group: ${c.group_name}` : ''} | ${c.staff_name || 'unassigned'}`;
  if (c.abn) text += ` | ABN ${c.abn}`;
  if (c.tfn_last3) text += ` | TFN ...${c.tfn_last3}`;
  text += `\n  ${c.email || ''} ${c.phone || ''}`.trimEnd();
  if (position?.next_payment_due_on) text += `\n  next payment due ${isoDate(position.next_payment_due_on)} (${money(position.payable_ahead_cents)} ahead of them)`;
  text += '\n' + heading('Correspondence') + '\n' + table(docs, REGISTER_COLS.filter((col) => col.key !== 'client'));
  if (lodgments.length) {
    text += '\n' + heading('Lodgments') + '\n' + table(lodgments, [
      { key: 'kind', label: 'kind' },
      { key: 'period', label: 'period' },
      { key: 'due_on', label: 'due', format: (v) => isoDate(v) },
      { key: 'lodged_on', label: 'lodged', format: (v) => isoDate(v) },
      { key: 'expected_cents', label: 'expected', align: 'right', format: (v) => amountLabel(v) },
      { key: 'status', label: 'status' },
    ]);
  }
  if (plans.length) {
    text += '\n' + heading('Payment plans') + '\n' + table(plans, [
      { key: 'started_on', label: 'started', format: (v) => isoDate(v) },
      { key: 'instalment_cents', label: 'instalment', align: 'right', format: (v) => money(v) },
      { key: 'frequency', label: 'frequency' },
      { key: 'next_due_on', label: 'next due', format: (v) => isoDate(v) },
      { key: 'remaining_cents', label: 'remaining', align: 'right', format: (v) => money(v) },
      { key: 'status', label: 'status' },
    ]);
  }
  if (notes.length) {
    text += '\n' + heading('Contact log') + '\n' + table(notes, [
      { key: 'noted_on', label: 'date', format: (v) => isoDate(v) },
      { key: 'channel', label: 'channel' },
      { key: 'staff', label: 'staff', width: 16 },
      { key: 'note', label: 'note', width: 70 },
    ]);
  }
  return { json, text };
}

async function cmdInbox(db) {
  const rows = await db.query('select * from v_inbox');
  return {
    json: rows,
    text:
      heading(`The inbox (${rows.length} not yet in front of the client)`) +
      '\n' +
      table(rows, REGISTER_COLS) +
      (rows.some((r) => !r.client_id)
        ? '\n\n  Unmatched mail first: `match <ref> <client>`. Then check, notify, file.'
        : ''),
  };
}

async function cmdRegister(db, args, flags) {
  const where = [];
  const params = [];
  if (flags.client) {
    const c = await resolve(db, 'client', flags.client);
    params.push(c.id);
    where.push(`client_id = $${params.length}`);
  }
  if (flags.type) {
    if (!DOC_TYPES.includes(str(flags.type))) throw new CliError(`--type= is one of: ${DOC_TYPES.join(', ')}`);
    params.push(str(flags.type));
    where.push(`doc_type = $${params.length}`);
  }
  if (flags.status) {
    params.push(str(flags.status));
    where.push(`status = $${params.length}`);
  }
  if (flags.period) {
    params.push(`%${str(flags.period)}%`);
    where.push(`period ilike $${params.length}`);
  }
  const sql = `select * from v_register ${where.length ? 'where ' + where.join(' and ') : ''} order by received_on desc ${flags.all ? '' : 'limit 40'}`;
  const rows = await db.query(sql, params);
  return {
    json: rows,
    text: heading(`The register (${rows.length}${flags.all ? '' : ', most recent'})`) + '\n' + table(rows, REGISTER_COLS),
  };
}

async function cmdDoc(db, args) {
  const d = await resolve(db, 'document', args.join(' '));
  const [row] = await db.query('select * from v_register where document_id = $1', [d.id]);
  const variance = d.lodgment_id
    ? (await db.query('select * from v_variances where document_id = $1', [d.id]))[0] || null
    : null;
  const lodgment = d.lodgment_id ? (await db.query('select * from lodgments where id = $1', [d.lodgment_id]))[0] : null;
  const notes = await db.query(
    'select n.noted_on, n.channel, n.note, s.full_name as staff from client_notes n left join staff s on s.id = n.staff_id where n.document_id = $1 order by n.noted_on desc',
    [d.id],
  );
  const tasks = await db.query('select title, due_on, status from tasks where document_id = $1 order by due_on', [d.id]);
  const json = { document: row, lodgment, variance, notes, tasks };
  let text = heading(`${row.ref}  ${row.title}`) + `\n  ${row.client} | ${row.doc_type}${row.period ? ` | ${row.period}` : ''} | ${row.staff}`;
  text += `\n  received ${isoDate(row.received_on)} (${row.days_held} days held) | status: ${row.status}`;
  if (row.amount_cents !== null && row.amount_cents !== undefined) text += `\n  amount: ${amountLabel(row.amount_cents)}`;
  if (row.due_on) text += ` | payment due ${isoDate(row.due_on)} (${row.days_to_due >= 0 ? row.days_to_due + ' days left' : Math.abs(row.days_to_due) + ' days AGO'})`;
  if (lodgment) {
    text += `\n  checked against: ${lodgment.kind} ${lodgment.period}, expected ${amountLabel(lodgment.expected_cents)}`;
    if (variance) text += `\n  VARIANCE: ${money(Math.abs(num(variance.variance_cents)))} ${num(variance.variance_cents) > 0 ? 'more payable' : 'better'} than lodged. Accept, amend or object.`;
    else text += '\n  matches the return as lodged.';
  }
  if (row.checked_on) text += `\n  checked ${isoDate(row.checked_on)}${row.check_note ? ': ' + row.check_note : ' (no note recorded)'}`;
  if (row.notified_on) text += `\n  client notified ${isoDate(row.notified_on)}`;
  if (row.filed_on) text += `\n  filed ${isoDate(row.filed_on)}${row.file_ref ? ' at ' + row.file_ref : ''}`;
  if (d.note) text += `\n  note: ${d.note}`;
  if (notes.length) {
    text += '\n' + heading('Contact log') + '\n' + table(notes, [
      { key: 'noted_on', label: 'date', format: (v) => isoDate(v) },
      { key: 'channel', label: 'channel' },
      { key: 'staff', label: 'staff', width: 16 },
      { key: 'note', label: 'note', width: 70 },
    ]);
  }
  if (tasks.length) {
    text += '\n' + heading('Tasks') + '\n' + table(tasks, [
      { key: 'title', label: 'task', width: 56 },
      { key: 'due_on', label: 'due', format: (v) => isoDate(v) },
      { key: 'status', label: 'status' },
    ]);
  }
  return { json, text };
}

async function cmdVariances(db) {
  const rows = await db.query('select * from v_variances order by abs(variance_cents) desc');
  return {
    json: rows,
    text:
      heading(`Variances: assessed against lodged (${rows.length})`) +
      '\n' +
      table(rows, [
        { key: 'ref', label: 'ref' },
        { key: 'client', label: 'client', width: 26 },
        { key: 'period', label: 'period' },
        { key: 'expected_cents', label: 'we lodged', align: 'right', format: (v) => amountLabel(v) },
        { key: 'assessed_cents', label: 'ATO assessed', align: 'right', format: (v) => amountLabel(v) },
        { key: 'variance_cents', label: 'variance', align: 'right', format: (v) => (num(v) > 0 ? '+' : '-') + money(Math.abs(num(v))) },
        { key: 'status', label: 'status' },
        { key: 'days_since_check', label: 'known for', align: 'right', format: (v) => (v === null ? '' : `${v}d`) },
        { key: 'check_note', label: 'explanation', width: 34, format: (v) => v || 'NONE RECORDED' },
      ]) +
      '\n\n  A variance still open after 30 days is a decision going stale: accept, amend, or object.\n  Objection windows are real deadlines (TAA 1953 Part IVC); see docs/compliance.md.',
  };
}

async function cmdDue(db, args, flags) {
  const days = flags.days === undefined || flags.days === true ? 30 : Number(flags.days);
  if (Number.isNaN(days)) throw new CliError('--days= takes a number.');
  const rows = await db.query('select * from v_due where days_to_due <= $1 order by due_on', [days]);
  return {
    json: rows,
    text:
      heading(`Money due to the ATO, next ${days} days (and recently missed)`) +
      '\n' +
      table(rows, [
        { key: 'ref', label: 'ref' },
        { key: 'client', label: 'client', width: 26 },
        { key: 'title', label: 'document', width: 40 },
        { key: 'amount_cents', label: 'amount', align: 'right', format: (v) => money(v) },
        { key: 'due_on', label: 'due', format: (v) => isoDate(v) },
        { key: 'days_to_due', label: 'left', align: 'right', format: (v) => (num(v) < 0 ? `${Math.abs(num(v))}d AGO` : `${v}d`) },
        { key: 'client_notified', label: 'client told', format: (v) => (v ? 'yes' : 'NO') },
      ]) +
      '\n\n  A NO in the last column inside 14 days is the first thing to fix today.',
  };
}

async function cmdWorkload(db) {
  const rows = await db.query('select * from v_workload order by staff');
  return {
    json: rows,
    text:
      heading('Workload and turnaround') +
      '\n' +
      table(rows, [
        { key: 'staff', label: 'staff', width: 20 },
        { key: 'awaiting_check', label: 'to check', align: 'right' },
        { key: 'awaiting_letter', label: 'to notify', align: 'right' },
        { key: 'awaiting_filing', label: 'to file', align: 'right' },
        { key: 'filed', label: 'filed', align: 'right' },
        { key: 'avg_days_to_notify', label: 'avg days to notify', align: 'right' },
        { key: 'oldest_held_days', label: 'oldest held', align: 'right', format: (v) => (v === null || v === undefined ? '' : `${v}d`) },
      ]) +
      '\n\n  Turnaround is received to client-notified. Seven days is the standard the compliance check runs.',
  };
}

async function cmdAttention(db) {
  const rows = await db.query(`
    select * from v_attention
    order by case reason
      when 'due_missed' then 1
      when 'due_soon_unnotified' then 2
      when 'lodgment_overdue' then 3
      when 'plan_overdue' then 4
      when 'audit_open' then 5
      when 'variance_open' then 6
      when 'doc_unmatched' then 7
      when 'doc_stale' then 8
      when 'unfiled' then 9
      when 'task_overdue' then 10
      else 11 end,
      days desc nulls last
  `);
  return {
    json: rows,
    text:
      heading(`Needs a decision (${rows.length})`) +
      '\n' +
      table(rows, [
        { key: 'reason', label: 'why' },
        { key: 'label', label: 'record', width: 22 },
        { key: 'client', label: 'client', width: 24 },
        { key: 'staff', label: 'staff', width: 16 },
        { key: 'days', label: 'days', align: 'right' },
        { key: 'amount_cents', label: 'amount', align: 'right', format: (v) => (v === null || v === undefined ? '' : money(Math.abs(num(v)))) },
        { key: 'detail', label: 'detail', width: 66 },
      ]),
  };
}

async function cmdLodgments(db, args, flags) {
  const rows = await db.query(
    `select * from v_lodgments where ($1 or status = 'due') order by due_on nulls last`,
    [Boolean(flags.all)],
  );
  return {
    json: rows,
    text:
      heading(flags.all ? 'The lodgment record' : 'Lodgments still due') +
      '\n' +
      table(rows, [
        { key: 'client', label: 'client', width: 28 },
        { key: 'kind', label: 'kind' },
        { key: 'period', label: 'period' },
        { key: 'due_on', label: 'due', format: (v) => isoDate(v) },
        { key: 'days_to_due', label: 'left', align: 'right', format: (v) => (v === null || v === undefined ? '' : num(v) < 0 ? `${Math.abs(num(v))}d AGO` : `${v}d`) },
        { key: 'lodged_on', label: 'lodged', format: (v) => isoDate(v) },
        { key: 'expected_cents', label: 'expected', align: 'right', format: (v) => amountLabel(v) },
        { key: 'status', label: 'status' },
        { key: 'staff', label: 'staff', width: 16 },
      ]),
  };
}

async function cmdPlans(db, args, flags) {
  const rows = await db.query(
    `select * from v_payment_plans where ($1 or status = 'active') order by next_due_on nulls last`,
    [Boolean(flags.all)],
  );
  return {
    json: rows,
    text:
      heading(flags.all ? 'Payment plans, all' : 'Active payment plans') +
      '\n' +
      table(rows, [
        { key: 'client', label: 'client', width: 28 },
        { key: 'started_on', label: 'started', format: (v) => isoDate(v) },
        { key: 'total_cents', label: 'total', align: 'right', format: (v) => money(v) },
        { key: 'instalment_cents', label: 'instalment', align: 'right', format: (v) => money(v) },
        { key: 'frequency', label: 'frequency' },
        { key: 'next_due_on', label: 'next due', format: (v) => isoDate(v) },
        { key: 'days_to_next', label: 'left', align: 'right', format: (v) => (v === null || v === undefined ? '' : num(v) < 0 ? `${Math.abs(num(v))}d AGO` : `${v}d`) },
        { key: 'remaining_cents', label: 'remaining', align: 'right', format: (v) => money(v) },
        { key: 'status', label: 'status' },
      ]) +
      '\n\n  One missed instalment defaults a plan, quietly, and the general interest charge keeps running.',
  };
}

async function cmdStats(db) {
  const [c] = await db.query(`
    select (select count(*) from staff)                                   as staff,
           (select count(*) from clients where status = 'active')         as active_clients,
           (select count(*) from documents)                               as documents,
           (select count(*) from documents where status = 'received')     as unmatched,
           (select count(*) from documents where status = 'matched')      as awaiting_check,
           (select count(*) from documents where status = 'checked')      as awaiting_letter,
           (select count(*) from documents where status = 'notified')     as awaiting_filing,
           (select count(*) from documents where status = 'filed')        as filed,
           (select count(*) from lodgments where status = 'due')          as lodgments_due,
           (select count(*) from payment_plans where status = 'active')   as active_plans,
           (select count(*) from v_attention)                             as attention_items
  `);
  const json = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
  return {
    json,
    text:
      heading('The practice') +
      `\n  ${json.active_clients} active clients, ${json.staff} staff` +
      `\n  ${json.documents} documents on the register: ${json.unmatched} unmatched, ${json.awaiting_check} awaiting check, ` +
      `${json.awaiting_letter} awaiting the client letter, ${json.awaiting_filing} awaiting filing, ${json.filed} filed` +
      `\n  ${json.lodgments_due} lodgments still due, ${json.active_plans} active payment plans` +
      `\n  ${json.attention_items} items on the attention list`,
  };
}

// ---------------------------------------------------------------------------
// The pipeline: receive -> match -> check -> notify -> file

async function cmdReceive(db, args, flags) {
  const docType = str(flags.type) || 'general';
  if (!DOC_TYPES.includes(docType)) throw new CliError(`--type= is one of: ${DOC_TYPES.join(', ')}`);
  const title = str(flags.title) || args.slice(flags.unmatched ? 0 : 1).join(' ');
  if (!title) throw new CliError('What is the document? --title="Notice of assessment 2025-26" (or the title after the client name).');
  let client = null;
  if (!flags.unmatched) {
    if (!args.length && !flags.client) throw new CliError('Whose mail is it? `receive <client> --type= --title=`, or `receive --unmatched --title=` if you cannot tell yet.');
    client = await resolve(db, 'client', str(flags.client) || args[0]);
  }
  const s = client ? (flags.staff ? await whoIs(db, flags) : client.staff_id ? { id: client.staff_id } : await whoIs(db, flags)) : await whoIs(db, flags);
  const amount = signedAmount(flags);
  const ref = await nextRef(db);
  const [doc] = await db.query(
    `insert into documents (ref, client_id, staff_id, doc_type, title, period, received_on, issued_on, amount_cents, due_on, status, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning *`,
    [
      ref,
      client?.id || null,
      s?.id || null,
      docType,
      title,
      str(flags.period) || null,
      parseDate(flags.received) || today(),
      parseDate(flags.issued),
      amount,
      parseDate(flags.due),
      client ? 'matched' : 'received',
      str(flags.note) || null,
    ],
  );
  const next = client
    ? CHECKABLE.has(docType)
      ? `check ${ref}`
      : NOTIFIABLE.has(docType)
        ? `notify ${ref} (after you have dealt with it)`
        : `file ${ref} --ref=<where it lives>`
    : `match ${ref} <client>`;
  return {
    json: doc,
    text: `${ref} on the register: ${client ? client.name : '(unmatched)'}, ${docType}, "${title}"${amount !== null ? ', ' + amountLabel(amount) : ''}${doc.due_on ? ', payment due ' + isoDate(doc.due_on) : ''}.\nNext: ${next}`,
  };
}

async function cmdMatch(db, args, flags) {
  const d = await resolve(db, 'document', args[0]);
  const client = await resolve(db, 'client', args.slice(1).join(' ') || str(flags.client));
  if (d.client_id) throw new CliError(`${d.ref} is already matched to ${d.client_name}.`);
  const s = flags.staff ? await whoIs(db, flags) : client.staff_id ? { id: client.staff_id } : null;
  const [doc] = await db.query(
    `update documents set client_id = $1, staff_id = coalesce($2, staff_id), status = 'matched' where id = $3 returning *`,
    [client.id, s?.id || null, d.id],
  );
  let tfnLine = '';
  if (client.tfn_last3) tfnLine = `\nConfirm against the letter: the TFN on file for ${client.name} ends ...${client.tfn_last3}.`;
  return {
    json: doc,
    text: `${d.ref} matched to ${client.name}.${tfnLine}\nNext: ${CHECKABLE.has(d.doc_type) ? `check ${d.ref}` : `deal with it, then notify or file`}`,
  };
}

async function cmdCheck(db, args, flags) {
  const d = await resolve(db, 'document', args[0]);
  if (!d.client_id) throw new CliError(`${d.ref} is matched to nobody. \`match ${d.ref} <client>\` first.`);
  if (d.status === 'filed') throw new CliError(`${d.ref} is already filed.`);
  const on = parseDate(flags.on) || today();
  let lodgment = null;
  let expected = parseMoney(flags.expected, 'expected amount');
  if (flags['expected-refund'] !== undefined) expected = -Math.abs(parseMoney(flags['expected-refund'], 'expected amount'));

  if (d.doc_type === 'assessment') {
    // An assessment is checked against the lodgment record, or it is not
    // checked at all. That is the whole point of the check.
    if (d.lodgment_id) {
      [lodgment] = await db.query('select * from lodgments where id = $1', [d.lodgment_id]);
    } else if (d.period) {
      const candidates = await db.query(
        `select * from lodgments where client_id = $1 and period = $2 and kind in ('itr','bas','smsf_return','fbt') order by lodged_on desc nulls last`,
        [d.client_id, d.period],
      );
      if (candidates.length) lodgment = candidates[0];
    }
    if (!lodgment && expected === null) {
      throw new CliError(
        `Check ${d.ref} against what? There is no lodgment on record for ${d.client_name} ${d.period || '(no period on the document)'}.\n` +
          `Record it first: lodge add "${d.client_name}" --kind=itr --period=${d.period || '<period>'} --expected=<payable dollars, or --expected-refund=>\n` +
          `Or, if the return genuinely lives outside this system, pass --expected= / --expected-refund= on this command.\n` +
          `The client hears a checked number, never a raw one (TASA 2009 s 30-10, reasonable care).`,
      );
    }
  }

  const baseline = lodgment ? lodgment.expected_cents : expected;
  let note = str(flags.note) || null;
  let varianceCents = null;
  if (baseline !== null && baseline !== undefined && d.amount_cents !== null && d.amount_cents !== undefined) {
    varianceCents = num(d.amount_cents) - num(baseline);
    if (!note && varianceCents === 0) note = 'Matches the return as lodged.';
  }
  if (varianceCents !== null && varianceCents !== 0 && !note) {
    // The check found a gap. It still records, but it says loudly that the
    // explanation is the missing half; /compliance will keep saying it.
  }
  const [doc] = await db.query(
    `update documents set status = case when status in ('received','matched') then 'checked' else status end,
       checked_on = $1, check_note = coalesce($2, check_note), lodgment_id = coalesce($3, lodgment_id)
     where id = $4 returning *`,
    [on, note, lodgment?.id || null, d.id],
  );
  if (lodgment && lodgment.status !== 'assessed') {
    await db.query(`update lodgments set status = 'assessed' where id = $1`, [lodgment.id]);
  }
  const json = { document: doc, baseline_cents: baseline ?? null, variance_cents: varianceCents };
  let text = `${d.ref} checked.`;
  if (varianceCents === 0) text += ` ${amountLabel(d.amount_cents)}, matches what was lodged.`;
  else if (varianceCents !== null) {
    text += ` VARIANCE: we expected ${amountLabel(baseline)}, the ATO says ${amountLabel(d.amount_cents)} (${money(Math.abs(varianceCents))} ${varianceCents > 0 ? 'worse' : 'better'}).`;
    text += note ? '' : `\nRecord the explanation before the client hears it: check ${d.ref} --note="why"`;
    text += '\nThe decision is accept, amend or object, and objection windows are real deadlines (docs/compliance.md).';
  } else text += note ? ` Note recorded.` : '';
  text += `\nNext: notify ${d.ref} (draft the letter with npm run docs, a person sends it).`;
  return { json, text };
}

async function cmdNotify(db, args, flags) {
  const d = await resolve(db, 'document', args[0]);
  if (!d.client_id) throw new CliError(`${d.ref} is matched to nobody. \`match ${d.ref} <client>\` first.`);
  if (CHECKABLE.has(d.doc_type) && !d.checked_on && !flags.force) {
    throw new CliError(
      `${d.ref} has not been checked. The client hears a checked number, never a raw one\n` +
        `(TASA 2009 s 30-10: reasonable care). Run \`check ${d.ref}\` first.\n` +
        `--force exists for a document genuinely checked outside this system, and then the check gets recorded immediately.`,
    );
  }
  const on = parseDate(flags.on) || today();
  const [doc] = await db.query(
    `update documents set status = case when status = 'filed' then 'filed' else 'notified' end, notified_on = $1 where id = $2 returning *`,
    [on, d.id],
  );
  await db.query(
    `insert into client_notes (client_id, document_id, staff_id, noted_on, channel, note) values ($1, $2, $3, $4, 'letter', $5)`,
    [d.client_id, d.id, d.staff_id, on, `Client notified about ${d.ref}: ${d.title}`],
  );
  return {
    json: doc,
    text: `${d.ref}: client notified ${on} and the contact log has the entry.\nNothing was sent from here: draft with npm run docs, a person sends.\nNext: file ${d.ref} --ref="<where the PDF lives>"`,
  };
}

async function cmdFile(db, args, flags) {
  const d = await resolve(db, 'document', args[0]);
  if (!d.client_id) throw new CliError(`${d.ref} is matched to nobody. \`match ${d.ref} <client>\` first.`);
  if (NOTIFIABLE.has(d.doc_type) && !d.notified_on && !flags['no-letter']) {
    throw new CliError(
      `${d.ref} is a ${d.doc_type} and the client has not been told. Filing it now buries it.\n` +
        `Run \`notify ${d.ref}\` first, or pass --no-letter with your reasons in --note= if this one genuinely needs no letter.`,
    );
  }
  const on = parseDate(flags.on) || today();
  const [doc] = await db.query(
    `update documents set status = 'filed', filed_on = $1, file_ref = coalesce($2, file_ref), note = coalesce($3, note) where id = $4 returning *`,
    [on, str(flags.ref) || null, str(flags.note) || null, d.id],
  );
  return {
    json: doc,
    text: `${d.ref} filed${doc.file_ref ? ` at ${doc.file_ref}` : ''}. The pipeline is done with it.`,
  };
}

// ---------------------------------------------------------------------------
// Lodgments and payment plans

async function cmdLodge(db, args, flags) {
  const sub = args[0];
  if (sub === 'add') {
    const client = await resolve(db, 'client', args.slice(1).join(' '));
    const kind = str(flags.kind) || 'itr';
    if (!LODGMENT_KINDS.includes(kind)) throw new CliError(`--kind= is one of: ${LODGMENT_KINDS.join(', ')}`);
    const period = str(flags.period);
    if (!period) throw new CliError('Which period? --period="2025-26" or --period="Q1 2026-27"');
    let expected = parseMoney(flags.expected, 'expected amount');
    if (flags['expected-refund'] !== undefined) expected = -Math.abs(parseMoney(flags['expected-refund'], 'expected amount'));
    const lodgedOn = parseDate(flags.lodged);
    const s = await whoIs(db, flags);
    const [row] = await db.query(
      `insert into lodgments (client_id, staff_id, kind, period, due_on, lodged_on, expected_cents, status, note)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (client_id, kind, period) do update set
         due_on = coalesce(excluded.due_on, lodgments.due_on),
         lodged_on = coalesce(excluded.lodged_on, lodgments.lodged_on),
         expected_cents = coalesce(excluded.expected_cents, lodgments.expected_cents),
         status = excluded.status,
         note = coalesce(excluded.note, lodgments.note)
       returning *`,
      [client.id, s?.id || null, kind, period, parseDate(flags.due), lodgedOn, expected, lodgedOn ? 'lodged' : 'due', str(flags.note) || null],
    );
    return {
      json: row,
      text: `${client.name}: ${kind} ${period} on the lodgment record (${row.status}${expected !== null ? `, expecting ${amountLabel(expected)}` : ''}).`,
    };
  }
  if (sub === 'done') {
    const client = await resolve(db, 'client', args.slice(1).join(' '));
    const params = [client.id];
    let where = `client_id = $1 and status = 'due'`;
    if (flags.kind) {
      params.push(str(flags.kind));
      where += ` and kind = $${params.length}`;
    }
    if (flags.period) {
      params.push(str(flags.period));
      where += ` and period = $${params.length}`;
    }
    const rows = await db.query(`select * from lodgments where ${where} order by due_on`, params);
    if (!rows.length) throw new CliError(`Nothing due on the lodgment record for ${client.name}. \`lodgments --all\` shows what exists.`);
    if (rows.length > 1) {
      throw new CliError(
        `${client.name} has ${rows.length} lodgments due. Say which: --kind= --period=\n` +
          rows.map((r) => `  ${r.kind} ${r.period} due ${isoDate(r.due_on)}`).join('\n'),
      );
    }
    let expected = parseMoney(flags.expected, 'expected amount');
    if (flags['expected-refund'] !== undefined) expected = -Math.abs(parseMoney(flags['expected-refund'], 'expected amount'));
    const [row] = await db.query(
      `update lodgments set status = 'lodged', lodged_on = $1, expected_cents = coalesce($2, expected_cents) where id = $3 returning *`,
      [parseDate(flags.on) || today(), expected, rows[0].id],
    );
    return {
      json: row,
      text: `${client.name}: ${row.kind} ${row.period} marked lodged ${isoDate(row.lodged_on)}${row.expected_cents !== null ? `, expecting ${amountLabel(row.expected_cents)}` : ''}. The assessment gets checked against this line when it lands.`,
    };
  }
  throw new CliError('lodge add <client> --kind= --period= [--due= --expected= --lodged=], or lodge done <client> [--kind= --period=] --on=');
}

async function resolvePlan(db, q) {
  const client = await resolve(db, 'client', q);
  const rows = await db.query(`select * from payment_plans where client_id = $1 and status = 'active'`, [client.id]);
  if (!rows.length) throw new CliError(`${client.name} has no active payment plan.`);
  if (rows.length > 1) throw new CliError(`${client.name} has ${rows.length} active plans; this system expects one per client at a time.`);
  return { client, plan: rows[0] };
}

function nextInstalmentDate(iso, frequency) {
  if (frequency === 'weekly') return addDays(iso, 7);
  if (frequency === 'fortnightly') return addDays(iso, 14);
  const d = new Date(`${iso}T00:00:00`);
  d.setMonth(d.getMonth() + 1);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function cmdPlan(db, args, flags) {
  const sub = args[0];
  if (sub === 'add') {
    const client = await resolve(db, 'client', args.slice(1).join(' '));
    const total = parseMoney(flags.total, 'total');
    const instalment = parseMoney(flags.instalment, 'instalment');
    if (!total || !instalment) throw new CliError('plan add <client> --total= --instalment= [--frequency=monthly] --next= [--doc=]');
    const frequency = str(flags.frequency) || 'monthly';
    if (!['weekly', 'fortnightly', 'monthly'].includes(frequency)) throw new CliError('--frequency= is weekly, fortnightly or monthly.');
    const doc = flags.doc ? await resolve(db, 'document', flags.doc) : null;
    const [row] = await db.query(
      `insert into payment_plans (client_id, document_id, started_on, total_cents, instalment_cents, frequency, next_due_on, remaining_cents, note)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
      [client.id, doc?.id || null, parseDate(flags.started) || today(), total, instalment, frequency, parseDate(flags.next), total, str(flags.note) || null],
    );
    return {
      json: row,
      text: `Payment plan on record for ${client.name}: ${money(total)} total, ${money(instalment)} ${frequency}${row.next_due_on ? `, next instalment ${isoDate(row.next_due_on)}` : ''}.\nOne missed instalment defaults an ATO plan; the attention list watches the date.`,
    };
  }
  if (sub === 'paid') {
    const { client, plan } = await resolvePlan(db, args.slice(1).join(' '));
    const remaining = Math.max(0, num(plan.remaining_cents) - num(plan.instalment_cents));
    const done = remaining === 0;
    const [row] = await db.query(
      `update payment_plans set remaining_cents = $1, next_due_on = $2, status = $3 where id = $4 returning *`,
      [remaining, done ? null : nextInstalmentDate(isoDate(plan.next_due_on) || today(), plan.frequency), done ? 'completed' : 'active', plan.id],
    );
    await db.query(
      `insert into client_notes (client_id, staff_id, noted_on, channel, note) values ($1, $2, $3, 'phone', $4)`,
      [client.id, client.staff_id, parseDate(flags.on) || today(), `Payment plan instalment of ${money(plan.instalment_cents)} confirmed paid. ${money(remaining)} remaining.`],
    );
    return {
      json: row,
      text: done
        ? `${client.name}: final instalment paid. The plan is complete.`
        : `${client.name}: instalment recorded. ${money(remaining)} remaining, next due ${isoDate(row.next_due_on)}.`,
    };
  }
  if (sub === 'defaulted' || sub === 'completed') {
    const { client, plan } = await resolvePlan(db, args.slice(1).join(' '));
    const [row] = await db.query(`update payment_plans set status = $1, note = coalesce($2, note) where id = $3 returning *`, [
      sub,
      str(flags.note) || null,
      plan.id,
    ]);
    return { json: row, text: `${client.name}: plan marked ${sub}.` };
  }
  throw new CliError('plan add <client> --total= --instalment= --next= | plan paid <client> | plan defaulted <client> | plan completed <client>');
}

// ---------------------------------------------------------------------------
// Log, tasks, add, client updates

async function cmdLog(db, args, flags) {
  const first = args[0];
  let doc = null;
  let client = null;
  if (/^(ato-)?\d{3,}$/i.test(str(first))) {
    doc = await resolve(db, 'document', first, { optional: true });
  }
  if (doc) {
    if (!doc.client_id) throw new CliError(`${doc.ref} is matched to nobody; match it first, then log against the client.`);
    [client] = await db.query('select * from clients where id = $1', [doc.client_id]);
  } else {
    client = await resolve(db, 'client', first);
  }
  const note = args.slice(1).join(' ');
  if (!note) throw new CliError('What happened? log <client or ATO-ref> "what was said or done"');
  const s = await whoIs(db, flags);
  const [row] = await db.query(
    `insert into client_notes (client_id, document_id, staff_id, noted_on, channel, note) values ($1, $2, $3, $4, $5, $6) returning *`,
    [client.id, doc?.id || null, s?.id || null, parseDate(flags.on) || today(), str(flags.channel) || 'phone', note],
  );
  return { json: row, text: `Logged against ${client.name}${doc ? ` (${doc.ref})` : ''}.` };
}

async function cmdTask(db, args, flags) {
  const sub = args[0];
  if (sub === 'add') {
    const title = args.slice(1).join(' ');
    if (!title) throw new CliError('task add "the thing to do" [--client= --doc= --due= --staff=]');
    const client = flags.client ? await resolve(db, 'client', flags.client) : null;
    const doc = flags.doc ? await resolve(db, 'document', flags.doc) : null;
    const s = await whoIs(db, flags);
    const [row] = await db.query(
      `insert into tasks (title, client_id, document_id, staff_id, due_on, note) values ($1, $2, $3, $4, $5, $6) returning *`,
      [title, client?.id || doc?.client_id || null, doc?.id || null, s?.id || null, parseDate(flags.due), str(flags.note) || null],
    );
    return { json: row, text: `Task on the list: "${title}"${row.due_on ? `, due ${isoDate(row.due_on)}` : ''}.` };
  }
  if (sub === 'done') {
    const t = await resolve(db, 'task', args.slice(1).join(' '));
    const [row] = await db.query(`update tasks set status = 'done', done_on = $1 where id = $2 returning *`, [parseDate(flags.on) || today(), t.id]);
    return { json: row, text: `Done: "${t.title}".` };
  }
  throw new CliError('task add "title" [--client= --doc= --due=], or task done <match>');
}

async function cmdTasks(db, args, flags) {
  const rows = await db.query(
    `select t.title, c.name as client, s.full_name as staff, t.due_on, t.status, t.done_on
     from tasks t left join clients c on c.id = t.client_id left join staff s on s.id = t.staff_id
     where ($1 or t.status = 'open') order by t.due_on nulls last`,
    [Boolean(flags.all)],
  );
  return {
    json: rows,
    text:
      heading(flags.all ? 'Tasks, all' : 'Open tasks') +
      '\n' +
      table(rows, [
        { key: 'title', label: 'task', width: 56 },
        { key: 'client', label: 'client', width: 24 },
        { key: 'staff', label: 'staff', width: 16 },
        { key: 'due_on', label: 'due', format: (v) => isoDate(v) },
        { key: 'status', label: 'status' },
      ]),
  };
}

async function cmdAdd(db, args, flags) {
  const kind = args[0];
  const name = args.slice(1).join(' ');
  if (!name) throw new CliError(`add ${kind || 'client|staff'} "<name>" [--flags]`);
  if (kind === 'client') {
    const tfnLast3 = refuseFullTfn(flags);
    const type = str(flags.type) || 'individual';
    if (!['individual', 'company', 'trust', 'partnership', 'smsf'].includes(type)) {
      throw new CliError('--type= is individual, company, trust, partnership or smsf.');
    }
    const s = flags.staff ? await whoIs(db, flags) : null;
    const [row] = await db.query(
      `insert into clients (name, client_type, email, phone, abn, tfn_last3, group_name, staff_id, note)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
      [name, type, str(flags.email) || null, str(flags.phone) || null, str(flags.abn) || null, tfnLast3, str(flags.group) || null, s?.id || null, str(flags.note) || null],
    );
    return { json: row, text: `Client on the list: ${name} (${type})${tfnLast3 ? `, TFN ...${tfnLast3}` : ''}${row.group_name ? `, group ${row.group_name}` : ''}.` };
  }
  if (kind === 'staff') {
    const [row] = await db.query(
      `insert into staff (full_name, code, email, role) values ($1, $2, $3, $4) returning *`,
      [name, str(flags.code) || null, str(flags.email) || null, str(flags.role) || 'accountant'],
    );
    return { json: row, text: `${name} added (${row.role}).` };
  }
  throw new CliError('add client "<name>" [--type= --email= --abn= --tfn-last3= --group= --staff=], or add staff "<name>" [--role=]');
}

async function cmdClientSet(db, args, flags) {
  const c = await resolve(db, 'client', args.join(' '));
  const tfnLast3 = refuseFullTfn(flags);
  const s = flags.staff ? await whoIs(db, flags) : null;
  const [row] = await db.query(
    `update clients set
       email = coalesce($1, email), phone = coalesce($2, phone), abn = coalesce($3, abn),
       tfn_last3 = coalesce($4, tfn_last3), group_name = coalesce($5, group_name),
       staff_id = coalesce($6, staff_id), status = coalesce($7, status), note = coalesce($8, note)
     where id = $9 returning *`,
    [
      str(flags.email) || null,
      str(flags.phone) || null,
      str(flags.abn) || null,
      tfnLast3,
      str(flags.group) || null,
      s?.id || null,
      str(flags.status) || null,
      str(flags.note) || null,
      c.id,
    ],
  );
  return { json: row, text: `${c.name} updated.` };
}

// ---------------------------------------------------------------------------
// Compliance: the rule book, run against the records. docs/compliance.md
// carries each rule's source; this is the executable half.

const RULES = [
  {
    key: 'tfn',
    title: 'No full tax file number stored, anywhere',
    source: 'Privacy (Tax File Number) Rule 2015, legally binding under s 17 of the Privacy Act 1988',
    sql: `select name as label, 'tfn_last3 holds more than three digits' as detail from clients where tfn_last3 is not null and length(tfn_last3) > 3`,
    fix: 'The schema and the CLI both refuse full TFNs at the gate; if this rule ever reports a breach, someone went around both. Truncate the value to the last three digits now.',
  },
  {
    key: 'turnaround',
    title: 'Every document actioned within seven days of receipt',
    source: 'TASA 2009 s 30-10 item 7 (competent service) and the standard this practice sets for itself',
    sql: `select ref || ' ' || client as label, 'received ' || to_char(received_on, 'YYYY-MM-DD') || ', still ' || status || ' after ' || days_held || ' days' as detail
          from v_register where status in ('received','matched','checked') and days_held > 7 order by days_held desc`,
    fix: 'Run the pipeline on each one: match, check, notify, file. The inbox command lists them oldest first.',
  },
  {
    key: 'checked',
    title: 'The client hears a checked number, never a raw one',
    source: "TASA 2009 s 30-10 items 9 and 10: reasonable care in ascertaining the client's state of affairs and applying the law",
    sql: `select ref || ' ' || client as label, 'notified ' || to_char(notified_on, 'YYYY-MM-DD') || ' with no check on record' as detail
          from v_register where notified_on is not null and doc_type in ('assessment','statement','instalment') and checked_on is null`,
    fix: 'check <ref> now and record what the comparison found, even after the fact. Then fix the habit: notify refuses unchecked documents unless it is forced.',
  },
  {
    key: 'variance',
    title: 'Every variance carries its explanation',
    source: 'TASA 2009 s 30-10 item 9: a number that differs from the return needs a reason before it is accepted',
    sql: `select ref || ' ' || client as label, period || ': assessed differs from lodged by ' || to_char(abs(variance_cents) / 100.0, 'FM$999,999,990') || ' and no explanation is recorded' as detail
          from v_variances where status in ('checked','notified') and (check_note is null or check_note = '')`,
    fix: 'Work out why (a data-matching add-back, a denied deduction, an ATO adjustment), then check <ref> --note="the reason". The letter the client gets should carry it.',
  },
  {
    key: 'due-notice',
    title: 'The client told at least fourteen days before money is due',
    source: 'TASA 2009 s 30-10 item 12: advising the client of their obligations under the taxation laws. Late notice of a due date is how trust dies',
    sql: `select ref || ' ' || client as label, 'payment of ' || to_char(amount_cents / 100.0, 'FM$999,999,990') || ' due ' || to_char(due_on, 'YYYY-MM-DD') || ' and the client has not been told' as detail
          from v_register where amount_cents > 0 and notified_on is null and due_on <= current_date + 14`,
    fix: 'notify <ref> today: draft the letter with npm run docs, a person sends it, and the due date goes in the first line.',
  },
  {
    key: 'objection',
    title: 'No variance left undecided past thirty days',
    source: 'TAA 1953 Part IVC: objection windows are real deadlines (two years for most individuals and small businesses, four years for others, sixty days for some decisions). A variance parked is a right expiring',
    sql: `select ref || ' ' || client as label, period || ': variance of ' || to_char(abs(variance_cents) / 100.0, 'FM$999,999,990') || ' known for ' || days_since_check || ' days with no decision' as detail
          from v_variances where status in ('checked','notified') and days_since_check > 30`,
    fix: "Decide: accept (file it, with the note), amend, or object. If objecting, diarise the Part IVC deadline for the client's own circumstances today.",
  },
  {
    key: 'plans',
    title: 'No payment plan instalment overdue',
    source: 'ATO practice: one missed instalment can default the plan, the whole balance falls due, and the general interest charge has been running the entire time',
    sql: `select client as label, 'instalment of ' || to_char(instalment_cents / 100.0, 'FM$999,999,990') || ' was due ' || to_char(next_due_on, 'YYYY-MM-DD') || ' (' || to_char(remaining_cents / 100.0, 'FM$999,999,990') || ' remaining)' as detail
          from v_payment_plans where status = 'active' and next_due_on < current_date`,
    fix: 'Ring the client today. If it was paid, plan paid <client>. If it was not, get it paid or renegotiate with the ATO before the default letter is issued.',
  },
  {
    key: 'lodgments',
    title: 'No lodgment past its due date',
    source: "TAA 1953 s 8C makes failure to lodge an offence; failure-to-lodge penalties accrue per 28-day period. An agent's lodgment program only protects the dates it is ahead of",
    sql: `select client || ' ' || kind || ' ' || period as label, 'due ' || to_char(due_on, 'YYYY-MM-DD') || ', ' || abs(days_to_due) || ' days ago' as detail
          from v_lodgments where status = 'due' and due_on < current_date`,
    fix: 'Lodge it, or get the deferral on record. lodge done <client> --on= when it goes in.',
  },
];

async function cmdCompliance(db, args) {
  const only = args[0];
  const rules = only ? RULES.filter((r) => r.key === only) : RULES;
  if (!rules.length) throw new CliError(`No rule "${only}". Rules: ${RULES.map((r) => r.key).join(', ')}`);
  const results = [];
  for (const rule of rules) {
    const breaches = await db.query(rule.sql);
    results.push({ key: rule.key, title: rule.title, source: rule.source, fix: rule.fix, breaches });
  }
  let text = heading('The rule book, run against the records');
  for (const r of results) {
    text += `\n\n${r.breaches.length ? 'FAIL' : ' ok '} ${r.key}: ${r.title}`;
    text += `\n      ${r.source}`;
    for (const b of r.breaches) text += `\n      - ${b.label}: ${b.detail}`;
    if (r.breaches.length) text += `\n      fix: ${r.fix}`;
  }
  const failed = results.filter((r) => r.breaches.length).length;
  text += `\n\n${results.length - failed} of ${results.length} rules pass. Sources and the fuller reading: docs/compliance.md. None of this is tax advice.`;
  return { json: results, text };
}

// ---------------------------------------------------------------------------
// Import and export

function mapImportStatus(v) {
  const s = String(v || '').trim().toLowerCase();
  if (['filed', 'complete', 'completed', 'done', 'processed'].includes(s)) return 'filed';
  if (['notified', 'sent', 'client notified', 'emailed'].includes(s)) return 'notified';
  if (['checked', 'reviewed', 'verified'].includes(s)) return 'checked';
  return 'matched';
}

function mapImportType(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s.includes('assess')) return 'assessment';
  if (s.includes('statement')) return 'statement';
  if (s.includes('debt') || s.includes('overdue')) return 'debt';
  if (s.includes('plan')) return 'payment_plan';
  if (s.includes('instal') || s.includes('payg')) return 'instalment';
  if (s.includes('lodg')) return 'lodgment_demand';
  if (s.includes('audit') || s.includes('review')) return 'audit';
  if (s.includes('remission') || s.includes('interest')) return 'remission';
  if (s.includes('super')) return 'super';
  return 'general';
}

async function cmdImport(db, args, flags) {
  const source = args[0];
  if (!['atomate', 'xpm', 'csv'].includes(source || '')) {
    throw new CliError('import atomate|xpm|csv --clients=file.csv [--documents=file.csv] [--lodgments=file.csv] [--dry-run]');
  }
  const dryRun = Boolean(flags['dry-run']);
  const readCsv = (flag, required) => {
    const file = str(flags[flag]);
    if (!file) {
      if (required) throw new CliError(`No ${flag} file. --${flag}=path.csv`);
      return null;
    }
    if (!existsSync(file)) throw new CliError(`No ${flag} file at ${file}.`);
    return parseCsv(readFileSync(file, 'utf8'));
  };
  const clientRows = readCsv('clients', !flags.documents && !flags.lodgments);
  const docRows = readCsv('documents', false);
  const lodgRows = readCsv('lodgments', false);
  const s = flags.staff ? await whoIs(db, flags) : null;

  const counts = {
    clients: 0, clients_updated: 0, documents: 0, documents_updated: 0,
    lodgments: 0, lodgments_updated: 0, skipped: 0, tfn_truncated: 0,
  };
  const skips = [];
  // Clients created earlier in this same run. On a dry run nothing is written,
  // so later rows resolve against this map instead of the database; the counts
  // then match what the real run will do.
  const pendingClients = new Map();

  const findClient = async (name, ref) => {
    if (ref) {
      const byRef = await db.query('select * from clients where lower(coalesce(external_ref, \'\')) = lower($1)', [ref]);
      if (byRef.length === 1) return byRef[0];
    }
    if (!name) return null;
    const rows = await db.query('select * from clients where lower(name) = lower($1)', [name]);
    if (rows.length === 1) return rows[0];
    return pendingClients.get(name.toLowerCase()) || null;
  };

  if (clientRows) {
    for (const row of clientRows) {
      const name = pick(row, 'Client Name', 'Client', 'Name', 'Taxpayer', 'Taxpayer Name');
      if (!name) {
        counts.skipped++;
        skips.push('client row with no name column value');
        continue;
      }
      // A TFN column in the export is deliberately NOT imported. The last
      // three digits are kept for letter-matching; the rest never lands.
      const tfnRaw = pick(row, 'TFN', 'Tax File Number');
      let tfnLast3 = null;
      if (tfnRaw) {
        const digits = String(tfnRaw).replace(/\D/g, '');
        if (digits) {
          tfnLast3 = digits.slice(-3);
          if (digits.length > 3) counts.tfn_truncated++;
        }
      }
      const typeRaw = String(pick(row, 'Client Type', 'Type', 'Entity Type') || '').toLowerCase();
      const type = typeRaw.includes('comp') ? 'company'
        : typeRaw.includes('trust') ? 'trust'
        : typeRaw.includes('partner') ? 'partnership'
        : typeRaw.includes('smsf') || typeRaw.includes('super') ? 'smsf'
        : 'individual';
      const existing = await findClient(name, pick(row, 'Client ID', 'Client Code', 'ID'));
      const values = {
        email: pick(row, 'Email', 'Email Address') || null,
        phone: pick(row, 'Phone', 'Mobile', 'Phone Number') || null,
        abn: pick(row, 'ABN') || null,
        group: pick(row, 'Group', 'Family Group', 'Client Group') || null,
        ref: pick(row, 'Client ID', 'Client Code', 'ID') || null,
      };
      if (existing) {
        counts.clients_updated++;
        if (!dryRun) {
          await db.query(
            `update clients set email = coalesce($1, email), phone = coalesce($2, phone), abn = coalesce($3, abn),
               tfn_last3 = coalesce($4, tfn_last3), group_name = coalesce($5, group_name), external_ref = coalesce($6, external_ref)
             where id = $7`,
            [values.email, values.phone, values.abn, tfnLast3, values.group, values.ref, existing.id],
          );
        }
      } else {
        counts.clients++;
        if (dryRun) {
          pendingClients.set(name.toLowerCase(), { id: null, name, staff_id: s?.id || null, __pending: true });
        } else {
          const [created] = await db.query(
            `insert into clients (name, client_type, email, phone, abn, tfn_last3, group_name, staff_id, external_ref)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
            [name, type, values.email, values.phone, values.abn, tfnLast3, values.group, s?.id || null, values.ref],
          );
          pendingClients.set(name.toLowerCase(), created);
        }
      }
    }
  }

  if (lodgRows) {
    for (const row of lodgRows) {
      const name = pick(row, 'Client', 'Client Name', 'Name');
      const client = await findClient(name, null);
      if (!client) {
        counts.skipped++;
        skips.push(`lodgment for "${name || '(no client)'}" matches no client on file`);
        continue;
      }
      const kindRaw = String(pick(row, 'Kind', 'Type', 'Form') || 'itr').toLowerCase();
      const kind = LODGMENT_KINDS.find((k) => kindRaw.includes(k.replace('_', ' ')) || kindRaw.includes(k)) ||
        (kindRaw.includes('activity') ? 'bas' : kindRaw.includes('return') ? 'itr' : 'itr');
      const period = pick(row, 'Period', 'Year', 'Tax Year');
      if (!period) {
        counts.skipped++;
        skips.push(`lodgment for "${name}" has no period column value`);
        continue;
      }
      const lodgedOn = pick(row, 'Lodged', 'Lodged On', 'Date Lodged') ? parseDate(pick(row, 'Lodged', 'Lodged On', 'Date Lodged')) : null;
      const expectedRaw = pick(row, 'Expected', 'Expected Amount', 'Estimate');
      const expected = expectedRaw ? parseMoney(expectedRaw) : null;
      const existing = await db.query('select * from lodgments where client_id = $1 and kind = $2 and period = $3', [client.id, kind, period]);
      if (existing.length) {
        counts.lodgments_updated++;
        if (!dryRun) {
          await db.query(
            `update lodgments set lodged_on = coalesce($1, lodged_on), expected_cents = coalesce($2, expected_cents),
               status = case when $1 is not null then 'lodged' else status end where id = $3`,
            [lodgedOn, expected, existing[0].id],
          );
        }
      } else {
        counts.lodgments++;
        if (!dryRun) {
          await db.query(
            `insert into lodgments (client_id, staff_id, kind, period, due_on, lodged_on, expected_cents, status)
             values ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [client.id, s?.id || null, kind, period, pick(row, 'Due', 'Due Date') ? parseDate(pick(row, 'Due', 'Due Date')) : null, lodgedOn, expected, lodgedOn ? 'lodged' : 'due'],
          );
        }
      }
    }
  }

  if (docRows) {
    for (const row of docRows) {
      const name = pick(row, 'Client', 'Client Name', 'Taxpayer', 'Taxpayer Name');
      const client = await findClient(name, null);
      const title = pick(row, 'Title', 'Document', 'Document Title', 'Description') || pick(row, 'Type', 'Document Type') || 'ATO correspondence';
      if (!client && name) {
        counts.skipped++;
        skips.push(`document "${truncate(title, 40)}" for "${name}" matches no client on file`);
        continue;
      }
      const receivedRaw = pick(row, 'Received', 'Date Received', 'Date', 'Processed Date');
      const amountRaw = pick(row, 'Amount', 'Amount Payable', 'Result');
      let amount = amountRaw ? parseMoney(amountRaw) : null;
      const direction = String(pick(row, 'Direction', 'Refund or Payable') || '').toLowerCase();
      if (amount !== null && (direction.includes('refund') || String(amountRaw).includes('('))) amount = -Math.abs(amount);
      const extRef = pick(row, 'Document ID', 'Ref', 'Reference') || null;
      const existing = extRef
        ? await db.query("select * from documents where lower(coalesce(external_ref, '')) = lower($1)", [extRef])
        : client
          ? await db.query('select * from documents where client_id = $1 and lower(title) = lower($2) and received_on = $3', [
              client.id, title, receivedRaw ? parseDate(receivedRaw) : today(),
            ])
          : [];
      if (existing.length) {
        counts.documents_updated++;
        if (!dryRun) {
          await db.query(
            `update documents set amount_cents = coalesce($1, amount_cents), due_on = coalesce($2, due_on), period = coalesce($3, period) where id = $4`,
            [amount, pick(row, 'Due', 'Due Date') ? parseDate(pick(row, 'Due', 'Due Date')) : null, pick(row, 'Period', 'Year', 'Tax Year') || null, existing[0].id],
          );
        }
      } else {
        counts.documents++;
        if (!dryRun) {
          const ref = await nextRef(db);
          await db.query(
            `insert into documents (ref, client_id, staff_id, doc_type, title, period, received_on, amount_cents, due_on, status, filed_on, external_ref)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              ref,
              client?.id || null,
              s?.id || client?.staff_id || null,
              mapImportType(pick(row, 'Type', 'Document Type') || title),
              title,
              pick(row, 'Period', 'Year', 'Tax Year') || null,
              receivedRaw ? parseDate(receivedRaw) : today(),
              amount,
              pick(row, 'Due', 'Due Date') ? parseDate(pick(row, 'Due', 'Due Date')) : null,
              client ? mapImportStatus(pick(row, 'Status')) : 'received',
              mapImportStatus(pick(row, 'Status')) === 'filed' ? (receivedRaw ? parseDate(receivedRaw) : today()) : null,
              extRef,
            ],
          );
        }
      }
    }
  }

  const json = { ...counts, dry_run: dryRun, skips };
  let text = `${dryRun ? 'DRY RUN, nothing written. Would import' : 'Imported'}: ` +
    `${counts.clients} new clients (${counts.clients_updated} updated), ` +
    `${counts.documents} documents (${counts.documents_updated} updated), ` +
    `${counts.lodgments} lodgments (${counts.lodgments_updated} updated).`;
  if (counts.tfn_truncated) {
    text += `\n${counts.tfn_truncated} TFN values in the export were truncated to their last three digits on the way in. The full numbers never landed, deliberately (Privacy (Tax File Number) Rule 2015).`;
  }
  if (skips.length) text += `\nSkipped ${counts.skipped}:\n` + skips.map((x) => `  - ${x}`).join('\n');
  text += dryRun ? '\nRun again without --dry-run to write it.' : '\nCheck it: stats, clients, register, lodgments --all.';
  return { json, text };
}

async function cmdExport(db, args, flags) {
  const tables = ['staff', 'clients', 'lodgments', 'documents', 'payment_plans', 'client_notes', 'tasks'];
  const out = {};
  for (const t of tables) out[t] = await db.query(`select * from ${t} order by created_at`);
  const counts = Object.fromEntries(tables.map((t) => [t, out[t].length]));
  const file = str(flags.out) || path.join(REPO_ROOT, 'exports', `ato-export-${today()}.json`);
  const dir = path.dirname(file);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 2));
  return {
    json: { file, counts },
    text: `Exported the whole database to ${file}.\n  ` + Object.entries(counts).map(([t, n]) => `${t}: ${n}`).join(', ') +
      '\nPlain JSON of plain tables. Note: exports carry at most the last three TFN digits, because that is all that exists.',
  };
}

// ---------------------------------------------------------------------------
// Help and dispatch

const HELP = `
ATO Correspondence for Claude Code: the CLI behind the slash commands.

  node scripts/ato.mjs <command> [args] [--flags]     (or: npm run ato -- <command>)

The pipeline (every piece of ATO mail walks it):
  receive <client> --type= --title= [--period= --payable=|--refund= --due= --received=]
  receive --unmatched --title= [...]                  mail you cannot place yet
  match <ref> <client>                                whose it is
  check <ref> [--note= --expected=|--expected-refund=] the numbers against the lodgment record
  notify <ref>                                        the client was told (letters draft via npm run docs)
  file <ref> --ref="<document store path>"            done, and where it lives

Reads:
  inbox                    everything not yet in front of the client, oldest first
  register [--client= --type= --status= --period= --all]
  doc <ref>                one document: the numbers, the check, the trail
  attention                everything that wants a decision, worst first
  due [--days=30]          money due to the ATO, and whether the client knows
  variances                assessed against lodged, with the unexplained ones loud
  client <name>            one client's whole ATO relationship
  clients [--all]          the client list with open items and money ahead
  lodgments [--all]        the lodgment calendar   |  workload    turnaround per person
  plans [--all]            payment plans and the next instalment  |  tasks [--all]  |  staff  |  stats
  compliance [rule]        the rule book run against the records

Writes:
  lodge add <client> --kind=itr|bas|ias|fbt|smsf_return|tpar --period= [--due= --expected=|--expected-refund= --lodged=]
  lodge done <client> [--kind= --period=] [--on= --expected=]
  plan add <client> --total= --instalment= [--frequency=] --next= [--doc=]
  plan paid <client> | plan defaulted <client> | plan completed <client>
  log <client or ref> "what was said" [--channel=phone|email|meeting|letter]
  task add "title" [--client= --doc= --due=]   task done <match>
  add client "<name>" [--type= --abn= --tfn-last3= --group= --staff=]   add staff "<name>" [--role=]
  client set <name> [--email= --staff= --group= --status= --tfn-last3=]
  import atomate|xpm|csv --clients= [--documents= --lodgments=] [--dry-run]
  export [--out=file.json]

Money in dollars, signed by flag: --payable=18400 means $18,400 owed to the ATO, --refund=950 the other way.
Any command takes --json. Names and refs match case-insensitively ("1007" finds ATO-1007); an ambiguous
one lists the candidates rather than guessing.
No full tax file number is stored here, ever: the last three digits at most (Privacy (TFN) Rule 2015).
Nothing connects to the ATO and nothing sends to a client: letters draft to docs-out/, a person sends.
Nothing here is tax advice.
`;

const COMMANDS = {
  staff: cmdStaff,
  clients: cmdClients,
  client: async (db, args, flags) => (args[0] === 'set' ? cmdClientSet(db, args.slice(1), flags) : cmdClient(db, args, flags)),
  inbox: cmdInbox,
  register: cmdRegister,
  doc: cmdDoc,
  receive: cmdReceive,
  match: cmdMatch,
  check: cmdCheck,
  notify: cmdNotify,
  file: cmdFile,
  variances: cmdVariances,
  due: cmdDue,
  workload: cmdWorkload,
  attention: cmdAttention,
  lodgments: cmdLodgments,
  lodge: cmdLodge,
  plans: cmdPlans,
  plan: cmdPlan,
  log: cmdLog,
  task: cmdTask,
  tasks: cmdTasks,
  add: cmdAdd,
  compliance: cmdCompliance,
  stats: cmdStats,
  import: cmdImport,
  export: cmdExport,
};

async function main() {
  const { args, flags } = parseArgv(process.argv.slice(2));
  const [command, ...rest] = args;
  if (!command || command === 'help' || flags.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const fn = COMMANDS[command];
  if (!fn) {
    process.stderr.write(`Unknown command "${command}".\n\n${HELP}`);
    return 1;
  }
  const db = await getDb();
  try {
    const result = await fn(db, rest, flags);
    if (flags.json) process.stdout.write(JSON.stringify(result.json, null, 2) + '\n');
    else process.stdout.write(result.text.replace(/^\n/, '') + '\n');
    return 0;
  } catch (e) {
    if (e instanceof CliError) {
      process.stderr.write(`${e.message}\n`);
      return e.code;
    }
    if (/relation "?\w+"? does not exist/.test(e.message)) {
      process.stderr.write('The database has no tables yet. Run: npm run migrate\n');
      return 1;
    }
    throw e;
  } finally {
    await db.close();
  }
}

process.exitCode = await main();
