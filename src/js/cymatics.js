// Digital Cymatics: radial waves and specular image-source reflections.
// Coordinates are in graph units; frequency is cycles/unit and phase is radians.
export const TAU = 2 * Math.PI;
export const MAX_RESONATORS = 32;
export const MAX_SIDES = 128;
export const WAVEFORMS = ['sinc', 'sine', 'square', 'sawtooth', 'triangle'];
export const BOUNDARIES = ['None', 'Circle', 'Binary Split', 'Triangle', 'Square', 'Rectangle', 'Pentagon', 'Hexagon', 'Septagon', 'Octagon', '9-sides', '10-sides', '11-sides', '12-sides', 'Custom'];

export function uniformly_distributed_points(numPoints, distance, rotateRadians = 0) {
    if (numPoints === 1) return [{ x: 0, y: 0 }];
    return Array.from({ length: numPoints }, (_, i) => {
        const angle = TAU * i / numPoints + rotateRadians;
        return { x: distance * Math.cos(angle), y: distance * Math.sin(angle) };
    });
}

export function generate_resonators(cfg) {
    return uniformly_distributed_points(cfg.numResonators, cfg.distance).map(pt => ({
        ...pt, amplitude: cfg.amplitude, frequency: cfg.frequency,
        phase_multiplier: cfg.phase_multiplier, phase_offset: 0, waveform: cfg.waveform
    }));
}

export function default_config() {
    const cfg = {
        app: 'Cymatics.art', version: 1, advanced: false,
        numResonators: 2, distance: 1.5, amplitude: 1, frequency: 2,
        phase_multiplier: -1, waveform: 'sinc', combineOperator: '+',
        resonatorRotationDegrees: 90, boundaryRotationDegrees: 90,
        boundary: 'Binary Split', radius: 5, sides: 7, boundaryWidth: 8, boundaryHeight: 6,
        phaseMode: 'animated', phase: 0, steps: 30, speed: 30,
        fuzzyLevel: 12, minOverride: 0, maxOverride: 1, rotationDegrees: 0,
        backgroundColor: '#0e1116',
        colorMap: 'gnuplot2', reverseColor: true, invertColor: false,
        colorStart: 0, colorCycles: 1, hueShiftDegrees: 0, saturationPercent: 0, luminosityPercent: 0,
        xCenter: 0, yCenter: 0, yHeight: 7.5
    };
    cfg.resonators_list = generate_resonators(cfg);
    return cfg;
}

// User edits that can change the raw field range invalidate a saved maximum.
// Animation advances phase without invalidating the user's chosen color scale.
export function config_with_patch(cfg, patch, { animation = false } = {}) {
    const rangeKeys = ['numResonators', 'distance', 'amplitude', 'frequency', 'phase_multiplier', 'waveform',
        'resonators_list', 'resonatorRotationDegrees', 'combineOperator', 'boundary', 'radius', 'sides',
        'boundaryRotationDegrees', 'boundaryWidth', 'boundaryHeight', 'steps',
        'xCenter', 'yCenter', 'yHeight', 'rotationDegrees'];
    if (!animation) rangeKeys.push('phase');
    const next = { ...cfg, ...patch };
    if (!Object.hasOwn(patch, 'maxOverride') && rangeKeys.some(key => Object.hasOwn(patch, key) && JSON.stringify(patch[key]) !== JSON.stringify(cfg[key]))) {
        next.maxOverride = null;
    }
    return next;
}

function number(value, name, min = -1e6, max = 1e6, integer = false) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
        throw new Error(`${name} must be ${integer ? 'an integer' : 'a finite number'} between ${min} and ${max}.`);
    }
    return value;
}

export function validate_resonator(r) {
    if (!r || typeof r !== 'object') throw new Error('Invalid resonator.');
    if (!WAVEFORMS.includes(r.waveform)) throw new Error('Unknown resonator waveform.');
    return {
        x: number(r.x, 'X'), y: number(r.y, 'Y'),
        amplitude: number(r.amplitude, 'Amplitude', -10000, 10000),
        frequency: number(r.frequency, 'Frequency', 0, 10000),
        phase_multiplier: number(r.phase_multiplier, 'Phase multiplier', -1000, 1000),
        phase_offset: number(r.phase_offset, 'Phase offset', 0, TAU), waveform: r.waveform
    };
}

