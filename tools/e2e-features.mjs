// Browser test for: persistent measurements, value display, text style, delete all, overlay mode.
//   npm run build && npx vite preview --port 4173 &  node tools/e2e-features.mjs <out-dir>
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = process.argv[2] || 'test-results';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
await ctx.addInitScript(() => {
  try {
    if (!localStorage.getItem('bildviewer.settings.v1')) localStorage.setItem('bildviewer.settings.v1', JSON.stringify({ lang: 'de' }));
  } catch {}
});
const errors = [];
ctx.on('page', (pg) => {
  pg.on('pageerror', (e) => errors.push(e.message));
  pg.on('dialog', (d) => d.accept());
});
const page = await ctx.newPage();
await page.goto('http://localhost:4173/?e2e');
await page.waitForSelector('.topbar');

const toClient = (vpIndex, p) =>
  page.evaluate(({ vpIndex, p }) => {
    const { ops } = window.__bv;
    const vp = ops.getViewport(vpIndex);
    const c = ops.imageToCanvas(vp, ops.currentImageId(vp), p);
    const r = document.querySelector(`[data-vp="${vpIndex}"] .vp-element`).getBoundingClientRect();
    return [r.left + c[0], r.top + c[1]];
  }, { vpIndex, p });
async function drag(vpIndex, a, b) {
  const [x1, y1] = await toClient(vpIndex, a);
  const [x2, y2] = await toClient(vpIndex, b);
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 });
  await page.mouse.move(x2, y2, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}
const svgText = (i = 0) => page.evaluate((i) => [...document.querySelectorAll(`[data-vp="${i}"] svg text`)].map((t) => t.textContent).join(' | '), i);
const svgLines = (i = 0) => page.evaluate((i) => document.querySelectorAll(`[data-vp="${i}"] svg line`).length, i);
/** sum of alpha in a small box of a canvas at image coordinate p */
const canvasInk = (sel, vpIndex, p) =>
  page.evaluate(({ sel, vpIndex, p }) => {
    const { ops } = window.__bv;
    const vp = ops.getViewport(vpIndex);
    const c = ops.imageToCanvas(vp, ops.currentImageId(vp), p);
    const cv = document.querySelector(`[data-vp="${vpIndex}"] ${sel}`);
    const dpr = cv.width / cv.clientWidth;
    const d = cv.getContext('2d').getImageData(Math.round(c[0] * dpr) - 4, Math.round(c[1] * dpr) - 4, 9, 9).data;
    let s = 0;
    for (let i = 3; i < d.length; i += 4) s += d[i];
    return s;
  }, { sel, vpIndex, p });

// data
await page.locator('input[type=file][webkitdirectory]').setInputFiles('testdata/mixed/ct_phantom');
await page.waitForSelector('text=Import abgeschlossen', { timeout: 60000 });
await page.getByRole('button', { name: 'OK', exact: true }).click();
await page.locator('.study-main').first().click();
await page.locator('.series-card').first().click();
await page.waitForTimeout(1200);
await page.evaluate(() => window.__bv.ops.scrollTo(20, 0));
await page.waitForTimeout(400);

// ---- text style for new measurements ----
const panel = page.locator('.psec', { hasText: 'Messungen' }).first();
await panel.locator('select').nth(1).selectOption('24'); // font size
await panel.locator('select').nth(0).selectOption('Times New Roman');
await panel.locator('.text-style .swatch').nth(3).click(); // yellow text
await page.keyboard.press('l');
await drag(0, [20, 64], [100, 64]);
const tAttr = await page.evaluate(() => {
  const t = document.querySelector('[data-vp="0"] svg text');
  return t ? { fill: t.getAttribute('fill'), size: t.getAttribute('font-size') || t.style.fontSize, font: t.getAttribute('font-family') || t.style.fontFamily } : null;
});
ok('Schriftfarbe, -art und -größe für neue Messungen', !!tAttr && /fdd835/i.test(tAttr.fill || '') && /24px/.test(tAttr.size || '') && /Times/.test(tAttr.font || ''), JSON.stringify(tAttr));

// ---- show values toggle ----
await panel.getByText('Messwerte als Zahl anzeigen').click();
await page.waitForTimeout(300);
const tOff = await svgText();
const lOff = await svgLines();
ok('Messwerte abwählbar: nur Linie, keine Zahl', tOff.trim() === '' && lOff >= 1, `Text "${tOff}", Linien ${lOff}`);
await panel.getByText('Messwerte als Zahl anzeigen').click();
await page.waitForTimeout(300);
ok('Messwerte wieder einblendbar', /mm/.test(await svgText()), await svgText());

