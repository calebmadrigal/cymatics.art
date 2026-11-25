import test from 'node:test';
import { Output, BufferTarget, WebMOutputFormat, EncodedVideoPacketSource, EncodedPacket, Input, BlobSource, WEBM } from 'mediabunny';
import assert from 'node:assert/strict';
import { default_config, TAU } from '../src/js/cymatics.js';
import { supported_video_formats, video_plan, video_phase, even_video_dimensions, video_filename, record_video } from '../src/js/video.js';
const settings = { width: 1280, height: 720, fps: 30, cycles: 3 };

test('video chooses MP4 first, then WebM, and tolerates unavailable encoders', () => {
    class Recorder { static isTypeSupported(type) { return type.startsWith('video/'); } }
    assert.equal(supported_video_formats(Recorder)[0].extension, 'mp4');
    Recorder.isTypeSupported = type => type.startsWith('video/webm');
    assert.equal(supported_video_formats(Recorder)[0].extension, 'webm');
    Recorder.isTypeSupported = () => { throw new Error('Unsupported'); };
    assert.deepEqual(supported_video_formats(Recorder), []);
    assert.deepEqual(supported_video_formats(null), []);
});

test('video duration covers complete cycles at the selected phase speed and FPS', () => {
    const cfg = default_config();
    assert.deepEqual(video_plan(cfg, settings), { ...settings, framesPerCycle: 30, totalFrames: 90, duration: 3 });
    const plan = video_plan({ ...cfg, steps: 7, speed: 3 }, { ...settings, fps: 24, cycles: 2 });
    assert.equal(plan.framesPerCycle, 56); assert.equal(plan.totalFrames, 112); assert.equal(plan.duration, 112 / 24);
    assert.equal(video_plan({ ...cfg, steps: 1, speed: 100 }, settings).framesPerCycle, 1);
});

test('video rejects invalid dimensions, FPS, cycle count, and excessive duration', () => {
    for (const patch of [{ width: 1279 }, { height: 1 }, { width: 4098 }, { width: 4096, height: 4096 }, { fps: 0 }, { fps: 29.5 }, { fps: 61 }, { cycles: 0 }, { cycles: 1.5 }, { cycles: 301 }]) {
        assert.throws(() => video_plan(default_config(), { ...settings, ...patch }));
    }
    assert.throws(() => video_plan({ ...default_config(), steps: 1000, speed: 1 }, settings), /five minutes/);
});

test('every video phase increment, including the seam, is equal when steps and FPS differ', () => {
    for (const steps of [1, 7, 30, 31, 100]) for (const framesPerCycle of [2, 8, 24, 30, 56]) {
        const cfg = { ...default_config(), steps, phase: 5.9 };
        const phases = Array.from({ length: framesPerCycle * 3 }, (_, i) => video_phase(cfg, i, framesPerCycle));
        for (let i = 0; i < phases.length; i++) {
            const delta = (phases[(i + 1) % phases.length] - phases[i] + TAU) % TAU;
            assert.ok(Math.abs(delta - TAU / framesPerCycle) < 1e-10, `Uneven phase step: steps=${steps}, frames=${framesPerCycle}, i=${i}`);
            assert.equal(phases[i], phases[i % framesPerCycle]);
        }
        assert.notEqual(phases[framesPerCycle - 1], phases[0]);
        assert.equal(cfg.phase, 5.9);
    }
});

test('video resolutions and filenames use encoder-compatible dimensions and extensions', () => {
    assert.deepEqual(even_video_dimensions(1279, 719), { width: 1280, height: 720 });
    assert.deepEqual(even_video_dimensions(1, 8000), { width: 2, height: 4096 });
    assert.equal(video_filename('Pattern.PNG', 'mp4'), 'Pattern.mp4');
    assert.equal(video_filename('Pattern.mp4', 'webm'), 'Pattern.webm');
    assert.equal(video_filename('  ', 'mp4'), 'Cymatics.art.mp4');
    assert.equal(video_filename('Cymatics.art', 'png'), 'Cymatics.art.png');
});

test('recording falls back after an MP4 startup failure and releases capture tracks', async () => {
    const originals = { MediaRecorder: globalThis.MediaRecorder, document: globalThis.document };
    const target = new BufferTarget(), fixture = new Output({ format: new WebMOutputFormat(), target });
    const source = new EncodedVideoPacketSource('vp8'); fixture.addVideoTrack(source);
    await fixture.start();
    await source.add(new EncodedPacket(new Uint8Array([0x10, 0, 0, 0x9d, 0x01, 0x2a, 2, 0, 2, 0]), 'key', 0, 1 / 30), { decoderConfig: { codec: 'vp8', codedWidth: 2, codedHeight: 2 } });
    source.close(); await fixture.finalize();
    let stopped = false; const tried = [], drawn = [];
    globalThis.document = new EventTarget();
    class Recorder {
        static isTypeSupported() { return true; }
        constructor(stream, { mimeType }) { this.mimeType = mimeType; this.state = 'inactive'; tried.push(mimeType); }
        start() {
            if (this.mimeType.startsWith('video/mp4')) throw new Error('No encoder');
            this.state = 'recording'; queueMicrotask(() => this.onstart());
        }
        stop() {
            this.state = 'inactive';
            queueMicrotask(() => { this.ondataavailable({ data: new Blob([target.buffer]) }); this.onstop(); });
        }
    }
    globalThis.MediaRecorder = Recorder;
    const track = { stop() { stopped = true; }, requestFrame() {} };
    const canvas = { captureStream() { return { getTracks: () => [track], getVideoTracks: () => [track] }; } };
    try {
        const result = await record_video({ canvas, plan: { ...settings, fps: 60, totalFrames: 2, duration: 2 / 60 }, drawFrame: frame => drawn.push(frame) });
        assert.equal(result.format.extension, 'webm'); assert.ok(result.blob.size > 0);
        const tagged = new Input({ source: new BlobSource(result.blob), formats: [WEBM] });
        try {
            const tags = await tagged.getMetadataTags();
            assert.equal(tags.raw.SOURCE, 'cymatics.art'); assert.equal(tags.comment, 'Created with https://cymatics.art');
        } finally { tagged.dispose(); }
        assert.deepEqual(tried.slice(0, 3), ['video/mp4', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp9']);
        assert.equal(stopped, true); assert.ok(drawn.includes(0)); assert.ok(drawn.includes(1));
        const controller = new AbortController(); controller.abort();
        await assert.rejects(record_video({ canvas, plan: settings, signal: controller.signal, drawFrame() { throw new Error('Should not draw'); } }), { name: 'AbortError' });
    } finally {
        for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    }
});
