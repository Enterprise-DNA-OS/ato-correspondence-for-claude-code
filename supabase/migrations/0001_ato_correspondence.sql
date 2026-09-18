-- ato-correspondence-for-claude-code: core schema.
-- An Australian accounting practice's ATO correspondence system: the staff,
-- the clients (with family groups, the way a tax practice actually reviews
-- mail), the correspondence register with its five-stage pipeline
-- (received -> matched -> checked -> notified -> filed), the lodgment record
-- every notice of assessment is checked against, the payment plans the ATO
-- defaults the moment an instalment slips, the contact log and the tasks.
--
-- Runs unchanged on PGlite (embedded) and on Postgres / Supabase.
--
-- Money is stored in cents, SIGNED: positive is payable to the ATO, negative
-- is a refund. A variance is one subtraction, not a report you buy.
--
-- No full tax file number is stored anywhere, deliberately. The clients table
-- keeps at most the LAST THREE digits (enough to confirm a match against a
-- letter in your hand) and the schema enforces it. The Privacy (Tax File
-- Number) Rule 2015 is legally binding; the safest TFN store is the one that
-- does not exist. Nothing here connects to the ATO: the mail arrives however
-- it arrives (paper, ATO Online, your practice portal) and this system is the
-- register, the checker and the drafter behind it.

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- Staff -----------------------------------------------------------------------
-- The team who process the mail. The workload view measures each person's real
-- turnaround (received to client notified), which is the number the incumbent
-- sells back to you as a dashboard.

