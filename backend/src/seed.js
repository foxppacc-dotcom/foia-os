const { getDatabase } = require('./database');
const bcrypt = require('bcryptjs');

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function seed() {
  console.log('🌱 Seeding FOIA OS database...\n');

  const db = getDatabase();

  // Clear existing data
  db.exec(`
    DELETE FROM case_labels;
    DELETE FROM case_comments;
    DELETE FROM case_documents;
    DELETE FROM case_tasks;
    DELETE FROM communications;
    DELETE FROM requests;
    DELETE FROM cases;
    DELETE FROM agencies;
    DELETE FROM users;
    DELETE FROM teams;
    DELETE FROM labels;
    DELETE FROM pipeline_lists;
  `);

  // 1. Seed 7 pipeline lists (FOIA classifications)
  const pipelineLists = [
    { list_number: 1, name_ar: 'لسته تم استلام السجلات', name_en: 'Records Received', color: '#10B981' },
    { list_number: 2, name_ar: 'لسته مطلوب دفع', name_en: 'Payment Required', color: '#F59E0B' },
    { list_number: 3, name_ar: 'لسته مفيش سجلات متوفرة للطلب ده', name_en: 'No Records Available', color: '#6B7280' },
    { list_number: 4, name_ar: 'لسته تم الرفض بموجب القانون', name_en: 'Denied by Law', color: '#EF4444' },
    { list_number: 5, name_ar: 'لسته القضية لسه مفتوحة فى المحكمة', name_en: 'Case Pending in Court', color: '#8B5CF6' },
    { list_number: 6, name_ar: 'لسته الوكالة لا تستخدم البودي كام', name_en: 'Agency Has No Bodycams', color: '#F97316' },
    { list_number: 7, name_ar: 'لسته الوكالة محتاجة تأكيد مواطنة', name_en: 'Citizenship Verification Needed', color: '#EC4899' },
  ];

  const insertList = db.prepare(
    'INSERT INTO pipeline_lists (list_number, name_ar, name_en, color) VALUES (?, ?, ?, ?)'
  );

  for (const list of pipelineLists) {
    insertList.run(list.list_number, list.name_ar, list.name_en, list.color);
  }
  console.log(`✅ Seeded ${pipelineLists.length} pipeline lists`);

  // 2. Seed demo user
  const demoUser = db.prepare(`
    INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)
  `).run('Admin User', 'admin@foia.com', hashPassword('admin123'), 'admin');
  console.log('✅ Seeded demo user (admin@foia.com / admin123)');

  // 3. Seed 5 sample agencies
  const agencies = [
    {
      name_ar: 'وزارة الداخلية',
      name_en: 'Ministry of Interior',
      state: 'Cairo',
      city: 'Cairo',
      type: 'government',
      email: 'info@moi.gov.eg',
      phone: '+202-12345678',
      portal_url: 'https://www.moi.gov.eg',
      notes: 'Main interior ministry handling public security'
    },
    {
      name_ar: 'وزارة العدل',
      name_en: 'Ministry of Justice',
      state: 'Cairo',
      city: 'Cairo',
      type: 'government',
      email: 'info@moj.gov.eg',
      phone: '+202-23456789',
      portal_url: 'https://www.moj.gov.eg',
      notes: 'Oversees judicial affairs and legal matters'
    },
    {
      name_ar: 'النيابة العامة',
      name_en: 'Public Prosecution Office',
      state: 'Cairo',
      city: 'Cairo',
      type: 'judicial',
      email: 'prosecution@ppo.gov.eg',
      phone: '+202-34567890',
      portal_url: null,
      notes: 'Public prosecution authority'
    },
    {
      name_ar: 'المجلس القومي لحقوق الإنسان',
      name_en: 'National Council for Human Rights',
      state: 'Cairo',
      city: 'Cairo',
      type: 'commission',
      email: 'info@nchr.eg',
      phone: '+202-45678901',
      portal_url: 'https://www.nchr.eg',
      notes: 'Independent national human rights institution'
    },
    {
      name_ar: 'جهاز الأمن الوطني',
      name_en: 'National Security Agency',
      state: 'Giza',
      city: 'Giza',
      type: 'security',
      email: null,
      phone: null,
      portal_url: null,
      notes: 'National security apparatus (limited disclosure)'
    },
  ];

  const insertAgency = db.prepare(`
    INSERT INTO agencies (name_ar, name_en, state, city, type, email, phone, portal_url, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const agency of agencies) {
    insertAgency.run(agency.name_ar, agency.name_en, agency.state, agency.city, agency.type, agency.email, agency.phone, agency.portal_url, agency.notes);
  }
  console.log(`✅ Seeded ${agencies.length} agencies`);

  // 4. Seed 3 sample cases with requests
  const cases = [
    {
      uuid: require('uuid').v4(),
      title: 'طلب الحصول على سجلات كاميرات المراقبة',
      description: 'طلب للحصول على تسجيلات كاميرات المراقبة في ميدان التحرير يوم 25 يناير',
      status: 'open',
      priority: 'high',
      client_name: 'محمد أحمد',
      agency_id: 1,
      user_id: 1,
      assigned_to: 1,
      deadline: '2026-08-15',
      requests: [
        { agency_id: 1, status: 'pending', classification_id: 1, sent_date: '2026-07-01', notes: 'تم إرسال الطلب عبر البوابة الإلكترونية' },
        { agency_id: 5, status: 'pending', classification_id: 7, sent_date: '2026-07-01', notes: 'طلب التحقق من الجنسية' },
      ]
    },
    {
      uuid: require('uuid').v4(),
      title: 'طلب بيانات احتجازات إدارية',
      description: 'طلب الحصول على إحصائيات الاحتجازات الإدارية خلال عام 2025',
      status: 'in_progress',
      priority: 'medium',
      client_name: 'سارة خالد',
      agency_id: 3,
      user_id: 1,
      assigned_to: 1,
      deadline: '2026-09-01',
      requests: [
        { agency_id: 3, status: 'pending', classification_id: 2, sent_date: '2026-06-15', notes: 'تم الطلب - مطلوب دفع رسوم' },
      ]
    },
    {
      uuid: require('uuid').v4(),
      title: 'طلب تقارير عن استخدام القوة',
      description: 'طلب الحصول على تقارير استخدام القوة من قبل الشرطة في مظاهرات 2024',
      status: 'closed',
      priority: 'high',
      client_name: 'أحمد علي',
      agency_id: 1,
      user_id: 1,
      assigned_to: 1,
      deadline: '2026-07-30',
      requests: [
        { agency_id: 1, status: 'completed', classification_id: 4, sent_date: '2026-05-01', response_date: '2026-06-01', notes: 'تم الرفض بموجب القانون - أمن قومي' },
      ]
    },
  ];

  const insertCase = db.prepare(`
    INSERT INTO cases (uuid, title, description, status, priority, client_name, agency_id, user_id, assigned_to, deadline)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertRequest = db.prepare(`
    INSERT INTO requests (case_id, agency_id, status, classification_id, sent_date, response_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const result = insertCase.run(c.uuid, c.title, c.description, c.status, c.priority, c.client_name, c.agency_id, c.user_id, c.assigned_to, c.deadline);
    const caseId = result.lastInsertRowid;

    for (const req of c.requests) {
      insertRequest.run(caseId, req.agency_id, req.status, req.classification_id, req.sent_date, req.response_date, req.notes);
    }
  }
  console.log(`✅ Seeded ${cases.length} cases with requests`);

  // 5. Seed some sample tasks
  const insertTask = db.prepare(`
    INSERT INTO case_tasks (case_id, title, description, status, priority, assigned_to, due_date, list_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tasks = [
    { case_id: 1, title: 'مراجعة الرد من الوكالة', description: 'مراجعة الرد الوارد من وزارة الداخلية', status: 'todo', priority: 'high', assigned_to: 1, due_date: '2026-08-10', list_id: 1 },
    { case_id: 1, title: 'متابعة طلب التحقق من الجنسية', description: 'التواصل مع جهاز الأمن الوطني بخصوص التحقق', status: 'in_progress', priority: 'medium', assigned_to: 1, due_date: '2026-08-05', list_id: 7 },
    { case_id: 2, title: 'دفع الرسوم المطلوبة', description: 'دفع رسوم معالجة الطلب للنيابة العامة', status: 'todo', priority: 'medium', assigned_to: 1, due_date: '2026-08-20', list_id: 2 },
    { case_id: 3, title: 'إبلاغ العميل بقرار الرفض', description: 'إبلاغ أحمد علي بقرار الرفض وشرح الأسباب', status: 'done', priority: 'high', assigned_to: 1, due_date: '2026-06-15', list_id: 4 },
  ];

  for (const t of tasks) {
    insertTask.run(t.case_id, t.title, t.description, t.status, t.priority, t.assigned_to, t.due_date, t.list_id);
  }
  console.log(`✅ Seeded ${tasks.length} sample tasks`);

  // 6. Seed sample comments
  const insertComment = db.prepare(`
    INSERT INTO case_comments (case_id, user_id, content) VALUES (?, ?, ?)
  `);

  const comments = [
    { case_id: 1, user_id: 1, content: 'تم إرسال الطلب رسمياً عبر البوابة الإلكترونية للوزارة' },
    { case_id: 1, user_id: 1, content: 'تم استلام إشعار باستلام الطلب من وزارة الداخلية' },
    { case_id: 2, user_id: 1, content: 'النيابة العامة طلبت دفع رسوم قدرها 500 جنيه لمعالجة الطلب' },
    { case_id: 3, user_id: 1, content: 'تم الرفض بناءً على المادة 25 من قانون ضمانات وحماية المعلومات' },
  ];

  for (const c of comments) {
    insertComment.run(c.case_id, c.user_id, c.content);
  }
  console.log(`✅ Seeded ${comments.length} comments`);

  // 7. Seed sample labels
  const insertLabel = db.prepare(`INSERT INTO labels (name_ar, name_en, color) VALUES (?, ?, ?)`);
  const insertCaseLabel = db.prepare(`INSERT INTO case_labels (case_id, label_id) VALUES (?, ?)`);

  const labels = [
    { name_ar: 'عاجل', name_en: 'Urgent', color: '#EF4444' },
    { name_ar: 'قانوني', name_en: 'Legal', color: '#3B82F6' },
    { name_ar: 'حقوق إنسان', name_en: 'Human Rights', color: '#8B5CF6' },
    { name_ar: 'مراقبة', name_en: 'Surveillance', color: '#F59E0B' },
  ];

  for (const l of labels) {
    const result = insertLabel.run(l.name_ar, l.name_en, l.color);
    // Assign labels to cases
    if (l.name_en === 'Urgent') insertCaseLabel.run(1, result.lastInsertRowid);
    if (l.name_en === 'Human Rights') {
      insertCaseLabel.run(1, result.lastInsertRowid);
      insertCaseLabel.run(2, result.lastInsertRowid);
    }
  }
  console.log(`✅ Seeded ${labels.length} labels and assigned to cases`);

  console.log('\n🎉 Seeding complete!');
  console.log('📧 Demo login: admin@foia.com / admin123');
  console.log(`📊 Database: ${db.name}`);
}

seed();
