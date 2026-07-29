const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getSupabase } = require('../supabase');
const storage = require('../services/storage');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.csv'].includes(ext)) cb(null, true);
    else cb(new Error('يرجى رفع ملف Excel (.xlsx, .xls) أو CSV'));
  }
});

// POST /api/agencies/upload — رفع Excel بالجهات
router.post('/agencies/upload', requireAuth, requireRole('admin'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف' });

    const workbook = XLSX.read(req.file.buffer);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

    if (data.length === 0) {
      return res.json({ success: true, imported: 0, message: 'الملف فارغ' });
    }

    const sup = getSupabase();

    const colMap = {};
    const sample = data[0];
    for (const key of Object.keys(sample)) {
      const k = key.toLowerCase().trim();
      if (k === 'name_en' || k === 'english name' || k === 'agency' || k === 'agency name' || k === 'name') colMap.name_en = key;
      else if (k === 'name_ar' || k === 'arabic name' || k === 'الاسم' || k === 'اسم الجهة' || k === 'اسم') colMap.name_ar = key;
      else if (k === 'state' || k === 'الولاية' || k === 'ولاية') colMap.state = key;
      else if (k === 'city' || k === 'المدينة' || k === 'مدينة') colMap.city = key;
      else if (k === 'type' || k === 'النوع') colMap.type = key;
      else if (k === 'email' || k === 'ايميل' || k === 'بريد' || k === 'البريد') colMap.email = key;
      else if (k === 'phone' || k === 'هاتف' || k === 'تلفون' || k === 'رقم') colMap.phone = key;
      else if (k === 'portal_url' || k === 'portal' || k === 'بوابة' || k === 'رابط') colMap.portal_url = key;
      else if (k === 'notes' || k === 'ملاحظات') colMap.notes = key;
    }

    if (!colMap.name_en) {
      return res.status(400).json({ error: 'لم يتم العثور على عمود اسم الجهة (name_en). الأعمدة المتاحة: ' + Object.keys(sample).join(', ') });
    }

    let imported = 0;
    for (const row of data) {
      const name_en = String(row[colMap.name_en] || '').trim();
      if (!name_en) continue;

      const { data: exists } = await sup.from('agencies').select('id').eq('name_en', name_en).maybeSingle();
      if (exists) continue;

      await sup.from('agencies').insert({
        name_ar: row[colMap.name_ar] ? String(row[colMap.name_ar]).trim() : null,
        name_en,
        state: row[colMap.state] ? String(row[colMap.state]).trim() : null,
        city: row[colMap.city] ? String(row[colMap.city]).trim() : null,
        type: row[colMap.type] ? String(row[colMap.type]).trim() : null,
        email: row[colMap.email] ? String(row[colMap.email]).trim() : null,
        phone: row[colMap.phone] ? String(row[colMap.phone]).trim() : null,
        portal_url: row[colMap.portal_url] ? String(row[colMap.portal_url]).trim() : null,
        notes: row[colMap.notes] ? String(row[colMap.notes]).trim() : null
      });
      imported++;
    }

    // Upload to Supabase Storage for record-keeping (non-blocking)
    try {
      await storage.uploadFromRequest(req.file, 'agency-files', 'imports');
    } catch (uploadErr) {
      console.warn('Agency file storage upload warning:', uploadErr.message);
    }

    res.json({
      success: true,
      imported,
      total_rows: data.length,
      message: `تم استيراد ${imported} جهة من ${data.length}`
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message || 'فشل رفع الملف' });
  }
});

// GET /api/agencies — قائمة الجهات (بحث + فلترة + صفحات)
router.get('/agencies', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const { search, type, status, page = 1, limit = 100 } = req.query;

  let query = sup.from('agencies').select('*', { count: 'exact' });

  if (search) {
    query = query.or(`name_ar.ilike.%${search}%,name_en.ilike.%${search}%,state.ilike.%${search}%,city.ilike.%${search}%`);
  }
  if (type) query = query.eq('type', type);
  if (status === 'active') query = query.eq('is_active', true);
  else if (status === 'inactive') query = query.eq('is_active', false);

  query = query.order('name_en', { ascending: true })
    .range((parseInt(page) - 1) * parseInt(limit), parseInt(page) * parseInt(limit) - 1);

  const { data: agencies, count: total } = await query;

  // Attach contact counts from notes JSON
  let withCounts = agencies || [];
  withCounts = withCounts.map(a => {
    let contacts = [];
    try { if (a.notes) { const parsed = JSON.parse(a.notes); if (parsed._contacts) contacts = parsed._contacts; } } catch {}
    return { ...a, contacts, contacts_count: contacts.length };
  });

  res.json({ success: true, data: withCounts, total: total || 0, page: parseInt(page), limit: parseInt(limit) });
});

