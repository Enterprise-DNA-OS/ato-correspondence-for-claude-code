-- Demo data for ato-correspondence-for-claude-code.
-- Banksia Partners, a fictional suburban Brisbane accounting practice: a
-- partner, two accountants and a practice administrator, sixteen clients
-- across individuals, companies, trusts, a partnership and an SMSF, a
-- lodgment calendar, three payment plans and a fortnight of ATO mail in every
-- state of the pipeline.
--
-- Deliberately messy, so the attention list has something to say:
--   a notice of assessment for $18,400 payable in nine days, client not told
--   a statement of account whose due date passed three days ago, client never told
--   an assessment $1,840 off the lodged return, unexplained, 34 days old
--   a scanned instalment notice matched to nobody for four days
--   a statement of account sitting unactioned for nine days
--   an audit letter open for fifteen days with the response task overdue
--   a payment plan instalment five days overdue (one miss defaults the plan)
--   a BAS six days past its lodgment date
--   a debt letter the client was told about that nobody filed
--
-- Dates are relative to current_date. Ids are derived from names with
-- seed_uuid, and every insert is ON CONFLICT DO NOTHING, so running it twice
-- changes nothing.
--
-- Names, amounts and periods are DEMO VALUES for a fictional practice. No
-- real person, firm or taxpayer is depicted, and nothing here is tax advice.

create or replace function seed_uuid(seed text) returns uuid language sql immutable as $$
  select (substr(m, 1, 8) || '-' || substr(m, 9, 4) || '-4' || substr(m, 13, 3)
          || '-8' || substr(m, 16, 3) || '-' || substr(m, 19, 12))::uuid
  from (select md5(seed) as m) s
$$;

-- Staff -----------------------------------------------------------------------

insert into staff (id, full_name, code, email, role, active, started_on) values
  (seed_uuid('staff:meredith'), 'Meredith Chan',   'MC', 'meredith@banksiapartners.example.au', 'partner',    true, current_date - 4800),
  (seed_uuid('staff:dave'),     'Dave Okafor',     'DO', 'dave@banksiapartners.example.au',     'accountant', true, current_date - 2300),
  (seed_uuid('staff:lauren'),   'Lauren Whitfield','LW', 'lauren@banksiapartners.example.au',   'accountant', true, current_date - 1100),
  (seed_uuid('staff:terri'),    'Terri Baumann',   'TB', 'terri@banksiapartners.example.au',    'admin',      true, current_date - 3100)
on conflict do nothing;

-- Clients ---------------------------------------------------------------------

