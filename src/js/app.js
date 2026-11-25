// UI state follows FuzzyGraph's nanostores + DOM event/listener style.
import { map } from 'nanostores';
import { matplotlibColorData, getMatplotlibColormap } from './ga_color.js';
import { TAU, MAX_RESONATORS, default_config, config_with_patch, validate_config, validate_resonator, generate_resonators,
    build_sources, rotated_resonators, inside_boundary, screen_to_world, phase_at_step, boundary_view_bounds, boundary_fully_visible, crop_view_config, linked_dimensions } from './cymatics.js';
import { create_renderer } from './cymatics_glsl.js';
import { add_png_config, read_png_config } from './png.js';

const $ = id => document.getElementById(id);
const offlineDocument = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
const config = map(default_config());
const canvas = $('mainCanvas');
let renderer = null, scene = null, sceneKey = '', listKey = '', colorsKey = '';
let editIndex = null, selectedIndex = 0, frameRequested = false, toastTimer;
let sampledRange = { min: 0, max: 1 };
let saveCropBounds = null;

function toast(message) {
    $('toast').textContent = message; $('toast').hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
}

function apply_config(candidate) {
    const validated = validate_config(candidate);
    if (!Object.hasOwn(matplotlibColorData, validated.colorMap)) throw new Error('Unknown color map.');
    config.set(validated);
}

function update_config(patch, options) { apply_config(config_with_patch(config.get(), patch, options)); }
function set_switch(id, value) { $(id).setAttribute('aria-checked', String(value)); }

for (const name of Object.keys(matplotlibColorData).sort((a, b) => a.localeCompare(b))) {
    const option = document.createElement('option'); option.value = name; option.textContent = name;
    $('colorMap').append(option);
}

function update_position_preview(cfg) {
    const preview = $('resonatorCanvas'), ctx = preview.getContext('2d');
    const bounds = preview.getBoundingClientRect();
    const cssWidth = bounds.width - 2 * preview.clientLeft, cssHeight = bounds.height - 2 * preview.clientTop;
    if (cssWidth <= 0 || cssHeight <= 0) return;
    const density = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(cssWidth * density)), height = Math.max(1, Math.round(cssHeight * density));
    if (preview.width !== width || preview.height !== height) { preview.width = width; preview.height = height; }
    // Preserve the original drawing scale, with equal graph-unit sizes on screen.
    const displayScale = Math.min(cssWidth / 480, cssHeight / 340);
    const w = cssWidth / displayScale, h = cssHeight / displayScale;
    ctx.setTransform(preview.width / w, 0, 0, preview.height / h, 0, 0);
    const extent = Math.max(cfg.boundary === 'Rectangle' ? Math.hypot(cfg.boundaryWidth, cfg.boundaryHeight) / 2 : cfg.boundary === 'None' ? 0 : cfg.radius, ...cfg.resonators_list.map(r => Math.hypot(r.x, r.y)), 1) * 1.2;
    const scale = Math.min(w, h) / (2 * extent);
    const xy = p => [w / 2 + p.x * scale, h / 2 - p.y * scale];
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f3f4f6'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
    ctx.strokeStyle = '#6b7280'; ctx.fillStyle = '#e5e7eb80'; ctx.lineWidth = 2;
    ctx.beginPath();
    if (scene.geometry.kind === 2) {
        const n = scene.geometry.normal, t = { x: -n.y, y: n.x };
        for (const side of [-1, 1]) {
            ctx.moveTo(...xy({ x: side * cfg.radius * n.x - 3 * extent * t.x, y: side * cfg.radius * n.y - 3 * extent * t.y }));
            ctx.lineTo(...xy({ x: side * cfg.radius * n.x + 3 * extent * t.x, y: side * cfg.radius * n.y + 3 * extent * t.y }));
        }
    } else if (scene.geometry.vertices.length) {
        scene.geometry.vertices.forEach((p, i) => i === 0 ? ctx.moveTo(...xy(p)) : ctx.lineTo(...xy(p)));
        ctx.closePath(); ctx.fill();
    }
    ctx.stroke();
    let outside = 0;
    rotated_resonators(cfg).forEach((r, i) => {
        const [x, y] = xy(r), isInside = inside_boundary(r, scene.geometry, cfg.radius);
        if (!isInside) outside++;
        if (cfg.advanced && i === selectedIndex) {
            ctx.beginPath(); ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2; ctx.arc(x, y, 11, 0, TAU); ctx.stroke();
        }
        ctx.fillStyle = isInside ? '#1f2937' : '#dc2626';
        ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.fill();
        ctx.font = '18px ui-sans-serif, system-ui'; ctx.fillText(String(i + 1), x + 9, y - 8);
    });
    ctx.fillStyle = '#9ca3af'; ctx.font = '16px ui-monospace, monospace'; ctx.fillText('0', w / 2 + 6, h / 2 + 19);
    $('resonatorCaption').textContent = outside ? `${outside} source${outside === 1 ? '' : 's'} outside the boundary (red).` : 'Resonator positions · centered at (0, 0)';
}

