#!/usr/bin/env node
// Loads supabase/seed.sql: Banksia Partners, a fictional Brisbane accounting
// practice with 4 staff, 16 clients, a lodgment calendar, three payment plans
// and a fortnight of ATO mail in every state of the pipeline. Every row has a
// derived id and inserts with ON CONFLICT DO NOTHING, so re-running it is
// harmless.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';

export async function seed(db) {
  const sql = readFileSync(path.join(REPO_ROOT, 'supabase', 'seed.sql'), 'utf8');
  await db.exec(sql);
  const [c] = await db.query(`
    select (select count(*) from staff)          as staff,
           (select count(*) from clients)        as clients,
           (select count(*) from lodgments)      as lodgments,
           (select count(*) from documents)      as documents,
           (select count(*) from payment_plans)  as payment_plans,
           (select count(*) from client_notes)   as client_notes,
           (select count(*) from tasks)          as tasks
  `);
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const db = await getDb();
  try {
    const n = await seed(db);
    console.log(
      `seed: ${n.staff} staff, ${n.clients} clients, ${n.lodgments} lodgments, ${n.documents} documents, ` +
        `${n.payment_plans} payment plans, ${n.client_notes} notes, ${n.tasks} tasks`,
    );
  } finally {
    await db.close();
  }
}
