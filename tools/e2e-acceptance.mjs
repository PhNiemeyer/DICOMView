// Automated acceptance test (headless Chromium). Usage:
//   npm run build && npx vite preview --port 4173 &  node tools/e2e-acceptance.mjs <screenshot-dir>
import { createRequire } from 'module';
import fs from 'fs';
import { execFileSync } from 'child_process';
const { chromium } = createRequire(import.meta.url)('playwright');

const OUT = process.argv[2] || 'test-results';
fs.mkdirSync(OUT, { recursive: true });
const URL0 = 'http://localhost:4173/?e2e';
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
  } catch {
    /* about:blank */
  }
});
const external = [];
ctx.on('request', (r) => {
  const u = new URL(r.url());
  if (!['localhost', '127.0.0.1'].includes(u.hostname) && !['data:', 'blob:'].includes(u.protocol)) external.push(r.url());
});
const errors = [];
ctx.on('page', (pg) => {
  pg.on('pageerror', (e) => errors.push(e.message));
  pg.on('dialog', (d) => d.accept());
});
const page = await ctx.newPage();

await page.goto(URL0);
await page.waitForSelector('.topbar');

// ---------- helpers ----------
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
async function toClient(vpIndex, p) {
  return page.evaluate(
    ({ vpIndex, p }) => {
      const { ops } = window.__bv;
      const vp = ops.getViewport(vpIndex);
      const id = ops.currentImageId(vp);
      const c = ops.imageToCanvas(vp, id, p);
      const r = document.querySelector(`[data-vp="${vpIndex}"] .vp-element`).getBoundingClientRect();
      return [r.left + c[0], r.top + c[1]];
    },
    { vpIndex, p },
  );
}
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
const svgText = (vpIndex = 0) => page.evaluate((i) => [...document.querySelectorAll(`[data-vp="${i}"] svg text`)].map((t) => t.textContent).join(' | '), vpIndex);
// sets the last annotation's handles to exact image pixel positions (mouse input is rounded to screen pixels)
async function setPoints(pts) {
  await page.evaluate((pts) => {
    const { tools, core, ops } = window.__bv;
    const all = tools.annotation.state.getAllAnnotations();
    const a = all[all.length - 1];
    const id = a.metadata.referencedImageId;
    a.data.handles.points = pts.map((p) => core.utilities.imageToWorldCoords(id, p));
    a.invalidated = true;
    tools.annotation.state.triggerAnnotationModified?.(a);
    ops.renderAllAnnotations();
  }, pts);
  await page.waitForTimeout(400);
}
const tool = (name) => page.locator('.toolbar').getByRole('button', { name, exact: false }).first().click();
async function openSeries(studyText, seriesText) {
  await page.locator('.study-main', { hasText: studyText }).first().click();
  await page.locator('.series-card', { hasText: seriesText }).first().click();
  await page.waitForTimeout(1200);
}
async function clearAnnotations() {
  await page.evaluate(() => window.__bv.tools.annotation.state.removeAllAnnotations());
}
async function selectLastAnnotation() {
  await page.evaluate(() => {
    const { tools } = window.__bv;
    const all = tools.annotation.state.getAllAnnotations();
    tools.annotation.selection.setAnnotationSelected(all[all.length - 1].annotationUID, true);
  });
  await page.waitForTimeout(1200); // panel polls once a second
}

// ---------- 1. import mixed folder ----------
await page.locator('input[type=file][webkitdirectory]').setInputFiles('testdata/mixed');
await page.waitForSelector('text=Import abgeschlossen', { timeout: 60000 });
const stats = await page.locator('.stats').innerText();
ok('Import gemischter Ordner (40 CT, 1 SC, 3 DX, 3 Bilder)', /Importiert: 47/.test(stats), stats.replace(/\n/g, ' '));
const issues = await page.locator('.issues').innerText();
ok('Fehlerhafte Dateien verständlich gemeldet, Import läuft weiter', /beschädigt/.test(issues) && /Leere Datei/.test(issues) && /Nicht unterstützt/.test(issues));
await shot('01-import');
await page.getByRole('button', { name: 'OK', exact: true }).click();
await page.waitForSelector('text=Bilddateien zuordnen');
await page.getByText('Neuer Patient').click();
await page.locator('.modal .row2 input').first().fill('Fotos Testperson');
await page.getByRole('button', { name: 'Zuordnen', exact: true }).click();
await page.waitForTimeout(1000);