function update_color_preview(cfg) {
    const key = JSON.stringify([cfg.colorMap, cfg.reverseColor, cfg.invertColor, cfg.colorStart, cfg.colorCycles, cfg.hueShiftDegrees, cfg.saturationPercent, cfg.luminosityPercent]);
    if (colorsKey === key) return;
    colorsKey = key;
    const ctx = $('colorPreview').getContext('2d');
    const color = getMatplotlibColormap(0, 1, cfg.colorMap, cfg.reverseColor, cfg.invertColor, cfg.colorCycles, cfg.colorStart, 1, cfg.hueShiftDegrees, cfg.saturationPercent, cfg.luminosityPercent);
    for (let x = 0; x < 256; x++) { ctx.fillStyle = `rgb(${color(x / 255).join(',')})`; ctx.fillRect(x, 0, 1, 10); }
}

function sync_ui(cfg) {
    for (const input of document.querySelectorAll('[data-config]')) {
        if (document.activeElement !== input) input.value = cfg[input.dataset.config];
        const output = $(input.id + 'Display');
        if (output) output.textContent = cfg[input.dataset.config];
    }
    for (const button of document.querySelectorAll('[data-switch]')) set_switch(button.id, cfg[button.dataset.switch]);
    set_switch('modeToggle', cfg.advanced);
    $('modeLabel').textContent = cfg.advanced ? 'Advanced' : 'Basic';
    $('basicResonators').hidden = cfg.advanced; $('basicWaveform').hidden = cfg.advanced;
    $('advancedResonators').hidden = !cfg.advanced;
    $('customSides').hidden = cfg.boundary !== 'Custom';
    $('rectangleDimensions').hidden = cfg.boundary !== 'Rectangle';
    $('radiusField').hidden = cfg.boundary === 'Rectangle';
    $('radius').disabled = cfg.boundary === 'None';
    $('boundaryRotationDegrees').disabled = cfg.boundary === 'None';
    const playing = cfg.phaseMode === 'animated';
    $('playPauseButton').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    $('playPauseButton').title = playing ? 'Pause' : 'Play';
    $('playPauseButton').setAttribute('aria-pressed', String(playing));
    $('pauseIcon').toggleAttribute('hidden', !playing); $('playIcon').toggleAttribute('hidden', playing);
    $('fixedPhase').hidden = cfg.phaseMode !== 'fixed'; $('animatedPhase').hidden = cfg.phaseMode !== 'animated';
    document.querySelectorAll('[name=phaseMode]').forEach(radio => { radio.checked = radio.value === cfg.phaseMode; });
    $('currentPhase').textContent = `Phase: ${cfg.phase.toFixed(3)} rad`;
    $('boundaryHint').textContent = cfg.boundary === 'None' ? 'Unbounded waves · no reflections.' : cfg.boundary === 'Binary Split' ? 'Parallel walls · rotate around the origin.' : cfg.boundary === 'Circle' ? 'Circular wall · 64-segment reflection model.' : cfg.boundary === 'Rectangle' ? 'Width and height are measured before boundary rotation.' : 'Radius is measured from center to vertices.';
    for (const key of ['minOverride', 'maxOverride']) {
        const enabled = cfg[key] !== null;
        $(key).disabled = !enabled; set_switch(key + 'Toggle', enabled);
        if (document.activeElement !== $(key)) $(key).value = cfg[key] ?? '';
    }
    const nextListKey = JSON.stringify(cfg.resonators_list);
    if (nextListKey !== listKey) {
        listKey = nextListKey;
        selectedIndex = Math.min(selectedIndex, cfg.resonators_list.length - 1);
        $('resonatorsList').replaceChildren(...cfg.resonators_list.map((r, i) => {
            const option = document.createElement('option'); option.value = i;
            option.textContent = `${i + 1}. ${r.waveform}  (${+r.x.toFixed(2)}, ${+r.y.toFixed(2)})`;
            option.title = `Amplitude ${r.amplitude}, frequency ${r.frequency}, phase ×${r.phase_multiplier} + ${r.phase_offset}`;
            return option;
        }));
        $('resonatorsList').value = selectedIndex;
    }
    $('addResonatorButton').disabled = cfg.resonators_list.length >= MAX_RESONATORS;
    $('removeResonatorButton').disabled = cfg.resonators_list.length <= 1;
    const nextSceneKey = JSON.stringify([cfg.resonators_list, cfg.resonatorRotationDegrees, cfg.boundary, cfg.radius, cfg.sides, cfg.boundaryRotationDegrees, cfg.boundaryWidth, cfg.boundaryHeight]);
    if (sceneKey !== nextSceneKey) { sceneKey = nextSceneKey; scene = build_sources(cfg); }
    update_position_preview(cfg); update_color_preview(cfg);
    request_render();
}

