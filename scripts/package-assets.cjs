// Publish icon URLs as well as inline icons, for hosting and offline downloads.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
fs.mkdirSync(path.join(dist, 'images'), { recursive: true });
for (const name of fs.readdirSync(path.join(root, 'images'))) {
    if (!/^(favicon(?:-\d+x\d+\.png|\.ico)|apple-touch-icon\.png|android-chrome-\d+x\d+\.png)$/.test(name)) continue;
    fs.copyFileSync(path.join(root, 'images', name), path.join(dist, 'images', name));
    fs.copyFileSync(path.join(root, 'images', name), path.join(dist, name));
}
// Keep the conventional PNG URL on the chosen artwork too; preserve both input files.
for (const target of [path.join(dist, 'favicon.png'), path.join(dist, 'images', 'favicon.png')]) {
    fs.copyFileSync(path.join(root, 'images', 'favicon_wb.png'), target);
}
fs.copyFileSync(path.join(dist, 'index.html'), path.join(dist, 'Cymatics.art.html'));
require('./check-build.cjs');