const patText = await page.locator('.patients .side-scroll').innerText();
const annaCount = (patText.match(/Muster Anna/g) || []).length;
ok('Gleicher Name, andere Patienten-ID → getrennte Patienten', annaCount === 2, `Muster Anna ×${annaCount}`);
const benIdx = patText.indexOf('10.06.2025');
ok('Untersuchungen absteigend nach Datum', benIdx >= 0 && benIdx < patText.indexOf('15.01.2023'));
ok('Bilddateien einem neuen Patienten zugeordnet', patText.includes('Fotos Testperson'));

// re-import same folder → duplicates
await page.locator('input[type=file][webkitdirectory]').setInputFiles('testdata/mixed');
await page.waitForSelector('text=Import abgeschlossen', { timeout: 60000 });
const stats2 = await page.locator('.stats').innerText();
ok('DICOM- und Bild-Duplikate erkannt', /Importiert: 0/.test(stats2) && /Duplikate übersprungen: 47/.test(stats2), stats2.replace(/\n/g, ' '));
await page.getByRole('button', { name: 'OK', exact: true }).click();

// ---------- 2. CT: sorting, display ----------
await openSeries('12.03.2025', 'CT Knie axial');
const order = await page.evaluate(() => {
  const { ops, reg } = window.__bv;
  const vp = ops.getViewport(0);
  return vp.getImageIds().map((id) => reg.keyToInstance.get(reg.imageIdToKey.get(id)).ipp[2]);
});
ok('Serie nach Geometrie (ImagePositionPatient) sortiert', order.length === 40 && order.every((z, i) => i === 0 || z > order[i - 1]), `z: ${order.slice(0, 4).join(',')}…`);
await page.keyboard.press('PageDown');
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(500);
const idx = await page.evaluate(() => window.__bv.ops.getViewport(0).getCurrentImageIdIndex());
ok('Schichtnavigation per Tastatur', idx === 11, `Index ${idx}`);
await page.locator('.toolbar select').selectOption('presetBone');
await page.waitForTimeout(300);
const ww = await page.evaluate(() => window.__bv.ops.getWindow(window.__bv.ops.getViewport(0)));
ok('CT-Fensterpreset Knochen (2000/400)', Math.round(ww.ww) === 2000 && Math.round(ww.wl) === 400, JSON.stringify(ww));
await shot('02-ct');

// ---------- 3. DX: length + magnification 1.1 ----------
await openSeries('10.06.2025', 'DX ohne ERMF');
await clearAnnotations();
await tool('Länge');
await drag(0, [200, 400], [700, 400]);
await setPoints([[200, 400], [700, 400]]);
let txt = await svgText();
ok('Länge DX (500 px × 0,1 mm Imager Spacing = 50,0 mm)', /50,0 mm/.test(txt), txt);
await page.getByRole('tab', { name: 'Vergrößerungsfaktor 1,1' }).click();
await page.getByRole('button', { name: 'Faktor 1,1 anwenden' }).click();
await page.waitForTimeout(400);
txt = await svgText();
ok('Vergrößerungsfaktor 1,1: 50,0 → 45,5 mm, gekennzeichnet', /45,5 mm \(÷1,1\)/.test(txt), txt);
const flag = await page.locator('[data-vp="0"] .vp-info.bl').innerText();
ok('Aktive Annahme im Bildfeld sichtbar', /1\/1,1/.test(flag), flag);

