const XLSX = require('xlsx');
const path = require('path');

const desktopPath = path.join('C:', 'Users', 'Work', 'Desktop', 'foia_sample_cases.xlsx');

/**
 * قضايا نموذجية — كل قضية فيها:
 * - عنوان القضية
 * - وصف
 * - أولوية
 * - عميل
 * - أسماء الجهات المرسلة (separated by ;)
 * - ملاحظات إضافية
 */

const cases = [
  {
    title: 'طلب الحصول على تسجيلات كاميرات الشرطة — حادثة ميدان التحرير',
    description: 'اشتباكات بين المتظاهرين والشرطة في 25 يناير 2025 — مطلوب جميع تسجيلات كاميرات الجسم من جميع الجهات المتواجدة.',
    priority: 'high',
    client_name: 'محمد أحمد علي',
    agencies: 'Federal Bureau of Investigation (FBI);Ministry of Interior;New York Police Department (NYPD)',
    notes: 'قضية ذات أولوية قصوى — مطلوب bodycam footage من 3 جهات مختلفة'
  },
  {
    title: 'طلب فيديوهات كاميرات مراقبة — تفريق مظاهرة جامعة القاهرة',
    description: 'مطالبة بالحصول على تسجيلات كاميرات المراقبة الداخلية والخارجية لجامعة القاهرة يوم 15 فبراير 2025.',
    priority: 'high',
    client_name: 'سارة خالد',
    agencies: 'Los Angeles Police Department (LAPD);Chicago Police Department (CPD)',
    notes: 'مطلوب كاميرات مراقبة + bodycam لرجال الأمن'
  },
  {
    title: 'طلب بيانات احتجازات إدارية — عام 2025',
    description: 'الحصول على إحصائيات دقيقة بعدد المحتجزين إدارياً خلال عام 2025.',
    priority: 'medium',
    client_name: 'أحمد حسن',
    agencies: 'Department of Justice (DOJ) - Civil Rights Division;Federal Bureau of Investigation (FBI)',
    notes: 'يتطلب متابعة دورية — بيانات إحصائية'
  },
  {
    title: 'طلب تقارير استخدام القوة — مظاهرات أغسطس 2024',
    description: 'الحصول على تقارير استخدام القوة من قبل الشرطة خلال المظاهرات الشعبية في أغسطس 2024.',
    priority: 'high',
    client_name: 'لجنة الحقوق والحريات',
    agencies: 'United States Marshals Service (USMS);Bureau of Alcohol, Tobacco, Firearms and Explosives (ATF)',
    notes: 'يتضمن طلب bodycam footage + تقارير داخلية'
  },
  {
    title: 'طلب محاضر الاستجواب — قضية رأي عام',
    description: 'الحصول على محاضر استجواب المتهمين في قضية الرأي العام رقم 158 لسنة 2025.',
    priority: 'high',
    client_name: 'نقابة المحامين',
    agencies: 'Federal Bureau of Investigation (FBI);Department of Justice (DOJ) - Civil Rights Division',
    notes: 'مستندات قانونية + تسجيلات استجواب'
  },
  {
    title: 'طلب كاميرات مراقبة — محطة المترو',
    description: 'تسجيلات كاميرات المراقبة في محطة مترو أنور السعدي يوم 3 مارس 2025.',
    priority: 'medium',
    client_name: 'أميرة سامي',
    agencies: 'Transportation Security Administration (TSA)',
    notes: 'مطلوب كاميرات داخل المحطة + المداخل'
  },
  {
    title: 'طلب بيانات حرية التعبير على الإنترنت',
    description: 'إحصائيات حول حسابات تم حجبها أو مراقبتها خلال عام 2025.',
    priority: 'medium',
    client_name: 'منظمة صحفيات بلا حدود',
    agencies: 'Customs and Border Protection (CBP)',
    notes: 'بيانات رقمية — لا يتضمن فيديوهات'
  },
  {
    title: 'طلب وثائق التعذيب في السجون',
    description: 'الحصول على تقارير وتوثيق حالات التعذيب في السجون المصرية خلال 2024-2025.',
    priority: 'high',
    client_name: 'المنظمة المصرية لحقوق الإنسان',
    agencies: 'Bureau of Prisons (BOP);Immigration and Customs Enforcement (ICE)',
    notes: 'قضية حساسة — توثيق مصور + تقارير طبية'
  },
  {
    title: 'طلب بث مباشر لقناة إخبارية',
    description: 'البث المباشر الكامل لقناة إخبارية أثناء تغطية فض الاعتصام في رابعة.',
    priority: 'low',
    client_name: 'باحث إعلامي',
    agencies: 'Federal Bureau of Investigation (FBI)',
    notes: 'بث تلفزيوني — غير عاجل'
  },
  {
    title: 'طلب صور أقمار صناعية — منطقة سيناء',
    description: 'صور أقمار صناعية عالية الدقة لمنطقة شمال سيناء خلال الفترة من يناير إلى مارس 2025.',
    priority: 'medium',
    client_name: 'مركز الدراسات الاستراتيجية',
    agencies: 'Drug Enforcement Administration (DEA)',
    notes: 'صور + تحليل جغرافي'
  },
  {
    title: 'طلب معلومات عن حالات اختفاء قسري',
    description: 'بيانات عن حالات الاختفاء القسري في مصر خلال 2025.',
    priority: 'high',
    client_name: 'المفوضية السامية لحقوق الإنسان',
    agencies: 'United States Marshals Service (USMS);California Highway Patrol (CHP)',
    notes: 'قضية دولية — متابعة مع جهات متعددة'
  },
  {
    title: 'طلب تسجيلات غرفة العمليات — فض اعتصام',
    description: 'جميع التسجيلات الصوتية والمرئية لغرفة عمليات الشرطة أثناء فض اعتصام 2025.',
    priority: 'high',
    client_name: 'محامي الضحايا',
    agencies: 'Texas Department of Public Safety (DPS);New York State Police;Florida Highway Patrol (FHP)',
    notes: 'مطلوب بشكل عاجل — تسجيلات + اتصالات'
  },
];

// Create Excel
const ws = XLSX.utils.json_to_sheet(cases, {
  header: ['title', 'description', 'priority', 'client_name', 'agencies', 'notes']
});

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Cases');

ws['!cols'] = [
  { wch: 55 }, // title
  { wch: 70 }, // description
  { wch: 10 }, // priority
  { wch: 25 }, // client_name
  { wch: 80 }, // agencies
  { wch: 50 }, // notes
];

XLSX.writeFile(wb, desktopPath);
console.log('✅ Excel written to:', desktopPath);
console.log('📊 Cases:', cases.length);
