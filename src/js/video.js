// Browser-local video export with frame-indexed phases and timestamps.
import { TAU } from './cymatics.js';
import { BufferTarget, CanvasSource, Mp4OutputFormat, WebMOutputFormat, Output, Quality, canEncodeVideo } from 'mediabunny';

export const VIDEO_FORMATS = [
    { mimeType: 'video/mp4', extension: 'mp4', label: 'MP4' },
    { mimeType: 'video/mp4;codecs=avc1', extension: 'mp4', label: 'MP4' },
    { mimeType: 'video/webm;codecs=vp9', extension: 'webm', label: 'WebM' },
    { mimeType: 'video/webm;codecs=vp8', extension: 'webm', label: 'WebM' },
    { mimeType: 'video/webm', extension: 'webm', label: 'WebM' }
];

export function supported_video_formats(Recorder = globalThis.MediaRecorder) {
    if (typeof Recorder !== 'function' || typeof Recorder.isTypeSupported !== 'function') return [];
    return VIDEO_FORMATS.filter(format => { try { return Recorder.isTypeSupported(format.mimeType); } catch { return false; } });
}

export function video_plan(cfg, { width, height, fps, cycles }) {
    if (![width, height].every(v => Number.isInteger(v) && v >= 2 && v <= 4096 && v % 2 === 0) || width * height > 12000000) {
        throw new Error('Video width and height must be even numbers from 2 to 4096, up to 12 megapixels.');
    }
    if (!Number.isInteger(fps) || fps < 1 || fps > 60) throw new Error('Choose an integer FPS from 1 to 60.');
    if (!Number.isInteger(cycles) || cycles < 1 || cycles > 300) throw new Error('Choose 1–300 complete phase cycles.');
    const framesPerCycle = Math.max(1, Math.round(fps * cfg.steps / cfg.speed));
    const totalFrames = framesPerCycle * cycles, duration = totalFrames / fps;
    if (duration > 300) throw new Error('Choose fewer cycles or a faster phase speed. Video exports are limited to five minutes.');
    return { width, height, fps, cycles, framesPerCycle, totalFrames, duration };
}

export function video_phase(cfg, frame, framesPerCycle) {
    // Each encoded frame advances exactly 2π / framesPerCycle, including the loop seam.
    const step = frame % framesPerCycle;
    return ((cfg.phase + TAU * step / framesPerCycle) % TAU + TAU) % TAU;
}

export function even_video_dimensions(width, height) {
    return { width: Math.max(2, Math.min(4096, Math.round(width / 2) * 2)), height: Math.max(2, Math.min(4096, Math.round(height / 2) * 2)) };
}

export function video_filename(name, extension) {
    const base = (name || '').trim().replace(/\.(png|mp4|webm)$/i, '') || 'Cymatics.art';
    return `${base}.${extension}`;
}

// Check actual encoder support at the requested dimensions, independently of MediaRecorder.
export async function video_export_formats(plan) {
    if (typeof globalThis.VideoEncoder === 'function' && typeof globalThis.VideoFrame === 'function') {
        const options = { width: plan.width, height: plan.height, frameRate: plan.fps, quality: new Quality({ bitrate: video_bitrate(plan) }) };
        const candidates = [
            { mimeType: 'video/mp4', extension: 'mp4', label: 'MP4', codec: 'avc' },
            { mimeType: 'video/webm', extension: 'webm', label: 'WebM', codec: 'vp9' },
            { mimeType: 'video/webm', extension: 'webm', label: 'WebM', codec: 'vp8' }
        ];
        const supported = await Promise.all(candidates.map(async format => {
            try { return await canEncodeVideo(format.codec, options) ? format : null; } catch { return null; }
        }));
        if (supported.some(Boolean)) return supported.filter(Boolean);
    }
    return supported_video_formats().map(format => ({ ...format, live: true }));
}

function video_bitrate(plan) {
    return Math.round(Math.max(1000000, Math.min(40000000, plan.width * plan.height * plan.fps * 0.12)));
}

export async function record_video(options) {
    const { signal } = options;
    signal?.throwIfAborted();
    const formats = await video_export_formats(options.plan);
    signal?.throwIfAborted();
    if (!formats.length) throw new Error('Video export is not available in this browser. PNG and JSON saving are still available.');
    if (formats[0].live) return record_live_video(options);
    return encode_video_frames(options, formats[0]);
}