function render() {
    frameRequested = false;
    if (!renderer || !scene) return;
    const bounds = canvas.getBoundingClientRect();
    // Limit display pixel density for responsive wave animation. Export has its own resolution.
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.round(bounds.width * ratio)), height = Math.max(1, Math.round(bounds.height * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    try {
        sampledRange = renderer.draw(config.get(), scene);
        $('minDisplay').textContent = sampledRange.min.toPrecision(3); $('maxDisplay').textContent = sampledRange.max.toPrecision(3);
        $('renderStatus').textContent = `${config.get().resonators_list.length} resonators · ${scene.sources.length - config.get().resonators_list.length} reflected paths`;
        $('errorBanner').hidden = true;
    } catch (error) { show_error(error); }
}

function request_render() { if (!frameRequested) { frameRequested = true; requestAnimationFrame(render); } }
function show_error(error) { $('errorBanner').textContent = error.message; $('errorBanner').hidden = false; console.error(error); }

const basicKeys = ['numResonators', 'distance', 'amplitude', 'frequency', 'phase_multiplier', 'waveform'];
for (const input of document.querySelectorAll('[data-config]')) {
    function commit() {
        input.setCustomValidity('');
        if (input.value === '' || !input.checkValidity()) return;
        const key = input.dataset.config, value = (input.tagName === 'SELECT' || input.type === 'color') ? input.value : Number(input.value);
        const patch = { [key]: value };
        if (basicKeys.includes(key)) patch.resonators_list = generate_resonators({ ...config.get(), ...patch });
        try { update_config(patch); }
        catch (error) { input.setCustomValidity(error.message); }
    }
    input.addEventListener('input', commit);
    input.addEventListener('change', () => {
        commit();
        if (!input.checkValidity() || input.value === '') {
            toast(input.validationMessage || 'A value is required.'); input.setCustomValidity(''); input.value = config.get()[input.dataset.config];
        }
    });
}
for (const button of document.querySelectorAll('[data-switch]')) button.addEventListener('click', () => update_config({ [button.dataset.switch]: !config.get()[button.dataset.switch] }));
$('playPauseButton').addEventListener('click', () => update_config({ phaseMode: config.get().phaseMode === 'animated' ? 'fixed' : 'animated' }));
$('modeToggle').addEventListener('click', () => update_config({ advanced: !config.get().advanced }));
document.querySelectorAll('[name=phaseMode]').forEach(r => r.addEventListener('change', () => update_config({ phaseMode: r.value })));
for (const key of ['minOverride', 'maxOverride']) {
    $(key + 'Toggle').addEventListener('click', () => {
        const enabled = config.get()[key] !== null;
        const value = enabled ? null : sampledRange[key === 'minOverride' ? 'min' : 'max'];
        try { update_config({ [key]: value }); } catch (error) { toast(error.message); }
    });
    $(key).addEventListener('change', () => {
        try {
            if ($(key).value === '' || !$(key).checkValidity()) throw new Error('Enter a nonnegative override.');
            update_config({ [key]: Number($(key).value) });
        } catch (error) { toast(error.message); $(key).value = config.get()[key] ?? ''; }
    });
}

function open_dialog(id) {
    $('navigation').classList.remove('menu-open'); $('mobileMenuButton').setAttribute('aria-expanded', 'false');
    $(id).showModal();
}
for (const button of document.querySelectorAll('.close-modal, [data-close]')) button.addEventListener('click', () => button.closest('dialog').close());
for (const dialog of document.querySelectorAll('dialog')) {
    let startedOnBackdrop = false;
    function on_backdrop(event) {
        const bounds = dialog.getBoundingClientRect();
        return event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
    }
    dialog.addEventListener('pointerdown', event => { startedOnBackdrop = event.button === 0 && on_backdrop(event); });
    dialog.addEventListener('pointercancel', () => { startedOnBackdrop = false; });
    dialog.addEventListener('close', () => { startedOnBackdrop = false; });
    dialog.addEventListener('click', event => {
        const dismiss = startedOnBackdrop && on_backdrop(event);
        startedOnBackdrop = false;
        if (dismiss) dialog.close();
    });
}

function edit_resonator(index = null) {
    editIndex = index;
    const cfg = config.get();
    const resonator = index === null ? { x: 0, y: 0, amplitude: cfg.amplitude, frequency: cfg.frequency, phase_multiplier: cfg.phase_multiplier, phase_offset: 0, waveform: cfg.waveform } : cfg.resonators_list[index];
    for (const [key, value] of Object.entries(resonator)) $('edit_' + key).value = value;
    $('resonatorError').textContent = ''; $('resonatorModalTitle').textContent = index === null ? 'Add resonator' : `Edit resonator ${index + 1}`;
    open_dialog('resonatorModal');
}
$('resonatorsList').addEventListener('change', () => { selectedIndex = Number($('resonatorsList').value); update_position_preview(config.get()); });
$('resonatorsList').addEventListener('dblclick', () => edit_resonator(selectedIndex));
$('addResonatorButton').addEventListener('click', () => edit_resonator());
$('editResonatorButton').addEventListener('click', () => edit_resonator(selectedIndex));
$('removeResonatorButton').addEventListener('click', () => {
    if (config.get().resonators_list.length <= 1) return;
    update_config({ resonators_list: config.get().resonators_list.filter((_, i) => i !== selectedIndex) });
});
$('resonatorForm').addEventListener('submit', event => {
    event.preventDefault();
    try {
        const r = {};
        for (const key of ['x', 'y', 'amplitude', 'frequency', 'phase_multiplier', 'phase_offset', 'waveform']) {
            if ($('edit_' + key).value === '') throw new Error('Complete every resonator field.');
            r[key] = key === 'waveform' ? $('edit_' + key).value : Number($('edit_' + key).value);
        }
        const resonator = validate_resonator(r), list = [...config.get().resonators_list];
        if (editIndex === null) { list.push(resonator); selectedIndex = list.length - 1; } else list[editIndex] = resonator;
        update_config({ resonators_list: list }); $('resonatorModal').close();
    } catch (error) { $('resonatorError').textContent = error.message; }
});

// View navigation, including rotation-aware pan and cursor-anchored zoom.
function zoom(factor, anchor = null) {
    const cfg = config.get(), bounds = canvas.getBoundingClientRect();
    const x = anchor?.x ?? bounds.width / 2, y = anchor?.y ?? bounds.height / 2;
    const before = screen_to_world(x, y, bounds.width, bounds.height, cfg);
    const yHeight = Math.max(0.0001, Math.min(100000, cfg.yHeight * factor));
    const after = screen_to_world(x, y, bounds.width, bounds.height, { ...cfg, yHeight });
    update_config({ yHeight, xCenter: cfg.xCenter + before.x - after.x, yCenter: cfg.yCenter + before.y - after.y });
}
$('zoomInButton').addEventListener('click', () => zoom(1 / 1.5));
$('zoomOutButton').addEventListener('click', () => zoom(1.5));
$('homeButton').addEventListener('click', () => {
    const cfg = config.get(), bounds = canvas.getBoundingClientRect();
    const geometryBounds = boundary_view_bounds({ ...cfg, rotationDegrees: 0 });
    const radius = cfg.boundary === 'None' ? Math.max(2, ...cfg.resonators_list.map(r => Math.hypot(r.x, r.y))) : cfg.radius;
    const yHeight = Math.max(.0001, Math.min(100000, geometryBounds ? 1.25 * Math.max(geometryBounds.height, geometryBounds.width * bounds.height / bounds.width) : 2.5 * radius * Math.max(1, bounds.height / bounds.width)));
    update_config({ xCenter: 0, yCenter: 0, yHeight, rotationDegrees: 0 });
});
canvas.addEventListener('wheel', event => {
    event.preventDefault(); const bounds = canvas.getBoundingClientRect();
    zoom(Math.exp(Math.max(-1, Math.min(1, event.deltaY * .001))), { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
}, { passive: false });
const pointers = new Map();
let previousGesture = null;
function gesture() {
    const values = [...pointers.values()];
    return { x: values.reduce((sum, p) => sum + p.x, 0) / values.length, y: values.reduce((sum, p) => sum + p.y, 0) / values.length,
        distance: values.length > 1 ? Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y) : null };
}
canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); previousGesture = gesture();
});
canvas.addEventListener('pointermove', event => {
    const bounds = canvas.getBoundingClientRect();
    const point = screen_to_world(event.clientX - bounds.left, event.clientY - bounds.top, bounds.width, bounds.height, config.get());
    $('coordinates').textContent = `x: ${point.x.toFixed(4)}  y: ${point.y.toFixed(4)}`; $('coordinates').hidden = false;
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const next = gesture(), cfg = config.get();
    if (previousGesture) {
        const before = screen_to_world(previousGesture.x - bounds.left, previousGesture.y - bounds.top, bounds.width, bounds.height, cfg);
        const after = screen_to_world(next.x - bounds.left, next.y - bounds.top, bounds.width, bounds.height, cfg);
        update_config({ xCenter: cfg.xCenter + before.x - after.x, yCenter: cfg.yCenter + before.y - after.y });
        if (next.distance && previousGesture.distance) zoom(previousGesture.distance / Math.max(1, next.distance), { x: next.x - bounds.left, y: next.y - bounds.top });
    }
    previousGesture = next;
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, event => { pointers.delete(event.pointerId); previousGesture = pointers.size ? gesture() : null; });
canvas.addEventListener('pointerleave', () => { $('coordinates').hidden = true; });
$('gotoButton').addEventListener('click', () => {
    const cfg = config.get(); $('gotoX').value = cfg.xCenter; $('gotoY').value = cfg.yCenter; $('gotoHeight').value = cfg.yHeight;
    $('gotoError').textContent = ''; open_dialog('gotoModal');
});
$('gotoForm').addEventListener('submit', event => {
    event.preventDefault();
    try { update_config({ xCenter: Number($('gotoX').value), yCenter: Number($('gotoY').value), yHeight: Number($('gotoHeight').value) }); $('gotoModal').close(); }
    catch (error) { $('gotoError').textContent = error.message; }
});
function set_sidebar_open(open) {
    document.body.classList.toggle('sidebar-hidden', !open);
    $('hideControlPanelButton').setAttribute('aria-expanded', String(open));
    $('openControlPanelButton').setAttribute('aria-expanded', String(open));
    $(open ? 'hideControlPanelButton' : 'openControlPanelButton').focus({ preventScroll: true });
    request_render();
}
$('hideControlPanelButton').addEventListener('click', () => set_sidebar_open(false));
$('openControlPanelButton').addEventListener('click', () => set_sidebar_open(true));
$('mobileMenuButton').addEventListener('click', () => { const open = $('navigation').classList.toggle('menu-open'); $('mobileMenuButton').setAttribute('aria-expanded', String(open)); });

function download_blob(blob, filename) {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function share_url() {
    const url = new URL('https://cymatics.art/'); url.searchParams.set('config', JSON.stringify(config.get())); return url.href;
}
const actions = {
    share() { $('shareURL').value = share_url(); open_dialog('shareModal'); },
    save() {
        const cfg = config.get();
        saveCropBounds = boundary_view_bounds(cfg, scene.geometry);
        const available = boundary_fully_visible(cfg, canvas.width, canvas.height, saveCropBounds);
        $('cropBoundaryRow').hidden = !available; $('cropBoundary').checked = available;
        $('cropHint').textContent = available ? 'Crop removes the surrounding view and keeps the boundary aspect ratio.' : 'Crop is available when a closed boundary is fully visible.';
        set_save_dimensions();
        $('saveError').textContent = ''; open_dialog('saveModal');
    },
    open() { $('openFileInput').value = ''; $('openError').textContent = ''; open_dialog('openModal'); },
    help() { open_dialog('helpModal'); }
};
function set_save_dimensions() {
    if ($('cropBoundary').checked && saveCropBounds) {
        const pixels = canvas.height / config.get().yHeight;
        const size = linked_dimensions(Math.max(1, Math.round(saveCropBounds.width * pixels)), saveCropBounds.width / saveCropBounds.height);
        $('saveWidth').value = size.width; $('saveHeight').value = size.height;
    } else {
        $('saveWidth').value = Math.min(4096, Math.max(1, canvas.width)); $('saveHeight').value = Math.min(4096, Math.max(1, canvas.height));
    }
}
$('cropBoundary').addEventListener('change', set_save_dimensions);
for (const [id, dimension] of [['saveWidth', 'width'], ['saveHeight', 'height']]) {
    $(id).addEventListener('input', () => {
        const value = Number($(id).value);
        if (!$('cropBoundary').checked || !saveCropBounds || !Number.isFinite(value) || value <= 0) return;
        const size = linked_dimensions(value, saveCropBounds.width / saveCropBounds.height, dimension);
        $('saveWidth').value = size.width; $('saveHeight').value = size.height;
    });
}

document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', actions[button.dataset.action]));
$('copyShareButton').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('shareURL').value); toast('Link copied.'); }
    catch { $('shareURL').focus(); $('shareURL').select(); toast('Select and copy the link with ⌘C / Ctrl+C.'); }
});
$('downloadAppButton').addEventListener('click', () => {
    const json = JSON.stringify(config.get()).replace(/</g, '\\u003c');
    const html = offlineDocument.replace(/(<script id="savedConfig" type="application\/json">)[\s\S]*?(<\/script>)/, (_, start, end) => start + json + end);
    download_blob(new Blob([html], { type: 'text/html' }), 'Cymatics.art.html'); toast('Downloaded an offline copy with this pattern.');
});
$('saveJsonButton').addEventListener('click', () => download_blob(new Blob([JSON.stringify(config.get(), null, 4)], { type: 'application/json' }), 'Cymatics.art.json'));
$('saveForm').addEventListener('submit', async event => {
    event.preventDefault(); $('saveImageButton').disabled = true; $('saveError').textContent = '';
    let exportRenderer;
    try {
        const width = Number($('saveWidth').value), height = Number($('saveHeight').value);
        if (![width, height].every(v => Number.isInteger(v) && v >= 1 && v <= 4096) || width * height > 12000000) throw new Error('Choose dimensions from 1 to 4096 px, up to 12 megapixels.');
        const saveCanvas = document.createElement('canvas'); saveCanvas.width = width; saveCanvas.height = height;
        const crop = $('cropBoundary').checked && saveCropBounds;
        exportRenderer = create_renderer(saveCanvas, { transparentOutside: !!crop });
        let cfg = structuredClone(config.get());
        if (crop) cfg = crop_view_config(cfg, saveCropBounds, width, height);
        exportRenderer.draw(cfg, scene);
        const png = await new Promise(resolve => saveCanvas.toBlob(resolve, 'image/png'));
        if (!png) throw new Error('The browser could not export this image. Try a smaller size.');
        const filename = $('saveFilename').value.trim() || 'Cymatics.art.png';
        download_blob(await add_png_config(png, cfg), filename.toLowerCase().endsWith('.png') ? filename : filename + '.png');
        $('saveModal').close(); toast('Saved image with embedded settings.');
    } catch (error) { $('saveError').textContent = error.message; }
    finally { exportRenderer?.dispose(); $('saveImageButton').disabled = false; }
});
async function open_file(file) {
    if (!file) return;
    $('openError').textContent = '';
    try {
        if (file.size > 50 * 1024 * 1024) throw new Error('Please choose a file smaller than 50 MB.');
        const candidate = file.name.toLowerCase().endsWith('.json') ? JSON.parse(await file.text()) : await read_png_config(file);
        apply_config(candidate); $('openModal').close(); toast('Pattern restored.');
    } catch (error) { $('openError').textContent = error.message; }
}
$('openFileInput').addEventListener('change', event => open_file(event.target.files[0]));
$('dropZone').addEventListener('dragover', event => { event.preventDefault(); $('dropZone').classList.add('drag-over'); });
$('dropZone').addEventListener('dragleave', () => $('dropZone').classList.remove('drag-over'));
$('dropZone').addEventListener('drop', event => { event.preventDefault(); $('dropZone').classList.remove('drag-over'); open_file(event.dataTransfer.files[0]); });

