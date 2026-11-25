// Browser-local, real-time video export. No camera, microphone, or server access.
import { TAU } from './cymatics.js';

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
    const step = Math.floor((frame % framesPerCycle) * cfg.steps / framesPerCycle);
    return ((cfg.phase + TAU * step / cfg.steps) % TAU + TAU) % TAU;
}

export function even_video_dimensions(width, height) {
    return { width: Math.max(2, Math.min(4096, Math.round(width / 2) * 2)), height: Math.max(2, Math.min(4096, Math.round(height / 2) * 2)) };
}

export function video_filename(name, extension) {
    const base = (name || '').trim().replace(/\.(png|mp4|webm)$/i, '') || 'Cymatics.art';
    return `${base}.${extension}`;
}

export function record_video({ canvas, plan, drawFrame, signal, onProgress = () => {}, onFormat = () => {} }) {
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
                const frame = Math.min(plan.totalFrames - 1, Math.floor(elapsed / frameMilliseconds));
                const rendered = frame !== lastFrame;
                if (rendered) {
                    drawFrame(frame); lastFrame = frame;
                    stream.getVideoTracks()[0].requestFrame?.();
                    onProgress({ frame: frame + 1, total: plan.totalFrames, elapsed: Math.min(plan.duration, elapsed / 1000) });
                }
                if (elapsed >= plan.duration * 1000) {
                    // Hold the final sampled phase if rendering ran past its scheduled frame.
                    if (rendered) timer = setTimeout(finish, frameMilliseconds);
                    else finish();
                } else {
                    timer = setTimeout(tick, Math.max(1, started + (frame + 1) * frameMilliseconds - performance.now()));
                }
            } catch (error) { fail(error); }
        }
        try {
            if (signal?.aborted) { aborted(); return; }
            if (document.hidden) throw new Error('Keep this tab visible while recording.');
            drawFrame(0);
            stream = canvas.captureStream(plan.fps);
            const bitrate = Math.round(Math.max(1000000, Math.min(40000000, plan.width * plan.height * plan.fps * 0.12)));
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
