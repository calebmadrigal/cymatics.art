// PNG iTXt metadata, compatible with the standard used by FuzzyGraph.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const signature = [137, 80, 78, 71, 13, 10, 26, 10];

function chunks(bytes) {
    if (!signature.every((n, i) => bytes[i] === n)) throw new Error('Please open a Cymatics.art PNG or JSON file.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const result = [];
    let p = 8;
    while (p + 12 <= bytes.length) {
        const length = view.getUint32(p);
        if (p + length + 12 > bytes.length) throw new Error('Truncated PNG file.');
        const type = decoder.decode(bytes.subarray(p + 4, p + 8));
        result.push({ p, length, type });
        if (type === 'IEND') return result;
        p += length + 12;
    }
    throw new Error('PNG is missing its end marker.');
}

function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (const byte of bytes) {
        c ^= byte;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    return (~c) >>> 0;
}

export async function add_png_config(blob, config) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const end = chunks(bytes).find(c => c.type === 'IEND').p;
    const payload = encoder.encode('cymaticsconfig\0\0\0\0\0' + JSON.stringify(config));
    const chunk = new Uint8Array(12 + payload.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, payload.length);
    chunk.set(encoder.encode('iTXt'), 4); chunk.set(payload, 8);
    view.setUint32(chunk.length - 4, crc32(chunk.subarray(4, chunk.length - 4)));
    return new Blob([bytes.subarray(0, end), chunk, bytes.subarray(end)], { type: 'image/png' });
}

export async function read_png_config(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    for (const { p, length, type } of chunks(bytes)) {
        if (type !== 'iTXt') continue;
        const data = bytes.subarray(p + 8, p + 8 + length);
        const keyEnd = data.indexOf(0);
        if (decoder.decode(data.subarray(0, keyEnd)) !== 'cymaticsconfig') continue;
        if (data[keyEnd + 1] !== 0) throw new Error('Compressed configuration metadata is unsupported.');
        let start = keyEnd + 3;
        start = data.indexOf(0, start) + 1;
        start = data.indexOf(0, start) + 1;
        return JSON.parse(decoder.decode(data.subarray(start)));
    }
    throw new Error('This PNG has no Cymatics.art settings. Open an image saved by Cymatics.art.');
}