insert into clients (id, name, client_type, email, phone, abn, tfn_last3, group_name, staff_id, status, external_ref) values
  (seed_uuid('client:gable-plumbing'), 'Gable Plumbing Pty Ltd',      'company',     'accounts@gableplumbing.example.au', '07 3555 0201', '53 004 085 616', '482', 'Gable',    seed_uuid('staff:dave'),     'active', 'XPM-8001'),
  (seed_uuid('client:roger-gable'),    'Roger Gable',                 'individual',  'roger@gableplumbing.example.au',    '0412 000 011', null,             '917', 'Gable',    seed_uuid('staff:dave'),     'active', 'XPM-8002'),
  (seed_uuid('client:karvelas-trust'), 'Karvelas Family Trust',       'trust',       'stavros@karvelas.example.au',       '0412 000 022', '81 002 231 550', '306', 'Karvelas', seed_uuid('staff:meredith'), 'active', 'XPM-8003'),
  (seed_uuid('client:stavros'),        'Stavros Karvelas',            'individual',  'stavros@karvelas.example.au',       '0412 000 022', null,             '779', 'Karvelas', seed_uuid('staff:meredith'), 'active', 'XPM-8004'),
  (seed_uuid('client:northgate'),      'Northgate Physio Pty Ltd',    'company',     'admin@northgatephysio.example.au',  '07 3555 0233', '19 004 875 483', '164', null,       seed_uuid('staff:lauren'),   'active', 'XPM-8005'),
  (seed_uuid('client:marchetti'),      'Ellen Marchetti',             'individual',  'e.marchetti@example.au',            '0412 000 044', null,             '531', null,       seed_uuid('staff:lauren'),   'active', 'XPM-8006'),
  (seed_uuid('client:duong-smsf'),     'Duong Family Super Fund',     'smsf',        'anh.duong@example.au',              '0412 000 055', '62 008 550 347', '208', 'Duong',    seed_uuid('staff:meredith'), 'active', 'XPM-8007'),
  (seed_uuid('client:anh-duong'),      'Anh Duong',                   'individual',  'anh.duong@example.au',              '0412 000 055', null,             '644', 'Duong',    seed_uuid('staff:meredith'), 'active', 'XPM-8008'),
  (seed_uuid('client:crestline'),      'Crestline Earthworks Pty Ltd','company',     'office@crestline.example.au',       '07 3555 0255', '30 009 726 199', '095', null,       seed_uuid('staff:dave'),     'active', 'XPM-8009'),
  (seed_uuid('client:willoughby'),     'Sandra Willoughby',           'individual',  's.willoughby@example.au',           '0412 000 077', null,             '822', null,       seed_uuid('staff:lauren'),   'active', 'XPM-8010'),
  (seed_uuid('client:wojcik'),         'Tomasz Wojcik',               'individual',  't.wojcik@example.au',               '0412 000 088', null,             '473', null,       seed_uuid('staff:meredith'), 'active', 'XPM-8011'),
  (seed_uuid('client:beacon-hill'),    'Beacon Hill Cafe Pty Ltd',    'company',     'bookings@beaconhillcafe.example.au','07 3555 0288', '75 000 998 344', null,  null,       seed_uuid('staff:dave'),     'active', 'XPM-8012'),
  (seed_uuid('client:nguyen'),         'Harold Nguyen',               'individual',  'h.nguyen@example.au',               '0412 000 099', null,             '350', null,       seed_uuid('staff:lauren'),   'active', 'XPM-8013'),
  (seed_uuid('client:templeman'),      'Iris Templeman',              'individual',  'i.templeman@example.au',            '07 3555 0299', null,             '718', null,       seed_uuid('staff:lauren'),   'active', 'XPM-8014'),
  (seed_uuid('client:riverstone'),     'Riverstone Landscaping',      'partnership', 'crew@riverstonelandscaping.example.au', '0412 000 110', '44 007 218 905', '286', null,   seed_uuid('staff:dave'),     'active', 'XPM-8015'),
  (seed_uuid('client:mcadam'),         'McAdam Consulting Pty Ltd',   'company',     'kirsty@mcadamconsulting.example.au','07 3555 0311', '92 001 664 720', '569', null,       seed_uuid('staff:meredith'), 'active', 'XPM-8016')
on conflict do nothing;

-- Lodgments ---------------------------------------------------------------------
-- expected_cents is signed: payable positive, refund negative.

