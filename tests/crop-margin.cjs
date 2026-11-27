// Optional Playwright regression: verify transparent PNG and decoded MP4/WebM margins.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
    const root = path.resolve(__dirname, '..');
    const { default_config } = await import(pathToFileURL(root + '/src/js/cymatics.js'));
    const { read_png_config } = await import(pathToFileURL(root + '/src/js/png.js'));
    const { version } = require(root + '/package.json');
    const cfg = { ...default_config(), boundary: 'Rectangle', boundaryWidth: 4, boundaryHeight: 2, boundaryRotationDegrees: 0, yHeight: 6,
        phaseMode: 'fixed', steps: 10, speed: 10, minOverride: 0, maxOverride: 1, colorMap: 'viridis', reverseColor: false, backgroundColor: '#123456',
        resonators_list: [{ x: 0, y: 0, amplitude: 1, frequency: 0, phase_multiplier: 0, phase_offset: Math.PI / 2, waveform: 'sine' }] };
    const base = new URL(process.env.APP_URL || pathToFileURL(root + '/dist/index.html').href);
    const output = await fs.mkdtemp(path.join(os.tmpdir(), 'cymatics-margin-'));
    const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
        if (new URL(location.href).searchParams.has('webmOnly')) {
            const check = VideoEncoder.isConfigSupported.bind(VideoEncoder);
            VideoEncoder.isConfigSupported = config => /^(avc|hvc|hev)/.test(config.codec) ? Promise.resolve({ supported: false, config }) : check(config);
            const supports = MediaRecorder.isTypeSupported.bind(MediaRecorder);
            MediaRecorder.isTypeSupported = type => !type.startsWith('video/mp4') && supports(type);
        }
    });
    async function load(patch = {}, webm = false) {
        const url = new URL(base); url.searchParams.set('config', JSON.stringify({ ...cfg, ...patch }));
        if (webm) url.searchParams.set('webmOnly', '1');
        await page.goto(url.href); await page.waitForFunction(() => document.getElementById('renderStatus').textContent.includes('reflected paths'));
    }
    async function openVideo() {
        await page.locator('#showSaveButton').click();
        assert.equal(await page.locator('#cropMarginOptions').isVisible(), true);
        await page.locator('#saveType').selectOption('video');
        assert.equal(await page.locator('#cropBoundary').isChecked(), true);
        assert.equal(await page.locator('#cropMarginOptions').isVisible(), true);
        assert.equal(await page.locator('#cropMargin').inputValue(), '0');
        await page.locator('#videoResolution').selectOption('custom');
        await page.locator('#saveHeight').fill('160'); await page.locator('#saveHeight').press('Tab');
        await page.locator('#videoFps').fill('10'); await page.locator('#videoCycles').fill('1');
    }
    async function savePngAndInspect(width, height, margin) {
        const wait = page.waitForEvent('download'); await page.locator('#saveImageButton').click();
        const download = await wait; assert.ok(download.suggestedFilename().endsWith('.png'));
        const file = path.join(output, `margin-${margin}-${width}x${height}.png`); await download.saveAs(file);
        const bytes = await fs.readFile(file);
        const image = await page.evaluate(async data => {
            const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/png' }));
            const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
            const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
            for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
                if (pixels[(y * canvas.width + x) * 4 + 3] > 200) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
            }
            const border = [], center = pixels[(Math.floor(canvas.height / 2) * canvas.width + Math.floor(canvas.width / 2)) * 4 + 3];
            for (let x = 0; x < canvas.width; x++) border.push(pixels[x * 4 + 3], pixels[((canvas.height - 1) * canvas.width + x) * 4 + 3]);
            for (let y = 0; y < canvas.height; y++) border.push(pixels[(y * canvas.width) * 4 + 3], pixels[(y * canvas.width + canvas.width - 1) * 4 + 3]);
            return { width: canvas.width, height: canvas.height, margins: [minX, minY, canvas.width - 1 - maxX, canvas.height - 1 - maxY], border, center };
        }, [...bytes]);
        assert.equal(image.width, width); assert.equal(image.height, height);
        assert.deepEqual(image.margins, [margin, margin, margin, margin]);
        assert.equal(image.center, 255);
        assert.ok(image.border.every(alpha => alpha === (margin ? 0 : 255)));
        const metadata = await read_png_config(new Blob([bytes]));
        assert.equal(metadata.boundary, 'Rectangle'); assert.ok(Math.abs(metadata.yHeight - 2 * height / (height - 2 * margin)) < 1e-8);
        console.log(`PASS PNG: ${width}×${height}, ${margin}px transparent margin on each side and embedded settings`);
    }
    async function saveAndInspect(width, height, margin, extension) {
        const wait = page.waitForEvent('download'); await page.locator('#saveImageButton').click();
        const download = await wait; assert.ok(download.suggestedFilename().endsWith('.' + extension));
        const file = path.join(output, `margin-${margin}-${width}x${height}.${extension}`); await download.saveAs(file);
        if (process.env.FFPROBE_PATH) {
            const info = JSON.parse(execFileSync(process.env.FFPROBE_PATH, ['-v', 'error', '-count_frames', '-show_entries', 'stream=width,height,nb_read_frames:format_tags', '-of', 'json', file], { encoding: 'utf8' }));
            assert.equal(info.streams[0].width, width); assert.equal(info.streams[0].height, height); assert.equal(Number(info.streams[0].nb_read_frames), 10);
            assert.equal(info.format.tags[extension === 'webm' ? 'MOVIE/SOURCE' : 'SOURCE'], 'cymatics.art');
        }
        if (process.env.FFMPEG_PATH) {
            const pixels = execFileSync(process.env.FFMPEG_PATH, ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
            let minX = width, minY = height, maxX = -1, maxY = -1;
            for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 3;
                if (pixels[i] > 100 && pixels[i + 1] > 130) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
            }
            const margins = [minX, minY, width - 1 - maxX, height - 1 - maxY];
            for (const actual of margins) assert.ok(Math.abs(actual - margin) <= 1, `${extension}: expected ${margin}px, decoded margins ${margins}`);
            if (margin) for (let channel = 0; channel < 3; channel++) assert.ok(Math.abs(pixels[channel] - [18, 52, 86][channel]) < 8);
            console.log(`PASS ${extension}: ${width}×${height}, decoded margins ${margins}, background color and source metadata`);
        }
    }
    try {
        await load(); assert.equal(await page.locator('#appVersion').textContent(), version); assert.equal(version, '1.1.2');
        const order = await page.evaluate(() => {
            const width = document.getElementById('boundaryWidth').getBoundingClientRect(), height = document.getElementById('boundaryHeight').getBoundingClientRect(), rotation = document.getElementById('boundaryRotationDegrees').getBoundingClientRect();
            return width.bottom < rotation.top && height.bottom < rotation.top;
        }); assert.equal(order, true, 'Rectangle dimensions must precede Rotation');
        const appDownload = page.waitForEvent('download'); await page.locator('#downloadAppButton').click();
        assert.equal((await appDownload).suggestedFilename(), `Cymatics.art_${version}.html`);
        await page.locator('#showSaveButton').click();
        assert.equal(await page.locator('#cropMarginOptions').isVisible(), true); assert.equal(await page.locator('#cropMargin').inputValue(), '0');
        await page.locator('#saveHeight').fill('160');
        await savePngAndInspect(320, 160, 0);
        await openVideo(); assert.equal(await page.locator('#saveWidth').inputValue(), '320');
        await saveAndInspect(320, 160, 0, 'mp4');
        await page.locator('#showSaveButton').click();
        await page.locator('#videoResolution').selectOption('custom'); await page.locator('#saveHeight').fill('160'); await page.locator('#saveHeight').press('Tab');
        await page.locator('#cropMargin').fill('12'); assert.equal(await page.locator('#saveWidth').inputValue(), '296');
        await page.locator('#saveWidth').fill('400'); assert.equal(await page.locator('#saveHeight').inputValue(), '212');
        await page.locator('#saveHeight').fill('160'); await page.locator('#saveHeight').press('Tab');
        await page.locator('#videoResolution').selectOption('480'); assert.equal(await page.locator('#saveHeight').inputValue(), '480'); assert.equal(await page.locator('#saveWidth').inputValue(), '936');
        await page.locator('#videoResolution').selectOption('custom'); await page.locator('#saveHeight').fill('160'); await page.locator('#saveHeight').press('Tab');
        for (const invalid of ['90', '-1', '1.5', '']) {
            await page.locator('#cropMargin').fill(invalid); assert.equal(await page.locator('#saveImageButton').isDisabled(), true);
        }
        await page.locator('#cropMargin').fill('12');
        await page.locator('#cropBoundary').uncheck(); assert.equal(await page.locator('#cropMarginOptions').isVisible(), false); assert.equal(await page.locator('#cropMargin').isDisabled(), true);
        await page.locator('#cropBoundary').check(); await page.locator('#saveHeight').fill('160'); await page.locator('#saveHeight').press('Tab');
        await page.locator('#saveType').selectOption('image'); assert.equal(await page.locator('#cropMargin').isDisabled(), false); assert.equal(await page.locator('#cropMarginOptions').isVisible(), true);
        assert.match(await page.locator('#cropMarginHint').textContent(), /Transparent/);
        await page.locator('#saveHeight').fill('160'); assert.equal(await page.locator('#saveWidth').inputValue(), '296');
        for (const invalid of ['90', '-1', '1.5', '']) {
            await page.locator('#cropMargin').fill(invalid); assert.equal(await page.locator('#saveImageButton').isDisabled(), true);
            assert.equal(await page.locator('#cropMarginError').isVisible(), true);
        }
        await page.locator('#cropMargin').fill('12'); assert.equal(await page.locator('#cropMarginError').isVisible(), false);
        await page.locator('#saveWidth').fill('401'); assert.equal(await page.locator('#saveWidth').inputValue(), '401'); assert.equal(await page.locator('#saveHeight').inputValue(), '213');
        await page.locator('#saveHeight').fill('160'); await savePngAndInspect(296, 160, 12);
        await page.locator('#showSaveButton').click();
        await page.locator('#saveType').selectOption('video'); await page.locator('#saveHeight').fill('160'); await page.locator('#saveHeight').press('Tab');
        await page.screenshot({ path: path.join(output, 'margin-control.png') });
        await saveAndInspect(296, 160, 12, 'mp4');
        await load({ boundaryRotationDegrees: 90 }, true); await openVideo();
        await page.locator('#cropMargin').fill('12'); assert.equal(await page.locator('#saveWidth').inputValue(), '92');
        await saveAndInspect(92, 160, 12, 'webm');
        await load({ boundary: 'None' }); await page.locator('#showSaveButton').click(); await page.locator('#saveType').selectOption('video');
        assert.equal(await page.locator('#cropMarginOptions').isVisible(), false); assert.equal(await page.locator('#cropMargin').isDisabled(), true);
        assert.deepEqual(errors, []); console.log('PASS margin defaults, visibility, linked dimensions, invalid inputs, Rectangle order and versioned app download');
        console.log('Artifacts:', output);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
