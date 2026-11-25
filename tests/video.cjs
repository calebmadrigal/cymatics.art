// Optional browser checks: real MP4/WebM downloads, cancellation and mobile controls.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { Input, BlobSource, MP4, WEBM } = require('mediabunny');
(async () => {
    const root = path.resolve(__dirname, '..');
    const { default_config, generate_resonators } = await import(pathToFileURL(root + '/src/js/cymatics.js'));
    const cfg = { ...default_config(), boundary: 'None', phaseMode: 'fixed', phase: .4, steps: 7, speed: 7, numResonators: 1, waveform: 'sine', frequency: .4, phase_multiplier: 1 };
    cfg.resonators_list = generate_resonators(cfg);
    const url = new URL(process.env.APP_URL || pathToFileURL(root + '/dist/index.html').href);
    url.searchParams.set('config', JSON.stringify(cfg));
    const output = await fs.mkdtemp(path.join(os.tmpdir(), 'cymatics-video-'));
    const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 950 }, acceptDownloads: true });
    const errors = [], downloads = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('download', d => downloads.push(d));
    await page.addInitScript(() => {
        window.skipMP4 = new URL(location.href).searchParams.has('webmOnly');
        window.disableVideo = new URL(location.href).searchParams.has('noVideo');
        const encoder = globalThis.VideoEncoder;
        window.liveVideo = new URL(location.href).searchParams.has('liveVideo');
        window.exportEncoders = [];
        if (window.disableVideo || window.liveVideo) globalThis.VideoEncoder = undefined;
        else if (encoder) {
            const check = encoder.isConfigSupported.bind(encoder);
            encoder.isConfigSupported = config => window.skipMP4 && /^(avc|hvc|hev)/.test(config.codec) ? Promise.resolve({ supported: false, config }) : check(config);
            globalThis.VideoEncoder = new Proxy(encoder, { construct(target, args) { const instance = Reflect.construct(target, args); window.exportEncoders.push(instance); return instance; } });
        }
        // Inspect the phases actually submitted to the GPU, and optionally slow rendering down.
        window.exportPhases = [];
        const locations = new WeakMap(), gl = WebGL2RenderingContext.prototype;
        const getLocation = gl.getUniformLocation, uniform = gl.uniform1f;
        gl.getUniformLocation = function(program, name) { const loc = getLocation.call(this, program, name); if (loc) locations.set(loc, name); return loc; };
        gl.uniform1f = function(loc, value) {
            if (locations.get(loc) === 'uPhase' && this.canvas.parentElement?.id === 'videoPreview') {
                window.exportPhases.push(value);
                const until = performance.now() + (window.slowExport || 0); while (performance.now() < until) {}
            }
            return uniform.call(this, loc, value);
        };
        const supported = MediaRecorder.isTypeSupported.bind(MediaRecorder);
        MediaRecorder.isTypeSupported = type => !window.disableVideo && !(window.skipMP4 && type.startsWith('video/mp4')) && supported(type);
        const capture = HTMLCanvasElement.prototype.captureStream;
        window.exportStreams = [];
        HTMLCanvasElement.prototype.captureStream = function(...args) { const stream = capture.apply(this, args); window.exportStreams.push(stream); return stream; };
    });
    async function configSnapshot() {
        await page.locator('#showShareButton').click();
        const value = JSON.parse(new URL(await page.locator('#shareURL').inputValue()).searchParams.get('config'));
        await page.locator('#shareModal .close-modal').click(); return value;
    }
    async function openVideo() {
        await page.locator('#showSaveButton').click(); await page.locator('#saveType').selectOption('video');
        await page.locator('#videoResolution').selectOption('custom');
        await page.locator('#saveWidth').fill('320'); await page.locator('#saveHeight').fill('180'); await page.locator('#saveHeight').press('Tab');
        await page.locator('#videoFps').fill('10'); await page.locator('#videoCycles').fill('1');
        await page.waitForFunction(() => { const text = document.getElementById('videoSummary').textContent; return text.includes('10 frames') || text.includes('unavailable'); });
    }
    async function assertStopped() {
        await page.waitForFunction(() => document.getElementById('saveForm').getAttribute('aria-busy') === 'false');
        assert.equal(await page.evaluate(() => exportStreams.every(s => s.getTracks().every(t => t.readyState === 'ended'))), true);
        assert.equal(await page.locator('#videoPreview canvas').count(), 0);
        assert.equal(await page.evaluate(() => exportEncoders.every(e => e.state === 'closed')), true, 'Video encoders must close after export or cancellation');
    }
    async function exportClip(extension, cycles = 1, width = 320, height = 180, background = null, live = false) {
        await page.locator('#saveFilename').fill('waves.png');
        await page.evaluate(() => { window.exportPhases = []; });
        const waiting = page.waitForEvent('download', { timeout: 30000 }); await page.locator('#saveImageButton').click();
        const download = await waiting; assert.equal(download.suggestedFilename(), 'waves.' + extension);
        const filename = path.join(output, download.suggestedFilename()); await download.saveAs(filename);
        const bytes = await fs.readFile(filename); assert.ok(bytes.length > 1000);
        if (extension === 'mp4') assert.equal(bytes.subarray(4, 8).toString(), 'ftyp'); else assert.equal(bytes.subarray(0, 4).toString('hex'), '1a45dfa3');
        const input = new Input({ source: new BlobSource(new Blob([bytes])), formats: [MP4, WEBM] });
        try {
            const tags = await input.getMetadataTags();
            assert.equal(tags.raw.SOURCE, 'cymatics.art');
            assert.equal(tags.comment, 'Created with https://cymatics.art');
        } finally { input.dispose(); }
        if (process.env.FFPROBE_PATH) {
            const metadata = JSON.parse(execFileSync(process.env.FFPROBE_PATH, ['-v', 'error', '-count_frames', '-show_entries', 'stream=width,height,nb_read_frames,duration,r_frame_rate:format=duration:format_tags:frame=best_effort_timestamp_time,pkt_duration_time', '-of', 'json', filename], { encoding: 'utf8' }));
            const stream = metadata.streams[0]; assert.equal(stream.width, width); assert.equal(stream.height, height);
            if (live) assert.ok(Number(stream.nb_read_frames) >= cycles * 9, JSON.stringify(stream));
            else assert.equal(Number(stream.nb_read_frames), cycles * 10, JSON.stringify(stream));
            assert.equal(metadata.format.tags[extension === 'webm' ? 'MOVIE/SOURCE' : 'SOURCE'], 'cymatics.art');
            const first = metadata.frames[0], last = metadata.frames.at(-1);
            const duration = Number(stream.duration || metadata.format.duration || (Number(last.best_effort_timestamp_time) - Number(first.best_effort_timestamp_time) + Number(last.pkt_duration_time || .1)));
            assert.ok(Math.abs(duration - cycles) < (live ? .5 : .002), `Unexpected duration: ${duration}`);
            for (let i = 0; !live && i < metadata.frames.length; i++) assert.ok(Math.abs(Number(metadata.frames[i].best_effort_timestamp_time) - i / 10) < .002, `Uneven timestamp at frame ${i}`);
            console.log(extension, stream);
        }
        if (process.env.FFMPEG_PATH) {
            const data = execFileSync(process.env.FFMPEG_PATH, ['-v', 'error', '-i', filename, '-f', 'framemd5', '-'], { encoding: 'utf8' });
            const hashes = data.split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1).trim());
            assert.ok(new Set(hashes).size > 3, 'Decoded video must contain changing frames');
            if (background) {
                const pixels = execFileSync(process.env.FFMPEG_PATH, ['-v', 'error', '-i', filename, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
                for (let channel = 0; channel < 3; channel++) assert.ok(Math.abs(pixels[channel] - background[channel]) < 10, `Crop background mismatch: ${pixels.subarray(0, 3)}`);
            }
        }
        const phases = await page.evaluate(() => window.exportPhases);
        if (!live) assert.equal(phases.length, cycles * 10, 'Exactly one draw for each encoded frame');
        for (let i = 0; !live && i < phases.length; i++) {
            const next = phases[(i + 1) % phases.length];
            const delta = (next - phases[i] + 2 * Math.PI) % (2 * Math.PI);
            assert.ok(Math.abs(delta - 2 * Math.PI / 10) < 1e-8, `Uneven phase increment at frame ${i}`);
        }
        await assertStopped();
        assert.deepEqual(await configSnapshot(), baseline);
    }
    let baseline;
    try {
        await page.goto(url.href); await page.waitForFunction(() => document.getElementById('renderStatus').textContent.includes('reflected paths'));
        assert.equal(await page.locator('[data-action=save]').count(), 1); baseline = await configSnapshot();
        await openVideo(); assert.match(await page.locator('#videoSummary').textContent(), /1.00 seconds · 10 frames/);
        const supportsMP4 = await page.evaluate(() => MediaRecorder.isTypeSupported('video/mp4'));
        await page.screenshot({ path: path.join(output, 'save-video-desktop.png') });
        await exportClip(supportsMP4 ? 'mp4' : 'webm');
        console.log('PASS MP4: exact frame count, uniform phase/timestamps, main config and phase preserved');
        const webmURL = new URL(url); webmURL.searchParams.set('webmOnly', '1');
        await page.goto(webmURL.href); await page.waitForFunction(() => document.getElementById('renderStatus').textContent.includes('reflected paths'));
        baseline = await configSnapshot();
        await page.evaluate(() => { window.slowExport = 125; });
        await openVideo(); await page.locator('#videoCycles').fill('2'); assert.match(await page.locator('#videoSummary').textContent(), /WebM.*2.00 seconds/); await exportClip('webm', 2);
        console.log('PASS WebM fallback: exact frame count, uniform phase/timestamps and two cycles despite slow rendering');
        for (const webm of [false, true]) {
            const liveURL = new URL(url); liveURL.searchParams.set('liveVideo', '1');
            if (webm) liveURL.searchParams.set('webmOnly', '1');
            await page.goto(liveURL.href); await page.waitForFunction(() => document.getElementById('renderStatus').textContent.includes('reflected paths'));
            baseline = await configSnapshot(); await openVideo();
            await exportClip(webm || !supportsMP4 ? 'webm' : 'mp4', 1, 320, 180, null, true);
        }
        console.log('PASS source tags in MP4/WebM live-recording fallback, preserving decoded frames');
        const croppedURL = new URL(url); croppedURL.searchParams.set('config', JSON.stringify({ ...cfg, boundary: 'Circle', radius: 2, yHeight: 6, backgroundColor: '#123456' }));
        await page.goto(croppedURL.href); await page.waitForFunction(() => document.getElementById('renderStatus').textContent.includes('reflected paths'));
        baseline = await configSnapshot();
        await openVideo(); assert.equal(await page.locator('#cropBoundary').isChecked(), true);
        assert.equal(await page.locator('#saveWidth').inputValue(), '180');
        await exportClip(supportsMP4 ? 'mp4' : 'webm', 1, 180, 180, [18, 52, 86]);
        console.log('PASS circular crop preserves aspect and uses the selected opaque background');

        for (const cancel of ['button', 'close', 'escape']) {
            await openVideo(); await page.locator('#videoCycles').fill('100'); await page.locator('#saveImageButton').click();
            await page.waitForFunction(() => document.getElementById('videoProgressBar').value > 0);
            const count = downloads.length;
            if (cancel === 'button') await page.locator('#cancelVideoButton').click();
            else if (cancel === 'close') await page.locator('#saveModal .close-modal').click();
            else await page.keyboard.press('Escape');
            await assertStopped(); assert.equal(downloads.length, count);
            if (cancel === 'button') { assert.equal(await page.locator('#saveModal').isVisible(), true); await page.locator('#saveModal .close-modal').click(); }
            assert.deepEqual(await configSnapshot(), baseline);
        }
        console.log('PASS Cancel, close and Escape close encoders without a partial download');

        const unsupportedURL = new URL(url); unsupportedURL.searchParams.set('noVideo', '1');
        await page.goto(unsupportedURL.href); await page.waitForFunction(() => document.getElementById('renderStatus').textContent.includes('reflected paths'));
        await openVideo();
        assert.equal(await page.locator('#saveImageButton').isDisabled(), true); assert.match(await page.locator('#videoSummary').textContent(), /unavailable/);
        await page.locator('#saveType').selectOption('image'); assert.equal(await page.locator('#saveImageButton').isDisabled(), false);
        assert.equal(await page.locator('#saveJsonButton').isVisible(), true); await page.locator('#saveModal .close-modal').click();
        await page.goto(url.href); await page.waitForFunction(() => document.getElementById('renderStatus').textContent.includes('reflected paths'));
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#mobileMenuButton').click(); await openVideo();
        await page.locator('#videoCycles').fill('100'); await page.screenshot({ path: path.join(output, 'save-video-mobile.png') });
        const box = await page.locator('#saveModal').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 391);
        await page.locator('#saveImageButton').click(); await page.locator('#cancelVideoButton').click(); await assertStopped();
        await page.locator('#saveModal .close-modal').click();
        assert.deepEqual(errors, []); console.log('PASS unsupported-browser image fallback and mobile controls');
        console.log('Artifacts:', output);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
