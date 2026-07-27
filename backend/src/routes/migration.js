// Temporary SQL migration endpoint — run once, then remove
const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getSupabase } = require('../supabase');

router.post('/sys/run-migration', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const sql = req.body.sql;
    if (!sql) return res.status(400).json({ error: 'sql field required' });

    // Try pg direct connection
    const { Pool } = require('pg');
    const connStr = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
    if (!connStr) {
      // Fallback: Supabase REST API with service_role key (pgm extension)
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const url = process.env.SUPABASE_URL;
      if (key && url) {
        // Try Supabase's raw SQL endpoint via rest
        const r = await fetch(url + '/rest/v1/rpc/', {
          method: 'POST',
          headers: { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
        });
        // The /rest/v1/ endpoint doesn't support DDL. Try the database API directly
        // Use pg connection via pg npm (now installed)
        // Actually, try the Supabase JS client's custom query capability
        const sup = getSupabase();
        // Fallback: just report available connection methods
        return res.status(500).json({ error: 'Supabase Management API needs PAT token. Run SQL manually in Supabase Dashboard > SQL Editor.', hint: 'Use: postgresql://postgres:[PASSWORD]@db.' + url?.replace('https://','').replace('.supabase.co','') + '.supabase.co:5432/postgres' });
      }
      return res.status(500).json({ error: 'No database connection or management API key available' });
    }

    const pool = new Pool({ connectionString: connStr, connectionTimeoutMillis: 10000 });
    const result = await pool.query(sql);
    await pool.end();
    res.json({ success: true, rows: result.rowCount, method: 'pg_direct' });
  } catch (ex) {
    // Fallback: try Supabase JS client
    try {
      const sup = getSupabase();
      const { error } = await sup.from('_sql').select('count').limit(0);
      // Try raw SQL via Supabase REST with service_role
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const url = process.env.SUPABASE_URL;
      if (key && url) {
        const r = await fetch(url + '/rest/v1/rpc/pg_query', {
          method: 'POST',
          headers: { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query_text: sql }),
        });
        const body = await r.text();
        return res.json({ method: 'rpc_pg_query', status: r.status, body: body.substring(0, 500) });
      }
    } catch (fallbackErr) {}
    res.status(500).json({ error: ex.message });
  }
});

module.exports = router;
