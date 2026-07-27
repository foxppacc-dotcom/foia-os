const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');

const dbPath = path.join(__dirname, 'data', 'foia_os.db');
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, role TEXT DEFAULT 'member', team_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS agencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name_ar TEXT, name_en TEXT NOT NULL,
    state TEXT, city TEXT, type TEXT, email TEXT, phone TEXT, portal_url TEXT, notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS pipeline_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT, list_number INTEGER NOT NULL UNIQUE,
    name_ar TEXT NOT NULL, name_en TEXT NOT NULL, color TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL, description TEXT, status TEXT DEFAULT 'open',
    priority TEXT DEFAULT 'medium', client_name TEXT,
    created_by INTEGER, assigned_to INTEGER, deadline DATE,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL,
    agency_id INTEGER, status TEXT DEFAULT 'pending', classification_id INTEGER,
    sent_date DATE, response_date DATE, notes TEXT, channel TEXT DEFAULT 'email',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id) REFERENCES agencies(id) ON DELETE SET NULL,
    FOREIGN KEY (classification_id) REFERENCES pipeline_lists(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS communications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER, request_id INTEGER,
    type TEXT CHECK(type IN ('email','phone','mail','portal','sms')) NOT NULL,
    direction TEXT CHECK(direction IN ('inbound','outbound')) NOT NULL,
    subject TEXT, body TEXT, sender TEXT, recipient TEXT, file_paths TEXT, metadata TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
    FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS case_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL,
    filename TEXT NOT NULL, original_name TEXT NOT NULL, mime_type TEXT,
    size INTEGER, file_path TEXT, uploaded_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS case_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL,
    user_id INTEGER, content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS phone_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL,
    direction TEXT CHECK(direction IN ('inbound','outbound')) NOT NULL,
    caller_name TEXT, caller_number TEXT, duration_seconds INTEGER DEFAULT 0,
    summary TEXT, notes TEXT, recording_path TEXT, created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS mail_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL,
    direction TEXT CHECK(direction IN ('inbound','outbound')) NOT NULL,
    mail_type TEXT CHECK(mail_type IN ('letter','package','document','other')) NOT NULL DEFAULT 'letter',
    tracking_number TEXT, courier TEXT, sender_name TEXT, recipient_name TEXT,
    sent_date DATE, received_date DATE, notes TEXT, scanned_path TEXT, created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS email_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, name TEXT NOT NULL,
    provider TEXT DEFAULT 'custom', smtp_host TEXT, smtp_port INTEGER DEFAULT 587,
    smtp_user TEXT, smtp_pass TEXT, imap_host TEXT, imap_port INTEGER DEFAULT 993,
    imap_user TEXT, imap_pass TEXT, daily_limit INTEGER DEFAULT 50,
    sent_today INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS portal_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT, agency_id INTEGER,
    portal_name TEXT NOT NULL, portal_url TEXT, username TEXT NOT NULL,
    password_encrypted TEXT NOT NULL, registered_email TEXT, notes TEXT,
    last_used TEXT, is_active INTEGER DEFAULT 1, created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (agency_id) REFERENCES agencies(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS production_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL UNIQUE,
    status TEXT CHECK(status IN ('pending','in_progress','completed','cancelled')) NOT NULL DEFAULT 'pending',
    assigned_to INTEGER, priority TEXT DEFAULT 'medium', notes TEXT,
    drive_folder_link TEXT, completed_at TEXT, created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// Clear existing data
db.exec('DELETE FROM pipeline_lists; DELETE FROM users; DELETE FROM system_settings');
db.exec('DELETE FROM agencies; DELETE FROM cases; DELETE FROM requests; DELETE FROM communications');
db.exec('DELETE FROM case_documents; DELETE FROM case_comments; DELETE FROM phone_logs');
db.exec('DELETE FROM mail_logs; DELETE FROM email_accounts; DELETE FROM portal_credentials');
db.exec('DELETE FROM production_queue; DELETE FROM teams');

// Seed 7 Pipeline Lists (NO كلمة "لسته")
const insertList = db.prepare('INSERT INTO pipeline_lists (list_number, name_ar, name_en, color) VALUES (?, ?, ?, ?)');
const pipelines = [
  [1, 'تم استلام السجلات', 'Records Received', '#10B981'],
  [2, 'مطلوب دفع', 'Payment Required', '#F59E0B'],
  [3, 'مفيش سجلات متوفرة', 'No Records Available', '#6B7280'],
  [4, 'تم الرفض بموجب القانون', 'Denied by Law', '#EF4444'],
  [5, 'القضية مفتوحة في المحكمة', 'Case Pending in Court', '#8B5CF6'],
  [6, 'الوكالة لا تستخدم البودي كام', 'Agency Has No Bodycams', '#F97316'],
  [7, 'محتاج تأكيد مواطنة', 'Citizenship Needed', '#EC4899'],
];
for (const p of pipelines) insertList.run(...p);
console.log('✅ 7 pipeline lists seeded');

// Seed Admin user
const hash = bcrypt.hashSync('admin123', 10);
db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run('Admin', 'admin@foia.com', hash, 'admin');
console.log('✅ Admin user: admin@foia.com / admin123');

// Seed Settings
const insertSetting = db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?)');
const defaults = {
  theme_mode: 'light', theme_bg_primary: '#F8F9FA', theme_bg_secondary: '#FFFFFF',
  theme_bg_tertiary: '#F0F2F5', theme_bg_elevated: '#E8EAED', theme_border: '#DEE2E6',
  theme_text_primary: '#1A1A2E', theme_text_secondary: '#495057', theme_text_muted: '#6C757D',
  theme_accent: '#D4A843', theme_accent_hover: '#e4b84a', theme_danger: '#EF4444',
  theme_success: '#10B981', theme_warning: '#F59E0B',
};
for (const [k, v] of Object.entries(defaults)) insertSetting.run(k, v);
console.log('✅', Object.keys(defaults).length, 'settings seeded');

console.log('\n🎉 Seed complete!');
db.close();