// transformations keep geometry
await page.keyboard.press('r');
await page.keyboard.press('h');
await page.evaluate(() => { const vp = window.__bv.ops.getViewport(0); vp.setZoom(1.7); vp.setPan([40, -25]); vp.render(); });
await page.waitForTimeout(600);
txt = await svgText();
const geo = await page.evaluate(() => {
  const { ops, tools } = window.__bv;
  const vp = ops.getViewport(0);
  const id = ops.currentImageId(vp);
  const expect = ops.imageToCanvas(vp, id, [200, 400]);
  const line = document.querySelector('[data-vp="0"] svg line');
  const pts = [[+line.getAttribute('x1'), +line.getAttribute('y1')], [+line.getAttribute('x2'), +line.getAttribute('y2')]];
  return Math.min(...pts.map((p) => Math.hypot(p[0] - expect[0], p[1] - expect[1])));
});
ok('Messung bleibt bei Drehen/Spiegeln/Zoom/Verschieben am Bildpunkt und korrekt', /45,5 mm/.test(txt) && geo < 2, `Abweichung ${geo.toFixed(2)} px`);
await shot('03-dx-transform');
await page.keyboard.press('0');

// ---------- 4. DX with ERMF: 1.1 not applied twice ----------
await openSeries('10.06.2025', 'DX mit ERMF');
await clearAnnotations();
await tool('Länge');
await drag(0, [200, 400], [700, 400]);
await setPoints([[200, 400], [700, 400]]);
txt = await svgText();
ok('ERMF berücksichtigt (50 mm ÷ 1,1 = 45,5 mm)', /45,5 mm/.test(txt) && !/÷1,1/.test(txt), txt);
await page.getByRole('tab', { name: 'Vergrößerungsfaktor 1,1' }).click();
ok('Faktor 1,1 bei bereits korrigierter Vergrößerung gesperrt', await page.getByText('Nicht anwendbar').isVisible());

// sphere calibration on DX: circle diameter 200 px, sphere 25 mm
await clearAnnotations();
await tool('Kreis');
await drag(0, [500, 600], [600, 600]);
await setPoints([[500, 600], [600, 600]]);
await selectLastAnnotation();
await page.getByRole('tab', { name: 'Referenzkugel' }).click();
await page.locator('.cal-box input').fill('25');
await page.getByRole('button', { name: 'Zusammenfassung' }).click();
const sum = await page.locator('.summary').innerText();
ok('Referenzkugel: Zusammenfassung vor Übernahme', /0,1250 mm\/px/.test(sum), sum.replace(/\n/g, ' '));
await page.getByRole('button', { name: 'Übernehmen' }).click();
await page.waitForTimeout(400);
txt = await svgText();
ok('Referenzkugel-Kalibrierung angewendet (Kreis Ø 25,0 mm)', /Ø 25,0 mm/.test(txt), txt);

// ---------- 5. JPEG: pixels only, 1.1 refused, known distance ----------
await page.locator('.pat', { hasText: 'Fotos Testperson' }).locator('.study-main').first().click();
await page.locator('.series-card', { hasText: 'photo.jpg' }).first().click();
await page.waitForTimeout(1200);
await clearAnnotations();
await tool('Länge');
await drag(0, [100, 200], [200, 200]);
await setPoints([[100, 200], [200, 200]]);
txt = await svgText();
ok('JPEG ohne Kalibrierung: nur Pixelwerte', /100 px/.test(txt) && !/mm/.test(txt), txt);
await page.getByRole('tab', { name: 'Vergrößerungsfaktor 1,1' }).click();
ok('Faktor 1,1 ohne physikalische Basis abgelehnt (keine Schein-mm)', await page.getByText('Nicht möglich').isVisible());
await selectLastAnnotation();
await page.getByRole('tab', { name: 'Bekannte Strecke' }).click();
await page.locator('.cal-box input').fill('10');
await page.getByRole('button', { name: 'Zusammenfassung' }).click();
await page.getByRole('button', { name: 'Übernehmen' }).click();
await page.waitForTimeout(400);
txt = await svgText();
ok('Bekannte Strecke: 100 px ≙ 10 mm → 10,0 mm', /10,0 mm/.test(txt), txt);
await tool('Kreis');
await drag(0, [400, 200], [500, 200]);
await setPoints([[400, 200], [500, 200]]);
txt = await svgText();
ok('Kreis nach Kalibrierung (200 px → Ø 20,0 mm)', /Ø 20,0 mm/.test(txt), txt);