insert into lodgments (id, client_id, staff_id, kind, period, due_on, lodged_on, expected_cents, status, note) values
  (seed_uuid('lodg:marchetti-itr'),   seed_uuid('client:marchetti'),      seed_uuid('staff:lauren'),   'itr', '2025-26',    current_date + 120, current_date - 40,  128000,   'assessed', null),
  (seed_uuid('lodg:gable-p-itr'),     seed_uuid('client:gable-plumbing'), seed_uuid('staff:dave'),     'itr', '2025-26',    current_date + 120, current_date - 30,  1840000,  'assessed', null),
  (seed_uuid('lodg:roger-itr'),       seed_uuid('client:roger-gable'),    seed_uuid('staff:dave'),     'itr', '2025-26',    current_date + 120, current_date - 25,  -95000,   'lodged',   'Refund expected; watching for the assessment.'),
  (seed_uuid('lodg:willoughby-itr'),  seed_uuid('client:willoughby'),     seed_uuid('staff:lauren'),   'itr', '2025-26',    current_date + 120, current_date - 50,  -231000,  'assessed', null),
  (seed_uuid('lodg:wojcik-itr'),      seed_uuid('client:wojcik'),         seed_uuid('staff:meredith'), 'itr', '2024-25',    current_date - 300, current_date - 305, -120000,  'assessed', null),
  (seed_uuid('lodg:stavros-itr'),     seed_uuid('client:stavros'),        seed_uuid('staff:meredith'), 'itr', '2025-26',    current_date + 120, current_date - 20,  410000,   'lodged',   null),
  (seed_uuid('lodg:anh-itr'),         seed_uuid('client:anh-duong'),      seed_uuid('staff:meredith'), 'itr', '2025-26',    current_date + 120, current_date - 35,  -64000,   'lodged',   null),
  (seed_uuid('lodg:northgate-bas'),   seed_uuid('client:northgate'),      seed_uuid('staff:lauren'),   'bas', 'Q4 2025-26', current_date - 6,   null,               null,     'due',      'Still waiting on their July till reports.'),
  (seed_uuid('lodg:crestline-bas'),   seed_uuid('client:crestline'),      seed_uuid('staff:dave'),     'bas', 'Q4 2025-26', current_date - 6,   current_date - 10,  660000,   'lodged',   null),
  (seed_uuid('lodg:beacon-bas'),      seed_uuid('client:beacon-hill'),    seed_uuid('staff:dave'),     'bas', 'Q3 2025-26', current_date - 95,  current_date - 100, 715000,   'assessed', null),
  (seed_uuid('lodg:duong-smsf'),      seed_uuid('client:duong-smsf'),     seed_uuid('staff:meredith'), 'smsf_return', '2024-25', current_date + 20, null,           null,     'due',      'Audit report back from the auditor last week.'),
  (seed_uuid('lodg:karvelas-itr'),    seed_uuid('client:karvelas-trust'), seed_uuid('staff:meredith'), 'itr', '2025-26',    current_date + 45,  null,               null,     'due',      null),
  (seed_uuid('lodg:riverstone-itr'),  seed_uuid('client:riverstone'),     seed_uuid('staff:dave'),     'itr', '2025-26',    current_date + 60,  null,               null,     'due',      null)
on conflict do nothing;

-- Documents ---------------------------------------------------------------------
-- amount_cents is signed: payable positive, refund negative.

