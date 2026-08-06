// Single shared source of nav item metadata (path/label/icon/roles) used by
// both Sidebar.jsx (renders items whose nav-layout location is 'sidebar')
// and Settings.jsx's sidebar-layout tab (renders quick links for items set
// to location 'settings', plus labels for reordering). nav_key here must
// match backend/src/routes/permissions.js's NAV_ITEMS keys exactly -- those
// drive per-role visibility, this drives path/label/icon/order/placement.
import {
  FolderOpen, LayoutDashboard, GitBranch, Building2, Sparkles, Users, Mail,
  Timer, Key, Cloud, UserCog, Phone, MailPlus, AtSign, ListChecks, Palette,
} from 'lucide-react';

export const NAV_CATALOG = [
  { key: 'dashboard', path: '/', label: 'لوحة التحكم', icon: LayoutDashboard, roles: ['admin', 'manager', 'member', 'viewer'], end: true },
  { key: 'intake', path: '/intake', label: 'استقبال ذكي', icon: Sparkles, roles: ['admin', 'manager', 'member'] },
  { key: 'cases', path: '/cases', label: 'القضايا', icon: FolderOpen, roles: ['admin', 'manager', 'member'] },
  { key: 'pipeline', path: '/pipeline', label: 'خط الإنتاج', icon: GitBranch, roles: ['admin', 'manager', 'member'] },
  { key: 'production', path: '/production', label: 'مونتاج', icon: Timer, roles: ['admin', 'manager', 'member'] },
  { key: 'agencies', path: '/agencies', label: 'الجهات', icon: Building2, roles: ['admin', 'manager', 'member'] },
  { key: 'portals', path: '/portals', label: 'بوابات', icon: Key, roles: ['admin', 'manager'] },
  { key: 'inbox', path: '/inbox', label: 'صندوق الوارد', icon: Mail, roles: ['admin', 'manager', 'member'] },
  { key: 'email_accounts', path: '/email-accounts', label: 'إيميلات', icon: AtSign, roles: ['admin', 'manager', 'member'] },
  { key: 'teams', path: '/teams', label: 'الفرق', icon: Users, roles: ['admin'] },
  { key: 'permissions', path: '/permissions', label: 'فريق العمل', icon: UserCog, roles: ['admin', 'manager'] },
  { key: 'gdrive', path: '/gdrive', label: 'Google Drive', icon: Cloud, roles: ['admin', 'manager', 'member'] },
  { key: 'phone_logs', path: '/phone-logs', label: 'سجل المكالمات', icon: Phone, roles: ['admin', 'manager', 'member'] },
  { key: 'mail_logs', path: '/mail-logs', label: 'البريد الفعلي', icon: MailPlus, roles: ['admin', 'manager', 'member'] },
  { key: 'production_lists', path: '/production-lists', label: 'إدارة قوائم الإنتاج', icon: ListChecks, roles: ['admin', 'manager'] },
  { key: 'theme_settings', path: '/theme-settings', label: 'الألوان والثيم', icon: Palette, roles: ['admin', 'manager'] },
];

export const getNavItem = (key) => NAV_CATALOG.find(i => i.key === key);
