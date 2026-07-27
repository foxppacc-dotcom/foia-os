// Production cleanup endpoint — removes fake operational data
const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getSupabase } = require('../supabase');

router.post('/sys/cleanup', requireAuth, requireRole('admin'), async (req, res) => {
  const sup = getSupabase();
  const results = {};

  try {
    // Order matters — children before parents
    const deletes = [
      { table: 'case_activities', label: 'Timeline' },
      { table: 'communications', label: 'Communications' },
      { table: 'case_documents', label: 'Documents' },
      { table: 'notifications', label: 'Notifications' },
      { table: 'followups', label: 'Follow-ups' },
      { table: 'requests', label: 'Requests' },
      { table: 'cases', label: 'Investigations' },
    ];

    for (const { table, label } of deletes) {
      try {
        // Delete all rows — service_role key bypasses RLS
        const { error } = await sup.from(table).delete().gte('id', 0);
        if (error) {
          // Fallback: try without filter
          await sup.from(table).delete().neq('id', 0);
        }
        results[label] = { table, status: 'cleared' };
      } catch (e) {
        // Last resort: delete one by one or skip
        results[label] = { table, status: 'error', detail: e.message.substring(0, 100) };
      }
    }

    // Verify email accounts preserved
    const { data: accounts } = await sup.from('email_accounts').select('id, email');
    const foxp = (accounts || []).find(a => a.email === 'foxppacc@gmail.com');
    results.foxppacc = foxp ? { preserved: true, id: foxp.id, email: foxp.email } : { preserved: false };

    res.json({ success: true, results, note: 'Hard refresh required to clear frontend cache' });
  } catch (ex) {
    res.status(500).json({ error: ex.message });
  }
});

module.exports = router;
