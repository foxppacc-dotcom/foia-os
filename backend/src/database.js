const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'foia_os.db');

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db;

function getDatabase() {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initializeTables();
  return db;
}

function initializeTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      team_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS agencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name_ar TEXT,
      name_en TEXT NOT NULL,
      state TEXT,
      city TEXT,
      type TEXT,
      email TEXT,
      phone TEXT,
      portal_url TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'open',
      priority TEXT DEFAULT 'medium',
      client_name TEXT,
      agency_id INTEGER,
      user_id INTEGER,
      assigned_to INTEGER,
      deadline DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agency_id) REFERENCES agencies(id) ON DELETE SET NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS pipeline_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_number INTEGER NOT NULL UNIQUE,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      color TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      agency_id INTEGER,
      status TEXT DEFAULT 'pending',
      classification_id INTEGER,
      sent_date DATE,
      response_date DATE,
      notes TEXT,
      channel_method TEXT DEFAULT 'email',
      email_account_id INTEGER,
      contact_value TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
      FOREIGN KEY (agency_id) REFERENCES agencies(id) ON DELETE SET NULL,
      FOREIGN KEY (classification_id) REFERENCES pipeline_lists(id) ON DELETE SET NULL,
      FOREIGN KEY (email_account_id) REFERENCES email_accounts(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS communications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER,
      request_id INTEGER,
      email_account_id INTEGER,
      type TEXT CHECK(type IN ('email', 'phone', 'mail', 'portal', 'sms')) NOT NULL,
      direction TEXT CHECK(direction IN ('inbound', 'outbound')) NOT NULL,
      subject TEXT,
      body TEXT,
      sender TEXT,
      recipient TEXT,
      file_paths TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
      FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE SET NULL,
      FOREIGN KEY (email_account_id) REFERENCES email_accounts(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS case_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      file_path TEXT NOT NULL,
      ocr_text TEXT,
      ai_summary TEXT,
      uploaded_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS case_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'todo',
      priority TEXT DEFAULT 'medium',
      assigned_to INTEGER,
      due_date DATE,
      list_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
      FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (list_id) REFERENCES pipeline_lists(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS case_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      user_id INTEGER,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS labels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name_ar TEXT,
      name_en TEXT NOT NULL,
      color TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS case_labels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      label_id INTEGER NOT NULL,
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
      FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE,
      UNIQUE(case_id, label_id)
    );

    CREATE TABLE IF NOT EXISTS email_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      provider TEXT DEFAULT 'custom',
      smtp_host TEXT,
      smtp_port INTEGER DEFAULT 587,
      smtp_user TEXT,
      smtp_pass TEXT,
      imap_host TEXT,
      imap_port INTEGER DEFAULT 993,
      imap_user TEXT,
      imap_pass TEXT,
      daily_limit INTEGER DEFAULT 50,
      sent_today INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Phone call logs
    CREATE TABLE IF NOT EXISTS phone_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      direction TEXT CHECK(direction IN ('inbound', 'outbound')) NOT NULL DEFAULT 'inbound',
      caller_name TEXT,
      caller_number TEXT,
      duration_seconds INTEGER DEFAULT 0,
      summary TEXT,
      notes TEXT,
      recording_path TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    -- Physical mail tracking
    CREATE TABLE IF NOT EXISTS mail_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      direction TEXT CHECK(direction IN ('inbound', 'outbound')) NOT NULL DEFAULT 'inbound',
      mail_type TEXT CHECK(mail_type IN ('letter', 'package', 'document', 'other')) NOT NULL DEFAULT 'letter',
      tracking_number TEXT,
      courier TEXT,
      sender_name TEXT,
      recipient_name TEXT,
      sent_date DATE,
      received_date DATE,
      notes TEXT,
      scanned_path TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  // Automation tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS automations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      trigger_type TEXT CHECK(trigger_type IN ('event', 'schedule', 'ai')) NOT NULL DEFAULT 'schedule',
      trigger_config TEXT DEFAULT '{}',
      action_type TEXT NOT NULL,
      action_config TEXT DEFAULT '{}',
      is_active INTEGER DEFAULT 1,
      last_run TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS automation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      automation_id INTEGER,
      case_id INTEGER,
      status TEXT,
      result TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Portal credentials for online submission portals
    CREATE TABLE IF NOT EXISTS portal_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agency_id INTEGER,
      portal_name TEXT NOT NULL,
      portal_url TEXT,
      username TEXT NOT NULL,
      password_encrypted TEXT NOT NULL,
      registered_email TEXT,
      notes TEXT,
      last_used DATETIME,
      is_active INTEGER DEFAULT 1,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (agency_id) REFERENCES agencies(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    -- Case assignees (multiple team members per case)
    CREATE TABLE IF NOT EXISTS case_assignees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT DEFAULT 'member',
      assigned_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(case_id, user_id)
    );

    -- List assignees (team members per pipeline list)
    CREATE TABLE IF NOT EXISTS list_assignees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      assigned_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (list_id) REFERENCES pipeline_lists(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(list_id, user_id)
    );

    -- Production/QC queue
    CREATE TABLE IF NOT EXISTS production_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL UNIQUE,
      status TEXT CHECK(status IN ('pending', 'in_progress', 'completed', 'cancelled')) NOT NULL DEFAULT 'pending',
      assigned_to INTEGER,
      priority TEXT DEFAULT 'medium',
      notes TEXT,
      drive_folder_link TEXT,
      completed_at DATETIME,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
      FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
    );

    -- Activity log (audit trail)
    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_name TEXT,
      action_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER,
      target_title TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    -- System settings (theme, config, etc)
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Seed default settings
  const settingCount = db.prepare('SELECT COUNT(*) as c FROM system_settings').get().c;
  if (settingCount === 0) {
    db.prepare(`INSERT INTO system_settings (key, value) VALUES (?, ?)`).run('theme_mode', 'light');
    db.prepare(`INSERT INTO system_settings (key, value) VALUES (?, ?)`).run('theme_bg_primary', '#F8F9FA');
    db.prepare(`INSERT INTO system_settings (key, value) VALUES (?, ?)`).run('theme_bg_secondary', '#FFFFFF');
    db.prepare(`INSERT INTO system_settings (key, value) VALUES (?, ?)`).run('theme_bg_tertiary', '#F0F2F5');
    db.prepare(`INSERT INTO system_settings (key, value) VALUES (?, ?)`).run('theme_bg_elevated', '#E8EAED');
    db.prepare(`INSERT INTO system_settings (key, value) VALUES (?, ?)`).run('theme_border', '#DEE2E6');
    db.prepare(`INSERT INTO system_settings (key, value) VALUES (?, ?)`).run('theme_text_primary', '#1A1A2E');
    db.prepare(`INSERT INTO system_settings (key, value) VALUES (?, ?)`).run('theme_text_secondary', '#495057');
    db.prepare(`INSERT INTO system_settings (key, value) VALUES (?, ?)`).run('theme_text_muted', '#6C757D');
    db.prepare(`INSERT INTO system_settings (key, value) VALUES (?, ?)`).run('theme_accent', '#D4A843');
    db.prepare(`INSERT INTO system_settings (key, value) VALUES (?, ?)`).run('theme_accent_hover', '#e4b84a');
    db.prepare(`INSERT INTO system_settings (key, value) VALUES (?, ?)`).run('theme_danger', '#EF4444');
    db.prepare(`INSERT INTO system_settings (key, value) VALUES (?, ?)`).run('theme_success', '#10B981');
    db.prepare(`INSERT INTO system_settings (key, value) VALUES (?, ?)`).run('theme_warning', '#F59E0B');
    console.log('✅ 16 system settings seeded');
  }

  // Seed default automations
  const count = db.prepare('SELECT COUNT(*) as c FROM automations').get().c;
  if (count === 0) {
    db.prepare(`INSERT INTO automations (name, trigger_type, action_type, action_config) VALUES (?, 'schedule', ?, '{}')`).run('متابعة الطلبات المتأخرة', 'follow_up_overdue');
    db.prepare(`INSERT INTO automations (name, trigger_type, action_type, action_config) VALUES (?, 'schedule', ?, '{}')`).run('تصعيد القضايا الراكدة', 'escalate_stale_high');
    db.prepare(`INSERT INTO automations (name, trigger_type, action_type, action_config) VALUES (?, 'event', ?, '{}')`).run('تصنيف تلقائي للطلبات الجديدة', 'auto_classify');
    db.prepare(`INSERT INTO automations (name, trigger_type, action_type, action_config) VALUES (?, 'schedule', ?, '{}')`).run('تذكير بالمواعيد النهائية', 'deadline_reminder');
    db.prepare(`INSERT INTO automations (name, trigger_type, action_type, action_config) VALUES (?, 'event', ?, '{}')`).run('إغلاق القضايا المكتملة تلقائياً', 'auto_close_completed');
    console.log('✅ 5 automations seeded');
  }

  // Performance indexes
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
      CREATE INDEX IF NOT EXISTS idx_cases_priority ON cases(priority);
      CREATE INDEX IF NOT EXISTS idx_cases_created ON cases(created_at);
      CREATE INDEX IF NOT EXISTS idx_cases_deadline ON cases(deadline);
      CREATE INDEX IF NOT EXISTS idx_requests_case ON requests(case_id);
      CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
      CREATE INDEX IF NOT EXISTS idx_communications_case ON communications(case_id);
      CREATE INDEX IF NOT EXISTS idx_communications_created ON communications(created_at);
      CREATE INDEX IF NOT EXISTS idx_documents_case ON case_documents(case_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_case ON case_tasks(case_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_list ON case_tasks(list_id);
      CREATE INDEX IF NOT EXISTS idx_comments_case ON case_comments(case_id);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `);
  } catch(e) { /* indexes may already exist */ }
}

module.exports = { getDatabase };
