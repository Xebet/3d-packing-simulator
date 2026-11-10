'use strict';

// Optional real-browser checks. Uses installed Puppeteer; no runtime dependencies.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { execSync } = require('node:child_process');
const { existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
    let puppeteer;
    const roots = [process.env.PUPPETEER_ROOT, process.cwd()].filter(Boolean);
    try { roots.push(path.dirname(execSync('npm root -g', { encoding: 'utf8' }).trim())); } catch {}
    for (const root of roots) {
        try { puppeteer = createRequire(path.join(root, 'noop.cjs'))('puppeteer-core'); break; } catch {}
    }
    if (!puppeteer) throw new Error('Install puppeteer-core locally or globally to run browser checks');
    const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(file => file && existsSync(file));
    if (!executablePath) throw new Error('Set CHROME_PATH to Chrome or Chromium');
    // Hosted CI has no physical GPU; use Chrome's software renderer for functional checks.
    const args = process.env.CI ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [];
    const browser = await puppeteer.launch({ executablePath, headless: true, args });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 900 });
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
        await page.evaluateOnNewDocument(() => localStorage.setItem('packing_theme', 'dark'));
        const errors = [], remote = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => { if (/^https?:/.test(request.url())) remote.push(request.url()); });
        const url = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
        await page.goto(url, { waitUntil: 'load' });
        await page.waitForSelector('#canvas-container canvas');
        assert.equal(await page.$eval('#tour-overlay', el => getComputedStyle(el).display), 'none');
        assert.deepEqual(errors, []);
        assert.equal(await page.$eval('html', el => el.classList.contains('light-theme')), true);
        assert.equal(await page.$eval('#theme-toggle', el => el.value), 'system');
        console.log('PASS offline startup and unobstructed workbench');
        await page.$eval('.delete-item-btn', el => el.click());
        assert.equal(await page.evaluate(() => inventory.length), 2);
        await page.$eval('#undo-inventory-btn', el => el.click());
        assert.equal(await page.evaluate(() => inventory.length), 3);
        console.log('PASS inventory deletion can be undone');

        const set = async (selector, value) => page.$eval(selector, (el, value) => {
            el.value = value; el.dispatchEvent(new Event('change', { bubbles: true }));
        }, String(value));
        await set('#bin-empty-weight', 0);
        assert.match(await page.$eval('#v-total-weight', el => el.textContent), /^0\.0 kg/);
        console.log('PASS zero empty weight is preserved');

        await page.evaluate(() => {
            window.actualWorkerFactory = PackingJobs.createWorker;
            PackingJobs.createWorker = () => ({ postMessage() {}, terminate() {} });
        });
        await page.click('#run-pack-btn');
        await page.waitForFunction(() => document.getElementById('run-pack-btn').disabled);
        await page.waitForSelector('#loading-modal', { visible: true });
        await page.click('#cancel-pack-btn');
        await page.waitForFunction(() => !document.getElementById('run-pack-btn').disabled);
        assert.match(await page.$eval('#workspace-status', el => el.textContent), /取消/);
        assert.equal(await page.$eval('main', el => el.inert), false);
        await page.evaluate(() => { PackingJobs.createWorker = window.actualWorkerFactory; });
        console.log('PASS cancellation restores controls and focus');

        await page.click('#run-pack-btn');
        await page.waitForFunction(() => !document.getElementById('run-pack-btn').disabled, { timeout: 60000 });
        assert.match(await page.$eval('#stat-packed-count', el => el.textContent), /^45 \/ 45/);
        assert.equal(await page.evaluate(() => Packer.validatePackingResult(autoPackedItems, 40, 50, 60).valid), true);
        if (process.env.BROWSER_ARTIFACT_DIR) {
            mkdirSync(process.env.BROWSER_ARTIFACT_DIR, { recursive: true });
            await page.screenshot({ path: path.join(process.env.BROWSER_ARTIFACT_DIR, 'packing-light.png'), fullPage: true });
        }
        console.log('PASS real Blob Workers pack and validate the preset');
        const fastSearch = await page.evaluate(async () => {
            const original = performParallelPacking;
            const modal = document.getElementById('loading-modal');
            let openings = 0;
            const observer = new MutationObserver(() => { if (modal.style.display !== 'none') openings++; });
            observer.observe(modal, { attributes: true, attributeFilter: ['style'] });
            const signature = Packer.layoutSignature(autoPackedItems);
            try {
                performParallelPacking = async () => ({ noAlternative: true });
                await calculatePacking(true);
                await new Promise(resolve => setTimeout(resolve, 350));
                return { openings, preserved: signature === Packer.layoutSignature(autoPackedItems),
                    inert: document.querySelector('main').inert };
            } finally { performParallelPacking = original; observer.disconnect(); }
        });
        assert.deepEqual(fastSearch, { openings: 0, preserved: true, inert: false });
        console.log('PASS fast searches never flash the overlay or leave a pending loading timer');
        const firstSignature = await page.evaluate(() => Packer.layoutSignature(autoPackedItems));
        const firstBest = await page.evaluate(() => Packer.packingMetrics(bestAutoResult.items));
        await page.evaluate(() => {
            window.actualWorkerFactory = PackingJobs.createWorker;
            PackingJobs.createWorker = () => ({ postMessage() {}, terminate() {} });
        });
        await page.click('#alternative-pack-btn');
        await page.waitForSelector('#loading-modal', { visible: true });
        await page.click('#cancel-pack-btn');
        await page.waitForFunction(() => !document.getElementById('run-pack-btn').disabled);
        assert.equal(await page.evaluate(() => Packer.layoutSignature(autoPackedItems)), firstSignature);
        await page.evaluate(() => { PackingJobs.createWorker = window.actualWorkerFactory; });
        await page.click('#alternative-pack-btn');
        await page.waitForFunction(() => !document.getElementById('run-pack-btn').disabled, { timeout: 60000 });
        assert.notEqual(await page.evaluate(() => Packer.layoutSignature(autoPackedItems)), firstSignature);
        assert.equal(await page.evaluate(() => Packer.validatePackingResult(autoPackedItems, 40, 50, 60).valid), true);
        assert.equal(await page.evaluate(() => bestAutoResult.items.length), firstBest.count);
        assert.match(await page.$eval('#packing-comparison', el => el.textContent), /种子/);
        await page.$eval('#restore-best-btn', el => el.click());
        assert.equal(await page.evaluate(() => Packer.layoutSignature(autoPackedItems)), await page.evaluate(() => Packer.layoutSignature(bestAutoResult.items)));
        await page.evaluate(() => {
            const items = bestAutoResult.items.filter(item => item.y === 0);
            displayAutoResult({ items, unpacked: bestAutoResult.items.filter(item => item.y !== 0), attempt: 0, seed: 0 });
        });
        assert.equal(await page.$eval('#restore-best-btn', el => el.hidden), false);
        await page.click('#restore-best-btn');
        assert.equal(await page.evaluate(() => Packer.layoutSignature(autoPackedItems)), await page.evaluate(() => Packer.layoutSignature(bestAutoResult.items)));
        console.log('PASS alternate layouts differ and the best solution can be restored');

        await page.click('#tab-manual');
        await page.$eval('.place-one-btn', el => el.click());
        await page.$eval('.place-one-btn', el => el.click());
        assert.equal(await page.evaluate(() => placedItems.length), 2);
        await page.evaluate(() => {
            selectPlacedItemById(placedItems[0].id);
            document.getElementById('btn-delete-placed').click();
        });
        assert.equal(await page.$eval('#collision-alert', el => getComputedStyle(el).display), 'flex');
        await page.$eval('#undo-placement-btn', el => el.click());
        assert.equal(await page.evaluate(() => placedItems.length), 2);
        assert.equal(await page.$eval('#collision-alert', el => getComputedStyle(el).display), 'none');
        await page.$eval('#btn-delete-placed', el => el.click());
        await page.click('#tab-auto');
        assert.match(await page.$eval('#stat-packed-count', el => el.textContent), /^45 \/ 45/);
        await page.click('#tab-manual');
        assert.equal(await page.evaluate(() => placedItems.length), 1);
        console.log('PASS modes preserve layouts and removing support exposes instability');

        await page.evaluate(() => showWarningModal('error', '安全检查', '<img src=x onerror=alert(1)>'));
        assert.equal(await page.$('#modal-body-text img'), null);
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.getElementById('warning-modal').contains(document.activeElement)), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.$eval('main', el => el.inert), false);
        console.log('PASS untrusted error text is escaped and dialogs contain keyboard focus');

        const assertTheme = async light => {
            await page.waitForFunction(light => document.documentElement.classList.contains('light-theme') === light, {}, light);
            assert.equal(await page.evaluate(() => '#' + scene.background.getHexString()), await page.evaluate(() => sceneColor('background')));
            assert.equal(await page.$eval('meta[name="theme-color"]', el => el.content), await page.evaluate(() => sceneColor('background')));
        };
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
        await assertTheme(false);
        await page.select('#theme-toggle', 'light');
        await assertTheme(true);
        await page.reload({ waitUntil: 'load' });
        await assertTheme(true);
        assert.equal(await page.$eval('#theme-toggle', el => el.value), 'light');
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
        await assertTheme(true);
        await page.select('#theme-toggle', 'dark');
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
        await page.reload({ waitUntil: 'load' });
        await assertTheme(false);
        assert.equal(await page.$eval('#theme-toggle', el => el.value), 'dark');
        if (process.env.BROWSER_ARTIFACT_DIR) await page.screenshot({ path: path.join(process.env.BROWSER_ARTIFACT_DIR, 'packing-dark.png'), fullPage: true });
        await page.select('#theme-toggle', 'system');
        await assertTheme(true);
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
        await page.reload({ waitUntil: 'load' });
        await assertTheme(false);
        assert.equal(await page.$eval('#theme-toggle', el => el.value), 'system');
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
        await assertTheme(true);
        console.log('PASS system theme updates the UI and 3D scene live; explicit overrides and system mode survive reload');

        for (const width of [320, 375, 768, 1024, 1440, 1920]) {
            await page.setViewport({ width, height: 900 });
            await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
            if (width < 960) {
                await page.click('#config-toggle');
                assert.equal(await page.$eval('#configuration', el => getComputedStyle(el).display), 'block');
                await page.click('#config-toggle');
            }
        }
        console.log('PASS responsive workspace and configuration disclosure at 320–1920px');
        await page.setViewport({ width: 1440, height: 900 });
        const frameCount = await page.evaluate(async () => {
            let count = 0;
            const original = renderer.render;
            renderer.render = function(...args) { count++; return original.apply(this, args); };
            await new Promise(resolve => setTimeout(resolve, 1000));
            count = 0;
            await new Promise(resolve => setTimeout(resolve, 300));
            renderer.render = original;
            return count;
        });
        assert.equal(frameCount, 0);
        console.log('PASS idle scene draws zero frames');
        assert.deepEqual(errors, []);
        assert.deepEqual(remote, []);
        console.log('PASS no uncaught browser exceptions or remote runtime requests');

        const extreme = await browser.newPage();
        await extreme.setViewport({ width: 1440, height: 900 });
        await extreme.goto(url, { waitUntil: 'load' });
        await extreme.$eval('.qty-input[data-index="2"]', el => { el.value = '16'; el.dispatchEvent(new Event('change', { bubbles: true })); });
        await extreme.click('#run-pack-btn');
        await extreme.waitForFunction(() => !document.getElementById('run-pack-btn').disabled, { timeout: 60000 });
        assert.equal(await extreme.evaluate(() => autoPackedItems.length), 49);
        assert.equal(await extreme.evaluate(() => Packer.validatePackingResult(autoPackedItems, 40, 50, 60).valid), true);
        console.log('PASS 49-item layout through the production parallel scheduler');
        await extreme.evaluate(() => {
            inventory = [
                { id: 'big', name: '超大盒', l: 100, w: 100, h: 100, qty: 2, weight: 1, color: '#446688', ratio: 0, minQty: 0 },
                { id: 'fit', name: '可装盒', l: 10, w: 10, h: 10, qty: 1, weight: 1, color: '#668844', ratio: 0, minQty: 0 }
            ];
            invalidateAutoLayout(); renderInventoryUI(); updateStats();
        });
        assert.equal(await extreme.$eval('#alternative-pack-btn', el => el.disabled), true);
        await extreme.click('#run-pack-btn');
        await extreme.waitForFunction(() => !document.getElementById('run-pack-btn').disabled);
        assert.equal(await extreme.evaluate(() => autoPackedItems.length), 1);
        assert.equal(await extreme.evaluate(() => autoUnpackedItems.length), 2);
        console.log('PASS oversized cargo does not block fitting cargo and invalidates previous best');
        await extreme.click('#modal-close-btn');
        await extreme.evaluate(() => {
            inventory = [{ id: 'exact', name: '整箱', l: 60, w: 40, h: 50, qty: 1, weight: 1, color: '#446688', ratio: 0, minQty: 0 }];
            invalidateAutoLayout(); renderInventoryUI(); updateStats();
        });
        await extreme.click('#run-pack-btn');
        await extreme.waitForFunction(() => !document.getElementById('run-pack-btn').disabled);
        const onlyLayout = await extreme.evaluate(() => Packer.layoutSignature(autoPackedItems));
        await extreme.click('#alternative-pack-btn');
        await extreme.waitForFunction(() => !document.getElementById('run-pack-btn').disabled, { timeout: 60000 });
        assert.equal(await extreme.evaluate(() => Packer.layoutSignature(autoPackedItems)), onlyLayout);
        assert.match(await extreme.$eval('#workspace-status', el => el.textContent), /未找到不同/);
        console.log('PASS unique exact-fit layout is preserved across all container orientations');
        await extreme.close();

        const noWorkers = await browser.newPage();
        await noWorkers.setViewport({ width: 1440, height: 900 });
        await noWorkers.evaluateOnNewDocument(() => { window.Worker = undefined; });
        await noWorkers.goto(url, { waitUntil: 'load' });
        await noWorkers.click('#run-pack-btn');
        await noWorkers.waitForFunction(() => !document.getElementById('run-pack-btn').disabled);
        assert.match(await noWorkers.$eval('#workspace-status', el => el.textContent), /基础搜索/);
        assert.equal(await noWorkers.evaluate(() => Packer.validatePackingResult(autoPackedItems, 40, 50, 60).valid), true);
        console.log('PASS browser without Workers returns a marked, valid fallback');
        await noWorkers.close();

        const noWebGL = await browser.newPage();
        await noWebGL.setViewport({ width: 1440, height: 900 });
        await noWebGL.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
        await noWebGL.evaluateOnNewDocument(() => {
            const original = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function(type, ...args) {
                if (/webgl/i.test(type)) return null;
                return original.call(this, type, ...args);
            };
            Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Disabled', 'SecurityError'); } });
        });
        await noWebGL.goto(url, { waitUntil: 'load' });
        assert.equal(await noWebGL.$eval('html', el => el.classList.contains('light-theme')), false);
        assert.equal(await noWebGL.$eval('#theme-toggle', el => el.value), 'system');
        assert.equal(await noWebGL.$eval('#run-pack-btn', el => el.disabled), true);
        assert.match(await noWebGL.$eval('#viewport-empty', el => el.textContent), /无法启动/);
        await noWebGL.click('#about-toggle');
        assert.equal(await noWebGL.$eval('main', el => el.inert), true);
        console.log('PASS WebGL/storage failures leave an explanatory, usable interface');
        await noWebGL.close();

        const suite = await browser.newPage();
        await suite.goto(pathToFileURL(path.resolve(__dirname, '../test_suite.html')).href, { waitUntil: 'load', timeout: 60000 });
        await suite.waitForFunction(() => document.getElementById('status').textContent === 'DONE', { timeout: 60000 });
        assert.equal(await suite.$eval('#failed-count', el => el.textContent), '0');
        assert.equal(await suite.$eval('#passed-count', el => el.textContent), '13');
        console.log('PASS all 13 existing browser algorithm tests');
        await suite.close();
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
