const { getSupabase } = require('../supabase');

/**
 * Activity Logger — تسجيل كل حركة في السستم
 */
async function logActivity({ user_id, user_name, action_type, target_type, target_id, target_title, details }) {
  try {
    const sup = getSupabase();
    await sup.from('activity_logs').insert({
      user_id: user_id || null,
      user_name: user_name || 'System',
      action_type,
      target_type,
      target_id: target_id || null,
      target_title: target_title ? String(target_title).substring(0, 200) : null,
      details: details ? String(details).substring(0, 500) : null,
    });
  } catch (e) {
    console.error('Activity log error:', e.message);
  }
}

/**
 * Get recent activity
 */
async function getRecentActivity(limit = 50, targetType = null, targetId = null) {
  const sup = getSupabase();
  let query = sup.from('activity_logs').select('*');
  if (targetType) query = query.eq('target_type', targetType);
  if (targetId) query = query.eq('target_id', targetId);
  query = query.order('created_at', { ascending: false }).limit(limit);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

module.exports = { logActivity, getRecentActivity };