// angles
await clearAnnotations();
await tool('Winkel');
for (const p of [[100, 100], [200, 200], [300, 100]]) {
  const [x, y] = await toClient(0, p);
  await page.mouse.click(x, y);
  await page.waitForTimeout(150);
}
await setPoints([[100, 100], [200, 200], [300, 100]]);
txt = await svgText();
ok('Dreipunktwinkel 90°', /90,0°/.test(txt), txt);
await clearAnnotations();
await tool('2-Linien-Winkel');
await drag(0, [50, 300], [150, 300]);
await drag(0, [350, 50], [350 + 86.6025, 50 + 50]);
await setPoints([[50, 300], [150, 300], [350, 50], [350 + 86.60254, 100]]);
await page.waitForTimeout(300);
txt = await svgText();
ok('Zweilinienwinkel ohne Berührung: Innenwinkel 30,0°', /30,0° \(innen\)/.test(txt), txt);
await selectLastAnnotation();
await page.locator('.psec', { hasText: 'Ausgewählte Messung' }).locator('select').selectOption('both');
await page.waitForTimeout(300);
txt = await svgText();
ok('Ergänzungswinkel eindeutig wählbar (150,0°)', /150,0° \(Ergänzung\)/.test(txt), txt);
await page.locator('.psec', { hasText: 'Ausgewählte Messung' }).locator('.swatch').nth(2).click();
await page.waitForTimeout(300);
const stroke = await page.locator('[data-vp="0"] svg line').first().getAttribute('stroke');
ok('Farbe nachträglich änderbar (Rot)', (stroke || '').toLowerCase() === '#e53935', stroke);
await shot('04-jpeg-angles');

// ---------- 6. masks + export ----------
await openSeries('12.03.2025', 'CT Knie axial');
await clearAnnotations();
await tool('Länge');
await drag(0, [20, 64], [100, 64]);
await tool('Maske');
await page.locator('.psec', { hasText: 'Maskierung' }).locator('select').selectOption('series');
await drag(0, [2, 2], [42, 14]);
const maskCount = await page.evaluate(() => window.__bv.reg.masksFor(window.__bv.reg.imageIdToKey.get(window.__bv.ops.currentImageId(window.__bv.ops.getViewport(0)))).length);
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(300);
const maskCount2 = await page.evaluate(() => window.__bv.reg.masksFor(window.__bv.reg.imageIdToKey.get(window.__bv.ops.currentImageId(window.__bv.ops.getViewport(0)))).length);
ok('Serienmaske auf allen Schichten beim Scrollen sichtbar', maskCount === 1 && maskCount2 === 1);
await page.keyboard.press('ArrowUp');
await shot('05-mask');

await page.getByRole('button', { name: 'Screenshot' }).click();
await page.waitForSelector('.preview-box img');
await page.getByText('Mit Messungen und Annotationen').click(); // → without measurements
await page.waitForTimeout(1500);
const res = await page.locator('.export-form .strong').innerText();
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Herunterladen' }).click()]);
const file = `${OUT}/export-${dl.suggestedFilename()}`;
await dl.saveAs(file);
ok('Neutraler Dateiname ohne Patientendaten', /^dicomview_\d{8}-\d{6}\.png$/.test(dl.suggestedFilename()), dl.suggestedFilename());
await page.keyboard.press('Escape');
// analyse PNG in python: masked area uniform black even after brightening, original resolution
const analysis = execFileSync('python3', ['-I', '-c', `
import sys, json
from PIL import Image
import numpy as np
im = np.asarray(Image.open(sys.argv[1]).convert('L')).astype(float)
h, w = im.shape
# find the image (non-black) bounding box
s = h / 128.0  # image fills the viewport height (fit), width is letterboxed
x0 = (w - 128 * s) / 2; y0 = 0
# burned-in text was rows 4..11, cols 4..39 (image px)
reg = im[int(y0 + 5*s):int(y0 + 11*s), int(x0 + 5*s):int(x0 + 38*s)]
bright = np.clip(reg * 8 + 50, 0, 255)
print(json.dumps({"w": int(w), "h": int(h), "scale": round(float(s), 3), "maskMax": float(reg.max()), "brightStd": float(bright.std())}))
`, file]).toString();
const an = JSON.parse(analysis);
ok('Maskierte Pixel im Export ersetzt, auch nach Aufhellen nicht sichtbar', an.maskMax <= 1 && an.brightStd < 0.5, analysis.trim());
ok('Export in Originalauflösung (1 Bildpixel ≈ 1 Exportpixel)', Math.abs(an.scale - 1) < 0.08, `${res}, Skalierung ${an.scale}`);

