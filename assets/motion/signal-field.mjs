import { createPerfGuard } from './perf-guard.mjs';

// The field calms a little while its own area scrolls away, but never straightens:
// straight lines read as ruled paper, so the waves keep most of their swing.
export const FIELD_REST_ORDER = 0.4;

export function computeFieldOrder(scrollY, fieldHeight) {
  if (!(fieldHeight > 0)) return FIELD_REST_ORDER;
  const t = Math.min(1, Math.max(0, scrollY / fieldHeight));
  return t * t * (3 - 2 * t) * FIELD_REST_ORDER;
}

// The field belongs to the opening of a page: the hero on the homepage, the title block on detail pages.
// Returns the document offset where it ends, or 0 when there is nothing to measure.
export function computeFieldExtent(boundaryBottom, scrollY, padding = 0) {
  const extent = Number(boundaryBottom) + (Number(scrollY) || 0) + (Number(padding) || 0);
  return Number.isFinite(extent) && extent > 0 ? Math.round(extent) : 0;
}

export function resolveFieldSettings(level, devicePixelRatio) {
  if (level === 'full') return { lineCount: 14, pixelRatio: Math.min(2, Math.max(1, devicePixelRatio || 1)), animate: true };
  return { lineCount: 7, pixelRatio: 1, animate: level !== 'static' };
}

const TAU = Math.PI * 2;
const wrap = (value, period) => ((value % period) + period) % period;

// Phases are wrapped in double precision so the shader only ever sees small numbers.
// The spot period of 100 keeps every per-line speed factor (1 + line * 0.07) continuous at the wrap.
export function computeFieldPhases(seconds) {
  return {
    wave: [wrap(seconds * 0.26, TAU), wrap(seconds * 0.16, TAU), wrap(seconds * 0.1, TAU)],
    spot: wrap(seconds * 0.03, 100)
  };
}

// Share of the viewport width, from the left, where text sits and the field steps back.
// Text that spans most of the width calms the whole field.
export function computeCalmEdge(textRight, viewportWidth) {
  if (!(viewportWidth > 0) || !Number.isFinite(textRight)) return 1;
  const ratio = Math.min(1, Math.max(0, textRight / viewportWidth));
  return ratio > 0.8 ? 1 : ratio;
}

function measureTextRight(documentObject) {
  const heading = documentObject.querySelector?.('main h1');
  if (!heading || !documentObject.createRange) return Number.NaN;
  let right = 0;
  for (const element of [heading, ...heading.parentElement.querySelectorAll(':scope > p')]) {
    const range = documentObject.createRange();
    range.selectNodeContents(element);
    right = Math.max(right, range.getBoundingClientRect().right);
  }
  return right;
}

