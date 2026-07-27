const { getDatabase } = require('../database');

/**
 * Activity Logger — تسجيل كل حركة في السستم
 */
function logActivity({ user_id, user_name, action_type, target_type, target_id, target_title, details }) {
  try {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO activity_logs (user_id, user_name, action_type, target_type, target_id, target_title, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      user_id || null,
      user_name || 'System',
      action_type,
      target_type,
      target_id || null,
      target_title ? String(target_title).substring(0, 200) : null,
      details ? String(details).substring(0, 500) : null
    );
  } catch (e) {
    console.error('Activity log error:', e.message);
  }
}

/**
 * Get recent activity
 */
function getRecentActivity(limit = 50, targetType = null, targetId = null) {
  const db = getDatabase();
  let sql = 'SELECT * FROM activity_logs WHERE 1=1';
  const params = [];

  if (targetType) { sql += ' AND target_type = ?'; params.push(targetType); }
  if (targetId) { sql += ' AND target_id = ?'; params.push(targetId); }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params);
}

module.exports = { logActivity, getRecentActivity };
