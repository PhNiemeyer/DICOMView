// Screenshots for the manual with the example X-ray (docs/handbuch/src/beispiel-roentgen.jpg).
// Needs `npx vite preview --port 4173`. Usage: node tools/handbuch-shots.cjs
const { chromium } = require('playwright');
const OUT = 'docs/handbuch/img';
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { try { localStorage.setItem('bildviewer.settings.v1', JSON.stringify({ lang: 'de' })); } catch {} });
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept());
  await p.goto('http://localhost:4173/?e2e');
  await p.waitForSelector('.topbar');
  await p.locator('input[type=file]:not([webkitdirectory])').setInputFiles('docs/handbuch/src/beispiel-roentgen.jpg');
  await p.waitForSelector('text=Import abgeschlossen');
  await p.getByRole('button', { name: 'OK', exact: true }).click();
  await p.waitForSelector('text=Bilddateien zuordnen');
  await p.getByText('Neuer Patient').click();
  await p.locator('.modal .row2 input').first().fill('Beispiel Röntgen');
  await p.locator('.modal .row2').nth(1).locator('input').nth(1).fill('Knie seitlich, intraoperativ');
  await p.getByRole('button', { name: 'Zuordnen', exact: true }).click();
  await p.waitForTimeout(800);
  await p.locator('.study-main').first().click();
  await p.locator('.series-card').first().click();
  await p.waitForTimeout(1500);

  const toClient = (pt) => p.evaluate((pt) => {
    const { ops } = window.__bv; const vp = ops.getViewport(0);
    const c = ops.imageToCanvas(vp, ops.currentImageId(vp), pt);
    const r = document.querySelector('[data-vp="0"] .vp-element').getBoundingClientRect();
    return [r.left + c[0], r.top + c[1]];
  }, pt);
  const drag = async (a, c) => {
    const [x1, y1] = await toClient(a); const [x2, y2] = await toClient(c);
    await p.mouse.move(x1, y1); await p.mouse.down();
    await p.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 }); await p.mouse.move(x2, y2, { steps: 4 });
    await p.mouse.up(); await p.waitForTimeout(250);
  };
  const setPoints = (pts) => p.evaluate((pts) => {
    const { tools, core, ops } = window.__bv;
    const all = tools.annotation.state.getAllAnnotations(); const a = all[all.length - 1];
    a.data.handles.points = pts.map((q) => core.utilities.imageToWorldCoords(a.metadata.referencedImageId, q));
    a.invalidated = true; ops.renderAllAnnotations();
  }, pts);
  const deselect = () => p.evaluate(() => { const { tools, ops } = window.__bv; for (const a of tools.annotation.state.getAllAnnotations()) tools.annotation.selection.setAnnotationSelected(a.annotationUID, false); ops.renderAllAnnotations(); });

  // 2-line angle between the two K-wires (yellow, larger text)
  const panel = p.locator('.psec', { hasText: 'Messungen' }).first();
  await panel.locator('.swatches').first().locator('.swatch').nth(3).click(); // line yellow
  await panel.locator('select').nth(1).selectOption('20');
  await p.keyboard.press('c');
  await drag([100, 746], [703, 391]);
  await drag([145, 818], [688, 416]);
  await setPoints([[100, 746], [703, 391], [145, 818], [688, 416]]);
  await deselect();
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/uebersicht.png` });

  // length + 3-point angle, select the 2-line angle to show its panel
  await panel.locator('.swatches').first().locator('.swatch').nth(6).click(); // turquoise
  await p.keyboard.press('l');
  await drag([330, 560], [700, 360]);
  await setPoints([[300, 345], [745, 352]]);
  await p.keyboard.press('a');
  for (const q of [[300, 345], [745, 352], [700, 395]]) { const [x, y] = await toClient(q); await p.mouse.click(x, y); await p.waitForTimeout(150); }
  await setPoints([[300, 345], [745, 352], [520, 980]]);
  await p.evaluate(() => {
    const { tools, ops } = window.__bv; const all = tools.annotation.state.getAllAnnotations();
    const cobb = all.find((a) => a.metadata.toolName === 'CobbAngle');
    cobb.data.bvAngleMode = 'both';
    tools.annotation.selection.setAnnotationSelected(cobb.annotationUID, true); ops.renderAllAnnotations();
  });
  await p.waitForTimeout(1300);
  await p.screenshot({ path: `${OUT}/messen.png` });

  // mask demonstration
  await deselect();
  await p.keyboard.press('m');
  await p.waitForTimeout(300);
  await drag([110, 250], [330, 315]);
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/maske.png` });
  await b.close();
})();
