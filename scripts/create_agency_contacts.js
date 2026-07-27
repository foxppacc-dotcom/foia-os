#!/usr/bin/env node
/* One-shot migration: create agency_contacts table */
const { Pool } = require('pg');

// Try to get connection string from common sources
const connStr = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

if (!connStr) {
  // Build from Supabase project ref
  const ref = 'otpwggeqcjxlvdbcszgj';
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) {
    console.error('ERROR: Set SUPABASE_DB_PASSWORD or DATABASE_URL');
    process.exit(1);
  }
  // Try connection pooler
  const urls = [
    `postgresql://postgres:${password}@db.${ref}.supabase.co:5432/postgres`,
    `postgresql://postgres:${password}@${ref}.supabase.co:5432/postgres`,
  ];
  for (const url of urls) {
    (async () => {
      try {
        const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 5000 });
        await pool.query('SELECT 1');
        console.log('Connected via:', url.substring(0, 40) + '...');
        await runMigration(pool);
        await pool.end();
        process.exit(0);
      } catch (e) {}
    })();
  }
} else {
  (async () => {
    const pool = new Pool({ connectionString: connStr, connectionTimeoutMillis: 10000 });
    await runMigration(pool);
    await pool.end();
  })();
}

async function runMigration(pool) {
  const sql = `
    CREATE TABLE IF NOT EXISTS public.agency_contacts (
      id SERIAL PRIMARY KEY,
      agency_id INTEGER NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      title TEXT,
      department TEXT,
      email TEXT,
      phone TEXT,
      extension TEXT,
      preferred_comm TEXT DEFAULT 'email',
      is_primary BOOLEAN DEFAULT false,
      is_foia_officer BOOLEAN DEFAULT false,
      is_legal_contact BOOLEAN DEFAULT false,
      is_records_custodian BOOLEAN DEFAULT false,
      notes TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_agency_contacts_agency_id ON public.agency_contacts(agency_id);
    CREATE INDEX IF NOT EXISTS idx_agency_contacts_email ON public.agency_contacts(email);
  `;
  const result = await pool.query(sql);
  console.log('Migration complete. Rows affected:', result.rowCount || 0);

  // Test: add the ZAMHUB contact
  const ins = await pool.query(
    "INSERT INTO public.agency_contacts (agency_id, name, title, email, is_primary, is_active) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING RETURNING id",
    [377, 'ZAMHUB Contact', 'Primary Contact', 'ZAMHUB.ACC@GMAIL.COM', true, true]
  );
  console.log('ZAMHUB contact ID:', ins.rows[0]?.id || 'already exists');
}
