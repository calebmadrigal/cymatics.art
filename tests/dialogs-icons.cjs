// Optional Playwright checks for favicons, title styling, and safe modal dismissal.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
    const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    try {
        const page = await browser.newPage({viewport:{width:1280,height:900}}), errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(process.env.APP_URL || 'http://127.0.0.1:8000');
        await page.waitForFunction(()=>document.getElementById('renderStatus').textContent.includes('reflected paths'));
        const title=page.locator('header .logo a');
        assert.equal(await title.getAttribute('href'),'https://cymatics.art');
        assert.equal(await title.evaluate(a=>getComputedStyle(a).color),'rgb(255, 255, 255)');
        const links=await page.locator('head link[rel=icon], head link[rel=apple-touch-icon]').evaluateAll(els=>els.map(el=>({rel:el.rel,size:el.sizes.value,href:el.href})));
        assert.equal(links.length,6);
        for(const icon of links) {
            const size=Number(icon.size.split('x')[0]);
            const name=icon.rel==='apple-touch-icon'?'apple-touch-icon.png':size>=192?`android-chrome-${size}x${size}.png`:`favicon-${size}x${size}.png`;
            const expected=await fs.readFile(path.join(__dirname,'../images',name));
            assert.ok(Buffer.from(icon.href.split(',')[1],'base64').equals(expected),name+' must be embedded unchanged');
        }
        console.log('PASS favicon links embed the generated artwork and title link stays white');

        for(const [button,modal,inputId] of [['showSaveButton','saveModal','saveFilename'],['showShareButton','shareModal','shareURL']]) {
            await page.locator('#'+button).click();
            const input=page.locator('#'+inputId);
            if(inputId==='saveFilename') await input.fill('selection-stays-open-cymatics.png');
            const box=await input.boundingBox(), dialog=await page.locator('#'+modal).boundingBox();
            const outside={x:dialog.x+dialog.width+30,y:box.y+box.height/2};
            await page.mouse.move(box.x+10,box.y+box.height/2); await page.mouse.down();
            await page.mouse.move(outside.x,outside.y,{steps:12}); await page.mouse.up();
            assert.equal(await page.locator('#'+modal).evaluate(d=>d.open),true,'Text selection ending outside must keep '+modal+' open');
            assert.ok(await input.evaluate(el=>el.selectionEnd>el.selectionStart),'Gesture must actually select text');
            await page.mouse.click(outside.x,outside.y);
            assert.equal(await page.locator('#'+modal).evaluate(d=>d.open),false,'A new genuine backdrop click should close '+modal);
            console.log('PASS text-selection drag outside and backdrop-click dismissal:',modal);
        }
        await page.locator('#showSaveButton').click();
        const dialog=await page.locator('#saveModal').boundingBox(), input=await page.locator('#saveFilename').boundingBox();
        await page.mouse.move(dialog.x+dialog.width+30,input.y+input.height/2); await page.mouse.down();
        await page.mouse.move(input.x+20,input.y+input.height/2,{steps:8}); await page.mouse.up();
        assert.equal(await page.locator('#saveModal').evaluate(d=>d.open),true,'Backdrop-to-input drag must keep modal open');
        await page.keyboard.press('Escape'); assert.equal(await page.locator('#saveModal').evaluate(d=>d.open),false);
        await page.locator('#showSaveButton').click(); await page.locator('#saveModal .close-modal').click();
        assert.equal(await page.locator('#saveModal').evaluate(d=>d.open),false);
        assert.deepEqual(errors,[]);
        console.log('PASS outside-to-inside drag, Escape, and explicit close button');
    } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
