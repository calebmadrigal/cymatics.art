// GLSL field renderer. Source records live in a floating-point texture so that
// Basic/Advanced changes do not require recompiling fragment shaders.
import { getMatplotlibColormap } from './ga_color.js';
import { WAVEFORMS, sample_range } from './cymatics.js';

const VERTEX_SRC = `#version 300 es
void main() {
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FRAGMENT_SRC = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSources;
uniform sampler2D uColormap;
uniform int uCount;
uniform int uOperator;
uniform int uBoundary;
uniform int uEdgeCount;
uniform vec4 uEdges[128];
uniform vec2 uResolution;
uniform vec2 uCenter;
uniform float uHeight;
uniform float uRotation;
uniform float uRadius;
uniform vec2 uSplitNormal;
uniform vec3 uBackgroundColor;
uniform float uPhase;
uniform float uFuzzy;
uniform bool uTransparentOutside;
uniform vec2 uRange;
out vec4 outColor;
const float TAU = 6.283185307179586;
float cross2(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }
float intersectRay(vec2 p, vec2 s, vec4 edge) {
    vec2 d = s - p, e = edge.zw - edge.xy;
    float den = cross2(d, e);
    if (abs(den) < 1e-8) return -1.0;
    float t = cross2(edge.xy - p, e) / den;
    float u = cross2(edge.xy - p, d) / den;
    return t >= 0.0 && t < 1.0 && (uBoundary == 2 || (u >= -1e-7 && u < 1.0 - 1e-7)) ? t : -1.0;
}
float wave(float distanceToSource, vec4 data, vec4 info) {
    float radial = TAU * data.w * distanceToSource;
    float phase = uPhase * info.x + info.y;
    float angle = radial + phase;
    float value;
    int kind = int(info.z);
    if (kind == 0) {
        value = sin(angle) / max(radial, 1e-6);
        if (radial < 1e-6 && abs(sin(phase)) < 1e-6) value = cos(angle);
    } else if (kind == 1) value = sin(angle);
    else if (kind == 2) value = sin(angle) >= 0.0 ? 1.0 : -1.0;
    else if (kind == 3) value = 2.0 * fract(angle / TAU + 0.5) - 1.0;
    else value = 2.0 / 3.141592653589793 * asin(sin(angle));
    return data.z * value;
}
float transfer(float value) {
    return pow(max(0.0, value) + 1e-6, 0.01 * uFuzzy);
}
void main() {
    vec2 p = (gl_FragCoord.xy - uResolution * 0.5) * uHeight / uResolution.y;
    float c = cos(uRotation), s = sin(uRotation);
    p = uCenter + mat2(c, s, -s, c) * p;
    bool inside = true;
    float edgeDistance = 1e20;
    if (uBoundary == 2) {
        float wallCoordinate = dot(p, uSplitNormal);
        inside = abs(wallCoordinate) <= uRadius;
        edgeDistance = abs(abs(wallCoordinate) - uRadius);
    } else if (uBoundary == 1) {
        for (int i = 0; i < 128; i++) {
            if (i >= uEdgeCount) break;
            vec4 e = uEdges[i];
            vec2 d = e.zw - e.xy;
            float side = cross2(d, p - e.xy) / length(d);
            if (side < -1e-7) inside = false;
            edgeDistance = min(edgeDistance, abs(side));
        }
    }
    if (!inside) { outColor = uTransparentOutside ? vec4(0.0) : vec4(uBackgroundColor, 1.0); return; }
    float value = 0.0;
    bool first = true;
    for (int i = 0; i < 8192; i++) {
        if (i >= uCount) break;
        vec4 data = texelFetch(uSources, ivec2(0, i), 0);
        vec4 info = texelFetch(uSources, ivec2(1, i), 0);
        if (info.w > 0.5) {
            float t = intersectRay(p, data.xy, texelFetch(uSources, ivec2(2, i), 0));
            if (t < 0.0) continue;
            if (info.w > 1.5 && intersectRay(p, data.xy, texelFetch(uSources, ivec2(3, i), 0)) <= t + 1e-7) continue;
        }
        float v = wave(length(p - data.xy), data, info);
        if (first) value = v;
        else if (uOperator == 0) value += v;
        else if (uOperator == 1) value -= v;
        else if (uOperator == 2) value = clamp(value * v, -1e20, 1e20);
        else value = clamp(value / (abs(v) < 1e-6 ? (v < 0.0 ? -1e-6 : 1e-6) : v), -1e20, 1e20);
        first = false;
    }
    float t;
    if (uFuzzy < 1.0) t = abs(value) < 0.02 ? 1.0 : 0.0;
    else {
        float lo = transfer(uRange.x), hi = transfer(uRange.y);
        t = clamp((transfer(abs(value)) - lo) / max(1e-6, hi - lo), 0.0, 1.0);
    }
    vec3 color = texture(uColormap, vec2(t, 0.5)).rgb;
    float pixelSize = uHeight / uResolution.y;
    float line = 1.0 - smoothstep(0.0, pixelSize * 1.3, edgeDistance);
    color = mix(color, vec3(0.8), line * 0.7);
    outColor = vec4(color, 1.0);
}`;