// ---------- 7. video ----------
await page.getByRole('button', { name: 'Video' }).click();
const fmtText = await page.locator('.float-panel').innerText();
await page.getByRole('button', { name: 'Aufnahme starten' }).click();
await page.waitForSelector('text=Aufnahme läuft', { timeout: 30000 });
for (let i = 0; i < 15; i++) {
  await page.mouse.move(800, 500);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(120);
}
const [vdl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Stoppen & speichern' }).click()]);
const vname = vdl.suggestedFilename();
const vfile = `${OUT}/video-${vname}`;
await vdl.saveAs(vfile);
const head = fs.readFileSync(vfile).subarray(0, 12);
const isMp4 = head.subarray(4, 8).toString() === 'ftyp';
const isWebm = head[0] === 0x1a && head[1] === 0x45;
ok('Videoexport: Dateiendung entspricht tatsächlichem Format', (vname.endsWith('.mp4') && isMp4) || (vname.endsWith('.webm') && isWebm), `${vname}, ${fs.statSync(vfile).size} B, ${fmtText.match(/Format: ([^)]+)/)?.[1]}`);
await page.locator('.float-panel').getByRole('button', { name: 'Schließen' }).click();

// ---------- 8. MPR ----------
await page.locator('.series-card', { hasText: 'CT Knie axial' }).click();
await page.getByRole('button', { name: 'MPR' }).first().click();
await page.waitForTimeout(4000);
const mprErr = await page.locator('.mpr-error').count();
await shot('06-mpr');
ok('MPR für geeignete CT-Serie (axial/koronar/sagittal)', mprErr === 0 && (await page.locator('.mpr-grid .viewport').count()) === 3);
await page.getByRole('button', { name: 'Zurück zum Viewer' }).click();
await openSeries('10.06.2025', 'DX ohne ERMF');
await page.getByRole('button', { name: 'MPR' }).first().click();
await page.waitForTimeout(1500);
ok('Ungeeignete Serie für MPR verständlich zurückgewiesen', (await page.locator('.mpr-error').innerText()).includes('nicht für MPR'));
await page.getByRole('button', { name: 'Zurück zum Viewer' }).first().click();

// ---------- 9. layouts + language ----------
await page.keyboard.press('4');
await page.waitForTimeout(500);
ok('Vier Bildfelder', (await page.locator('.grid-cell').count()) === 4);
await page.keyboard.press('1');
await page.getByRole('button', { name: 'Sprache' }).click();
await page.waitForTimeout(300);
const enText = await page.locator('.topbar').innerText();
ok('Englische Oberfläche', /Screenshot/.test(enText) && /Files…/.test(enText) && !/Dateien/.test(enText));
await shot('07-english');
await page.getByRole('button', { name: 'Language' }).click();

// ---------- 10. persistence + purge ----------
await page.reload();
await page.waitForSelector('.topbar');
await page.waitForTimeout(800);
ok('Arbeitsbestand übersteht Neuladen (temporär lokal)', (await page.locator('.patients .side-scroll').innerText()).includes('Beispiel Ben'));

const page2 = await ctx.newPage();
await page2.goto(URL0);
await page2.waitForSelector('.topbar');
await page2.waitForTimeout(500);
// simulate: data written yesterday 10:00 → 23:59 yesterday is due
await page.evaluate(() => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(10, 0, 0, 0);
  localStorage.setItem('bildviewer.workspaceSince', String(d.getTime()));
});
// tab re-activation triggers check
await page.evaluate(() => window.dispatchEvent(new Event('focus')));
await page.waitForTimeout(3000);
await page.waitForSelector('.topbar');
const afterPurge1 = await page.locator('.patients .side-scroll').innerText();
await page2.waitForTimeout(1500);
await page2.waitForSelector('.topbar');
const afterPurge2 = await page2.locator('.patients .side-scroll').innerText();
ok('Fällige Löschung (Aktivierung des Tabs) entfernt Arbeitsbestand', !afterPurge1.includes('Beispiel'));
ok('Zweiter Tab zeigt gelöschte Daten nicht weiter an', !afterPurge2.includes('Beispiel'));

