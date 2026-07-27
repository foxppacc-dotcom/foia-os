const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');

// GET /api/pipeline — returns all 7 lists with their tasks grouped
router.get('/pipeline', (req, res) => {
  try {
    const db = getDatabase();
    const { caseId } = req.query;

    const lists = db.prepare('SELECT * FROM pipeline_lists ORDER BY list_number ASC').all();

    let tasksQuery;
    let tasksParams;

    if (caseId) {
      tasksQuery = `SELECT ct.*, pl.name_ar AS list_name_ar, pl.name_en AS list_name_en, 
                     pl.color AS list_color, u.name AS assigned_user_name
                    FROM case_tasks ct
                    LEFT JOIN pipeline_lists pl ON ct.list_id = pl.id
                    LEFT JOIN users u ON ct.assigned_to = u.id
                    WHERE ct.case_id = ?
                    ORDER BY ct.created_at DESC`;
      tasksParams = [parseInt(caseId)];
    } else {
      tasksQuery = `SELECT ct.*, pl.name_ar AS list_name_ar, pl.name_en AS list_name_en, 
                     pl.color AS list_color, u.name AS assigned_user_name,
                     c.title AS case_title, c.uuid AS case_uuid
                    FROM case_tasks ct
                    LEFT JOIN pipeline_lists pl ON ct.list_id = pl.id
                    LEFT JOIN users u ON ct.assigned_to = u.id
                    LEFT JOIN cases c ON ct.case_id = c.id
                    ORDER BY ct.created_at DESC`;
      tasksParams = [];
    }

    const allTasks = db.prepare(tasksQuery).all(...tasksParams);

    // Also get requests grouped by classification
    const requestsQuery = caseId
      ? `SELECT r.*, pl.name_ar AS classification_name_ar, pl.name_en AS classification_name_en, 
         pl.color AS classification_color, a.name_en AS agency_name
         FROM requests r
         LEFT JOIN pipeline_lists pl ON r.classification_id = pl.id
         LEFT JOIN agencies a ON r.agency_id = a.id
         WHERE r.case_id = ?
         ORDER BY r.created_at DESC`
      : `SELECT r.*, pl.name_ar AS classification_name_ar, pl.name_en AS classification_name_en, 
         pl.color AS classification_color, a.name_en AS agency_name,
         c.title AS case_title
         FROM requests r
         LEFT JOIN pipeline_lists pl ON r.classification_id = pl.id
         LEFT JOIN agencies a ON r.agency_id = a.id
         LEFT JOIN cases c ON r.case_id = c.id
         ORDER BY r.created_at DESC`;

    const requestsParams = caseId ? [parseInt(caseId)] : [];
    const allRequests = db.prepare(requestsQuery).all(...requestsParams);

    // Group by lists
    const pipeline = lists.map(list => {
      const tasks = allTasks.filter(t => t.list_id === list.id);
      const items = allRequests.filter(r => r.classification_id === list.id);
      return {
        ...list,
        tasks,
        requests: items,
        count: tasks.length + items.length
      };
    });

    res.json(pipeline);
  } catch (err) {
    console.error('Error getting pipeline:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/pipeline/tasks/:id — update task's list_id (drag-drop)
router.put('/pipeline/tasks/:id', (req, res) => {
  try {
    const db = getDatabase();
    const taskId = parseInt(req.params.id);
    const { list_id } = req.body;

    if (!list_id) {
      return res.status(400).json({ error: 'list_id is required' });
    }

    const existing = db.prepare('SELECT * FROM case_tasks WHERE id = ?').get(taskId);
    if (!existing) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const list = db.prepare('SELECT id FROM pipeline_lists WHERE id = ?').get(list_id);
    if (!list) {
      return res.status(400).json({ error: 'Invalid list_id' });
    }

    db.prepare('UPDATE case_tasks SET list_id = ? WHERE id = ?').run(list_id, taskId);

    const updated = db.prepare(`
      SELECT ct.*, pl.name_ar AS list_name_ar, pl.name_en AS list_name_en, pl.color AS list_color
      FROM case_tasks ct
      LEFT JOIN pipeline_lists pl ON ct.list_id = pl.id
      WHERE ct.id = ?
    `).get(taskId);

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