insert into documents (id, ref, client_id, staff_id, lodgment_id, doc_type, title, period, received_on, issued_on, amount_cents, due_on, status, checked_on, check_note, notified_on, filed_on, file_ref, note) values
  -- The record of how this is meant to run: received, checked, told, filed.
  (seed_uuid('doc:willoughby-noa'), 'ATO-1001', seed_uuid('client:willoughby'), seed_uuid('staff:lauren'), seed_uuid('lodg:willoughby-itr'),
   'assessment', 'Notice of assessment 2025-26', '2025-26', current_date - 18, current_date - 20, -231000, null,
   'filed', current_date - 17, 'Matches the return as lodged. Refund of $2,310 to her nominated account.', current_date - 16, current_date - 16, 'DM:Willoughby/2026/NoA-2025-26.pdf', null),
  (seed_uuid('doc:templeman-payg'), 'ATO-1002', seed_uuid('client:templeman'), seed_uuid('staff:lauren'), null,
   'instalment', 'PAYG instalment notice Q1 2026-27', 'Q1 2026-27', current_date - 12, current_date - 14, 98000, current_date + 35,
   'filed', current_date - 11, 'Instalment unchanged from last quarter; no variation needed.', current_date - 10, current_date - 10, 'DM:Templeman/2026/PAYG-Q1.pdf', null),
  (seed_uuid('doc:wojcik-noa'), 'ATO-1003', seed_uuid('client:wojcik'), seed_uuid('staff:meredith'), seed_uuid('lodg:wojcik-itr'),
   'assessment', 'Notice of assessment 2024-25', '2024-25', current_date - 290, current_date - 292, -120000, null,
   'filed', current_date - 289, 'Matches the return as lodged.', current_date - 288, current_date - 288, 'DM:Wojcik/2025/NoA-2024-25.pdf', null),
  (seed_uuid('doc:crestline-gic'), 'ATO-1004', seed_uuid('client:crestline'), seed_uuid('staff:dave'), null,
   'remission', 'General interest charge remission outcome', null, current_date - 20, current_date - 22, null, null,
   'filed', null, null, null, current_date - 18, 'DM:Crestline/2026/GIC-remission.pdf', 'GIC of $840 remitted in part following our request of June.'),
  (seed_uuid('doc:gable-super'), 'ATO-1005', seed_uuid('client:gable-plumbing'), seed_uuid('staff:dave'), null,
   'super', 'Super guarantee: employer obligations reminder', null, current_date - 40, current_date - 42, null, null,
   'filed', null, null, null, current_date - 39, 'DM:GablePlumbing/2026/SG-reminder.pdf', null),
  (seed_uuid('doc:karvelas-soa'), 'ATO-1006', seed_uuid('client:karvelas-trust'), seed_uuid('staff:meredith'), null,
   'statement', 'Statement of account: integrated client account', '2025-26', current_date - 30, current_date - 32, null, null,
   'filed', current_date - 29, 'Balance reflects the payment plan; instalments applying as agreed.', current_date - 28, current_date - 28, 'DM:Karvelas/2026/SOA-Aug.pdf', null),

  -- The live mess the attention list exists for.
  (seed_uuid('doc:gable-noa'), 'ATO-1007', seed_uuid('client:gable-plumbing'), seed_uuid('staff:dave'), seed_uuid('lodg:gable-p-itr'),
   'assessment', 'Notice of assessment 2025-26', '2025-26', current_date - 3, current_date - 5, 1840000, current_date + 9,
   'checked', current_date - 2, 'Matches the return as lodged. $18,400 payable.', null, null, null, null),
  (seed_uuid('doc:marchetti-noa'), 'ATO-1008', seed_uuid('client:marchetti'), seed_uuid('staff:lauren'), seed_uuid('lodg:marchetti-itr'),
   'assessment', 'Notice of assessment 2025-26', '2025-26', current_date - 36, current_date - 38, 312000, current_date + 18,
   'checked', current_date - 34, null, null, null, null, null),
  (seed_uuid('doc:beacon-soa'), 'ATO-1009', seed_uuid('client:beacon-hill'), seed_uuid('staff:dave'), seed_uuid('lodg:beacon-bas'),
   'statement', 'Statement of account: overdue balance Q3 2025-26', 'Q3 2025-26', current_date - 16, current_date - 18, 715000, current_date - 3,
   'matched', null, null, null, null, null, null),
  (seed_uuid('doc:unmatched-payg'), 'ATO-1010', null, null, null,
   'instalment', 'PAYG instalment notice: poor scan, taxpayer name unclear', 'Q1 2026-27', current_date - 4, null, 41000, current_date + 40,
   'received', null, null, null, null, null, 'Faxed copy from the client''s old address. Last three of the TFN on the letter: 462.'),
  (seed_uuid('doc:nguyen-soa'), 'ATO-1011', seed_uuid('client:nguyen'), seed_uuid('staff:lauren'), null,
   'statement', 'Statement of account 2025-26', '2025-26', current_date - 9, current_date - 11, 43000, current_date + 25,
   'matched', null, null, null, null, null, null),
  (seed_uuid('doc:wojcik-audit'), 'ATO-1012', seed_uuid('client:wojcik'), seed_uuid('staff:meredith'), null,
   'audit', 'Review of work-related expenses 2024-25: request for information', '2024-25', current_date - 15, current_date - 17, null, null,
   'matched', null, null, null, null, null, 'Substantiation requested for D5 claims. Response window is running.'),
  (seed_uuid('doc:crestline-debt'), 'ATO-1013', seed_uuid('client:crestline'), seed_uuid('staff:dave'), null,
   'debt', 'Overdue debt: intent to engage stronger action', null, current_date - 10, current_date - 12, 1540000, null,
   'notified', null, null, current_date - 8, null, null, 'Balance sits under the payment plan; letter crossed with the missed instalment.'),
  (seed_uuid('doc:northgate-ftl'), 'ATO-1014', seed_uuid('client:northgate'), seed_uuid('staff:lauren'), seed_uuid('lodg:northgate-bas'),
   'lodgment_demand', 'Failure to lodge warning: activity statement Q4 2025-26', 'Q4 2025-26', current_date - 1, current_date - 3, null, null,
   'matched', null, null, null, null, null, null),
  (seed_uuid('doc:anh-general'), 'ATO-1015', seed_uuid('client:anh-duong'), seed_uuid('staff:meredith'), null,
   'general', 'Confirmation of updated financial institution details', null, current_date, current_date - 2, null, null,
   'matched', null, null, null, null, null, null)
