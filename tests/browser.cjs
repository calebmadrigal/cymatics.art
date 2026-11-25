// Optional end-to-end QA: PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser.cjs
// Serve dist first, then set APP_URL if using a port other than 8000.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
    const output = await fs.mkdtemp(path.join(os.tmpdir(), 'cymatics-qa-'));
    const { default_config, build_sources, evaluate_field, sample_range, screen_to_world } = await import('../src/js/cymatics.js');
    const { read_png_config } = await import('../src/js/png.js');
    const { getMatplotlibColormap } = await import('../src/js/ga_color.js');
    const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        const origin = process.env.APP_URL || 'http://127.0.0.1:8000';
        await page.goto(origin);
        await page.waitForFunction(() => document.getElementById('renderStatus').textContent.includes('reflected paths'));
        assert.equal(await page.locator('#errorBanner').isVisible(), false);
        assert.equal(await page.locator('#numResonators').inputValue(), '6');
        assert.equal(await page.locator('[name=phaseMode][value=animated]').isChecked(), true);
        assert.equal(await page.locator('#playPauseButton').getAttribute('aria-label'), 'Pause');
        assert.equal(await page.locator('#pauseIcon').isVisible(), true);
        assert.equal(await page.locator('#playIcon').isVisible(), false);
        await page.locator('#playPauseButton').click();
        assert.equal(await page.locator('[name=phaseMode][value=fixed]').isChecked(), true);
        assert.equal(await page.locator('#playIcon').isVisible(), true);
        assert.equal(await page.locator('#pauseIcon').isVisible(), false);
        const fixedPhase = await page.locator('#phase').inputValue();
        await page.waitForTimeout(150); assert.equal(await page.locator('#phase').inputValue(), fixedPhase);
        await page.locator('#playPauseButton').click();
        assert.equal(await page.locator('[name=phaseMode][value=animated]').isChecked(), true);
        await page.locator('[name=phaseMode][value=fixed]').check();
        assert.equal(await page.locator('#playPauseButton').getAttribute('aria-label'), 'Play');
        assert.equal(await page.locator('#colorHeading').textContent(), 'Color');
        console.log('PASS default playback, Play/Pause icons and sidebar synchronization');
        await page.screenshot({ path: path.join(output, 'desktop.png') });

        // Verify actual GLSL output against the CPU reference with all operators.
        for (const operator of ['+', '-', '*', '/']) {
            const cfg = { ...default_config(), boundary: operator === '/' ? 'Binary Split' : 'Square', phaseMode: 'fixed', resonatorRotationDegrees: 27, boundaryRotationDegrees: 17, combineOperator: operator, fuzzyLevel: 24, colorMap: 'viridis', reverseColor: false };
            cfg.resonators_list = cfg.resonators_list.slice(0, 2).map(r => ({ ...r, waveform: 'sine', amplitude: 1, frequency: .23 }));
            await page.goto(origin + '/?config=' + encodeURIComponent(JSON.stringify(cfg)));
            await page.waitForFunction(() => document.getElementById('renderStatus').textContent.includes('reflected paths'));
            const pixels = await page.evaluate(() => {
                const c = document.getElementById('mainCanvas'), gl = c.getContext('webgl2');
                const result = { width: c.width, height: c.height, samples: [] };
                for (const [fx, fy] of [[.47,.46],[.53,.55],[.58,.43]]) {
                    const x = Math.floor(c.width * fx), y = Math.floor(c.height * fy), rgb = new Uint8Array(4);
                    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgb);
                    result.samples.push({ x, y, rgb: [...rgb] });
                }
                result.error = gl.getError(); return result;
            });
            assert.equal(pixels.error, 0);
            const scene = build_sources(cfg), range = sample_range(scene, cfg, pixels.width, pixels.height);
            const transfer = v => (v + 1e-6) ** (.01 * cfg.fuzzyLevel);
            const lo = transfer(range.min), hi = transfer(range.max);
            const color = getMatplotlibColormap(0,1,cfg.colorMap,cfg.reverseColor,false);
            for (const pixel of pixels.samples) {
                const p = screen_to_world(pixel.x + .5, pixels.height - pixel.y - .5, pixels.width, pixels.height, cfg);
                const value = Math.abs(evaluate_field(p,scene,cfg));
                const t = Math.max(0,Math.min(1,(transfer(value)-lo)/Math.max(1e-6,hi-lo)));
                const rgb = color(t);
                assert.ok(rgb.every((v,i)=>Math.abs(v-pixel.rgb[i]) <= 5), `${operator}: GPU ${pixel.rgb} / CPU ${rgb}`);
            }
        }
        console.log('PASS GPU / CPU field parity for all combine operators');

        await page.goto(origin);
        // Keep the editor workflow fixture at three sources, independent of defaults.
        await page.locator('#numResonators').fill('3'); await page.locator('#numResonators').press('Tab');
        await page.locator('#playPauseButton').click();
        await page.locator('#resonatorRotationDegrees').fill('35'); await page.locator('#resonatorRotationDegrees').press('Tab');
        await page.locator('#boundaryRotationDegrees').fill('20'); await page.locator('#boundaryRotationDegrees').press('Tab');
        await page.locator('#backgroundColor').evaluate(input => { input.value = '#123456'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
        await page.waitForTimeout(100);
        const background = await page.locator('#mainCanvas').evaluate(c => {
            const gl = c.getContext('webgl2'), pixel = new Uint8Array(4);
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); return [...pixel];
        });
        assert.deepEqual(background, [18, 52, 86, 255]);
        await page.locator('#modeToggle').click();
        assert.equal(await page.locator('#resonatorRotationDegrees').isVisible(), true);
        assert.equal(await page.locator('#basicResonators').isVisible(), false);
        await page.locator('#addResonatorButton').click();
        for (const [key, value] of Object.entries({x:'1.2',y:'-1.1',amplitude:'4.2',frequency:'1.7',phase_multiplier:'0',phase_offset:'1.571'})) await page.locator('#edit_'+key).fill(value);
        await page.locator('#edit_waveform').selectOption('triangle');
        await page.locator('#resonatorForm .primary').click();
        assert.equal(await page.locator('#resonatorsList option').count(), 4);
        await page.locator('#editResonatorButton').click(); await page.locator('#edit_y').fill('1.1'); await page.locator('#resonatorForm .primary').click();
        await page.locator('#boundary').selectOption('Custom'); await page.locator('#sides').fill('17'); await page.locator('#sides').press('Tab');
        assert.equal(await page.locator('#customSides').isVisible(), true);
        await page.locator('#boundary').selectOption('Binary Split');
        await page.locator('#boundary').selectOption('None');
        assert.equal(await page.locator('#radius').isDisabled(), true);
        await page.locator('#boundary').selectOption('Hexagon');
        await page.locator('#phase').fill('1.2'); await page.locator('#phase').press('Tab');
        await page.locator('[name=phaseMode][value=animated]').check();
        await page.waitForTimeout(150);
        const phase1 = await page.locator('#currentPhase').textContent();
        await page.waitForTimeout(180);
        assert.notEqual(await page.locator('#currentPhase').textContent(), phase1);
        await page.locator('[name=phaseMode][value=fixed]').check();
        await page.locator('#showShareButton').click();
        const share = new URL(await page.locator('#shareURL').inputValue());
        assert.equal(share.origin,'https://cymatics.app');
        const saved = JSON.parse(share.searchParams.get('config'));
        assert.deepEqual(saved.resonators_list[3],{x:1.2,y:1.1,amplitude:4.2,frequency:1.7,phase_multiplier:0,phase_offset:1.571,waveform:'triangle'});
        assert.equal(saved.boundary,'Hexagon');
        assert.equal(saved.resonatorRotationDegrees,35); assert.equal(saved.boundaryRotationDegrees,20); assert.equal(saved.backgroundColor,'#123456');
        await page.locator('#shareModal .close-modal').click();
        console.log('PASS advanced CRUD, boundaries, phase animation, share state');

        await page.locator('#showSaveButton').click();
        await page.locator('#saveWidth').fill('192'); await page.locator('#saveHeight').fill('128');
        const pngDownload = page.waitForEvent('download'); await page.locator('#saveImageButton').click();
        const png = await pngDownload, pngPath = path.join(output,'pattern.png'); await png.saveAs(pngPath);
        const pngCfg = await read_png_config(new Blob([await fs.readFile(pngPath)]));
        assert.deepEqual(pngCfg,saved);
        const imagePixel = await page.evaluate(async data => {
            const blob = new Blob([new Uint8Array(data)], { type: 'image/png' });
            const image = await createImageBitmap(blob), c = document.createElement('canvas');
            c.width = image.width; c.height = image.height; const ctx = c.getContext('2d'); ctx.drawImage(image,0,0);
            return [...ctx.getImageData(0,0,1,1).data];
        }, [...await fs.readFile(pngPath)]);
        assert.deepEqual(imagePixel,[18,52,86,255]);
        await page.locator('#removeResonatorButton').click();
        assert.equal(await page.locator('#resonatorsList option').count(),3);
        await page.locator('#showOpenButton').click(); await page.locator('#openFileInput').setInputFiles(pngPath);
        await page.waitForFunction(()=>!document.getElementById('openModal').open);
        assert.equal(await page.locator('#resonatorsList option').count(),4);
        const htmlDownload = page.waitForEvent('download'); await page.locator('#downloadAppButton').click();
        const html = await htmlDownload, htmlPath = path.join(output,'Cymatics.art.html'); await html.saveAs(htmlPath);
        const offline = await browser.newPage(); await offline.context().setOffline(true);
        await offline.goto(pathToFileURL(htmlPath).href);
        await offline.waitForFunction(()=>document.getElementById('renderStatus').textContent.includes('reflected paths'));
        assert.equal(await offline.locator('#errorBanner').isVisible(),false);
        assert.equal(await offline.locator('#resonatorsList option').count(),4);
        assert.equal(await offline.locator('#boundary').inputValue(),'Hexagon');
        assert.equal(await offline.locator('#resonatorRotationDegrees').inputValue(),'35'); assert.equal(await offline.locator('#boundaryRotationDegrees').inputValue(),'20'); assert.equal(await offline.locator('#backgroundColor').inputValue(),'#123456');
        await offline.close();
        console.log('PASS PNG save/open and downloaded HTML works offline with full settings');

        await page.locator('#gotoButton').click();
        await page.locator('#gotoX').fill('1.5'); await page.locator('#gotoY').fill('-2'); await page.locator('#gotoHeight').fill('6');
        await page.locator('#gotoForm .primary').click();
        await page.locator('#zoomInButton').click(); await page.locator('#homeButton').click();
        await page.locator('#hideControlPanelButton').click(); assert.equal(await page.locator('#controlPanel').isVisible(),false);
        await page.locator('#openControlPanelButton').click();
        await page.setViewportSize({width:390,height:844});
        await page.screenshot({path:path.join(output,'mobile.png')});
        const size = await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));
        assert.equal(size.scroll,size.width);
        await page.locator('#mobileMenuButton').click(); await page.locator('#showHelpButton').click(); assert.equal(await page.locator('#helpModal').isVisible(),true);
        assert.deepEqual(errors,[]);
        console.log('PASS view navigation, mobile layout and Help');
        console.log('Screenshots and downloads:',output);
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