async function encode_video_frames({ canvas, plan, drawFrame, signal, onProgress = () => {}, onFormat = () => {} }, format) {
    const target = new BufferTarget();
    const output = new Output({ format: format.extension === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target });
    let cancelError, cancelPromise, bytes = 0, completed = false;
    function cancel(error) {
        if (cancelError) return;
        cancelError = error;
        cancelPromise = output.cancel().catch(() => {});
    }
    function aborted() { cancel(signal.reason || new DOMException('Video export cancelled.', 'AbortError')); }
    function visibility_changed() { if (document.hidden) cancel(new Error('Export stopped because this tab was hidden. Keep the tab visible and try again.')); }
    function check() { signal?.throwIfAborted(); if (cancelError) throw cancelError; }
    const source = new CanvasSource(canvas, {
        codec: format.codec, quality: new Quality({ bitrate: video_bitrate(plan) }),
        onEncodedPacket(packet) {
            bytes += packet.data.byteLength;
            if (bytes > 512 * 1024 * 1024) cancel(new Error('The video exceeded 512 MB. Choose fewer cycles or a lower resolution.'));
        }
    });
    output.addVideoTrack(source, { frameRate: plan.fps });
    signal?.addEventListener('abort', aborted, { once: true });
    document.addEventListener('visibilitychange', visibility_changed);
    try {
        check(); visibility_changed(); check();
        await output.start(); check(); onFormat(format);
        for (let frame = 0; frame < plan.totalFrames; frame++) {
            check(); drawFrame(frame);
            // Time belongs to the frame index, never to rendering or encoding speed.
            await source.add(frame / plan.fps, 1 / plan.fps, { keyFrame: frame % plan.framesPerCycle === 0 });
            check(); onProgress({ frame: frame + 1, total: plan.totalFrames, elapsed: (frame + 1) / plan.fps });
            // Let progress paint and cancellation run, including on slow renders.
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        source.close();
        await output.finalize(); check();
        const blob = new Blob([target.buffer], { type: format.mimeType });
        if (!blob.size) throw new Error('The browser produced an empty video. Try a smaller resolution.');
        completed = true;
        return { blob, format };
    } catch (error) { throw cancelError || error; }
    finally {
        signal?.removeEventListener('abort', aborted);
        document.removeEventListener('visibilitychange', visibility_changed);
        if (!completed) await (cancelPromise || output.cancel().catch(() => {}));
    }
}

function record_live_video({ canvas, plan, drawFrame, signal, onProgress = () => {}, onFormat = () => {} }) {
    const formats = supported_video_formats();
    if (!formats.length || typeof canvas.captureStream !== 'function') return Promise.reject(new Error('Video recording is not available in this browser. PNG and JSON saving are still available.'));
    return new Promise((resolve, reject) => {
        let stream, recorder, format, timer, startTimer, started = 0, lastFrame = -1, finished = false, settled = false, bytes = 0;
        const chunks = [], frameMilliseconds = 1000 / plan.fps;
        function cleanup() {
            clearTimeout(timer); clearTimeout(startTimer);
            signal?.removeEventListener('abort', aborted);
            document.removeEventListener('visibilitychange', visibility_changed);
            for (const track of stream?.getTracks() || []) track.stop();
        }
        function fail(error) {
            if (settled) return;
            settled = true; cleanup();
            if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch {} }
            reject(error);
        }
        function aborted() { fail(signal.reason || new DOMException('Video export cancelled.', 'AbortError')); }
        function visibility_changed() {
            if (document.hidden) fail(new Error('Recording stopped because this tab was hidden. Keep the tab visible and try again.'));
        }
        function finish() {
            if (settled || finished) return;
            finished = true;
            try {
                recorder.stop();
                timer = setTimeout(() => fail(new Error('The browser did not finish encoding. Try a smaller resolution.')), 15000);
            } catch (error) { fail(error); }
        }
        function tick() {
            if (settled) return;
            try {
                const elapsed = performance.now() - started;
                const frame = lastFrame + 1;
                if (frame >= plan.totalFrames) { finish(); return; }
                drawFrame(frame); lastFrame = frame;
                stream.getVideoTracks()[0].requestFrame?.();
                onProgress({ frame: frame + 1, total: plan.totalFrames, elapsed: Math.min(plan.duration, elapsed / 1000) });
                timer = setTimeout(tick, Math.max(frameMilliseconds, started + (frame + 1) * frameMilliseconds - performance.now()));
            } catch (error) { fail(error); }
        }
        try {
            if (signal?.aborted) { aborted(); return; }
            if (document.hidden) throw new Error('Keep this tab visible while recording.');
            drawFrame(0);
            stream = canvas.captureStream(0);
            if (typeof stream.getVideoTracks()[0]?.requestFrame !== 'function') {
                for (const track of stream.getTracks()) track.stop();
                stream = canvas.captureStream(plan.fps);
            }
            const bitrate = video_bitrate(plan);
            let startError;
            for (const candidate of formats) {
                try {
                    recorder = new MediaRecorder(stream, { mimeType: candidate.mimeType, videoBitsPerSecond: bitrate });
                    format = candidate;
                    recorder.ondataavailable = event => {
                        if (settled || !event.data.size) return;
                        chunks.push(event.data); bytes += event.data.size;
                        if (bytes > 512 * 1024 * 1024) fail(new Error('The video exceeded 512 MB. Choose fewer cycles or a lower resolution.'));
                    };
                    recorder.onerror = event => fail(new Error(event.error?.message || 'Video encoding failed. Try a smaller resolution or another browser.'));
                    recorder.onstop = () => {
                        if (settled) return;
                        if (!finished) { fail(new Error('Video recording was interrupted.')); return; }
                        const mimeType = recorder.mimeType || format.mimeType;
                        const blob = new Blob(chunks, { type: mimeType });
                        if (!blob.size) { fail(new Error('The browser produced an empty video. Try a smaller resolution.')); return; }
                        settled = true; cleanup();
                        resolve({ blob, format: { ...format, mimeType } });
                    };
                    recorder.onstart = () => {
                        if (settled) return;
                        clearTimeout(startTimer); started = performance.now(); onFormat(format); tick();
                    };
                    recorder.start(1000);
                    startError = null; break;
                } catch (error) { startError = error; recorder = null; }
            }
            if (!recorder) throw startError || new Error('No supported video encoder could be started.');
            signal?.addEventListener('abort', aborted, { once: true });
            document.addEventListener('visibilitychange', visibility_changed);
            startTimer = setTimeout(() => fail(new Error('The video encoder did not start. Try a smaller resolution.')), 15000);
        } catch (error) { fail(error); }
    });
}