// restart scenario: import, mark as overdue, then open fresh → nothing shown before purge
await page.locator('input[type=file][webkitdirectory]').setInputFiles('testdata/mixed/dx');
await page.waitForSelector('text=Import abgeschlossen', { timeout: 60000 });
await page2.close();
await page.evaluate(() => localStorage.setItem('bildviewer.workspaceSince', String(Date.now() - 3 * 86400000)));
await page.close();
const page3 = await ctx.newPage();
let sawPatient = false;
page3.on('framenavigated', () => undefined);
await page3.goto(URL0);
await page3.waitForSelector('.topbar');
sawPatient = (await page3.locator('.patients .side-scroll').innerText()).includes('Beispiel');
ok('Neustart nach fälliger Löschung: keine alten Daten angezeigt', !sawPatient);

// manual delete-all
await page3.locator('input[type=file][webkitdirectory]').setInputFiles('testdata/mixed/dx');
await page3.waitForSelector('text=Import abgeschlossen', { timeout: 60000 });
await page3.getByRole('button', { name: 'OK', exact: true }).click();
await page3.getByRole('button', { name: 'Einstellungen' }).click();
const chip = await page3.locator('.modal').innerText();
ok('Nächste Löschung sichtbar angezeigt', /nächste Löschung/.test(chip));
await page3.getByRole('button', { name: 'Alle lokalen Daten jetzt löschen' }).click();
await page3.waitForTimeout(2500);
await page3.waitForSelector('.topbar');
ok('„Alle lokalen Daten jetzt löschen“', !(await page3.locator('.patients .side-scroll').innerText()).includes('Beispiel'));

// ---------- 11. ZIP + limits ----------
await page3.locator('input[type=file]:not([webkitdirectory])').setInputFiles('testdata/mixed.zip');
await page3.waitForSelector('text=Import abgeschlossen', { timeout: 60000 });
const zs = await page3.locator('.stats').innerText();
ok('ZIP-Archiv mit Unterordnern lokal entpackt und importiert', /Importiert: 47/.test(zs), zs.replace(/\n/g, ' '));
await page3.getByRole('button', { name: 'OK', exact: true }).click();
await page3.getByRole('button', { name: 'Später' }).click().catch(() => undefined);
await page3.locator('input[type=file]:not([webkitdirectory])').setInputFiles('testdata/bomb.zip');
await page3.waitForSelector('text=Import abgeschlossen', { timeout: 60000 });
const bomb = await page3.locator('.modal').innerText();
ok('Stark komprimiertes Archiv nicht unkontrolliert entpackt', /komprimiert/.test(bomb), bomb.split('\n').slice(-3).join(' '));
await page3.getByRole('button', { name: 'OK', exact: true }).click();