// Animation uses discrete phase values and elapsed time, independent of frame rate.
let previousTime = null, elapsed = 0;
function animate(time) {
    const cfg = config.get();
    if (previousTime !== null && cfg.phaseMode === 'animated' && !document.hidden && !document.querySelector('dialog[open]')) {
        elapsed += Math.min(250, time - previousTime);
        const count = Math.floor(elapsed * cfg.speed / 1000);
        if (count > 0) {
            elapsed -= count * 1000 / cfg.speed;
            const step = Math.round(cfg.phase / TAU * cfg.steps);
            update_config({ phase: phase_at_step(step + count, cfg.steps) }, { animation: true });
        }
    } else elapsed = 0;
    previousTime = time; requestAnimationFrame(animate);
}

try { renderer = create_renderer(canvas); } catch (error) { show_error(error); }
canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); renderer = null; show_error(new Error('Graphics context lost. Waiting for the browser to restore it.')); });
canvas.addEventListener('webglcontextrestored', () => { try { renderer = create_renderer(canvas); request_render(); } catch (error) { show_error(error); } });
try {
    const params = new URLSearchParams(location.search), embedded = JSON.parse($('savedConfig').textContent);
    const candidate = params.has('config') ? JSON.parse(params.get('config')) : embedded;
    if (candidate) apply_config(candidate);
} catch (error) { toast(`Could not restore settings: ${error.message}`); }
config.subscribe(sync_ui);
new ResizeObserver(() => { if (scene) update_position_preview(config.get()); }).observe($('resonatorCanvas'));
let previousViewSize = null;
new ResizeObserver(([entry]) => {
    const size = `${entry.contentRect.width}:${entry.contentRect.height}`;
    if (previousViewSize !== null && size !== previousViewSize) update_config({ maxOverride: null });
    previousViewSize = size;
    request_render();
}).observe($('mainView'));
requestAnimationFrame(animate);
