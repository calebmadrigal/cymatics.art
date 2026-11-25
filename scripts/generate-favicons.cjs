// Derive every icon from the supplied artwork; keep the offline HTML self-contained.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const images = path.join(root, 'images');
const definitions = [
    ['favicon-16x16.png', 16], ['favicon-32x32.png', 32], ['favicon-48x48.png', 48],
    ['apple-touch-icon.png', 180], ['android-chrome-192x192.png', 192], ['android-chrome-512x512.png', 512]
];
(async () => {
    const source = fs.readFileSync(path.join(images, 'favicon_wb.png'));
    const buffers = new Map();
    for (const size of new Set([...definitions.map(([, size]) => size), 24, 64, 128, 256])) {
        buffers.set(size, await sharp(source).resize(size, size, { fit: 'contain', background: '#00000000', kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer());
    }
    for (const [name, size] of definitions) fs.writeFileSync(path.join(images, name), buffers.get(size));
    // ICO directory followed by PNG-encoded frames, supported by modern browsers.
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const header = Buffer.alloc(6 + sizes.length * 16);
    header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    sizes.forEach((size, i) => {
        const at = 6 + i * 16, png = buffers.get(size);
        header[at] = size === 256 ? 0 : size; header[at + 1] = size === 256 ? 0 : size;
        header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
        header.writeUInt32LE(png.length, at + 8); header.writeUInt32LE(offset, at + 12); offset += png.length;
    });
    fs.writeFileSync(path.join(images, 'favicon.ico'), Buffer.concat([header, ...sizes.map(size => buffers.get(size))]));
    const links = definitions.map(([name, size]) => {
        const rel = name === 'apple-touch-icon.png' ? 'apple-touch-icon' : 'icon';
        return `    <link rel="${rel}" type="image/png" sizes="${size}x${size}" href="data:image/png;base64,${buffers.get(size).toString('base64')}">`;
    });
    const htmlPath = path.join(root, 'src/index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    const block = '    <!-- Generated favicons -->\n' + links.join('\n') + '\n    <!-- End generated favicons -->';
    if (html.includes('<!-- Generated favicons -->')) {
        html = html.replace(/    <!-- Generated favicons -->[\s\S]*?    <!-- End generated favicons -->/, block);
    } else {
        html = html.replace(/^    <link rel="icon"[^>]*>$/m, block);
    }
    fs.writeFileSync(htmlPath, html);
    console.log('Generated PNG favicons (16, 32, 48, 180, 192, 512) and multi-size ICO.');
})().catch(error => { console.error(error); process.exitCode = 1; });