// compression coverage: public pydicom samples
await page3.locator('input[type=file][webkitdirectory]').setInputFiles('testdata/samples');
await page3.waitForSelector('text=Import abgeschlossen', { timeout: 60000 });
const ss = await page3.locator('.modal').innerText();
console.log('   samples:', ss.replace(/\n/g, ' | ').slice(0, 600));
await page3.getByRole('button', { name: 'OK', exact: true }).click();
const decodeResults = await page3.evaluate(async () => {
  const { core, store, series: S, reg } = window.__bv;
  const st = store.getState();
  const out = [];
  for (const ser of st.series) {
    const imgs = await S.openSeries(ser);
    const id = reg.keyToImageId.get(imgs[0].instanceKey);
    const inst = imgs[0].instance;
    try {
      const im = await core.imageLoader.loadAndCacheImage(id);
      out.push({ d: ser.description || inst.fileName, ts: inst.transferSyntax, ok: im.width > 0 });
    } catch (e) {
      out.push({ d: ser.description || inst.fileName, ts: inst.transferSyntax, ok: false });
    }
  }
  return out;
});
const failed = decodeResults.filter((r) => !r.ok);
ok('Dekodierung repräsentativer Transfersyntaxen (unkomprimiert, RLE, JPEG, JPEG-LS, JPEG 2000, Deflate, Big Endian)', failed.length === 0, `${decodeResults.length - failed.length}/${decodeResults.length} ok; TS: ${[...new Set(decodeResults.map((r) => r.ts))].join(', ')}${failed.length ? '; FEHLER: ' + failed.map((f) => f.d + ' ' + f.ts).join(', ') : ''}`);

// storage limit: 2 MB; CT phantom (1.3 MB) then DX folder (3 × 1.6 MB)
await page3.getByRole('button', { name: 'Einstellungen' }).click();
await page3.getByRole('button', { name: 'Alle lokalen Daten jetzt löschen' }).click();
await page3.waitForTimeout(2500);
await page3.waitForSelector('.topbar');
await page3.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('bildviewer.settings.v1'));
  s.storageLimitMB = 2;
  localStorage.setItem('bildviewer.settings.v1', JSON.stringify(s));
});
await page3.reload();
await page3.waitForSelector('.topbar');
await page3.locator('input[type=file][webkitdirectory]').setInputFiles('testdata/mixed/ct_phantom');
await page3.waitForSelector('text=Import abgeschlossen', { timeout: 60000 });
await page3.getByRole('button', { name: 'OK', exact: true }).click();
await page3.evaluate(() => window.__bv.store.getState().set({ viewportSeries: [null, null, null, null] })); // nothing displayed → evictable
await page3.locator('input[type=file]:not([webkitdirectory])').setInputFiles('testdata/mixed/dx/dx_noermf.dcm');
await page3.waitForSelector('text=Import abgeschlossen', { timeout: 60000 });
const ev = await page3.locator('.modal').innerText();
ok('Speicherlimit: am längsten nicht verwendete Untersuchung automatisch entfernt + Hinweis', /automatisch aus dem Arbeitsbestand entfernt/.test(ev), ev.split('\n').filter((l) => /entfernt|Importiert/.test(l)).join(' / '));
await page3.getByRole('button', { name: 'OK', exact: true }).click();
const tree = await page3.locator('.patients .side-scroll').innerText();
ok('Leere Patienteneinträge entfernt', !tree.includes('Muster Anna') && tree.includes('Beispiel Ben'));
await page3.locator('.study-main').first().click();
await page3.locator('.series-card').first().click();
await page3.waitForTimeout(800);
await page3.locator('input[type=file]:not([webkitdirectory])').setInputFiles('testdata/mixed/dx/dx_ermf.dcm');
await page3.waitForSelector('text=Import abgeschlossen', { timeout: 60000 });
const lim = await page3.locator('.modal').innerText();
ok('Kein Platz freigebbar (angezeigte Untersuchung geschützt) → kontrollierter Stopp mit Erklärung', /Speicherlimit ist erreicht/.test(lim), lim.split('\n').filter((l) => /gestoppt|Importiert/.test(l)).join(' / '));
await page3.screenshot({ path: `${OUT}/08-limit.png` });

ok('Keine Netzwerkanfragen an externe Dienste', external.length === 0, external.slice(0, 3).join(', '));
ok('Keine unbehandelten Laufzeitfehler', errors.length === 0, errors.slice(0, 3).join(' / '));

fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} bestanden`);
await browser.close();
