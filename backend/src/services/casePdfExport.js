// Builds and renders the case export PDF: case header + summary + a list of
// every manually/FileFetch-uploaded file's name and clickable link. Uses
// puppeteer-core against the system Chromium (installed via apt in the
// Dockerfile) rather than full puppeteer, so no bundled-Chromium download is
// needed and the image stays smaller.

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildCaseExportHtml(caseRow, docs) {
  const rows = docs.map(d => {
    const name = escapeHtml(d.original_name || d.filename || 'بدون اسم');
    const link = d.url || d.file_path || '';
    return `
      <div class="doc-row">
        <div class="doc-name">${name}</div>
        ${link ? `<a class="doc-link" href="${escapeHtml(link)}">${escapeHtml(link)}</a>` : '<div class="doc-link doc-link--missing">لا يوجد رابط</div>'}
      </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
  @page { margin: 24mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Noto Sans Arabic', 'Noto Naskh Arabic', Arial, sans-serif; color: #1a1a1a; direction: rtl; text-align: right; font-size: 13px; line-height: 1.8; }
  .header { border-bottom: 3px solid #1d4ed8; padding-bottom: 14px; margin-bottom: 20px; }
  .case-id { color: #1d4ed8; font-size: 13px; font-weight: 700; margin-bottom: 4px; }
  .case-title { font-size: 22px; font-weight: 800; }
  .section-title { font-size: 15px; font-weight: 700; color: #1d4ed8; margin: 22px 0 8px; border-right: 4px solid #1d4ed8; padding-right: 8px; }
  .summary { white-space: pre-wrap; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; }
  .doc-row { padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
  /* File names routinely mix Arabic with Latin/numeric runs (dates, .mp4,
     WhatsApp-style IDs) -- inheriting the page's RTL paragraph direction
     reverses those runs (a date like 2026-09-06 or a ".mp4" extension jumps
     to the wrong end). unicode-bidi: plaintext makes each name pick its own
     direction from its first strong character instead, matching how the
     name actually reads. */
  .doc-name { font-weight: 700; margin-bottom: 3px; unicode-bidi: plaintext; }
  .doc-link { color: #1d4ed8; text-decoration: underline; word-break: break-all; font-size: 11px; unicode-bidi: plaintext; direction: ltr; text-align: right; }
  .doc-link--missing { color: #9ca3af; text-decoration: none; }
  .empty { color: #9ca3af; padding: 10px 0; display: block; }
  .footer { margin-top: 30px; font-size: 10px; color: #9ca3af; text-align: center; }
</style>
</head>
<body>
  <div class="header">
    <div class="case-id">القضية رقم #${caseRow.id}</div>
    <div class="case-title">${escapeHtml(caseRow.title || 'بدون عنوان')}</div>
  </div>

  <div class="section-title">ملخص القضية</div>
  <div class="summary">${caseRow.case_summary ? escapeHtml(caseRow.case_summary) : '<span class="empty">لا يوجد ملخص</span>'}</div>

  <div class="section-title">الملفات (${docs.length})</div>
  ${docs.length ? rows : '<div class="empty">لا توجد ملفات</div>'}

  <div class="footer">تم إنشاء هذا التقرير تلقائيًا بتاريخ ${new Date().toLocaleDateString('ar-EG')}</div>
</body>
</html>`;
}

async function renderCasePdf(caseRow, docs) {
  const puppeteer = require('puppeteer-core');
  const html = buildCaseExportHtml(caseRow, docs);
  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const buffer = await page.pdf({ format: 'A4', printBackground: true });
    return Buffer.from(buffer);
  } finally {
    await browser.close();
  }
}

module.exports = { buildCaseExportHtml, renderCasePdf };
