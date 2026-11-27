import test from 'node:test';
import assert from 'node:assert/strict';
import { TAU, default_config, generate_resonators, validate_config, validate_resonator, boundary_geometry, build_sources,
    reflect_point, visible_source, inside_boundary, wave_value, evaluate_field, phase_at_step, screen_to_world, rotate_point, boundary_view_bounds, boundary_fully_visible, crop_view_config, linked_dimensions, config_with_patch } from '../src/js/cymatics.js';
import { add_png_config, read_png_config } from '../src/js/png.js';
const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≠ ${b}`);

test('Basic resonators use the required JSON schema and a uniform arrangement', () => {
    const cfg = default_config();
    assert.deepEqual(Object.keys(cfg.resonators_list[0]), ['x', 'y', 'amplitude', 'frequency', 'phase_multiplier', 'phase_offset', 'waveform']);
    assert.equal(cfg.phase_multiplier, -1);
    assert.equal(cfg.resonatorRotationDegrees, 0); assert.equal(cfg.boundaryRotationDegrees, 0);
    assert.equal(cfg.boundary, 'Binary Split'); assert.equal(cfg.radius, 8); assert.equal(cfg.fuzzyLevel, 22);
    for (const r of cfg.resonators_list) near(Math.hypot(r.x, r.y), cfg.distance);
    assert.deepEqual(generate_resonators({ ...cfg, numResonators: 1 })[0], { x: 0, y: 0, amplitude: 1, frequency: 2, phase_multiplier: -1, phase_offset: 0, waveform: 'sinc' });
});

test('all waveform values, signed phases and per-source phase parameters', () => {
    const source = { amplitude: 2, frequency: 1, phase_multiplier: 2, phase_offset: .3 };
    for (const waveform of ['sine', 'square', 'sawtooth', 'triangle']) {
        const s = { ...source, waveform };
        const expected = { sine: 2 * Math.sin(.8), square: 2, sawtooth: 2 * (.8 / Math.PI), triangle: 2 * (2 / Math.PI * Math.asin(Math.sin(.8))) }[waveform];
        near(wave_value(0, s, .25), expected);
        assert.ok(Number.isFinite(wave_value(1.25, { ...s, phase_multiplier: -3 }, 6)));
    }
    near(wave_value(0, { ...source, waveform: 'sinc', phase_offset: 0 }, 0), 2);
    near(wave_value(.25, { ...source, waveform: 'sinc', phase_multiplier: 0, phase_offset: 0 }, 1), 2 / (Math.PI / 2));
});

test('None has no reflected images and matches the original radial equation', () => {
    const cfg = { ...default_config(), resonatorRotationDegrees: 0, boundary: 'None' }, scene = build_sources(cfg), p = { x: .4, y: .7 };
    assert.equal(scene.sources.length, cfg.resonators_list.length);
    const expected = cfg.resonators_list.reduce((sum, r) => sum + wave_value(Math.hypot(p.x-r.x, p.y-r.y), r, cfg.phase), 0);
    near(evaluate_field(p, scene, cfg), expected);
});

test('a planar wall gives the analytic mirror-source path length and interference', () => {
    const cfg = { ...default_config(), resonatorRotationDegrees: 0, boundaryRotationDegrees: 0, boundary: 'Binary Split', radius: 2, resonators_list: [{ x: .5, y: .2, amplitude: 2, frequency: .7, phase_multiplier: 1, phase_offset: 0, waveform: 'sine' }] };
    const scene = build_sources(cfg), p = { x: 1, y: .6 };
    const image = scene.sources.find(s => s.order === 1 && s.x > 2);
    near(image.x, 3.5); near(image.y, .2);
    assert.ok(visible_source(p, image));
    const bounceY = p.y + (image.y - p.y) * (2 - p.x) / (image.x - p.x);
    near(Math.hypot(image.x - p.x, image.y - p.y), Math.hypot(2 - .5, bounceY - .2) + Math.hypot(2 - 1, bounceY - .6));
    const direct = { sources: [scene.sources[0]], geometry: scene.geometry };
    assert.notEqual(evaluate_field(p, scene, cfg), evaluate_field(p, direct, cfg));
});

test('invalid finite-wall paths are rejected; two-bounce paths are ordered', () => {
    const source = { x: 2, y: 0, order: 1, edge: [{ x: 1, y: -.5 }, { x: 1, y: .5 }] };
    assert.ok(visible_source({ x: 0, y: 0 }, source));
    assert.equal(visible_source({ x: 0, y: 3 }, source), false);
    const second = { ...source, x: 4, order: 2, previousEdge: [{ x: 3, y: -.5 }, { x: 3, y: .5 }] };
    assert.ok(visible_source({ x: 0, y: 0 }, second));
    assert.equal(visible_source({ x: 0, y: 0 }, { ...second, previousEdge: [{ x: .5, y: -.5 }, { x: .5, y: .5 }] }), false);
});

test('all boundaries clip the field and custom sides are respected', () => {
    const cfg = { ...default_config(), boundaryRotationDegrees: 0 };
    for (const boundary of ['Circle', 'Triangle', 'Square', 'Rectangle', 'Pentagon', 'Hexagon', 'Septagon', 'Octagon', '9-sides', '10-sides', '11-sides', '12-sides', 'Custom', 'Binary Split']) {
        const g = boundary_geometry({ ...cfg, boundary, sides: 17 });
        assert.ok(inside_boundary({ x: 0, y: 0 }, g, cfg.radius));
        assert.equal(inside_boundary({ x: 100, y: 0 }, g, cfg.radius), false);
        if (boundary === 'Custom') assert.equal(g.edges.length, 17);
        if (boundary === 'Circle') assert.equal(g.edges.length, 64);
    }
    const edge = [{ x: 1, y: -3 }, { x: 1, y: 3 }];
    near(reflect_point({ x: .2, y: 1 }, edge).x, 1.8);
});

test('reflected waves participate in every combine operator without NaN or infinity', () => {
    const cfg = { ...default_config(), boundary: 'Square', waveform: 'sine' };
    cfg.resonators_list = generate_resonators(cfg);
    const scene = build_sources(cfg), p = { x: .28, y: .39 };
    const values = scene.sources.filter(s => visible_source(p, s)).map(s => wave_value(Math.hypot(p.x-s.x,p.y-s.y),s,cfg.phase));
    assert.ok(values.length > cfg.resonators_list.length);
    for (const op of ['+', '-', '*', '/']) {
        const value = evaluate_field(p, scene, { ...cfg, combineOperator: op });
        assert.ok(Number.isFinite(value));
        if (op === '+') near(value, values.reduce((a,b)=>a+b));
        if (op === '-') near(value, values.slice(1).reduce((a,b)=>a-b, values[0]));
    }
    cfg.resonators_list.forEach(r => { r.amplitude = 0; });
    assert.ok(Number.isFinite(evaluate_field(p, build_sources(cfg), { ...cfg, combineOperator: '/' })));
});

test('phase steps cover one cycle uniformly with no duplicate endpoint', () => {
    assert.deepEqual(Array.from({ length: 4 }, (_,i)=>phase_at_step(i,4)), [0,Math.PI/2,Math.PI,3*Math.PI/2]);
    assert.equal(phase_at_step(4,4),0); assert.equal(phase_at_step(1,1),0);
    near(phase_at_step(-1,4),3*Math.PI/2);
});

test('camera center and rotation agree with graph coordinates', () => {
    const cfg = { ...default_config(), xCenter: 1, yCenter: 2, rotationDegrees: 90, yHeight: 4 };
    assert.deepEqual(screen_to_world(100,50,200,100,cfg), { x: 1, y: 2 });
    const right = screen_to_world(125,50,200,100,cfg); near(right.x,1); near(right.y,3);
});

test('settings round trip and invalid imported inputs cannot reach rendering', () => {
    const cfg = default_config(); cfg.advanced = true; cfg.resonators_list[0].x = .789;
    assert.deepEqual(validate_config(JSON.parse(JSON.stringify(cfg))),cfg);
    for (const patch of [{ radius: 0 }, { sides: 3.5 }, { steps: 0 }, { phase: TAU + .1 }, { speed: Infinity }, { numResonators: 100 }, { resonators_list: [] }, { minOverride: 2, maxOverride: 1 }, { colorStart: -2 }]) assert.throws(() => validate_config({ ...cfg, ...patch }));
    assert.throws(()=>validate_resonator({ ...cfg.resonators_list[0], x: '2' }));
});

test('PNG metadata preserves the full configuration and malformed files fail clearly', async () => {
    const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')],{ type:'image/png' });
    const cfg = default_config(); cfg.phase = 1.571; cfg.resonators_list[0].phase_offset = 1.571;
    const result = await add_png_config(png,cfg);
    assert.deepEqual(await read_png_config(result),cfg);
    await assert.rejects(()=>read_png_config(png),/no Cymatics.art settings/);
    await assert.rejects(()=>read_png_config(new Blob(['invalid'])),/Please open/);
    await assert.rejects(()=>read_png_config(new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,255,73,69,78,68,0,0,0,0])])),/Truncated/);
});


test('resonator rotation transforms source positions without changing stored coordinates', () => {
    const cfg = { ...default_config(), boundary: 'None', resonatorRotationDegrees: 90,
        resonators_list: [{ x: 1, y: 0, amplitude: 2, frequency: 1, phase_multiplier: 1, phase_offset: 0, waveform: 'sine' }] };
    const scene = build_sources(cfg);
    near(scene.sources[0].x, 0); near(scene.sources[0].y, 1);
    near(evaluate_field({ x: 0, y: 1.25 }, scene, cfg), 2);
    assert.deepEqual([cfg.resonators_list[0].x, cfg.resonators_list[0].y], [1, 0]);
});

test('boundary rotation changes polygon clipping and parallel-wall reflection geometry', () => {
    const cfg = { ...default_config(), boundaryRotationDegrees: 0, radius: 3, boundary: 'Square' };
    const p = { x: 1.8, y: 1.8 };
    assert.ok(inside_boundary(p, boundary_geometry(cfg), 3));
    assert.equal(inside_boundary(p, boundary_geometry({ ...cfg, boundaryRotationDegrees: 45 }), 3), false);
    const split = { ...cfg, boundary: 'Binary Split', radius: 2, boundaryRotationDegrees: 90, numResonators: 1 };
    split.resonators_list = generate_resonators(split);
    const scene = build_sources(split);
    assert.equal(inside_boundary({ x: 0, y: 3 }, scene.geometry, 2), false);
    assert.ok(inside_boundary({ x: 3, y: 0 }, scene.geometry, 2));
    const topImage = scene.sources.find(s => s.order === 1 && s.y > 0);
    near(topImage.x, 0, 1e-6); near(topImage.y, 4, 1e-6);
    assert.ok(visible_source({ x: 10000, y: 0 }, topImage));
});

test('rotating sources and boundary together preserves the reflected field', () => {
    for (const boundary of ['Triangle', 'Binary Split']) {
        const cfg = { ...default_config(), resonatorRotationDegrees: 0, boundaryRotationDegrees: 0, boundary, phase: .7 };
        const p = { x: .31, y: .42 }, angle = 37;
        const rotated = { ...cfg, resonatorRotationDegrees: angle, boundaryRotationDegrees: angle };
        near(evaluate_field(p, build_sources(cfg), cfg), evaluate_field(rotate_point(p, angle), build_sources(rotated), rotated), 1e-5);
    }
});

test('new color and rotation settings validate and legacy settings retain their phase mode', () => {
    const cfg = default_config(); assert.equal(cfg.phaseMode, 'animated');
    for (const patch of [{ backgroundColor: '#12' }, { backgroundColor: 'red' }, { backgroundColor: 1 }, { resonatorRotationDegrees: NaN }, { boundaryRotationDegrees: Infinity }]) assert.throws(() => validate_config({ ...cfg, ...patch }));
    const legacy = { ...cfg, phaseMode: 'fixed' };
    delete legacy.resonatorRotationDegrees; delete legacy.boundaryRotationDegrees; delete legacy.backgroundColor;
    const restored = validate_config(legacy);
    assert.equal(restored.phaseMode, 'fixed'); assert.equal(restored.resonatorRotationDegrees, 0); assert.equal(restored.boundaryRotationDegrees, 0); assert.equal(restored.backgroundColor, '#0e1116');
});


test('rectangle uses independent dimensions and rotates walls and mirror sources', () => {
    const cfg = { ...default_config(), boundary: 'Rectangle', boundaryWidth: 8, boundaryHeight: 2, boundaryRotationDegrees: 0 };
    const geometry = boundary_geometry(cfg);
    assert.ok(inside_boundary({ x: 3.9, y: .9 }, geometry, cfg.radius));
    assert.equal(inside_boundary({ x: 0, y: 1.1 }, geometry, cfg.radius), false);
    const rotated = boundary_geometry({ ...cfg, boundaryRotationDegrees: 90 });
    assert.ok(inside_boundary({ x: .9, y: 3.9 }, rotated, cfg.radius));
    assert.equal(inside_boundary({ x: 1.1, y: 0 }, rotated, cfg.radius), false);
    assert.equal(build_sources(cfg).sources.length, cfg.resonators_list.length * 17);
    for (const patch of [{ boundaryWidth: 0 }, { boundaryHeight: Infinity }]) assert.throws(() => validate_config({ ...cfg, ...patch }));
});

test('crop bounds and visibility account for camera rotation and pan', () => {
    const cfg = { ...default_config(), boundary: 'Rectangle', boundaryWidth: 8, boundaryHeight: 2, boundaryRotationDegrees: 0, rotationDegrees: 0, yHeight: 6 };
    const bounds = boundary_view_bounds(cfg);
    near(bounds.width, 8); near(bounds.height, 2);
    assert.ok(boundary_fully_visible(cfg, 900, 600));
    assert.equal(boundary_fully_visible({ ...cfg, xCenter: 2 }, 900, 600), false);
    assert.equal(boundary_fully_visible({ ...cfg, yHeight: 1 }, 900, 600), false);
    const turned = boundary_view_bounds({ ...cfg, rotationDegrees: 90 });
    near(turned.width, 2); near(turned.height, 8);
    const cropped = crop_view_config(cfg, bounds, 800, 200);
    near(cropped.yHeight, 2); near(cropped.xCenter, 0); near(cropped.yCenter, 0);
    assert.equal(boundary_view_bounds({ ...cfg, boundary: 'Binary Split' }), null);
    assert.equal(boundary_fully_visible({ ...cfg, boundary: 'None' }, 900, 600), false);
    const padded = crop_view_config(cfg, bounds, 840, 240, 20), scale = 240 / padded.yHeight;
    near((840 - bounds.width * scale) / 2, 20);
    near((240 - bounds.height * scale) / 2, 20);
    near(padded.xCenter, cropped.xCenter); near(padded.yCenter, cropped.yCenter);
    assert.deepEqual(crop_view_config(cfg, bounds, 800, 200, 0), cropped);
    for (const margin of [-1, .5, 100, 5000]) assert.throws(() => crop_view_config(cfg, bounds, 800, 200, margin));
});

test('linked crop dimensions preserve aspect from either input', () => {
    assert.deepEqual(linked_dimensions(800, 4, 'width'), { width: 800, height: 200 });
    assert.deepEqual(linked_dimensions(300, 4, 'height'), { width: 1200, height: 300 });
    const large = linked_dimensions(8000, 4);
    assert.equal(large.width, 4096); assert.equal(large.height, 1024);
    assert.deepEqual(linked_dimensions(800, 4, 'width', 20), { width: 800, height: 230 });
    assert.deepEqual(linked_dimensions(240, 4, 'height', 20), { width: 840, height: 240 });
    assert.deepEqual(linked_dimensions(8000, 4, 'width', 20), { width: 4096, height: 1054 });
    const paddedLimit = linked_dimensions(8000, 1, 'width', 100);
    assert.ok(paddedLimit.width <= 4096 && paddedLimit.height <= 4096 && paddedLimit.width * paddedLimit.height <= 12000000);
    for (const margin of [-1, .5, 100, 1732, 2047]) assert.throws(() => linked_dimensions(200, 4, 'height', margin));
});


test('max override defaults to 1 and persists through wave, geometry, phase and view edits', () => {
    const cfg = default_config();
    assert.equal(cfg.maxOverride, 1); assert.equal(cfg.minOverride, 0);
    for (const patch of [{ amplitude: 2 }, { frequency: 3 }, { boundary: 'Circle' }, { boundaryWidth: 9 },
        { boundaryRotationDegrees: 12 }, { resonatorRotationDegrees: 15 }, { combineOperator: '*' },
        { xCenter: 1 }, { yHeight: 12 }, { steps: 60 }, { phase: 1 },
        { resonators_list: cfg.resonators_list.map((r, i) => i ? r : { ...r, phase_offset: .5 }) }]) {
        const next = config_with_patch(cfg, patch);
        assert.equal(next.maxOverride, 1, JSON.stringify(patch));
        assert.equal(next.minOverride, 0);
        validate_config(next);
    }
});

test('animation, playback, colors, and unchanged fields preserve the selected maximum', () => {
    const cfg = { ...default_config(), maxOverride: 8 };
    for (const patch of [{ phaseMode: 'fixed' }, { speed: 60 }, { colorMap: 'viridis' }, { backgroundColor: '#123456' },
        { fuzzyLevel: 20 }, { amplitude: cfg.amplitude }, { resonators_list: structuredClone(cfg.resonators_list) }]) {
        assert.equal(config_with_patch(cfg, patch).maxOverride, 8);
    }
    assert.equal(config_with_patch(cfg, { phase: 1 }).maxOverride, 8);
    assert.equal(config_with_patch(cfg, { maxOverride: null }).maxOverride, null);
    assert.equal(config_with_patch({ ...cfg, maxOverride: null }, { amplitude: 2 }).maxOverride, null);
    assert.equal(config_with_patch(cfg, { amplitude: 2, maxOverride: 4 }).maxOverride, 4);
    assert.equal(config_with_patch(cfg, { amplitude: 2 }).minOverride, 0);
});