// Whitelist fields before applying imported or URL-provided configuration.
export function validate_config(input) {
    if (!input || input.app !== 'Cymatics.art' || input.version !== 1) throw new Error('This is not a supported Cymatics.art configuration.');
    const cfg = default_config();
    // Configurations from before rotation controls retain their original orientation.
    cfg.resonatorRotationDegrees = 0; cfg.boundaryRotationDegrees = 0;
    for (const key of Object.keys(cfg)) {
        if (Object.hasOwn(input, key)) cfg[key] = input[key];
    }
    for (const key of ['advanced', 'reverseColor', 'invertColor']) {
        if (typeof cfg[key] !== 'boolean') throw new Error(`Invalid ${key}.`);
    }
    if (!BOUNDARIES.includes(cfg.boundary) || !WAVEFORMS.includes(cfg.waveform) || !['+', '-', '*', '/'].includes(cfg.combineOperator)) throw new Error('Unknown boundary, waveform, or operator.');
    if (!['fixed', 'animated'].includes(cfg.phaseMode)) throw new Error('Invalid phase mode.');
    number(cfg.numResonators, 'Number of resonators', 1, MAX_RESONATORS, true);
    number(cfg.distance, 'Distance', 0, 10000);
    number(cfg.amplitude, 'Amplitude', -10000, 10000);
    number(cfg.frequency, 'Frequency', 0, 10000);
    number(cfg.phase_multiplier, 'Phase multiplier', -1000, 1000);
    number(cfg.radius, 'Radius', 0.001, 10000);
    number(cfg.boundaryWidth, 'Rectangle width', 0.001, 10000);
    number(cfg.boundaryHeight, 'Rectangle height', 0.001, 10000);
    number(cfg.sides, 'Sides', 3, MAX_SIDES, true);
    number(cfg.phase, 'Phase', 0, TAU);
    number(cfg.steps, 'Steps', 1, 10000, true);
    number(cfg.speed, 'Speed', 0.1, 120);
    number(cfg.fuzzyLevel, 'Fuzzy level', 0, 100);
    number(cfg.rotationDegrees, 'Rotation', -36000, 36000);
    number(cfg.resonatorRotationDegrees, 'Resonator rotation', -36000, 36000);
    number(cfg.boundaryRotationDegrees, 'Boundary rotation', -36000, 36000);
    if (typeof cfg.backgroundColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(cfg.backgroundColor)) throw new Error('Background Color must be a six-digit hex color.');
    number(cfg.colorStart, 'Color start', 0, 255);
    number(cfg.colorCycles, 'Color cycles', 0.01, 100);
    number(cfg.hueShiftDegrees, 'Hue shift', -360, 360);
    number(cfg.saturationPercent, 'Saturation', -100, 100);
    number(cfg.luminosityPercent, 'Luminosity', -100, 100);
    number(cfg.xCenter, 'Center X'); number(cfg.yCenter, 'Center Y');
    number(cfg.yHeight, 'View height', 0.0001, 100000);
    for (const key of ['minOverride', 'maxOverride']) {
        if (cfg[key] !== null) number(cfg[key], key, 0, 1e20);
    }
    if (cfg.minOverride !== null && cfg.maxOverride !== null && cfg.minOverride >= cfg.maxOverride) throw new Error('Min Override must be less than Max Override.');
    if (typeof cfg.colorMap !== 'string') throw new Error('Invalid color map.');
    if (!Array.isArray(cfg.resonators_list) || cfg.resonators_list.length < 1 || cfg.resonators_list.length > MAX_RESONATORS) throw new Error(`Use 1–${MAX_RESONATORS} resonators.`);
    cfg.resonators_list = cfg.resonators_list.map(validate_resonator);
    // The list is authoritative, including in Basic mode, until a Basic control changes.
    return cfg;
}

// Rotate around the origin without changing the source JSON coordinates.
export function rotate_point(point, degrees) {
    const angle = degrees * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    return { x: point.x * c - point.y * s, y: point.x * s + point.y * c };
}

export function rotated_resonators(cfg) {
    return cfg.resonators_list.map(r => ({ ...r, ...rotate_point(r, cfg.resonatorRotationDegrees ?? 0) }));
}

