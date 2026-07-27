const Database = require('better-sqlite3');
const db = new Database('data/foia_os.db');

// أمسح الـ requests اللي classification_id = null و case_id > 14
db.prepare("DELETE FROM requests WHERE classification_id IS NULL AND case_id > 14").run();
console.log('Cleared unclassified requests for new cases');

// جيب القضايا الجديدة
const cases = db.prepare('SELECT id, title, priority FROM cases WHERE id > 14 ORDER BY id').all();
console.log('Cases to process:', cases.length);

// قوائم التصنيف
const lists = db.prepare('SELECT id, list_number, name_ar FROM pipeline_lists WHERE id BETWEEN 1 AND 7 ORDER BY list_number').all();
console.log('Lists:', lists.map(l => l.id + '=' + l.name_ar).join(', '));

// Agencies لكل قضية
const agencyMap = {
  15: [1, 22, 23],
  16: [1, 2, 9],
  17: [21],
  18: [22],
  19: [6],
  20: [3],
  21: [23],
  22: [7],
  23: [9],
  24: [10],
  25: [2],
  26: [4],
  27: [12, 21],
  28: [14],
  29: [11],
  30: [16],
  31: [5],
  32: [13]
};

const insertRequest = db.prepare('INSERT INTO requests (case_id, agency_id, classification_id, status, sort_order, notes) VALUES (?, ?, ?, ?, ?, ?)');
const logActivity = db.prepare('INSERT INTO activity_logs (user_id, user_name, action_type, target_type, target_id, target_title, details) VALUES (?, ?, ?, ?, ?, ?, ?)');

let total = 0;
for (const c of cases) {
  const agencies = agencyMap[c.id] || [1];
  const listIdx = (c.id - 15) % lists.length;
  const listId = lists[listIdx].id;
  const listName = lists[listIdx].name_ar;

  for (const agencyId of agencies) {
    const sortOrder = agencies.length - agencies.indexOf(agencyId);
    insertRequest.run(c.id, agencyId, listId, 'classified', sortOrder, 'Auto-classified for demo');
    total++;
  }

  logActivity.run(1, 'System', 'auto_classify', 'case', c.id, c.title, 'تم تصنيف القضية تلقائياً في: ' + listName);
}

console.log('Created', total, 'requests with classifications');

// Verify
const ver = db.prepare('SELECT l.name_ar, COUNT(*) as c FROM requests r JOIN pipeline_lists l ON r.classification_id = l.id GROUP BY l.id ORDER BY l.list_number').all();
ver.forEach(v => console.log('  ' + v.name_ar + ': ' + v.c + ' cards'));
db.close();
