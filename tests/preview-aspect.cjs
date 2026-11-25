// Optional Playwright regression: preview geometry stays proportional at all sizes.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
    const root = path.resolve(__dirname, '..');
    const { default_config } = await import(pathToFileURL(path.join(root, 'src/js/cymatics.js')));
    const cfg = { ...default_config(), boundary: 'Square', radius: 3, boundaryRotationDegrees: 0, phaseMode: 'fixed' };
    const url = new URL(process.env.APP_URL || pathToFileURL(path.join(root, 'dist/index.html')).href);
    url.searchParams.set('config', JSON.stringify(cfg));
    const output = await fs.mkdtemp(path.join(os.tmpdir(), 'cymatics-preview-'));
    const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    try {
        for (const density of [1, 2]) {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: density });
            const page = await context.newPage();
            await page.goto(url.href);
            await page.waitForFunction(() => document.getElementById('renderStatus').textContent.includes('reflected paths'));
            for (const width of [390, 320, 600, 1280, 390]) {
                await page.setViewportSize({ width, height: 844 });
                // Allow ResizeObserver to redraw the preview; the phase remains fixed.
                await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                const shape = await page.locator('#resonatorCanvas').evaluate(c => {
                    const bounds = c.getBoundingClientRect(), cssWidth = bounds.width - 2 * c.clientLeft, cssHeight = bounds.height - 2 * c.clientTop;
                    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
                    let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
                    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
                        const i = (y * c.width + x) * 4;
                        // Include antialiased boundary pixels; axes/background are lighter and sources lie inside.
                        if (data[i] < 200 && data[i+1] < 205 && data[i+2] < 215) {
                            minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
                        }
                    }
                    return { width: (maxX - minX + 1) * cssWidth / c.width, height: (maxY - minY + 1) * cssHeight / c.height, found: maxX >= 0 };
                });
                assert.ok(shape.found, 'Boundary must be drawn');
                assert.ok(Math.abs(shape.width - shape.height) < 2, `Square stretched at viewport ${width}, DPR ${density}: ${shape.width} × ${shape.height}`);
            }
            await page.locator('#boundary').selectOption('Circle');
            await page.locator('#resonatorCanvas').scrollIntoViewIfNeeded();
            await page.screenshot({ path: path.join(output, `mobile-dpr-${density}.png`) });
            assert.equal(await page.locator('#errorBanner').isVisible(), false);
            await context.close();
        }
        console.log('PASS preview squares retain equal displayed dimensions across mobile, desktop, resize, and DPR 1/2');
        console.log('Screenshots:', output);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