// ---- persistent across slices ----
await page.evaluate(() => window.__bv.ops.scrollTo(25, 0));
await page.waitForTimeout(500);
const inkBefore = await canvasInk('.vp-overlay', 0, [60, 64]);
await panel.getByText('Messung über Einzelbild hinaus sichtbar machen').click();
await page.waitForTimeout(500);
const inkAfter = await canvasInk('.vp-overlay', 0, [60, 64]);
ok('Messung bleibt beim Blättern auf anderem Bild sichtbar (gestrichelt)', inkBefore === 0 && inkAfter > 0, `Pixel-Deckung vorher ${inkBefore}, nachher ${inkAfter}`);
// measure a 2nd line on slice 25 while the first one is visible
await page.keyboard.press('l');
await drag(0, [20, 90], [100, 90]);
const n2 = await page.evaluate(() => window.__bv.tools.annotation.state.getAllAnnotations().length);
ok('Weitere Messung auf anderem Bild bei sichtbarer erster Linie', n2 === 2, `${n2} Messungen`);
await page.screenshot({ path: `${OUT}/f1-persist.png` });

// ---- delete all (series) ----
await panel.getByRole('button', { name: 'Alle Annotationen löschen' }).click();
await page.getByRole('button', { name: 'Nur diese Serie' }).click();
await page.waitForTimeout(500);
const n3 = await page.evaluate(() => window.__bv.tools.annotation.state.getAllAnnotations().length);
ok('Alle Annotationen der Serie gelöscht', n3 === 0, `${n3} übrig`);

// ---- overlay mode ----
await page.getByRole('button', { name: 'Überlagern' }).click();
await page.waitForTimeout(600);
ok('Überlagern schaltet in 2-Felder-Ansicht', (await page.locator('.grid-cell').count()) === 2);
await page.evaluate(() => window.__bv.ops.scrollTo(10, 0));
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Bild zur Überlagerung übernehmen' }).click();
await page.waitForTimeout(1500);
const rightIdx = await page.evaluate(() => window.__bv.ops.getViewport(1).getCurrentImageIdIndex());
ok('1. Bild erscheint rechts', rightIdx === 10, `rechts Bild-Index ${rightIdx}`);
await page.evaluate(() => window.__bv.ops.scrollTo(20, 0));
await page.waitForTimeout(400);
await page.getByRole('button', { name: '2. Ebene zur Überlagerung auswählen' }).click();
await page.waitForTimeout(2500);
// sphere is only on slices ~10-30; slice 10 (z=-10) has no sphere at center, slice 20 (z=0) has: overlay adds brightness at center
const ulInk = await canvasInk('.vp-underlay', 1, [64, 64]);
const st = await page.evaluate(() => ({ stage: window.__bv.store.getState().overlay.stage, alpha: window.__bv.store.getState().overlay.alpha }));
ok('2. Ebene rechts mit 50 % Transparenz überlagert', st.stage === 'ready' && st.alpha === 0.5 && ulInk > 0, JSON.stringify({ ...st, ulInk }));
await page.locator('[data-vp="1"]').click({ position: { x: 30, y: 30 } });
await page.keyboard.press('l');
await drag(1, [30, 40], [90, 40]);
ok('Messfunktionen rechts aktiv', /mm/.test(await svgText(1)), await svgText(1));
await page.screenshot({ path: `${OUT}/f2-overlay-ready.png` });
await page.getByRole('button', { name: 'Überlagerung zur weiteren Überarbeitung übernehmen' }).click();
await page.waitForTimeout(1500);
const fin = await page.evaluate(() => ({ layout: window.__bv.store.getState().layout, stage: window.__bv.store.getState().overlay.stage, idx: window.__bv.ops.getViewport(0).getCurrentImageIdIndex() }));
const exportBtn = page.locator('.tb-btn.ovl-export');
ok('Übernahme: 1-Feld-Ansicht, Export hervorgehoben', fin.layout === 1 && fin.stage === 'final' && fin.idx === 10 && (await exportBtn.getAttribute('class')).includes('highlight') && (await exportBtn.isEnabled()), JSON.stringify(fin));
const ul2 = await canvasInk('.vp-underlay', 0, [64, 64]);
ok('Überlagerung im 1-Feld-Modus sichtbar', ul2 > 0, `Deckung ${ul2}`);
await page.screenshot({ path: `${OUT}/f3-overlay-final.png` });
for (const [label, withAnn] of [['Ohne Annotationen', false], ['Mit Annotationen', true]]) {
  await exportBtn.click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: label }).click()]);
  const f = `${OUT}/ovl-${withAnn ? 'mit' : 'ohne'}.jpg`;
  await dl.saveAs(f);
  const b = fs.readFileSync(f);
  ok(`Export überlagertes Bild als JPEG (${label.toLowerCase()})`, b[0] === 0xff && b[1] === 0xd8 && /\.jpg$/.test(dl.suggestedFilename()), `${dl.suggestedFilename()}, ${b.length} B`);
}
ok('Keine unbehandelten Laufzeitfehler', errors.length === 0, errors.slice(0, 3).join(' / '));
fs.writeFileSync(`${OUT}/features.json`, JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} bestanden`);
await browser.close();