on conflict do nothing;

-- Payment plans -------------------------------------------------------------------

insert into payment_plans (id, client_id, document_id, started_on, total_cents, instalment_cents, frequency, next_due_on, remaining_cents, status, note) values
  (seed_uuid('plan:crestline'), seed_uuid('client:crestline'), seed_uuid('doc:crestline-debt'), current_date - 120, 2640000, 220000, 'monthly', current_date - 5, 1540000, 'active', 'Set up after the Q2 shortfall. Director paying from progress claims.'),
  (seed_uuid('plan:karvelas'),  seed_uuid('client:karvelas-trust'), null, current_date - 60, 1320000, 110000, 'monthly', current_date + 12, 990000, 'active', null),
  (seed_uuid('plan:beacon'),    seed_uuid('client:beacon-hill'), null, current_date - 400, 480000, 80000, 'monthly', null, 0, 'completed', 'Cleared in full, February.')
on conflict do nothing;

-- Contact log ----------------------------------------------------------------------

insert into client_notes (id, client_id, document_id, staff_id, noted_on, channel, note) values
  (seed_uuid('note:willoughby'), seed_uuid('client:willoughby'), seed_uuid('doc:willoughby-noa'), seed_uuid('staff:lauren'), current_date - 16, 'email', 'Sent the assessment letter: refund of $2,310, nothing to do.'),
  (seed_uuid('note:templeman'),  seed_uuid('client:templeman'),  seed_uuid('doc:templeman-payg'), seed_uuid('staff:lauren'), current_date - 10, 'letter', 'Posted the instalment letter with the payment slip, due date flagged.'),
  (seed_uuid('note:crestline1'), seed_uuid('client:crestline'),  seed_uuid('doc:crestline-debt'), seed_uuid('staff:dave'),   current_date - 8,  'phone', 'Rang the director about the debt letter. He believes the July instalment went; asked him for the receipt.'),
  (seed_uuid('note:wojcik'),     seed_uuid('client:wojcik'),     seed_uuid('doc:wojcik-audit'),   seed_uuid('staff:meredith'), current_date - 14, 'phone', 'Told Tomasz about the review. He is gathering logbook and receipts for the D5 claims.'),
  (seed_uuid('note:karvelas'),   seed_uuid('client:karvelas-trust'), null, seed_uuid('staff:meredith'), current_date - 28, 'email', 'Confirmed the August instalment cleared; statement reflects the plan.'),
  (seed_uuid('note:northgate'),  seed_uuid('client:northgate'),  null, seed_uuid('staff:lauren'), current_date - 5, 'email', 'Chased the July till reports again for the Q4 BAS.')
on conflict do nothing;

-- Tasks ----------------------------------------------------------------------------

insert into tasks (id, title, client_id, document_id, staff_id, due_on, status, done_on, note) values
  (seed_uuid('task:wojcik'),    'Compile Wojcik substantiation for the expenses review response', seed_uuid('client:wojcik'), seed_uuid('doc:wojcik-audit'), seed_uuid('staff:meredith'), current_date - 1, 'open', null, null),
  (seed_uuid('task:northgate'), 'Chase Northgate for the Q4 till reports', seed_uuid('client:northgate'), null, seed_uuid('staff:lauren'), current_date + 2, 'open', null, null),
  (seed_uuid('task:crestline'), 'Get the Crestline instalment receipt or reschedule with the ATO', seed_uuid('client:crestline'), seed_uuid('doc:crestline-debt'), seed_uuid('staff:dave'), current_date + 1, 'open', null, null)
on conflict do nothing;
