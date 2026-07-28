-- FOIA OS — Full Schema Migration for Supabase
-- Run this in Supabase SQL Editor

-- 1. Teams
CREATE TABLE IF NOT EXISTS teams (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Users
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'member' CHECK (role IN ('admin', 'manager', 'member')),
  team_id BIGINT REFERENCES teams(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Agencies
CREATE TABLE IF NOT EXISTS agencies (
  id BIGSERIAL PRIMARY KEY,
  name_ar TEXT,
  name_en TEXT NOT NULL,
  state TEXT,
  city TEXT,
  type TEXT,
  email TEXT,
  phone TEXT,
  portal_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Cases
CREATE TABLE IF NOT EXISTS cases (
  id BIGSERIAL PRIMARY KEY,
  uuid TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'open',
  priority TEXT DEFAULT 'medium',
  client_name TEXT,
  assigned_to BIGINT REFERENCES users(id) ON DELETE SET NULL,
  deadline DATE,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Pipeline Lists
CREATE TABLE IF NOT EXISTS pipeline_lists (
  id BIGSERIAL PRIMARY KEY,
  list_number INTEGER NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  color TEXT NOT NULL
);

-- 6. Requests
CREATE TABLE IF NOT EXISTS requests (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  agency_id BIGINT REFERENCES agencies(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'pending',
  classification_id BIGINT REFERENCES pipeline_lists(id) ON DELETE SET NULL,
  sent_date DATE,
  response_date DATE,
  notes TEXT,
  channel_method TEXT DEFAULT 'email',
  email_account_id BIGINT,
  contact_value TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Communications
CREATE TABLE IF NOT EXISTS communications (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT REFERENCES cases(id) ON DELETE CASCADE,
  request_id BIGINT REFERENCES requests(id) ON DELETE SET NULL,
  email_account_id BIGINT,
  type TEXT CHECK (type IN ('email', 'phone', 'mail', 'portal', 'sms')) NOT NULL,
  direction TEXT CHECK (direction IN ('inbound', 'outbound')) NOT NULL,
  subject TEXT,
  body TEXT,
  sender TEXT,
  recipient TEXT,
  file_paths TEXT,
  metadata TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Case Documents
CREATE TABLE IF NOT EXISTS case_documents (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT,
  size BIGINT,
  file_path TEXT NOT NULL,
  ocr_text TEXT,
  ai_summary TEXT,
  uploaded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Case Tasks
CREATE TABLE IF NOT EXISTS case_tasks (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'todo',
  priority TEXT DEFAULT 'medium',
  assigned_to BIGINT REFERENCES users(id) ON DELETE SET NULL,
  due_date DATE,
  list_id BIGINT REFERENCES pipeline_lists(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Case Comments
CREATE TABLE IF NOT EXISTS case_comments (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. Phone Logs
CREATE TABLE IF NOT EXISTS phone_logs (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  direction TEXT CHECK (direction IN ('inbound', 'outbound')) NOT NULL DEFAULT 'inbound',
  caller_name TEXT,
  caller_number TEXT,
  duration_seconds INTEGER DEFAULT 0,
  summary TEXT,
  notes TEXT,
  recording_path TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. Mail Logs
CREATE TABLE IF NOT EXISTS mail_logs (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  direction TEXT CHECK (direction IN ('inbound', 'outbound')) NOT NULL DEFAULT 'inbound',
  mail_type TEXT CHECK (mail_type IN ('letter', 'package', 'document', 'other')) NOT NULL DEFAULT 'letter',
  tracking_number TEXT,
  courier TEXT,
  sender_name TEXT,
  recipient_name TEXT,
  sent_date DATE,
  received_date DATE,
  notes TEXT,
  scanned_path TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. Specialties
CREATE TABLE IF NOT EXISTS specialties (
  id BIGSERIAL PRIMARY KEY,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  icon TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. User Specialties
CREATE TABLE IF NOT EXISTS user_specialties (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  specialty_id BIGINT NOT NULL REFERENCES specialties(id) ON DELETE CASCADE,
  UNIQUE(user_id, specialty_id)
);

-- 15. Case Assignees
CREATE TABLE IF NOT EXISTS case_assignees (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member',
  specialty_id BIGINT REFERENCES specialties(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(case_id, user_id)
);

-- 16. List Assignees
CREATE TABLE IF NOT EXISTS list_assignees (
  id BIGSERIAL PRIMARY KEY,
  list_id BIGINT NOT NULL REFERENCES pipeline_lists(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(list_id, user_id)
);

-- 17. Activity Logs
CREATE TABLE IF NOT EXISTS activity_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  user_name TEXT,
  action_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id BIGINT,
  target_title TEXT,
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 18. System Settings
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 19. Email Accounts
CREATE TABLE IF NOT EXISTS email_accounts (
  id BIGSERIAL PRIMARY KEY,
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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 20. Production Queue
CREATE TABLE IF NOT EXISTS production_queue (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL UNIQUE REFERENCES cases(id) ON DELETE CASCADE,
  status TEXT CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')) NOT NULL DEFAULT 'pending',
  assigned_to BIGINT REFERENCES users(id) ON DELETE SET NULL,
  priority TEXT DEFAULT 'medium',
  notes TEXT,
  drive_folder_link TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 21. Indexes
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_priority ON cases(priority);
CREATE INDEX IF NOT EXISTS idx_cases_created ON cases(created_at);
CREATE INDEX IF NOT EXISTS idx_requests_case ON requests(case_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_comments_case ON case_comments(case_id);

-- ========== SEED DATA ==========

-- Seed default admin user (password: admin123)
INSERT INTO users (name, email, password_hash, role)
VALUES ('مدير النظام', 'admin@foia.com', '$2a$10$dummyhash_admin_placeholder', 'admin')
ON CONFLICT (email) DO NOTHING;

-- Seed 7 pipeline lists
INSERT INTO pipeline_lists (list_number, name_ar, name_en, color) VALUES
  (1, 'تم استلام السجلات', 'Records Received', '#10B981'),
  (2, 'محتاج تأكيد مواطنة', 'Citizenship Needed', '#EC4899'),
  (3, 'مطلوب دفع', 'Payment Required', '#F59E0B'),
  (4, 'مفيش سجلات متوفرة', 'No Records Available', '#6B7280'),
  (5, 'تم الرفض بموجب القانون', 'Denied by Law', '#EF4444'),
  (6, 'القضية مفتوحة في المحكمة', 'Case Pending in Court', '#8B5CF6'),
  (7, 'الوكالة لا تستخدم البودي كام', 'Agency Has No Bodycams', '#F97316')
ON CONFLICT (list_number) DO NOTHING;

-- Seed 3 specialties
INSERT INTO specialties (name_ar, name_en, icon) VALUES
  ('مسؤول استلام سجلات بالبريد', 'Mail Records Receiver', '📥'),
  ('مسؤول دفع بالبريد', 'Mail Payment Officer', '💰'),
  ('مسؤول تأكيد مواطنة', 'Citizenship Verifier', '🆔')
ON CONFLICT DO NOTHING;

-- Seed default system settings
INSERT INTO system_settings (key, value) VALUES
  ('theme_mode', 'light'),
  ('theme_bg_primary', '#F8F9FA'),
  ('theme_bg_secondary', '#FFFFFF'),
  ('theme_bg_tertiary', '#F0F2F5'),
  ('theme_bg_elevated', '#E8EAED'),
  ('theme_border', '#DEE2E6'),
  ('theme_text_primary', '#1A1A2E'),
  ('theme_text_secondary', '#495057'),
  ('theme_text_muted', '#6C757D'),
  ('theme_accent', '#D4A843'),
  ('theme_accent_hover', '#e4b84a'),
  ('theme_danger', '#EF4444'),
  ('theme_success', '#10B981'),
  ('theme_warning', '#F59E0B')
ON CONFLICT (key) DO NOTHING;
