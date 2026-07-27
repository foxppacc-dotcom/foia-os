const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');

// GET /api/dashboard — stats
router.get('/dashboard', (req, res) => {
  try {
    const db = getDatabase();

    // Total cases
    const totalCases = db.prepare('SELECT COUNT(*) as count FROM cases').get();

    // Cases by status
    const byStatus = db.prepare(`
      SELECT status, COUNT(*) as count FROM cases GROUP BY status ORDER BY count DESC
    `).all();

    // Cases by priority
    const byPriority = db.prepare(`
      SELECT priority, COUNT(*) as count FROM cases GROUP BY priority ORDER BY count DESC
    `).all();

    // Recent activity — last 10 created cases
    const recentCases = db.prepare(`
      SELECT c.id, c.uuid, c.title, c.status, c.priority, c.created_at,
             a.name_en AS agency_name
      FROM cases c
      LEFT JOIN agencies a ON c.agency_id = a.id
      ORDER BY c.created_at DESC LIMIT 10
    `).all();

    // Recent communications
    const recentCommunications = db.prepare(`
      SELECT cm.*, c.title AS case_title
      FROM communications cm
      LEFT JOIN cases c ON cm.case_id = c.id
      ORDER BY cm.created_at DESC LIMIT 10
    `).all();

    // Upcoming deadlines — cases with deadlines in the next 30 days
    const upcomingDeadlines = db.prepare(`
      SELECT c.id, c.uuid, c.title, c.deadline, c.status, c.priority,
             a.name_en AS agency_name,
             u.name AS assigned_user_name,
             julianday(c.deadline) - julianday('now') AS days_remaining
      FROM cases c
      LEFT JOIN agencies a ON c.agency_id = a.id
      LEFT JOIN users u ON c.assigned_to = u.id
      WHERE c.deadline IS NOT NULL 
        AND c.deadline >= date('now')
        AND c.status != 'closed'
      ORDER BY c.deadline ASC LIMIT 10
    `).all();

    // Total agencies
    const totalAgencies = db.prepare('SELECT COUNT(*) as count FROM agencies').get();

    // Total open requests
    const totalRequests = db.prepare('SELECT COUNT(*) as count FROM requests').get();

    // Pipeline list counts
    const pipelineCounts = db.prepare(`
      SELECT pl.id, pl.name_ar, pl.name_en, pl.color, pl.list_number,
             (SELECT COUNT(*) FROM case_tasks ct WHERE ct.list_id = pl.id) AS task_count,
             (SELECT COUNT(*) FROM requests r WHERE r.classification_id = pl.id) AS request_count
      FROM pipeline_lists pl
      ORDER BY pl.list_number ASC
    `).all();

    res.json({
      totalCases: totalCases.count,
      byStatus,
      byPriority,
      recentCases,
      recentCommunications,
      upcomingDeadlines,
      totalAgencies: totalAgencies.count,
      totalRequests: totalRequests.count,
      pipelineCounts
    });
  } catch (err) {
    console.error('Error getting dashboard:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
