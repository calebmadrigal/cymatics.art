// Optional Playwright checks for override persistence and boundary exports.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
    const root = path.resolve(__dirname, '..');
    const { default_config, generate_resonators } = await import(pathToFileURL(root + '/src/js/cymatics.js'));
    const { read_png_config } = await import(pathToFileURL(root + '/src/js/png.js'));
    const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath:process.env.CHROMIUM_PATH } : {}), headless:true, args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
    const output = await fs.mkdtemp(path.join(os.tmpdir(), 'cymatics-features-'));
    const page = await browser.newPage({ viewport:{width:1100,height:800}, acceptDownloads:true });
    const errors = []; page.on('pageerror', e=>errors.push(e.message));
    page.on('console', m=>{if(m.type()==='error') console.log('CONSOLE',m.text())});
    const origin = process.env.APP_URL || 'http://127.0.0.1:8000';
    async function load(cfg) {
        await page.goto(origin + (cfg ? '/?config=' + encodeURIComponent(JSON.stringify(cfg)) : ''));
        await page.waitForFunction(()=>document.getElementById('renderStatus').textContent.includes('reflected paths'),null,{timeout:90000});
        assert.equal(await page.locator('#errorBanner').isVisible(), false);
    }
    async function setMax(value) {
        if (await page.locator('#maxOverride').isDisabled()) await page.locator('#maxOverrideToggle').click();
        await page.locator('#maxOverride').fill(String(value)); await page.locator('#maxOverride').press('Tab');
    }
    async function assertMin() {
        assert.equal(await page.locator('#minOverride').inputValue(), '0');
        assert.equal(await page.locator('#minOverride').isDisabled(), false);
        assert.equal(await page.locator('#minOverrideToggle').getAttribute('aria-checked'), 'true');
    }
    try {
        await load();
        const defaults = { numResonators:'2', distance:'1.5', frequency:'2', resonatorRotationDegrees:'0', boundary:'Binary Split', radius:'8', boundaryRotationDegrees:'0', fuzzyLevel:'22', colorMap:'gnuplot2', minOverride:'0' };
        for (const [id,value] of Object.entries(defaults)) assert.equal(await page.locator('#'+id).inputValue(),value,id);
        assert.equal(await page.locator('#maxOverride').inputValue(),'1');
        await assertMin();
        await page.waitForTimeout(200);
        assert.equal(await page.locator('#maxOverride').inputValue(),'1');
        await page.locator('#playPauseButton').click();
        await page.screenshot({path:output+'/defaults.png'});
        await page.locator('#showHelpButton').click();
        assert.equal(await page.locator('#helpModal a').count(),2);
        assert.equal(await page.locator('#helpModal a').first().getAttribute('href'),'https://fuzzygraph.com');
        assert.equal(await page.locator('#helpModal a').last().getAttribute('href'),'https://gods.art');
        assert.equal(await page.locator('#helpModal a').first().evaluate(a=>getComputedStyle(a).color),'rgb(223, 51, 224)');
        assert.equal((await page.locator('#helpModal').textContent()).includes('GLSL / WebGL 2'),false);
        await page.locator('#helpModal .close-modal').click();
        await page.locator('#showSaveButton').click();
        assert.equal(await page.locator('#cropBoundaryRow').isVisible(),false);
        await page.locator('#saveModal .close-modal').click();
        console.log('PASS defaults, links, halo view, infinite-boundary crop unavailable');

        const cfg = { ...default_config(), boundary:'None', numResonators:1, distance:0, amplitude:2, frequency:0, phase_multiplier:1, phaseMode:'fixed', steps:4 };
        cfg.resonators_list = generate_resonators({ ...cfg, waveform:'sine' }); cfg.waveform = 'sine';
        await load(cfg);
        await page.locator('#phase').fill('1.5707963267948966'); await page.locator('#phase').press('Tab');
        assert.equal(await page.locator('#maxOverride').isDisabled(),false); await assertMin();
        assert.equal(await page.locator('#maxOverride').inputValue(),'1');
        await setMax(8);
        await page.locator('#colorMap').selectOption('viridis');
        assert.equal(await page.locator('#maxOverride').inputValue(),'8');
        await page.locator('#amplitude').fill('3'); await page.locator('#amplitude').press('Tab');
        assert.equal(await page.locator('#maxOverride').isDisabled(),false); await assertMin();
        assert.equal(await page.locator('#maxOverride').inputValue(),'8');
        await setMax(8);
        await page.locator('#playPauseButton').click();
        await page.waitForTimeout(200);
        assert.equal(await page.locator('#maxOverride').inputValue(),'8');
        await page.locator('#speed').fill('20'); await page.locator('#speed').press('Tab');
        assert.equal(await page.locator('#maxOverride').inputValue(),'8');
        await page.locator('#steps').fill('8'); await page.locator('#steps').press('Tab');
        assert.equal(await page.locator('#maxOverride').isDisabled(),false); await assertMin();
        assert.equal(await page.locator('#maxOverride').inputValue(),'8');
        await setMax(8);
        await page.locator('#zoomInButton').click();
        assert.equal(await page.locator('#maxOverride').isDisabled(),false); await assertMin();
        assert.equal(await page.locator('#maxOverride').inputValue(),'8');
        await setMax(8);
        await page.setViewportSize({width:1000,height:800});
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.locator('#maxOverride').isDisabled(),false);
        assert.equal(await page.locator('#maxOverride').inputValue(),'8');
        await assertMin();
        await page.locator('#hideControlPanelButton').click();
        await page.locator('#openControlPanelButton').click();
        assert.equal(await page.locator('#maxOverride').isDisabled(),false);
        assert.equal(await page.locator('#maxOverride').inputValue(),'8');
        await page.locator('#maxOverrideToggle').click();
        await page.locator('#amplitude').fill('4'); await page.locator('#amplitude').press('Tab');
        assert.equal(await page.locator('#maxOverride').isDisabled(),true);
        console.log('PASS selected max survives wave, phase, step, view, resize and sidebar changes; manual disable stays disabled');

        await page.setViewportSize({width:1100,height:800});
        const rectangle={...cfg,boundary:'Rectangle',boundaryWidth:4,boundaryHeight:2,boundaryRotationDegrees:0,rotationDegrees:0,yHeight:6,maxOverride:2,phase:Math.PI/2};
        await load(rectangle);
        assert.equal(await page.locator('#rectangleDimensions').isVisible(),true);
        assert.equal(await page.locator('#radiusField').isVisible(),false);
        await page.locator('#showSaveButton').click();
        assert.equal(await page.locator('#cropBoundary').isChecked(),true);
        await page.locator('#saveWidth').fill('400');
        assert.equal(await page.locator('#saveHeight').inputValue(),'200');
        await page.locator('#saveHeight').fill('150');
        assert.equal(await page.locator('#saveWidth').inputValue(),'300');
        const filenameGap = await page.locator('#saveFilename').evaluate(input => {
            const range = document.createRange(); range.selectNodeContents(input.parentElement.firstChild);
            return input.getBoundingClientRect().top - range.getBoundingClientRect().bottom;
        });
        assert.ok(filenameGap >= 10, 'Filename label needs visible spacing above its input');
        await page.screenshot({path:output+'/crop-save.png'});
        const downloadPromise=page.waitForEvent('download'); await page.locator('#saveImageButton').click();
        const download=await downloadPromise, pngPath=output+'/rectangle.png'; await download.saveAs(pngPath);
        const metadata=await read_png_config(new Blob([await fs.readFile(pngPath)]));
        assert.equal(metadata.boundary,'Rectangle'); assert.equal(metadata.boundaryWidth,4); assert.equal(metadata.boundaryHeight,2); assert.equal(metadata.yHeight,2);
        const pixels = await page.evaluate(async data=>{
            const image=await createImageBitmap(new Blob([new Uint8Array(data)],{type:'image/png'}));
            const c=document.createElement('canvas'); c.width=image.width;c.height=image.height; const ctx=c.getContext('2d');ctx.drawImage(image,0,0);
            return {width:c.width,height:c.height,center:[...ctx.getImageData(c.width/2,c.height/2,1,1).data]};
        },[...await fs.readFile(pngPath)]);
        assert.deepEqual([pixels.width,pixels.height],[300,150]); assert.equal(pixels.center[3],255);
        console.log('PASS rectangle tight crop, linked dimensions and PNG metadata');

        await page.locator('#boundary').selectOption('Circle'); await page.locator('#radius').fill('2'); await page.locator('#radius').press('Tab');
        await page.locator('#showSaveButton').click(); assert.equal(await page.locator('#cropBoundary').isChecked(),true);
        await page.locator('#saveWidth').fill('128'); assert.equal(await page.locator('#saveHeight').inputValue(),'128');
        const circleDownload=page.waitForEvent('download'); await page.locator('#saveImageButton').click();
        const circle=await circleDownload;const circlePath=output+'/circle.png';await circle.saveAs(circlePath);
        const alpha=await page.evaluate(async data=>{
            const i=await createImageBitmap(new Blob([new Uint8Array(data)],{type:'image/png'}));const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);return [ctx.getImageData(0,0,1,1).data[3],ctx.getImageData(64,64,1,1).data[3]];
        },[...await fs.readFile(circlePath)]);
        assert.deepEqual(alpha,[0,255]);
        await page.locator('#radius').fill('20');await page.locator('#radius').press('Tab');
        await page.locator('#showSaveButton').click();assert.equal(await page.locator('#cropBoundaryRow').isVisible(),false);
        assert.deepEqual(errors,[]);
        console.log('PASS transparent circular crop and clipped-boundary crop unavailable');
        console.log('Artifacts:',output);
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
