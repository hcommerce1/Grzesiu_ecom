const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const htmlPath = path.resolve(__dirname, 'claude-podstawy.html');
  const pdfPath = path.resolve(__dirname, 'claude-podstawy.pdf');
  const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(fileUrl, { waitUntil: 'networkidle' });
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '18mm', right: '16mm', bottom: '18mm', left: '16mm' },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="font-size:8pt; color:#999; width:100%; text-align:center; padding:4mm 0;">Strona <span class="pageNumber"></span> / <span class="totalPages"></span></div>'
  });
  await browser.close();

  console.log('PDF wygenerowany:', pdfPath);
})();