// GET /api/agencies/:id — تفاصيل جهة كاملة (بيانات + جهات اتصال من notes JSON)
router.get('/agencies/:id', requireAuth, async (req, res) => {
  const sup = getSupabase();
  const id = parseInt(req.params.id);
  const { data: agency } = await sup.from('agencies').select('*').eq('id', id).single();
  if (!agency) return res.status(404).json({ error: 'Agency not found' });

  // Parse contacts from notes._contacts JSON
  let contacts = [];
  try { if (agency.notes) { const parsed = JSON.parse(agency.notes); if (parsed._contacts) contacts = parsed._contacts; } } catch {}

  const [{ data: emailAccounts }] = await Promise.all([
    sup.from('email_accounts').select('id, email, name').eq('is_active', true).then(r => r.error ? { data: [] } : r),
  ]);

  res.json({ ...agency, contacts, available_email_accounts: emailAccounts || [] });
});

// POST /api/agencies — إضافة جهة يدوية
router.post('/agencies', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  const sup = getSupabase();
  const { name_ar, name_en, state, city, type, email, phone, portal_url, notes, address, reply_to, default_email_account_id, website, tracking_portal_url } = req.body;
  if (!name_en) return res.status(400).json({ error: 'name_en (English name) مطلوب' });

  const { data: existing } = await sup.from('agencies').select('id').eq('name_en', name_en).maybeSingle();
  if (existing) return res.status(409).json({ error: 'هذه الجهة موجودة مسبقاً' });

  const insertData = {
    name_ar: name_ar || null, name_en,
    state: state || null, city: city || null, type: type || null,
    email: email || null, phone: phone || null, portal_url: portal_url || null, notes: notes || null,
  };
  // Optional columns — insert only if the migration adding them has run
  if (address !== undefined) insertData.address = address || null;
  if (reply_to !== undefined) insertData.reply_to = reply_to || null;
  if (default_email_account_id !== undefined) insertData.default_email_account_id = default_email_account_id || null;
  if (website !== undefined) insertData.website = website || null;
  if (tracking_portal_url !== undefined) insertData.tracking_portal_url = tracking_portal_url || null;

  let { data: created, error } = await sup.from('agencies').insert(insertData).select().single();
  while (error && /column .* does not exist|Could not find the '(\w+)' column/.test(error.message)) {
    const m = error.message.match(/'(\w+)' column|column "(\w+)"/);
    const badCol = m && (m[1] || m[2]);
    if (!badCol || !(badCol in insertData)) break;
    delete insertData[badCol];
    ({ data: created, error } = await sup.from('agencies').insert(insertData).select().single());
  }
  if (error) throw error;

  res.status(201).json({ success: true, id: created.id });
});

// PUT /api/agencies/:id — تحديث بيانات الجهة (بما فيها التفعيل/التعطيل وإعدادات الإرسال)
router.put('/agencies/:id', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  const sup = getSupabase();
  const id = parseInt(req.params.id);

  const { data: existing } = await sup.from('agencies').select('id').eq('id', id).single();
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const { name_ar, name_en, state, city, type, email, phone, portal_url, notes, address, is_active, reply_to, default_email_account_id, website, tracking_portal_url } = req.body;

  const updates = {};
  if (name_ar !== undefined) updates.name_ar = name_ar;
  if (name_en !== undefined) updates.name_en = name_en;
  if (state !== undefined) updates.state = state;
  if (city !== undefined) updates.city = city;
  if (type !== undefined) updates.type = type;
  if (email !== undefined) updates.email = email;
  if (phone !== undefined) updates.phone = phone;
  if (portal_url !== undefined) updates.portal_url = portal_url;
  if (notes !== undefined) updates.notes = notes;
  if (address !== undefined) updates.address = address;
  if (is_active !== undefined) updates.is_active = !!is_active;
  if (reply_to !== undefined) updates.reply_to = reply_to;
  if (default_email_account_id !== undefined) updates.default_email_account_id = default_email_account_id || null;
  if (website !== undefined) updates.website = website || null;
  if (tracking_portal_url !== undefined) updates.tracking_portal_url = tracking_portal_url || null;

  let { error } = await sup.from('agencies').update(updates).eq('id', id);
  let skipped = [];
  // If the migration adding address/is_active/reply_to/default_email_account_id hasn't
  // run yet, retry with just those columns stripped instead of failing the whole save —
  // mirrors the same fallback already used in POST /agencies above.
  while (error && /column .* does not exist|Could not find the '(\w+)' column/.test(error.message)) {
    const m = error.message.match(/'(\w+)' column|column "(\w+)"/);
    const badCol = m && (m[1] || m[2]);
    if (!badCol || !(badCol in updates)) break;
    delete updates[badCol];
    skipped.push(badCol);
    ({ error } = await sup.from('agencies').update(updates).eq('id', id));
  }
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, skipped: skipped.length ? skipped : undefined });
});

// DELETE /api/agencies/:id
router.delete('/agencies/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const sup = getSupabase();
  await sup.from('agencies').delete().eq('id', parseInt(req.params.id));
  res.json({ success: true });
});

// ===== BULK ACTIONS =====

// POST /api/agencies/bulk/status — تفعيل/تعطيل جماعي
router.post('/agencies/bulk/status', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  const { ids, is_active } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids مطلوبة' });
  const sup = getSupabase();
  const { error } = await sup.from('agencies').update({ is_active: !!is_active }).in('id', ids);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, updated: ids.length });
});

