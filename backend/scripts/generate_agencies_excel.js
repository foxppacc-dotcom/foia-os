const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// كل جهات إنفاذ القانون الأمريكية — على مستوى الولايات
const agencies = [
  // ===== FEDERAL AGENCIES =====
  { name_en: 'Federal Bureau of Investigation (FBI)', name_ar: 'مكتب التحقيقات الفيدرالي', state: 'Federal', city: 'Washington DC', type: 'federal', email: 'foia@fbi.gov', phone: '202-324-3000', portal_url: 'https://foia.fbi.gov', notes: 'FOIA requests for investigations, surveillance, bodycam evidence' },
  { name_en: 'Drug Enforcement Administration (DEA)', name_ar: 'إدارة مكافحة المخدرات', state: 'Federal', city: 'Arlington VA', type: 'federal', email: 'dea.foia@dea.gov', phone: '202-307-1000', portal_url: 'https://www.dea.gov/foia', notes: 'Drug-related investigations bodycam and dashcam footage' },
  { name_en: 'Bureau of Alcohol, Tobacco, Firearms and Explosives (ATF)', name_ar: 'مكتب الكحول والتبغ والأسلحة', state: 'Federal', city: 'Washington DC', type: 'federal', email: 'ATFFOIA@atf.gov', phone: '202-648-8500', portal_url: 'https://www.atf.gov/foia', notes: 'Firearms, explosives, arson investigations — bodycam evidence' },
  { name_en: 'United States Marshals Service (USMS)', name_ar: 'خدمة المارشالات الأمريكية', state: 'Federal', city: 'Arlington VA', type: 'federal', email: 'foia@usdoj.gov', phone: '202-307-9000', portal_url: 'https://www.usmarshals.gov/foia', notes: 'Witness protection, fugitive operations — bodycam/dashcam' },
  { name_en: 'Customs and Border Protection (CBP)', name_ar: 'الجمارك وحماية الحدود', state: 'Federal', city: 'Washington DC', type: 'federal', email: 'cbpfoia@cbp.dhs.gov', phone: '202-325-8000', portal_url: 'https://www.cbp.gov/foia', notes: 'Border patrol bodycams, dashcams, incident footage' },
  { name_en: 'Immigration and Customs Enforcement (ICE)', name_ar: 'الهجرة والجمارك', state: 'Federal', city: 'Washington DC', type: 'federal', email: 'ICE.FOIA@ice.dhs.gov', phone: '202-732-3000', portal_url: 'https://www.ice.gov/foia', notes: 'ICE enforcement operations bodycam footage' },
  { name_en: 'Transportation Security Administration (TSA)', name_ar: 'إدارة أمن النقل', state: 'Federal', city: 'Springfield VA', type: 'federal', email: 'TSAfoia@tsa.dhs.gov', phone: '202-385-2000', portal_url: 'https://www.tsa.gov/foia', notes: 'Airport security camera footage' },
  { name_en: 'United States Secret Service', name_ar: 'الخدمة السرية الأمريكية', state: 'Federal', city: 'Washington DC', type: 'federal', email: 'foia@usss.dhs.gov', phone: '202-406-8000', portal_url: 'https://www.secretservice.gov/foia', notes: 'Protective operations, investigations — bodycam evidence' },
  { name_en: 'Department of Justice (DOJ) - Civil Rights Division', name_ar: 'وزارة العدل - قسم الحقوق المدنية', state: 'Federal', city: 'Washington DC', type: 'federal', email: 'foia@usdoj.gov', phone: '202-514-2000', portal_url: 'https://www.justice.gov/foia', notes: 'Police misconduct, civil rights investigations — bodycam evidence' },
  { name_en: 'Bureau of Prisons (BOP)', name_ar: 'مكتب السجون الفيدرالي', state: 'Federal', city: 'Washington DC', type: 'federal', email: 'BOPFOIA@bop.gov', phone: '202-307-3198', portal_url: 'https://www.bop.gov/foia', notes: 'Prison incident footage and bodycam recordings' },

  // ===== STATE POLICE / HIGHWAY PATROL =====
  { name_en: 'California Highway Patrol (CHP)', name_ar: 'دورية الطرق السريعة في كاليفورنيا', state: 'California', city: 'Sacramento', type: 'state', email: 'foia@chp.ca.gov', phone: '916-843-3000', portal_url: 'https://www.chp.ca.gov/foia', notes: 'Highway patrol bodycams and dashcams' },
  { name_en: 'Texas Department of Public Safety (DPS)', name_ar: 'إدارة السلامة العامة في تكساس', state: 'Texas', city: 'Austin', type: 'state', email: 'dpsfoia@dps.texas.gov', phone: '512-424-2000', portal_url: 'https://www.dps.texas.gov/foia', notes: 'State trooper bodycams, dashcam footage' },
  { name_en: 'New York State Police', name_ar: 'شرطة ولاية نيويورك', state: 'New York', city: 'Albany', type: 'state', email: 'foia@troopers.ny.gov', phone: '518-457-6811', portal_url: 'https://www.troopers.ny.gov/foia', notes: 'NYSP bodycam and dashcam evidence' },
  { name_en: 'Florida Highway Patrol (FHP)', name_ar: 'دورية الطرق السريعة في فلوريدا', state: 'Florida', city: 'Tallahassee', type: 'state', email: 'fhppublicrecords@flhsmv.gov', phone: '850-410-3000', portal_url: 'https://www.flhsmv.gov/foia', notes: 'FHP bodycam, dashcam, incident footage' },
  { name_en: 'Illinois State Police (ISP)', name_ar: 'شرطة ولاية إلينوي', state: 'Illinois', city: 'Springfield', type: 'state', email: 'foia@illinois.gov', phone: '217-782-7263', portal_url: 'https://isp.illinois.gov/foia', notes: 'ISP bodycam and dashcam footage' },
  { name_en: 'Pennsylvania State Police (PSP)', name_ar: 'شرطة ولاية بنسلفانيا', state: 'Pennsylvania', city: 'Harrisburg', type: 'state', email: 'RA-PSPFOIA@pa.gov', phone: '717-783-5599', portal_url: 'https://www.psp.pa.gov/foia', notes: 'PSP bodycam footage and incident reports' },
  { name_en: 'Ohio State Highway Patrol (OSHP)', name_ar: 'دورية الطرق السريعة في أوهايو', state: 'Ohio', city: 'Columbus', type: 'state', email: 'foia@dps.ohio.gov', phone: '614-466-2660', portal_url: 'https://www.statepatrol.ohio.gov/foia', notes: 'OSHP dashcam and bodycam evidence' },
  { name_en: 'Georgia State Patrol (GSP)', name_ar: 'دورية ولاية جورجيا', state: 'Georgia', city: 'Atlanta', type: 'state', email: 'dpsfoia@gsp.net', phone: '404-624-7400', portal_url: 'https://www.gsp.net/foia', notes: 'GSP bodycam and dashcam footage' },
  { name_en: 'Michigan State Police (MSP)', name_ar: 'شرطة ولاية ميشيغان', state: 'Michigan', city: 'Lansing', type: 'state', email: 'msp-foia@michigan.gov', phone: '517-284-3000', portal_url: 'https://www.michigan.gov/msp/foia', notes: 'MSP bodycam and dashcam recordings' },
  { name_en: 'Arizona Department of Public Safety (DPS)', name_ar: 'إدارة السلامة العامة في أريزونا', state: 'Arizona', city: 'Phoenix', type: 'state', email: 'foia@azdps.gov', phone: '602-223-2000', portal_url: 'https://www.azdps.gov/foia', notes: 'AZ DPS bodycam and dashcam footage' },

  // ===== MAJOR CITY POLICE =====
  { name_en: 'New York Police Department (NYPD)', name_ar: 'شرطة نيويورك', state: 'New York', city: 'New York City', type: 'municipal', email: 'foia@nypd.org', phone: '646-610-5000', portal_url: 'https://www.nyc.gov/nypd/foia', notes: 'NYPD bodycam footage — largest PD in US' },
  { name_en: 'Los Angeles Police Department (LAPD)', name_ar: 'شرطة لوس أنجلوس', state: 'California', city: 'Los Angeles', type: 'municipal', email: 'lapd.foia@lacity.org', phone: '213-486-8730', portal_url: 'https://www.lapdonline.org/foia', notes: 'LAPD bodycam evidence and incident footage' },
  { name_en: 'Chicago Police Department (CPD)', name_ar: 'شرطة شيكاغو', state: 'Illinois', city: 'Chicago', type: 'municipal', email: 'cpdfoia@chicagopolice.org', phone: '312-745-5700', portal_url: 'https://www.chicagopolice.org/foia', notes: 'CPD bodycam footage — COPA oversight' },
  { name_en: 'Houston Police Department (HPD)', name_ar: 'شرطة هيوستن', state: 'Texas', city: 'Houston', type: 'municipal', email: 'hpdrecords@houstonpolice.org', phone: '713-884-3131', portal_url: 'https://www.houstonpolice.org/foia', notes: 'HPD bodycam and dashcam evidence' },
  { name_en: 'Philadelphia Police Department (PPD)', name_ar: 'شرطة فيلادلفيا', state: 'Pennsylvania', city: 'Philadelphia', type: 'municipal', email: 'ppd.foia@phila.gov', phone: '215-686-3000', portal_url: 'https://www.phillypolice.com/foia', notes: 'PPD bodycam footage' },
  { name_en: 'Phoenix Police Department', name_ar: 'شرطة فينيكس', state: 'Arizona', city: 'Phoenix', type: 'municipal', email: 'phxpdrecords@phoenix.gov', phone: '602-262-6151', portal_url: 'https://www.phoenix.gov/police/foia', notes: 'Phoenix PD bodycam and dashcam' },
  { name_en: 'San Antonio Police Department (SAPD)', name_ar: 'شرطة سان أنطونيو', state: 'Texas', city: 'San Antonio', type: 'municipal', email: 'sapdrecords@sanantonio.gov', phone: '210-207-7200', portal_url: 'https://www.sanantonio.gov/police/foia', notes: 'SAPD bodycam video evidence' },
  { name_en: 'San Diego Police Department (SDPD)', name_ar: 'شرطة سان دييغو', state: 'California', city: 'San Diego', type: 'municipal', email: 'sdpublicsafety@pd.sandiego.gov', phone: '619-531-2000', portal_url: 'https://www.sandiego.gov/police/foia', notes: 'SDPD bodycam and dashcam' },
  { name_en: 'Dallas Police Department (DPD)', name_ar: 'شرطة دالاس', state: 'Texas', city: 'Dallas', type: 'municipal', email: 'dpdrecords@dallascityhall.com', phone: '214-671-3300', portal_url: 'https://www.dallaspolice.net/foia', notes: 'DPD bodycam and incident footage' },
  { name_en: 'Las Vegas Metropolitan Police Department (LVMPD)', name_ar: 'شرطة لاس فيغاس', state: 'Nevada', city: 'Las Vegas', type: 'municipal', email: 'records@lvmpd.com', phone: '702-828-3111', portal_url: 'https://www.lvmpd.com/foia', notes: 'LVMPD bodycam footage — Route 91 shooting evidence' },

  // ===== MORE STATE AGENCIES =====
  { name_en: 'Washington State Patrol (WSP)', name_ar: 'دورية ولاية واشنطن', state: 'Washington', city: 'Olympia', type: 'state', email: 'wspfoia@wsp.wa.gov', phone: '360-596-4000', portal_url: 'https://www.wsp.wa.gov/foia', notes: 'WSP dashcam and bodycam' },
  { name_en: 'Massachusetts State Police (MSP)', name_ar: 'شرطة ولاية ماساتشوستس', state: 'Massachusetts', city: 'Framingham', type: 'state', email: 'mspfoia@pol.state.ma.us', phone: '508-820-2300', portal_url: 'https://www.mass.gov/msp/foia', notes: 'MSP bodycam and cruiser camera footage' },
  { name_en: 'Virginia State Police (VSP)', name_ar: 'شرطة ولاية فرجينيا', state: 'Virginia', city: 'Richmond', type: 'state', email: 'vspfoia@vsp.virginia.gov', phone: '804-674-2000', portal_url: 'https://www.vsp.virginia.gov/foia', notes: 'VSP bodycam and dashcam evidence' },
  { name_en: 'Colorado State Patrol (CSP)', name_ar: 'دورية ولاية كولورادو', state: 'Colorado', city: 'Denver', type: 'state', email: 'cdps_foia@state.co.us', phone: '303-239-4500', portal_url: 'https://www.csp.colorado.gov/foia', notes: 'CSP bodycam and dashcam' },
  { name_en: 'Nevada Highway Patrol (NHP)', name_ar: 'دورية الطرق السريعة في نيفادا', state: 'Nevada', city: 'Carson City', type: 'state', email: 'nhpfoia@dps.state.nv.us', phone: '775-687-5300', portal_url: 'https://www.nhp.nv.gov/foia', notes: 'NHP dashcam and bodycam' },
  { name_en: 'Oregon State Police (OSP)', name_ar: 'شرطة ولاية أوريغون', state: 'Oregon', city: 'Salem', type: 'state', email: 'osp.foia@state.or.us', phone: '503-378-3720', portal_url: 'https://www.oregon.gov/osp/foia', notes: 'OSP bodycam and evidence footage' },
  { name_en: 'Tennessee Highway Patrol (THP)', name_ar: 'دورية الطرق السريعة في تينيسي', state: 'Tennessee', city: 'Nashville', type: 'state', email: 'thp.foia@tn.gov', phone: '615-741-2000', portal_url: 'https://www.tn.gov/safety/foia', notes: 'THP bodycam and dashcam' },
  { name_en: 'Maryland State Police (MDSP)', name_ar: 'شرطة ولاية ميريلاند', state: 'Maryland', city: 'Pikesville', type: 'state', email: 'mdsp.foia@maryland.gov', phone: '410-486-3101', portal_url: 'https://www.mdsp.org/foia', notes: 'MDSP bodycam and dashcam' },
  { name_en: 'New Jersey State Police (NJSP)', name_ar: 'شرطة ولاية نيو جيرسي', state: 'New Jersey', city: 'West Trenton', type: 'state', email: 'njspfoia@njsp.org', phone: '609-882-2000', portal_url: 'https://www.njsp.org/foia', notes: 'NJSP bodycam and dashboard camera evidence' },
  { name_en: 'North Carolina State Highway Patrol (NCSHP)', name_ar: 'دورية الطرق السريعة في نورث كارولاينا', state: 'North Carolina', city: 'Raleigh', type: 'state', email: 'ncshp.foia@ncdps.gov', phone: '919-733-7952', portal_url: 'https://www.ncdps.gov/foia', notes: 'NCSHP bodycam and dashcam' },

  // ===== MORE MAJOR CITIES =====
  { name_en: 'Miami Police Department', name_ar: 'شرطة ميامي', state: 'Florida', city: 'Miami', type: 'municipal', email: 'records@miamipd.gov', phone: '305-579-6100', portal_url: 'https://www.miami-police.org/foia', notes: 'Miami PD bodycam footage' },
  { name_en: 'Atlanta Police Department (APD)', name_ar: 'شرطة أتلانتا', state: 'Georgia', city: 'Atlanta', type: 'municipal', email: 'apdrecords@atlantaga.gov', phone: '404-546-4240', portal_url: 'https://www.atlantapd.org/foia', notes: 'APD bodycam evidence' },
  { name_en: 'Seattle Police Department (SPD)', name_ar: 'شرطة سياتل', state: 'Washington', city: 'Seattle', type: 'municipal', email: 'spdrecords@seattle.gov', phone: '206-684-5426', portal_url: 'https://www.seattle.gov/police/foia', notes: 'SPD bodycam — consent decree oversight' },
  { name_en: 'Denver Police Department (DPD)', name_ar: 'شرطة دنفر', state: 'Colorado', city: 'Denver', type: 'municipal', email: 'denverpdrecords@denvergov.org', phone: '720-913-2000', portal_url: 'https://www.denvergov.org/police/foia', notes: 'DPD bodycam and incident footage' },
  { name_en: 'Boston Police Department (BPD)', name_ar: 'شرطة بوسطن', state: 'Massachusetts', city: 'Boston', type: 'municipal', email: 'bpdrecords@bpd.gov', phone: '617-343-4500', portal_url: 'https://www.bpdnews.com/foia', notes: 'BPD bodycam evidence' },
  { name_en: 'Detroit Police Department (DPD)', name_ar: 'شرطة ديترويت', state: 'Michigan', city: 'Detroit', type: 'municipal', email: 'detroitpdrecords@detroitmi.gov', phone: '313-596-2200', portal_url: 'https://www.detroitmi.gov/police/foia', notes: 'DPD bodycam and dashcam' },
  { name_en: 'Minneapolis Police Department (MPD)', name_ar: 'شرطة مينيابوليس', state: 'Minnesota', city: 'Minneapolis', type: 'municipal', email: 'mpdrecords@minneapolismn.gov', phone: '612-673-3000', portal_url: 'https://www.minneapolismn.gov/police/foia', notes: 'MPD bodycam — George Floyd case, DOJ pattern/practice' },
  { name_en: 'Memphis Police Department (MPD)', name_ar: 'شرطة ممفيس', state: 'Tennessee', city: 'Memphis', type: 'municipal', email: 'mpdrecords@memphistn.gov', phone: '901-636-3200', portal_url: 'https://www.memphispolice.org/foia', notes: 'MPD bodycam footage — Tyre Nichols case' },
  { name_en: 'Baltimore Police Department (BPD)', name_ar: 'شرطة بالتيمور', state: 'Maryland', city: 'Baltimore', type: 'municipal', email: 'bpdrecords@baltimorepolice.org', phone: '410-396-2100', portal_url: 'https://www.baltimorepolice.org/foia', notes: 'BPD bodycam — consent decree' },
  { name_en: 'Portland Police Bureau (PPB)', name_ar: 'شرطة بورتلاند', state: 'Oregon', city: 'Portland', type: 'municipal', email: 'ppbrecords@portlandoregon.gov', phone: '503-823-0000', portal_url: 'https://www.portland.gov/police/foia', notes: 'PPB bodycam evidence' },

  // ===== SHERIFF DEPARTMENTS =====
  { name_en: 'Los Angeles County Sheriff\'s Department (LASD)', name_ar: 'مكتب شريف مقاطعة لوس أنجلوس', state: 'California', city: 'Los Angeles', type: 'sheriff', email: 'foia@lasd.org', phone: '213-229-1800', portal_url: 'https://www.lasd.org/foia', notes: 'Largest sheriff department — bodycam and jail footage' },
  { name_en: 'Cook County Sheriff\'s Office (CCSO)', name_ar: 'مكتب شريف مقاطعة كوك', state: 'Illinois', city: 'Chicago', type: 'sheriff', email: 'ccsofoia@cookcountyil.gov', phone: '312-603-6400', portal_url: 'https://www.cookcountysheriff.org/foia', notes: 'Cook County IL bodycam and jail footage' },
  { name_en: 'Harris County Sheriff\'s Office (HCSO)', name_ar: 'مكتب شريف مقاطعة هاريس', state: 'Texas', city: 'Houston', type: 'sheriff', email: 'hcsorecords@harriscountytx.gov', phone: '713-221-6000', portal_url: 'https://www.hcso-tx.org/foia', notes: 'Harris County TX bodycam and dashcam' },
  { name_en: 'Maricopa County Sheriff\'s Office (MCSO)', name_ar: 'مكتب شريف مقاطعة ماريكوبا', state: 'Arizona', city: 'Phoenix', type: 'sheriff', email: 'mcsofoia@mcso.maricopa.gov', phone: '602-876-1000', portal_url: 'https://www.mcso.org/foia', notes: 'Maricopa County AZ bodycam and detention footage' },
  { name_en: 'San Bernardino County Sheriff\'s Department', name_ar: 'مكتب شريف مقاطعة سان بيرناردينو', state: 'California', city: 'San Bernardino', type: 'sheriff', email: 'sbcsorecords@sbcounty.gov', phone: '909-387-8311', portal_url: 'https://www.sbcounty.gov/sheriff/foia', notes: 'San Bernardino bodycam and incident footage' },
  { name_en: 'Riverside County Sheriff\'s Department', name_ar: 'مكتب شريف مقاطعة ريفرسايد', state: 'California', city: 'Riverside', type: 'sheriff', email: 'riversidesheriff@rivco.org', phone: '951-955-2400', portal_url: 'https://www.riversidesheriff.org/foia', notes: 'Riverside CA bodycam evidence' },
  { name_en: 'Dade County Sheriff\'s Office', name_ar: 'مكتب شريف مقاطعة ميامي-ديد', state: 'Florida', city: 'Miami', type: 'sheriff', email: 'miamidade@miamidade.gov', phone: '305-375-3000', portal_url: 'https://www.miamidadesheriff.org/foia', notes: 'Miami-Dade bodycam and dashcam' },
  { name_en: 'King County Sheriff\'s Office (KCSO)', name_ar: 'مكتب شريف مقاطعة كينغ', state: 'Washington', city: 'Seattle', type: 'sheriff', email: 'kcsofoia@kingcounty.gov', phone: '206-296-6600', portal_url: 'https://www.kingcounty.gov/sheriff/foia', notes: 'Seattle area bodycam evidence' },
  { name_en: 'Clark County Sheriff\'s Office (Las Vegas Metro)', name_ar: 'مكتب شريف مقاطعة كلارك', state: 'Nevada', city: 'Las Vegas', type: 'sheriff', email: 'ccsofoia@clarkcountynv.gov', phone: '702-828-3111', portal_url: 'https://www.clarkcountysheriff.org/foia', notes: 'Las Vegas bodycam and LVMPD unification' },
  { name_en: 'Orange County Sheriff\'s Department (OCSD)', name_ar: 'مكتب شريف مقاطعة أورانج', state: 'California', city: 'Santa Ana', type: 'sheriff', email: 'ocsdfoia@ocsd.org', phone: '714-647-7000', portal_url: 'https://www.ocsd.org/foia', notes: 'Orange County CA bodycam and jail footage' },
];

// Generate Excel
const ws = XLSX.utils.json_to_sheet(agencies, { header: ['name_en', 'name_ar', 'state', 'city', 'type', 'email', 'phone', 'portal_url', 'notes'] });
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Agencies');

// Set column widths
ws['!cols'] = [
  { wch: 45 }, // name_en
  { wch: 35 }, // name_ar
  { wch: 15 }, // state
  { wch: 20 }, // city
  { wch: 12 }, // type
  { wch: 35 }, // email
  { wch: 18 }, // phone
  { wch: 40 }, // portal_url
  { wch: 50 }, // notes
];

// Freeze header row
ws['!freeze'] = { xSplit: 0, ySplit: 1 };

const desktopPath = path.join('C:', 'Users', 'Work', 'Desktop', 'foia_us_agencies.xlsx');
XLSX.writeFile(wb, desktopPath);
console.log('✅ Excel written to:', desktopPath);
console.log('📊 Agencies:', agencies.length);
