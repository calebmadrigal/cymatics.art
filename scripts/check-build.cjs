const fs = require('node:fs');
const html = fs.readFileSync('dist/index.html', 'utf8');
if (/<script[^>]+src\s*=/i.test(html) || /<link[^>]+(?:stylesheet|modulepreload)/i.test(html) || /@import\s*["']/i.test(html)) {
    throw new Error('Build must inline all scripts and styles.');
}
if (!html.includes('Cymatics.art') || !html.includes('savedConfig')) throw new Error('Incomplete build.');
console.log(`Verified self-contained HTML (${(Buffer.byteLength(html) / 1024).toFixed(0)} KiB).`);