export function create_renderer(canvas, { transparentOutside = false } = {}) {
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, alpha: transparentOutside });
    if (!gl) throw new Error('Cymatics.art requires WebGL 2. Enable hardware acceleration or try a current browser.');
    function shader(type, source) {
        const result = gl.createShader(type);
        gl.shaderSource(result, source); gl.compileShader(result);
        if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result));
        return result;
    }
    const program = gl.createProgram();
    const vertex = shader(gl.VERTEX_SHADER, VERTEX_SRC), fragment = shader(gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const uniforms = {};
    for (const name of ['Sources', 'Colormap', 'Count', 'Operator', 'Boundary', 'EdgeCount', 'Edges', 'Resolution', 'Center', 'Height', 'Rotation', 'Radius', 'SplitNormal', 'BackgroundColor', 'Phase', 'Fuzzy', 'Range', 'TransparentOutside']) {
        uniforms[name] = gl.getUniformLocation(program, 'u' + name + (name === 'Edges' ? '[0]' : ''));
    }
    const sourceTexture = gl.createTexture(), colorTexture = gl.createTexture();
    function texture(unit, textureObject, filter = gl.NEAREST) {
        gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, textureObject);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    let previousScene = null, previousColors = '';
    return {
        gl,
        draw(cfg, scene) {
            gl.useProgram(program);
            if (previousScene !== scene) {
                const records = new Float32Array(scene.sources.length * 16);
                scene.sources.forEach((r, i) => {
                    records.set([r.x, r.y, r.amplitude, r.frequency, r.phase_multiplier, r.phase_offset, WAVEFORMS.indexOf(r.waveform), r.order], i * 16);
                    for (const [offset, edge] of [[8, r.edge], [12, r.previousEdge]]) {
                        if (edge) records.set([edge[0].x, edge[0].y, edge[1].x, edge[1].y], i * 16 + offset);
                    }
                });
                texture(0, sourceTexture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 4, scene.sources.length, 0, gl.RGBA, gl.FLOAT, records);
                const edges = new Float32Array(128 * 4);
                scene.geometry.edges.forEach(([a, b], i) => edges.set([a.x, a.y, b.x, b.y], i * 4));
                gl.uniform4fv(uniforms.Edges, edges);
                previousScene = scene;
            }
            const colorKey = JSON.stringify([cfg.colorMap, cfg.reverseColor, cfg.invertColor, cfg.colorCycles, cfg.colorStart, cfg.hueShiftDegrees, cfg.saturationPercent, cfg.luminosityPercent]);
            if (colorKey !== previousColors) {
                const mapColor = getMatplotlibColormap(0, 1, cfg.colorMap, cfg.reverseColor, cfg.invertColor, cfg.colorCycles, cfg.colorStart, 1, cfg.hueShiftDegrees, cfg.saturationPercent, cfg.luminosityPercent);
                const lut = new Uint8Array(2048 * 4);
                for (let i = 0; i < 2048; i++) lut.set([...mapColor(i / 2047), 255], i * 4);
                texture(1, colorTexture, gl.LINEAR);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2048, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut);
                previousColors = colorKey;
            }
            texture(0, sourceTexture); texture(1, colorTexture, gl.LINEAR);
            const range = sample_range(scene, cfg, canvas.width, canvas.height);
            const min = cfg.minOverride ?? range.min;
            gl.uniform1i(uniforms.Sources, 0); gl.uniform1i(uniforms.Colormap, 1);
            gl.uniform1i(uniforms.Count, scene.sources.length);
            gl.uniform1i(uniforms.Operator, ['+', '-', '*', '/'].indexOf(cfg.combineOperator));
            gl.uniform1i(uniforms.Boundary, scene.geometry.kind);
            gl.uniform1i(uniforms.EdgeCount, scene.geometry.edges.length);
            gl.uniform2f(uniforms.Resolution, canvas.width, canvas.height);
            gl.uniform2f(uniforms.Center, cfg.xCenter, cfg.yCenter);
            gl.uniform1f(uniforms.Height, cfg.yHeight);
            gl.uniform1f(uniforms.Rotation, cfg.rotationDegrees * Math.PI / 180);
            gl.uniform1f(uniforms.Radius, cfg.radius);
            gl.uniform2f(uniforms.SplitNormal, scene.geometry.normal?.x ?? 1, scene.geometry.normal?.y ?? 0);
            const background = cfg.backgroundColor.match(/[0-9a-f]{2}/gi).map(channel => parseInt(channel, 16) / 255);
            gl.uniform3fv(uniforms.BackgroundColor, background);
            gl.uniform1f(uniforms.Phase, cfg.phase);
            gl.uniform1f(uniforms.Fuzzy, cfg.fuzzyLevel);
            gl.uniform1i(uniforms.TransparentOutside, transparentOutside ? 1 : 0);
            const max = cfg.maxOverride ?? range.max;
            gl.uniform2f(uniforms.Range, min, Math.max(min + 1e-6, max));
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            return range;
        },
        dispose() {
            gl.deleteTexture(sourceTexture); gl.deleteTexture(colorTexture); gl.deleteProgram(program);
            gl.getExtension('WEBGL_lose_context')?.loseContext();
        }
    };
}
