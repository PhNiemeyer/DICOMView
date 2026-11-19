// Renders docs/handbuch/handbuch.html to PDF (A4) + PNG previews. Usage: node tools/render-handbuch.cjs <out.pdf> [previewDir]
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const out = process.argv[2];
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('file://' + path.resolve('docs/handbuch/handbuch.html'));
  await p.evaluate(() => document.fonts.ready);
  await p.pdf({
    path: out,
    format: 'A4',
    preferCSSPageSize: true,
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `<div style="width:100%;font-family:Arial,sans-serif;font-size:7pt;color:#607D89;padding:0 18mm;display:flex;justify-content:space-between;">
      <span>DICOMView · Benutzerhandbuch · Version 2.0</span><span><span class="pageNumber"></span></span></div>`,
  });
  await b.close();
})();