const VERTEX_SOURCE = 'attribute vec2 aPosition;void main(){gl_Position=vec4(aPosition,0.0,1.0);}';
const FRAGMENT_SOURCE = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uResolution;
uniform vec3 uWave;
uniform float uSpot;
uniform float uOrder;
uniform float uLines;
uniform float uCalm;
uniform vec3 uPath;
uniform vec3 uAccent;
float wave(float x,float seed){
  return sin(x*3.1+seed*1.7+uWave.x)*0.5+sin(x*7.3-seed*2.9+uWave.y)*0.3+sin(x*13.7+seed*5.3-uWave.z)*0.2;
}
void main(){
  vec2 uv=gl_FragCoord.xy/uResolution;
  float chaos=1.0-uOrder;
  float thickness=2.0/uResolution.y;
  float line=0.0;
  float spot=0.0;
  for(int i=0;i<14;i++){
    float fi=float(i);
    if(fi>=uLines){break;}
    float base=(fi+0.5)/uLines;
    float y=base+wave(uv.x,fi)*0.085*chaos;
    line=max(line,smoothstep(thickness,0.0,abs(uv.y-y))*(0.55+0.45*uOrder));
    float px=fract(uSpot*(1.0+fi*0.07)+fi*0.37);
    float py=base+wave(px,fi)*0.085*chaos;
    vec2 delta=vec2((uv.x-px)*uResolution.x/uResolution.y,uv.y-py);
    spot=max(spot,smoothstep(0.007,0.003,length(delta)));
  }
  float presence=mix(0.28,1.0,smoothstep(uCalm-0.1,uCalm+0.1,uv.x));
  float alpha=max(line*0.6,spot*0.85)*presence;
  gl_FragColor=vec4(mix(uPath,uAccent,spot)*alpha,alpha);
}`;
const CONTEXT_OPTIONS = { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'low-power' };
const NOOP = Object.freeze({ disconnect() {} });

function readColor(styles, name, fallback) {
  const match = /^#([0-9a-f]{6})$/i.exec(styles?.getPropertyValue(name).trim() ?? '');
  const hex = match ? match[1] : fallback;
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

function createProgram(gl) {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
  const program = vertex && fragment ? gl.createProgram() : null;
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

function prepare(canvas) {
  try {
    const gl = canvas.getContext('webgl', CONTEXT_OPTIONS) || canvas.getContext('experimental-webgl', CONTEXT_OPTIONS);
    if (!gl || gl.isContextLost()) return null;
    const program = createProgram(gl);
    return program ? { gl, program } : null;
  } catch {
    return null;
  }
}

export function initSignalField({ canvas, reduced, windowObject, IntersectionObserverCtor }) {
  if (!canvas || typeof canvas.getContext !== 'function' || !windowObject?.requestAnimationFrame) return NOOP;
  const documentObject = canvas.ownerDocument;
  const boundary = documentObject.querySelector?.('.hero') ?? documentObject.querySelector?.('main > .lead') ?? null;
  const boundaryPadding = boundary?.matches?.('.hero') ? 0 : 48;
  function measureExtent() {
    if (!boundary?.getBoundingClientRect || !canvas.style?.setProperty) return;
    const extent = computeFieldExtent(boundary.getBoundingClientRect().bottom, windowObject.scrollY, boundaryPadding);
    if (extent) canvas.style.setProperty('--signal-extent', `${extent}px`);
  }
  measureExtent();
  const prepared = prepare(canvas);
  if (!prepared) {
    canvas.dataset.signalState = 'fallback';
    return NOOP;
  }
  const { gl, program } = prepared;

  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'aPosition');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const uniform = (name) => gl.getUniformLocation(program, name);
  const locations = { resolution: uniform('uResolution'), wave: uniform('uWave'), spot: uniform('uSpot'), order: uniform('uOrder'), lines: uniform('uLines'), calm: uniform('uCalm'), path: uniform('uPath'), accent: uniform('uAccent') };
  const styles = windowObject.getComputedStyle?.(documentObject.documentElement);
  gl.uniform3fv(locations.path, readColor(styles, '--signal-path', '6d8dff'));
  gl.uniform3fv(locations.accent, readColor(styles, '--signal-question', 'ee5a95'));
  gl.clearColor(0, 0, 0, 0);

  const guard = createPerfGuard();
  let level = reduced ? 'static' : 'full';
  let settings = resolveFieldSettings(level, windowObject.devicePixelRatio);
  let frameHandle = 0;
  let lastStamp = 0;
  let elapsedMs = 0;
  let frames = 0;
  let orderText = '';
  let stopped = false;
  let covered = false;
  let observer = null;
  let calm = 1;

  let extentObserver = null;

  const currentOrder = () => computeFieldOrder(windowObject.scrollY, canvas.clientHeight || windowObject.innerHeight);

  function resize() {
    measureExtent();
    const width = Math.round(canvas.clientWidth * settings.pixelRatio);
    const height = Math.round(canvas.clientHeight * settings.pixelRatio);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    gl.viewport(0, 0, width, height);
    calm = computeCalmEdge(measureTextRight(documentObject), windowObject.innerWidth);
    canvas.dataset.signalCalm = calm.toFixed(2);
  }

  function draw(order) {
    const phases = computeFieldPhases(elapsedMs / 1000);
    gl.uniform2f(locations.resolution, canvas.width || 1, canvas.height || 1);
    gl.uniform3fv(locations.wave, phases.wave);
    gl.uniform1f(locations.spot, phases.spot);
    gl.uniform1f(locations.order, order);
    gl.uniform1f(locations.lines, settings.lineCount);
    gl.uniform1f(locations.calm, calm >= 1 ? 1.2 : calm);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const text = order.toFixed(2);
    if (text !== orderText) { orderText = text; canvas.dataset.signalOrder = text; }
  }

  function cancel() {
    if (frameHandle) windowObject.cancelAnimationFrame(frameHandle);
    frameHandle = 0;
    lastStamp = 0;
  }

  function settle(order) {
    cancel();
    resize();
    draw(order);
    canvas.dataset.signalState = 'static';
  }

  function frame(stamp) {
    frameHandle = 0;
    if (stopped) return;
    if (lastStamp) {
      const delta = stamp - lastStamp;
      if (delta > 0 && delta < 1000) elapsedMs += delta;
      const next = guard.sample(delta);
      if (next !== level) {
        level = next;
        settings = resolveFieldSettings(level, windowObject.devicePixelRatio);
        canvas.dataset.signalQuality = level;
        if (!settings.animate) { settle(currentOrder()); return; }
        resize();
      }
    }
    lastStamp = stamp;
    const order = currentOrder();
    draw(order);
    frames += 1;
    if (frames % 30 === 0) canvas.dataset.signalFrames = String(frames);
    if (covered) { lastStamp = 0; return; }
    frameHandle = windowObject.requestAnimationFrame(frame);
  }

  function start() {
    if (stopped || frameHandle || !settings.animate || documentObject.hidden) return;
    frameHandle = windowObject.requestAnimationFrame(frame);
  }

  function onResize() {
    resize();
    if (!frameHandle) draw(reduced ? 0 : currentOrder());
  }

  function onVisibility() {
    if (documentObject.hidden) cancel(); else start();
  }

  function onContextLost(event) {
    event.preventDefault?.();
    stopped = true;
    cancel();
    canvas.dataset.signalState = 'fallback';
  }

  canvas.dataset.signalQuality = level;
  canvas.dataset.signalFrames = '0';
  canvas.addEventListener('webglcontextlost', onContextLost);
  windowObject.addEventListener('resize', onResize);
  documentObject.addEventListener('visibilitychange', onVisibility);
  if (IntersectionObserverCtor) {
    observer = new IntersectionObserverCtor((entries) => {
      covered = !entries[entries.length - 1].isIntersecting;
      if (!covered) start();
    });
    observer.observe(canvas);
  }
  if (boundary && typeof windowObject.ResizeObserver === 'function') {
    extentObserver = new windowObject.ResizeObserver(() => onResize());
    extentObserver.observe(boundary);
  }
  resize();
  if (settings.animate) {
    canvas.dataset.signalState = 'live';
    draw(currentOrder());
    start();
  } else {
    settle(0);
  }

  return {
    disconnect() {
      stopped = true;
      cancel();
      observer?.disconnect();
      extentObserver?.disconnect();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      windowObject.removeEventListener('resize', onResize);
      documentObject.removeEventListener('visibilitychange', onVisibility);
    }
  };
}
