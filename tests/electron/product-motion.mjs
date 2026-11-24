import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, electronExecutable, electronSafeEnv } from '../../scripts/lib/paths.mjs';

const modules = process.env.BOOKKEEP_QA_NODE_MODULES
  ?? 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { _electron } = createRequire(path.join(modules, 'qa.cjs'))('playwright');
const localAppData = mkdtempSync(path.join(tmpdir(), 'BookKeep stats motion '));
const app = await _electron.launch({
  executablePath: electronExecutable(),
  args: [ROOT, '--force-device-scale-factor=1'],
  cwd: ROOT,
  env: electronSafeEnv({ LOCALAPPDATA: localAppData }),
  timeout: 30000,
});

try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 850));
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('[data-ledger-total]').waitFor();

  const noticeAnimations = await page.evaluate(() => {
    const layer = document.createElement('aside');
    layer.className = 'achievement-notice-layer';
    layer.setAttribute('aria-hidden', 'true');
    layer.style.setProperty('--notice-enter', '260ms');
    layer.style.setProperty('--notice-exit', '180ms');
    const card = document.createElement('div');
    card.className = 'achievement-notice';
    layer.append(card);
    document.body.append(layer);
    const animations = {};
    for (const position of ['center', 'bottom-right']) {
      layer.dataset.position = position;
      animations[position] = ['entering', 'visible', 'exiting'].map(phase => {
        card.dataset.phase = phase;
        return getComputedStyle(card).animationName;
      });
    }
    layer.remove();
    return animations;
  });
  assert.deepEqual(noticeAnimations, {
    center: ['achievement-appear', 'none', 'achievement-disappear'],
    'bottom-right': ['achievement-appear-corner', 'none', 'achievement-disappear'],
  });
  console.log('PASS achievement notice enters once and keeps its exit animation in both positions');

  await page.locator('[data-nav-item="statistics"]').click();
  await page.locator('[data-statistics-total="0"]').waitFor();
  const refresh = page.getByRole('button', { name: '刷新统计', exact: true });
  const metric = page.locator('[data-statistics-total] .metric-value').first();

  async function seed(amountFen) {
    const reply = await page.evaluate(amountFen => window.bookkeep.transaction.create({
      amountFen,
      occurredDate: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(),
      occurredTime: null,
      timePrecision: 'date',
      name: '动效回归',
      merchant: null,
      categoryId: 'cat_food',
      note: null,
    }), amountFen);
    assert.equal(reply.ok, true, JSON.stringify(reply));
  }

  await seed(123456);
  const frames = await page.evaluate(() => new Promise(resolve => {
    const firstMetric = document.querySelector('.metric-value');
    const startedAt = performance.now();
    const frames = [];
    const sample = () => {
      const metric = document.querySelector('.metric-value');
      const snapshot = document.querySelector('[data-statistics-total]');
      frames.push({
        sameMetric: metric === firstMetric,
        cents: Math.round(Number(metric?.textContent.slice(1)) * 100),
        target: snapshot?.dataset.statisticsTotal,
      });
      if (performance.now() - startedAt < 550) requestAnimationFrame(sample);
      else resolve(frames);
    };
    [...document.querySelectorAll('button')].find(button => button.textContent === '刷新统计').click();
    requestAnimationFrame(sample);
  }));
  assert(frames.every(frame => frame.sameMetric));
  assert(frames.some(frame => frame.target === '123456' && frame.cents > 0 && frame.cents < 123456));
  assert.equal(await metric.innerText(), '¥1234.56');
  console.log('PASS statistics counter interpolates without remounting and settles exactly');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seed(6544);
  await refresh.click();
  await page.locator('[data-statistics-total="130000"]').waitFor();
  assert.equal(await metric.innerText(), '¥1300.00');
  assert.equal(await page.locator('.chart-selection').evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  console.log('PASS reduced motion shows the exact total and disables the chart transition');
} finally {
  await app.close();
}