export function boundary_geometry(cfg) {
    if (cfg.boundary === 'None') return { kind: 0, vertices: [], edges: [] };
    if (cfg.boundary === 'Binary Split') {
        // Rotate both the wall segments and the clipping normal.
        return { kind: 2, vertices: [], normal: rotate_point({ x: 1, y: 0 }, cfg.boundaryRotationDegrees ?? 0), edges: [
            [{ x: -cfg.radius, y: -cfg.radius }, { x: -cfg.radius, y: cfg.radius }],
            [{ x: cfg.radius, y: cfg.radius }, { x: cfg.radius, y: -cfg.radius }]
        ].map(edge => edge.map(p => rotate_point(p, cfg.boundaryRotationDegrees ?? 0))) };
    }
    if (cfg.boundary === 'Rectangle') {
        const w = cfg.boundaryWidth / 2, h = cfg.boundaryHeight / 2;
        const vertices = [{ x: -w, y: -h }, { x: w, y: -h }, { x: w, y: h }, { x: -w, y: h }].map(p => rotate_point(p, cfg.boundaryRotationDegrees));
        return { kind: 1, vertices, edges: vertices.map((p, i) => [p, vertices[(i + 1) % 4]]) };
    }
    const namedSides = { Triangle: 3, Square: 4, Pentagon: 5, Hexagon: 6, Septagon: 7, Octagon: 8, '9-sides': 9, '10-sides': 10, '11-sides': 11, '12-sides': 12 };
    const n = cfg.boundary === 'Circle' ? 64 : cfg.boundary === 'Custom' ? cfg.sides : namedSides[cfg.boundary];
    const angle = (n === 4 ? Math.PI / 4 : Math.PI / 2) + (cfg.boundaryRotationDegrees ?? 0) * Math.PI / 180;
    const vertices = Array.from({ length: n }, (_, i) => ({ x: cfg.radius * Math.cos(TAU * i / n + angle), y: cfg.radius * Math.sin(TAU * i / n + angle) }));
    return { kind: 1, vertices, edges: vertices.map((v, i) => [v, vertices[(i + 1) % n]]) };
}

export function reflect_point(point, edge) {
    const [a, b] = edge;
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy);
    return { x: 2 * (a.x + t * dx) - point.x, y: 2 * (a.y + t * dy) - point.y };
}

export function inside_boundary(p, geometry, radius) {
    if (geometry.kind === 0) return true;
    if (geometry.kind === 2) return Math.abs(p.x * geometry.normal.x + p.y * geometry.normal.y) <= radius;
    return geometry.edges.every(([a, b]) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -1e-7);
}

export function build_sources(cfg) {
    const geometry = boundary_geometry(cfg);
    const sources = [];
    for (const resonator of rotated_resonators(cfg)) {
        sources.push({ ...resonator, order: 0 });
        for (const [j, edge] of geometry.edges.entries()) {
            const image = reflect_point(resonator, edge);
            sources.push({ ...resonator, ...image, order: 1, edge, infinite: geometry.kind === 2 });
            // Two-bounce paths for named polygons / the parallel split. Larger
            // custom polygons and the 64-facet circle use one-bounce paths.
            if (geometry.edges.length > 12) continue;
            for (const [k, nextEdge] of geometry.edges.entries()) {
                if (j === k) continue;
                sources.push({ ...resonator, ...reflect_point(image, nextEdge), order: 2, edge: nextEdge, infinite: geometry.kind === 2,
                    previousEdge: edge.map(p => reflect_point(p, nextEdge)) });
            }
        }
    }
    return { sources, geometry };
}

const cross = (ax, ay, bx, by) => ax * by - ay * bx;
export function intersection_parameter(p, source, edge, infinite = false) {
    const [a, b] = edge;
    const dx = source.x - p.x, dy = source.y - p.y;
    const ex = b.x - a.x, ey = b.y - a.y;
    const denominator = cross(dx, dy, ex, ey);
    if (Math.abs(denominator) < 1e-8) return -1;
    const t = cross(a.x - p.x, a.y - p.y, ex, ey) / denominator;
    const u = cross(a.x - p.x, a.y - p.y, dx, dy) / denominator;
    return t >= 0 && t < 1 && (infinite || (u >= -1e-7 && u < 1 - 1e-7)) ? t : -1;
}

export function visible_source(p, s) {
    if (!s.order) return true;
    const t = intersection_parameter(p, s, s.edge, s.infinite);
    if (t < 0) return false;
    return s.order < 2 || intersection_parameter(p, s, s.previousEdge, s.infinite) > t + 1e-7;
}