// POST /api/agencies/bulk/delete — حذف جماعي
router.post('/agencies/bulk/delete', requireAuth, requireRole('admin'), async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids مطلوبة' });
  const sup = getSupabase();
  const { error } = await sup.from('agencies').delete().in('id', ids);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, deleted: ids.length });
});

// ===== CONTACTS =====

// POST /api/agencies/:id/contacts — add contact (stored in agencies.notes JSON)
router.post('/agencies/:id/contacts', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  const sup = getSupabase();
  const agency_id = parseInt(req.params.id);
  const { name, title, phone, email, notes, extension, department, preferred_contact } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم جهة الاتصال مطلوب' });

  // Get current agency
  const { data: agency } = await sup.from('agencies').select('notes').eq('id', agency_id).maybeSingle();
  if (!agency) return res.status(404).json({ error: 'Agency not found' });

  // Parse existing contacts from notes JSON
  let parsed = {};
  try { if (agency.notes) parsed = JSON.parse(agency.notes); } catch {}
  const contacts = parsed._contacts || [];

  // Generate new ID
  const newId = contacts.length > 0 ? Math.max(...contacts.map(c => c.id)) + 1 : 1;
  const newContact = {
    id: newId, name, title: title || '', phone: phone || '', email: email || '', notes: notes || '',
    extension: extension || '', department: department || '', preferred_contact: preferred_contact || 'email',
    is_active: true, created_at: new Date().toISOString(),
  };
  contacts.push(newContact);

  parsed._contacts = contacts;
  const { error } = await sup.from('agencies').update({ notes: JSON.stringify(parsed) }).eq('id', agency_id);
  if (error) return res.status(400).json({ error: error.message });

  res.status(201).json({ success: true, data: newContact });
});

// PUT /api/agencies/:id/contacts/:contactId — update contact
router.put('/agencies/:id/contacts/:contactId', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  const sup = getSupabase();
  const agency_id = parseInt(req.params.id);
  const contactId = parseInt(req.params.contactId);
  const { name, title, phone, email, notes, is_active, extension, department, preferred_contact } = req.body;

  const { data: agency } = await sup.from('agencies').select('notes').eq('id', agency_id).maybeSingle();
  if (!agency) return res.status(404).json({ error: 'Agency not found' });

  let parsed = {};
  try { if (agency.notes) parsed = JSON.parse(agency.notes); } catch {}
  const contacts = parsed._contacts || [];
  const idx = contacts.findIndex(c => c.id === contactId);
  if (idx === -1) return res.status(404).json({ error: 'Contact not found' });

  if (name !== undefined) contacts[idx].name = name;
  if (title !== undefined) contacts[idx].title = title;
  if (phone !== undefined) contacts[idx].phone = phone;
  if (email !== undefined) contacts[idx].email = email;
  if (notes !== undefined) contacts[idx].notes = notes;
  if (is_active !== undefined) contacts[idx].is_active = is_active;
  if (extension !== undefined) contacts[idx].extension = extension;
  if (department !== undefined) contacts[idx].department = department;
  if (preferred_contact !== undefined) contacts[idx].preferred_contact = preferred_contact;
  contacts[idx].updated_at = new Date().toISOString();

  parsed._contacts = contacts;
  await sup.from('agencies').update({ notes: JSON.stringify(parsed) }).eq('id', agency_id);
  res.json({ success: true });
});

// DELETE /api/agencies/:id/contacts/:contactId — delete contact
router.delete('/agencies/:id/contacts/:contactId', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  const sup = getSupabase();
  const agency_id = parseInt(req.params.id);
  const contactId = parseInt(req.params.contactId);

  const { data: agency } = await sup.from('agencies').select('notes').eq('id', agency_id).maybeSingle();
  if (!agency) return res.status(404).json({ error: 'Agency not found' });

  let parsed = {};
  try { if (agency.notes) parsed = JSON.parse(agency.notes); } catch {}
  parsed._contacts = (parsed._contacts || []).filter(c => c.id !== contactId);

  await sup.from('agencies').update({ notes: JSON.stringify(parsed) }).eq('id', agency_id);
  res.json({ success: true });
});

// ===== EMAILS (deprecated — use agencies.email field directly)
// POST /api/agencies/:id/emails — update primary email on agency
router.post('/agencies/:id/emails', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  const sup = getSupabase();
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'البريد الإلكتروني مطلوب' });
  const { error } = await sup.from('agencies').update({ email }).eq('id', parseInt(req.params.id));
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, data: { email } });
});

// PUT /api/agencies/:id/emails/:emailId — update primary email
router.put('/agencies/:id/emails/:emailId', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  const sup = getSupabase();
  const { email } = req.body;
  const updates = {};
  if (email !== undefined) updates.email = email;
  const { error } = await sup.from('agencies').update(updates).eq('id', parseInt(req.params.id));
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// DELETE /api/agencies/:id/emails/:emailId — no-op (emails stored on agency)
router.delete('/agencies/:id/emails/:emailId', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  res.json({ success: true, note: 'Use agencies.email field' });
});

module.exports = router;