create table if not exists staff (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  code          text,
  email         text,
  role          text not null default 'accountant',   -- partner | accountant | bookkeeper | admin
  active        boolean not null default true,
  started_on    date,
  external_ref  text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists staff_name_lower_idx on staff (lower(full_name));

-- Clients ---------------------------------------------------------------------
-- One client is one taxpayer: a person, a company, a trust, a partnership or
-- an SMSF. group_name is the family group, because that is how a practice
-- reads its mail ("everything for the Gables this week"). tfn_last3 is the
-- ONLY tax file number material this system will hold: the check constraint
-- refuses anything longer, and the CLI refuses the flag that would try.

create table if not exists clients (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  client_type   text not null default 'individual',   -- individual | company | trust | partnership | smsf
  email         text,
  phone         text,
  abn           text,
  tfn_last3     text check (tfn_last3 is null or tfn_last3 ~ '^[0-9]{1,3}$'),
  group_name    text,
  staff_id      uuid references staff(id) on delete set null,
  status        text not null default 'active',       -- active | former
  note          text,
  external_ref  text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists clients_name_lower_idx on clients (lower(name));
create index if not exists clients_group_idx on clients (lower(group_name));

-- Lodgments -------------------------------------------------------------------
-- What the practice lodged (or must lodge), and what it expected back. This is
-- the table a notice of assessment is CHECKED against: expected_cents (signed,
-- payable positive) against what the ATO assessed. It also carries the
-- lodgment calendar, so an overdue BAS surfaces before the ATO's demand does.

create table if not exists lodgments (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients(id) on delete cascade,
  staff_id        uuid references staff(id) on delete set null,
  kind            text not null default 'itr',        -- itr | bas | ias | fbt | smsf_return | tpar
  period          text not null,                       -- '2024-25', 'Q1 2026-27'
  due_on          date,
  lodged_on       date,
  expected_cents  bigint,                              -- signed: payable positive, refund negative
  status          text not null default 'due',         -- due | lodged | assessed
  note            text,
  external_ref    text unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (client_id, kind, period)
);
create index if not exists lodgments_client_idx on lodgments (client_id);
create index if not exists lodgments_status_idx on lodgments (status);

-- Documents -------------------------------------------------------------------
-- The correspondence register: one row per piece of ATO mail. The pipeline is
-- the whole job:
--   received  -> it exists (client_id may still be null: unmatched)
--   matched   -> we know whose it is
--   checked   -> the numbers were checked against the lodgment record
--   notified  -> the client letter was drafted and a person sent it
--   filed     -> it is in the document store, with the reference recorded
-- amount_cents is signed (payable positive). due_on is the ATO's payment due
-- date, and the days between today and it are the days your client has left.

create table if not exists documents (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique,
  client_id     uuid references clients(id) on delete set null,
  staff_id      uuid references staff(id) on delete set null,
  lodgment_id   uuid references lodgments(id) on delete set null,
  doc_type      text not null default 'general',  -- assessment | statement | debt | payment_plan | instalment | lodgment_demand | audit | remission | super | general
  title         text not null,
  period        text,
  received_on   date not null default current_date,
  issued_on     date,
  amount_cents  bigint,                            -- signed: payable positive, refund negative
  due_on        date,                              -- ATO payment due date, if the document carries one
  status        text not null default 'received',  -- received | matched | checked | notified | filed
  checked_on    date,
  check_note    text,                              -- what the check found, especially any variance and why
  notified_on   date,
  filed_on      date,
  file_ref      text,                              -- where the PDF lives in your document store
  note          text,
  external_ref  text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists documents_client_idx on documents (client_id);
create index if not exists documents_status_idx on documents (status);
create index if not exists documents_type_idx on documents (doc_type);

-- Payment plans ---------------------------------------------------------------
-- ATO payment plans die quietly: one missed instalment and the plan defaults,
-- the general interest charge keeps running, and the client finds out from a
-- letter. next_due_on is the line this system watches.

create table if not exists payment_plans (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references clients(id) on delete cascade,
  document_id      uuid references documents(id) on delete set null,
  started_on       date not null default current_date,
  total_cents      bigint not null,
  instalment_cents bigint not null,
  frequency        text not null default 'monthly',   -- weekly | fortnightly | monthly
  next_due_on      date,
  remaining_cents  bigint not null,
  status           text not null default 'active',    -- active | completed | defaulted
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists plans_client_idx on payment_plans (client_id);

-- Contact log and tasks ---------------------------------------------------------
-- The contact log is evidence: when the client was told, by whom, through what.
-- The debt-letter and quiet-client checks read it.

create table if not exists client_notes (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  document_id  uuid references documents(id) on delete set null,
  staff_id     uuid references staff(id) on delete set null,
  noted_on     date not null default current_date,
  channel      text not null default 'phone',   -- phone | email | meeting | letter
  note         text not null,
  created_at   timestamptz not null default now()
);
create index if not exists notes_client_idx on client_notes (client_id);
create index if not exists notes_document_idx on client_notes (document_id);

create table if not exists tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  client_id    uuid references clients(id) on delete cascade,
  document_id  uuid references documents(id) on delete set null,
  staff_id     uuid references staff(id) on delete set null,
  due_on       date,
  status       text not null default 'open',   -- open | done
  done_on      date,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- updated_at triggers -----------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['staff','clients','lodgments','documents','payment_plans','tasks']
  loop
    execute format('drop trigger if exists %I on %I', t || '_updated_at', t);
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_updated_at', t);
  end loop;
end
$$;

-- =============================================================================
-- Views: the questions a practice asks every morning, as SQL it can read.
-- =============================================================================

-- The register: every document with its client, its owner and its countdowns.
create or replace view v_register as
select
  d.id as document_id,
  d.ref,
  coalesce(c.name, '(unmatched)') as client,
  c.id as client_id,
  c.group_name,
  coalesce(s.full_name, 'unassigned') as staff,
  d.doc_type,
  d.title,
  d.period,
  d.received_on,
  (current_date - d.received_on) as days_held,
  d.amount_cents,
  d.due_on,
  (d.due_on - current_date) as days_to_due,
  d.status,
  d.checked_on,
  d.check_note,
  d.notified_on,
  d.filed_on,
  d.file_ref,
  d.lodgment_id
from documents d
left join clients c on c.id = d.client_id
left join staff s on s.id = d.staff_id;

-- The inbox: everything not yet in front of the client, oldest first. This is
-- the morning mail run.
create or replace view v_inbox as
select * from v_register
where status in ('received', 'matched', 'checked')
order by received_on;

-- Variances: what the ATO assessed against what the practice lodged. The
-- column the incumbent charges a tier for is one subtraction here.
create or replace view v_variances as
select
  r.document_id,
  r.ref,
  r.client,
  r.staff,
  r.doc_type,
  r.period,
  r.status,
  r.checked_on,
  (current_date - r.checked_on) as days_since_check,
  l.expected_cents,
  r.amount_cents as assessed_cents,
  (r.amount_cents - l.expected_cents) as variance_cents,
  r.check_note
from v_register r
join lodgments l on l.id = r.lodgment_id
where r.amount_cents is not null and l.expected_cents is not null
  and r.amount_cents <> l.expected_cents;

-- Money due to the ATO: every payable document with a due date still ahead or
-- freshly behind, and whether the client has been told.
create or replace view v_due as
select
  r.ref,
  r.client,
  r.staff,
  r.doc_type,
  r.title,
  r.period,
  r.amount_cents,
  r.due_on,
  r.days_to_due,
  r.status,
  (r.notified_on is not null) as client_notified
from v_register r
where r.amount_cents > 0 and r.due_on is not null
  and r.due_on >= current_date - 60;

-- Payment plans with the countdown to the next instalment.
create or replace view v_payment_plans as
select
  p.id as plan_id,
  c.name as client,
  coalesce(s.full_name, 'unassigned') as staff,
  p.started_on,
  p.total_cents,
  p.instalment_cents,
  p.frequency,
  p.next_due_on,
  (p.next_due_on - current_date) as days_to_next,
  p.remaining_cents,
  p.status,
  p.note
from payment_plans p
join clients c on c.id = p.client_id
left join staff s on s.id = c.staff_id;

-- The lodgment calendar: due and overdue first.
create or replace view v_lodgments as
select
  l.id as lodgment_id,
  c.name as client,
  coalesce(s.full_name, 'unassigned') as staff,
  l.kind,
  l.period,
  l.due_on,
  (l.due_on - current_date) as days_to_due,
  l.lodged_on,
  l.expected_cents,
  l.status,
  l.note
from lodgments l
join clients c on c.id = l.client_id
left join staff s on s.id = coalesce(l.staff_id, c.staff_id);

-- One client, one line: the whole relationship with the ATO.
create or replace view v_client_position as
select
  c.id as client_id,
  c.name as client,
  c.client_type,
  c.group_name,
  c.status,
  coalesce(s.full_name, 'unassigned') as staff,
  (select count(*) from documents d where d.client_id = c.id and d.status in ('received','matched','checked','notified')) as open_documents,
  (select count(*) from documents d where d.client_id = c.id) as all_documents,
  coalesce((select sum(d.amount_cents) from documents d
            where d.client_id = c.id and d.amount_cents > 0 and d.due_on >= current_date), 0)::bigint as payable_ahead_cents,
  (select min(d.due_on) from documents d where d.client_id = c.id and d.amount_cents > 0 and d.due_on >= current_date) as next_payment_due_on,
  (select count(*) from payment_plans p where p.client_id = c.id and p.status = 'active') as active_plans,
  (select count(*) from lodgments l where l.client_id = c.id and l.status = 'due' and l.due_on < current_date) as overdue_lodgments,
  (select max(n.noted_on) from client_notes n where n.client_id = c.id) as last_contact_on,
  (current_date - (select max(n.noted_on) from client_notes n where n.client_id = c.id)) as days_since_contact
from clients c
left join staff s on s.id = c.staff_id;

-- Workload and turnaround per staff member: how many documents each person is
-- holding at each stage, and the real average days from received to the client
-- being told. The number the vendor's "practice insights" tier charges for.
create or replace view v_workload as
select
  coalesce(s.full_name, 'unassigned') as staff,
  s.id as staff_id,
  count(*) filter (where d.status in ('received','matched')) as awaiting_check,
  count(*) filter (where d.status = 'checked') as awaiting_letter,
  count(*) filter (where d.status = 'notified') as awaiting_filing,
  count(*) filter (where d.status = 'filed') as filed,
  round(avg(d.notified_on - d.received_on) filter (where d.notified_on is not null), 1) as avg_days_to_notify,
  max(current_date - d.received_on) filter (where d.status in ('received','matched','checked')) as oldest_held_days
from documents d
left join staff s on s.id = d.staff_id
group by s.id, s.full_name;

-- Everything that wants a decision, one union, worst first. The reasons are
-- the ones that cost a practice money, clients or standing with the ATO.
create or replace view v_attention as
-- A payable document whose due date has passed and the client was never told.
select 'due_missed' as reason, r.ref as label, r.client, r.staff,
       abs(r.days_to_due) as days, r.amount_cents,
       'payment was due ' || to_char(r.due_on, 'YYYY-MM-DD') || ' and the client was never notified: ' || r.title as detail
from v_register r
where r.amount_cents > 0 and r.due_on < current_date and r.notified_on is null
union all
-- A payable document due inside fourteen days, client not yet told.
select 'due_soon_unnotified', r.ref, r.client, r.staff,
       r.days_to_due, r.amount_cents,
       'payment due ' || to_char(r.due_on, 'YYYY-MM-DD') || ' and the client has not been told: ' || r.title
from v_register r
where r.amount_cents > 0 and r.notified_on is null
  and r.due_on between current_date and current_date + 14
union all
-- An assessment that does not match what was lodged, still unresolved.
select 'variance_open', v.ref, v.client, v.staff,
       v.days_since_check, v.variance_cents,
       'assessed ' || v.period || ' differs from the lodgment by ' ||
       to_char(abs(v.variance_cents) / 100.0, 'FM$999,999,990') || ': accept, amend or object'
from v_variances v
where v.status in ('checked', 'notified')
union all
-- Mail nobody has matched to a client.
select 'doc_unmatched', r.ref, '(unmatched)', r.staff,
       r.days_held, r.amount_cents,
       'received ' || to_char(r.received_on, 'YYYY-MM-DD') || ' and matched to nobody: ' || r.title
from v_register r
where r.client_id is null and r.status = 'received'
union all
-- A document sitting in the pipeline more than seven days.
select 'doc_stale', r.ref, r.client, r.staff,
       r.days_held, r.amount_cents,
       'received ' || to_char(r.received_on, 'YYYY-MM-DD') || ', still ' || r.status || ': ' || r.title
from v_register r
where r.status in ('received','matched','checked') and r.days_held > 7
union all
-- An audit or review letter anywhere but closed.
select 'audit_open', r.ref, r.client, r.staff,
       r.days_held, null::bigint,
       'audit or review correspondence open since ' || to_char(r.received_on, 'YYYY-MM-DD') || ': ' || r.title
from v_register r
where r.doc_type = 'audit' and r.status <> 'filed'
union all
-- A payment plan instalment past its date. The ATO defaults quietly.
select 'plan_overdue', p.client, p.client, p.staff,
       abs(p.days_to_next), p.instalment_cents,
       'instalment was due ' || to_char(p.next_due_on, 'YYYY-MM-DD') || ' (' || p.frequency || ' plan, ' ||
       to_char(p.remaining_cents / 100.0, 'FM$999,999,990') || ' remaining): one missed instalment defaults the plan'
from v_payment_plans p
where p.status = 'active' and p.next_due_on < current_date
union all
-- A lodgment past its due date.
select 'lodgment_overdue', l.kind || ' ' || l.period, l.client, l.staff,
       abs(l.days_to_due), null::bigint,
       upper(l.kind) || ' for ' || l.period || ' was due ' || to_char(l.due_on, 'YYYY-MM-DD') || ' and has not been lodged'
from v_lodgments l
where l.status = 'due' and l.due_on < current_date
union all
-- Notified but never filed: the letter went, the record did not.
select 'unfiled', r.ref, r.client, r.staff,
       (current_date - r.notified_on), null::bigint,
       'client notified ' || to_char(r.notified_on, 'YYYY-MM-DD') || ' but the document was never filed'
from v_register r
where r.status = 'notified' and r.notified_on <= current_date - 7
union all
-- A task past its date.
select 'task_overdue', t.title, coalesce(c.name, ''), coalesce(s.full_name, ''),
       (current_date - t.due_on), null::bigint,
       'due ' || to_char(t.due_on, 'YYYY-MM-DD')
from tasks t
left join clients c on c.id = t.client_id
left join staff s on s.id = t.staff_id
where t.status = 'open' and t.due_on < current_date;