export function wave_value(distance, s, phase) {
    const radial = TAU * s.frequency * distance;
    const angle = radial + phase * s.phase_multiplier + s.phase_offset;
    let wave;
    if (s.waveform === 'sinc') {
        // Match FuzzyGraph's phased radial sinc, with a bounded source core.
        wave = Math.sin(angle) / Math.max(radial, 1e-6);
        if (radial < 1e-6 && Math.abs(Math.sin(phase * s.phase_multiplier + s.phase_offset)) < 1e-6) wave = Math.cos(angle);
    } else if (s.waveform === 'sine') wave = Math.sin(angle);
    else if (s.waveform === 'square') wave = Math.sin(angle) >= 0 ? 1 : -1;
    else if (s.waveform === 'sawtooth') wave = 2 * ((angle / TAU + 0.5) % 1 + 1) % 2 - 1;
    else wave = 2 / Math.PI * Math.asin(Math.sin(angle));
    return s.amplitude * wave;
}

export function combine_values(a, b, operator) {
    if (operator === '+') return a + b;
    if (operator === '-') return a - b;
    if (operator === '*') return Math.max(-1e20, Math.min(1e20, a * b));
    return Math.max(-1e20, Math.min(1e20, a / (Math.abs(b) < 1e-6 ? (b < 0 ? -1e-6 : 1e-6) : b)));
}

export function evaluate_field(p, scene, cfg) {
    if (!inside_boundary(p, scene.geometry, cfg.radius)) return null;
    let value = 0, first = true;
    for (const source of scene.sources) {
        if (!visible_source(p, source)) continue;
        const wave = wave_value(Math.hypot(p.x - source.x, p.y - source.y), source, cfg.phase);
        value = first ? wave : combine_values(value, wave, cfg.combineOperator);
        first = false;
    }
    return value;
}

export function phase_at_step(step, steps) {
    return ((step % steps + steps) % steps) * TAU / steps;
}

export function screen_to_world(x, y, width, height, cfg) {
    const px = (x - width / 2) * cfg.yHeight / height;
    const py = (height / 2 - y) * cfg.yHeight / height;
    const angle = cfg.rotationDegrees * Math.PI / 180;
    return { x: cfg.xCenter + px * Math.cos(angle) - py * Math.sin(angle), y: cfg.yCenter + px * Math.sin(angle) + py * Math.cos(angle) };
}

export function sample_range(scene, cfg, width, height) {
    let min = Infinity, max = 0;
    for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) {
        const p = screen_to_world((x + 0.5) * width / 32, (y + 0.5) * height / 24, width, height, cfg);
        const value = evaluate_field(p, scene, cfg);
        if (value === null || !Number.isFinite(value)) continue;
        const magnitude = Math.abs(value);
        min = Math.min(min, magnitude); max = Math.max(max, magnitude);
    }
    if (!Number.isFinite(min)) min = 0;
    return { min, max: Math.max(max, min + 1e-6) };
}

// Bounds in camera-oriented graph coordinates. Infinite boundaries have no crop.
export function boundary_view_bounds(cfg, geometry = boundary_geometry(cfg)) {
    if (geometry.kind !== 1) return null;
    const vertices = geometry.vertices.map(p => rotate_point(p, -cfg.rotationDegrees));
    const minX = Math.min(...vertices.map(p => p.x)), maxX = Math.max(...vertices.map(p => p.x));
    const minY = Math.min(...vertices.map(p => p.y)), maxY = Math.max(...vertices.map(p => p.y));
    return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

export function boundary_fully_visible(cfg, width, height, bounds = boundary_view_bounds(cfg)) {
    if (!bounds || width <= 0 || height <= 0) return false;
    const center = rotate_point({ x: cfg.xCenter, y: cfg.yCenter }, -cfg.rotationDegrees);
    const halfHeight = cfg.yHeight / 2, halfWidth = halfHeight * width / height;
    const epsilon = 1e-8;
    return bounds.minX >= center.x - halfWidth - epsilon && bounds.maxX <= center.x + halfWidth + epsilon &&
        bounds.minY >= center.y - halfHeight - epsilon && bounds.maxY <= center.y + halfHeight + epsilon;
}

export function crop_view_config(cfg, bounds, width, height) {
    const center = rotate_point({ x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }, cfg.rotationDegrees);
    // Accommodate rounding to integer image dimensions without cutting off an edge.
    return { ...cfg, xCenter: center.x, yCenter: center.y, yHeight: Math.max(bounds.height, bounds.width * height / width) };
}

export function linked_dimensions(value, aspect, changed = 'width') {
    let width = changed === 'width' ? value : value * aspect;
    let height = changed === 'height' ? value : value / aspect;
    const factor = Math.min(1, 4096 / width, 4096 / height, Math.sqrt(12000000 / (width * height)));
    return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)) };
}
