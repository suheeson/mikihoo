// ═══════════════════════════════════════════════════════════════════════════
// hero-shader.js — mikihoo / 微氣候  interactive hero
// Vanilla OGL WebGL, no build step. ESM module.
// States: IDLE (breathing dot) → POINTER (shader live) → MIC (+ audio)
// ═══════════════════════════════════════════════════════════════════════════

import { Renderer, Program, Mesh, Triangle, Texture, Geometry }
  from 'https://cdn.jsdelivr.net/npm/ogl/+esm';

// ─── TUNABLE PARAMETERS ───────────────────────────────────────────────────
// Edit these values to adjust every effect without touching shader code.
const P = {
  // Duotone color mapping  (normalized 0-1 RGB)
  SHADOW_COLOR:    [0.07, 0.05, 0.13],   // ← deep violet for shadows/darks
  HIGHLIGHT_COLOR: [0.67, 0.67, 0.62],   // ← #a8a89e warm grey for highlights
  DUOTONE_MIX:     0.30,                  // ← 0=pure b&w  1=full duotone

  // Displacement / wave ripple
  DISP_BASE:       0.0022,   // ← always-on gentle ripple amplitude (try 0–0.008)
  DISP_POINTER:    0.009,    // ← extra amplitude near pointer (local boost)
  DISP_BASS:       0.006,    // ← extra amplitude from bass audio

  // Chromatic aberration (RGB split)
  CHROMA_VEL:      0.0045,   // ← split when pointer moves fast
  CHROMA_HIGH:     0.0035,   // ← split from treble audio

  // Komorebi light flares
  FLARE_BASE:      0.055,    // ← autonomous drifting glow intensity
  FLARE_POINTER:   0.10,     // ← near-pointer glow boost
  FLARE_AUDIO:     0.09,     // ← from overall volume (RMS)

  // Glitch events
  GLITCH_PROB:     0.0003,   // ← per-frame chance base (small = rare)
  GLITCH_PROB_H:   0.0025,   // ← per-frame chance when treble is loud
  GLITCH_DUR:      0.14,     // ← seconds each glitch event lasts

  // Mouse tracking inertia (0=instant, higher=more lag/smoothness)
  MOUSE_INERTIA:   0.07,

  // Ease-in durations (seconds)
  ACTIVE_EASE_DUR: 2.5,      // ← IDLE→POINTER fade-in
  AUDIO_EASE_DUR:  1.8,      // ← mic permission granted → audio takes effect

  // Particle system
  PARTICLES:       true,     // ← false to disable entirely
  PART_DESKTOP:    5000,     // ← particle count desktop/tablet
  PART_MOBILE:     800,      // ← particle count mobile
  PART_SIZE:       1.8,      // ← point size (px)
};
// ─────────────────────────────────────────────────────────────────────────

const REDUCED  = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const IS_MOB   = window.innerWidth <= 768 || 'ontouchstart' in window;

// ─── GLSL: Main vertex (fullscreen triangle) ─────────────────────────────
const VERT = /* glsl */`
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

// ─── GLSL: Main fragment (post-process video texture) ────────────────────
const FRAG = /* glsl */`
precision highp float;

uniform sampler2D tVideo;
uniform float uTime;
uniform float uActive;       // 0=idle, 1=fully active
uniform vec2  uMouse;        // smoothed mouse [0,1]
uniform float uMouseVel;     // mouse velocity (0–1 normalized)
uniform float uAudio;        // RMS level × audio ease
uniform float uBass;
uniform float uHigh;
uniform float uGlitch;       // 0 or 1
uniform float uGlitchY;
uniform float uGlitchH;
uniform float uGlitchOff;
uniform vec4  uVideoUV;      // [scaleX, scaleY, offX, offY] — object-fit:cover

// ── Tunable uniforms (mapped from P object) ──
uniform vec3  uShadowColor;
uniform vec3  uHighlightColor;
uniform float uDuotoneMix;
uniform float uDispBase;
uniform float uDispPointer;
uniform float uDispBass;
uniform float uFlareBase;
uniform float uFlarePointer;
uniform float uFlareAudio;
uniform float uChromaVel;
uniform float uChromaHigh;

varying vec2 vUv;

// ── Simplex 2D noise ────────────────────────────────────────────────────
vec3 _mod289v3(vec3 x) { return x - floor(x*(1.0/289.0))*289.0; }
vec2 _mod289v2(vec2 x) { return x - floor(x*(1.0/289.0))*289.0; }
vec3 _perm(vec3 x)     { return _mod289v3(((x*34.0)+1.0)*x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                      -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1  = (x0.x > x0.y) ? vec2(1.0,0.0) : vec2(0.0,1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy  -= i1;
  i = _mod289v2(i);
  vec3 p = _perm(_perm(i.y + vec3(0.0,i1.y,1.0)) + i.x + vec3(0.0,i1.x,1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x  = 2.0*fract(p*C.www) - 1.0;
  vec3 h  = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314*(a0*a0 + h*h);
  vec3 g;
  g.x  = a0.x *x0.x  + h.x *x0.y;
  g.yz = a0.yz*x12.xz + h.yz*x12.yw;
  return 130.0*dot(m,g);
}

// ── Video UV: object-fit:cover equivalent ───────────────────────────────
vec2 videoUV(vec2 uv) {
  return uv * uVideoUV.xy + uVideoUV.zw;
}

// ── Soft radial flare ─────────────────────────────────────────────────
float flare(vec2 uv, vec2 center, float r) {
  vec2 d = uv - center;
  return exp(-dot(d,d) / (r*r));
}

void main() {
  vec2 uv   = vUv;
  float t   = uTime;
  float act = uActive;

  // ── 1. Displacement ──────────────────────────────────────────────────
  // Autonomous noise wave, amplified by active/bass/pointer proximity
  float nFreq = 2.6;
  float nx = snoise(uv * nFreq + vec2(t*0.13,  t*0.09));
  float ny = snoise(uv * nFreq + vec2(t*0.11 + 3.7, t*0.15 + 1.3));

  // Pointer proximity (soft radial, flipped Y to match shader coords)
  vec2  mp   = vec2(uMouse.x, uMouse.y);
  float md   = length(uv - mp);
  float mprx = exp(-md*md / 0.06) * act;

  // Total displacement, dampened in IDLE
  float damp    = mix(0.18, 1.0, act);
  float dispAmp = (uDispBase + mprx*uDispPointer + uBass*uDispBass) * damp;
  vec2  dispUV  = uv + vec2(nx, ny) * dispAmp;

  // ── 2. Chromatic aberration direction & amount ──────────────────────
  float chromaAmt = (uMouseVel*uChromaVel + uHigh*uChromaHigh) * act;
  vec2  cDir      = normalize(vec2(nx, ny) + 0.0001);

  // ── 3. Glitch horizontal band ────────────────────────────────────────
  vec2 sampleUV = dispUV;
  if (uGlitch > 0.5) {
    float inBand = step(uGlitchY - uGlitchH, uv.y)
                 - step(uGlitchY + uGlitchH, uv.y);
    sampleUV.x  += inBand * uGlitchOff;
  }

  // ── 4. Sample video with RGB split ───────────────────────────────────
  vec2 vR = clamp(videoUV(sampleUV + cDir*chromaAmt),    0.0, 1.0);
  vec2 vG = clamp(videoUV(sampleUV),                      0.0, 1.0);
  vec2 vB = clamp(videoUV(sampleUV - cDir*chromaAmt),    0.0, 1.0);

  float r = texture2D(tVideo, vR).r;
  float g = texture2D(tVideo, vG).g;
  float b = texture2D(tVideo, vB).b;
  float lum = dot(vec3(r,g,b), vec3(0.299, 0.587, 0.114));

  // ── 5. Duotone color mapping ──────────────────────────────────────────
  // Map luminance → shadow→highlight gradient, blend with b&w
  vec3 duoColor = mix(uShadowColor, uHighlightColor, lum);
  vec3 color    = mix(vec3(lum), duoColor, uDuotoneMix);

  // ── 6. Komorebi flares (screen-blend additive) ───────────────────────
  // Two autonomous flares that drift on noise paths
  float ft = t * 0.18;
  vec2 fc1 = vec2(0.30 + 0.22*snoise(vec2(ft,       0.0)),
                  0.42 + 0.18*snoise(vec2(0.0,       ft+1.3)));
  vec2 fc2 = vec2(0.68 + 0.14*snoise(vec2(ft+5.1,   0.0)),
                  0.60 + 0.14*snoise(vec2(0.0,       ft+2.7)));

  float f1 = flare(uv, fc1, 0.28) * uFlareBase;
  float f2 = flare(uv, fc2, 0.20) * uFlareBase * 0.65;

  // Pointer flare (with mouse inertia already baked into uMouse)
  float fp = flare(uv, mp, 0.16) * uFlarePointer * mprx;

  // Audio global brightening
  float fa = uAudio * uFlareAudio;

  float fTotal = clamp((f1 + f2 + fp) * act + fa * act, 0.0, 0.45);

  // Screen blend: result = 1-(1-a)(1-b)
  color = 1.0 - (1.0 - color) * (1.0 - fTotal);

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

// ─── GLSL: Particle vertex ────────────────────────────────────────────────
const PART_VERT = /* glsl */`
attribute vec2 aUV;      // initial UV position in video [0,1]
attribute float aSpeed;  // drift speed multiplier
uniform sampler2D tVideo;
uniform float uTime;
uniform float uActive;
uniform vec2  uMouse;
uniform float uBass;
uniform vec4  uVideoUV;
uniform float uPointSize;
varying float vLum;
varying float vAlpha;

void main() {
  vec2 uv = aUV;

  // Sample luminance at this particle's position
  vec2 texUV = clamp(uv * uVideoUV.xy + uVideoUV.zw, 0.0, 1.0);
  float lum  = texture2D(tVideo, texUV).r;
  vLum = lum;

  // Gentle autonomous drift
  float driftX = sin(uTime*0.35*aSpeed + uv.x*6.28) * 0.006;
  float driftY = cos(uTime*0.27*aSpeed + uv.y*5.93) * 0.005;

  // Mouse repulsion
  vec2  clip    = uv * 2.0 - 1.0;
  vec2  mouseC  = uMouse * 2.0 - 1.0;
  vec2  toM     = clip - mouseC;
  float mDist   = length(toM);
  vec2  repel   = normalize(toM + 0.0001) * exp(-mDist*mDist/0.08) * uBass * 0.07;

  clip += vec2(driftX, driftY) + repel;

  vAlpha       = uActive * smoothstep(0.15, 0.5, lum);
  gl_PointSize = uPointSize;
  gl_Position  = vec4(clip, 0.0, 1.0);
}`;

// ─── GLSL: Particle fragment ──────────────────────────────────────────────
const PART_FRAG = /* glsl */`
precision mediump float;
varying float vLum;
varying float vAlpha;

void main() {
  vec2  d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float a = (0.5 - r) * 2.0;
  gl_FragColor = vec4(vec3(vLum * 0.85 + 0.1), vAlpha * a * 0.45);
}`;

// ─── STATE ───────────────────────────────────────────────────────────────
const STATE = { IDLE: 0, POINTER: 1, MIC: 2 };
let state      = STATE.IDLE;
let activeEase = 0;
let audioEase  = 0;

// ─── POINTER ─────────────────────────────────────────────────────────────
const rawMouse = { x: 0.5, y: 0.5 };
const smMouse  = { x: 0.5, y: 0.5 };
let mouseVelRaw = 0;
let mouseVelSm  = 0;

function onPointerMove(e) {
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  const nx = cx / window.innerWidth;
  const ny = 1.0 - cy / window.innerHeight;   // flip Y → shader bottom=0
  const dx = nx - rawMouse.x, dy = ny - rawMouse.y;
  mouseVelRaw = Math.sqrt(dx*dx + dy*dy);
  rawMouse.x  = nx;
  rawMouse.y  = ny;
}
window.addEventListener('mousemove',  onPointerMove, { passive: true });
window.addEventListener('touchmove',  onPointerMove, { passive: true });

// ─── AUDIO ────────────────────────────────────────────────────────────────
let analyser, freqData, audioStream;
let audioLevel = 0, audioBass = 0, audioHigh = 0;

async function initAudio() {
  if (!navigator.mediaDevices?.getUserMedia) return;
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') await actx.resume();
    const src = actx.createMediaStreamSource(audioStream);
    analyser  = actx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    src.connect(analyser);
    freqData = new Uint8Array(analyser.frequencyBinCount);
    state    = STATE.MIC;   // upgrade state silently
  } catch(_) {
    // permission denied or unsupported — stay in POINTER, no error shown
  }
}

function updateAudio() {
  if (!analyser || !freqData) return;
  analyser.getByteFrequencyData(freqData);

  // Overall RMS
  let s = 0;
  for (let i = 0; i < freqData.length; i++) s += (freqData[i]/255)**2;
  audioLevel = Math.sqrt(s / freqData.length);

  // Bass band (bins 0–4 ≈ 0–340 Hz at 44100 / FFT 256)
  let b = 0;
  for (let i = 0; i < 4; i++) b += freqData[i]/255;
  audioBass = b / 4;

  // High/treble (bins 80+ ≈ 10 kHz+)
  let h = 0, hN = freqData.length - 80;
  for (let i = 80; i < freqData.length; i++) h += freqData[i]/255;
  audioHigh = hN > 0 ? h / hN : 0;
}

// ─── GLITCH ───────────────────────────────────────────────────────────────
let glitchActive = 0, glitchTimer = 0;
let glitchY = 0.5, glitchH = 0.04, glitchOff = 0;

function maybeGlitch(dt) {
  if (state === STATE.IDLE) return;
  if (glitchTimer > 0) {
    glitchTimer  -= dt;
    if (glitchTimer <= 0) { glitchActive = 0; glitchTimer = 0; }
    return;
  }
  const prob = P.GLITCH_PROB + audioHigh * P.GLITCH_PROB_H;
  if (Math.random() < prob * 60 * dt) {
    glitchActive = 1;
    glitchTimer  = P.GLITCH_DUR;
    glitchY      = Math.random();
    glitchH      = 0.03 + Math.random() * 0.07;
    glitchOff    = (Math.random() - 0.5) * 0.04;
  }
}

// ─── DOM refs ─────────────────────────────────────────────────────────────
const heroEl  = document.querySelector('.hero');
const videoEl = document.querySelector('.hero-video');
const dotEl   = document.getElementById('heroDot');

// ─── WEBGL ────────────────────────────────────────────────────────────────
let canvasEl, renderer, gl, program, mesh, videoTexture;
let particleMesh, particleProgram;
let videoUvTransform = [1, 1, 0, 0];  // [sx, sy, ox, oy]

function computeVideoUV() {
  if (!videoEl || !canvasEl) return;
  const vw = videoEl.videoWidth  || 1920;
  const vh = videoEl.videoHeight || 1080;
  const cw = canvasEl.offsetWidth  || window.innerWidth;
  const ch = canvasEl.offsetHeight || window.innerHeight;
  const vAR = vw / vh, cAR = cw / ch;
  let sx = 1, sy = 1, ox = 0, oy = 0;
  if (vAR > cAR) {
    sx = cAR / vAR;
    ox = (1 - sx) * 0.5;
  } else {
    sy = vAR / cAR;
    oy = (1 - sy) * 0.5;
  }
  videoUvTransform = [sx, sy, ox, oy];
  if (program) program.uniforms.uVideoUV.value = videoUvTransform;
  if (particleProgram) particleProgram.uniforms.uVideoUV.value = videoUvTransform;
}

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer?.setSize(w, h);
  if (program) program.uniforms.uResolution?.value && (program.uniforms.uResolution.value = [w, h]);
  computeVideoUV();
}

// ─── Init WebGL ───────────────────────────────────────────────────────────
function initWebGL() {
  try {
    canvasEl = document.createElement('canvas');
    canvasEl.id = 'heroShaderCanvas';
    canvasEl.style.cssText = [
      'position:absolute', 'top:0', 'left:0',
      'width:100%', 'height:100%',
      'pointer-events:none', 'z-index:1',
    ].join(';');
    // Insert after video, before hero-fade
    heroEl.insertBefore(canvasEl, heroEl.children[1] || null);

    renderer = new Renderer({ canvas: canvasEl, alpha: false, antialias: false,
                               dpr: Math.min(window.devicePixelRatio, 2) });
    gl = renderer.gl;

    resize();
    window.addEventListener('resize', debounce(resize, 200));

    videoTexture = new Texture(gl, {
      generateMipmaps: false,
      wrapS: gl.CLAMP_TO_EDGE,
      wrapT: gl.CLAMP_TO_EDGE,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR,
    });

    const geo = new Triangle(gl);
    program   = new Program(gl, {
      vertex: VERT, fragment: FRAG,
      uniforms: {
        tVideo:          { value: videoTexture },
        uTime:           { value: 0 },
        uActive:         { value: 0 },
        uMouse:          { value: [0.5, 0.5] },
        uMouseVel:       { value: 0 },
        uAudio:          { value: 0 },
        uBass:           { value: 0 },
        uHigh:           { value: 0 },
        uGlitch:         { value: 0 },
        uGlitchY:        { value: 0.5 },
        uGlitchH:        { value: 0.04 },
        uGlitchOff:      { value: 0 },
        uVideoUV:        { value: [1, 1, 0, 0] },
        uResolution:     { value: [window.innerWidth, window.innerHeight] },
        // ── Tunable (map directly from P) ──────────────────────────────
        uShadowColor:    { value: P.SHADOW_COLOR },
        uHighlightColor: { value: P.HIGHLIGHT_COLOR },
        uDuotoneMix:     { value: P.DUOTONE_MIX },
        uDispBase:       { value: P.DISP_BASE },
        uDispPointer:    { value: P.DISP_POINTER },
        uDispBass:       { value: P.DISP_BASS },
        uFlareBase:      { value: P.FLARE_BASE },
        uFlarePointer:   { value: P.FLARE_POINTER },
        uFlareAudio:     { value: P.FLARE_AUDIO },
        uChromaVel:      { value: P.CHROMA_VEL },
        uChromaHigh:     { value: P.CHROMA_HIGH },
      },
    });

    mesh = new Mesh(gl, { geometry: geo, program });

    // Particles (desktop, non-reduced-motion only)
    if (P.PARTICLES && !REDUCED && !IS_MOB) initParticles();

    return true;
  } catch(e) {
    console.warn('[mikihoo-hero] WebGL failed, falling back to plain video', e);
    return false;
  }
}

// ─── Particle system ──────────────────────────────────────────────────────
function initParticles() {
  const N    = IS_MOB ? P.PART_MOBILE : P.PART_DESKTOP;
  const uvs  = new Float32Array(N * 2);
  const spds = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    uvs[i*2]   = Math.random();
    uvs[i*2+1] = Math.random();
    spds[i]    = 0.5 + Math.random() * 0.5;
  }
  const geo = new Geometry(gl, {
    aUV:   { size: 2, data: uvs },
    aSpeed: { size: 1, data: spds },
  });
  particleProgram = new Program(gl, {
    vertex: PART_VERT, fragment: PART_FRAG,
    uniforms: {
      tVideo:     { value: videoTexture },
      uTime:      { value: 0 },
      uActive:    { value: 0 },
      uMouse:     { value: [0.5, 0.5] },
      uBass:      { value: 0 },
      uVideoUV:   { value: [1, 1, 0, 0] },
      uPointSize: { value: P.PART_SIZE },
    },
    transparent: true,
    depthTest: false,
  });
  particleMesh = new Mesh(gl, { geometry: geo, program: particleProgram,
                                 mode: gl.POINTS });
}

// ─── Render loop ──────────────────────────────────────────────────────────
let rafId   = null;
let lastTs  = null;
let elapsed = 0;

function tick(ts) {
  rafId = requestAnimationFrame(tick);

  const dt  = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : 0.016;
  lastTs    = ts;
  elapsed  += dt;

  // ── Ease states ─────────────────────────────────────────────────────
  if (state !== STATE.IDLE && !REDUCED) {
    activeEase = Math.min(1, activeEase + dt / P.ACTIVE_EASE_DUR);
  }
  if (state === STATE.MIC && !REDUCED) {
    audioEase = Math.min(1, audioEase + dt / P.AUDIO_EASE_DUR);
  }

  // ── Audio ────────────────────────────────────────────────────────────
  updateAudio();
  if (!REDUCED) maybeGlitch(dt);

  // ── Smooth mouse ─────────────────────────────────────────────────────
  smMouse.x  += (rawMouse.x - smMouse.x) * P.MOUSE_INERTIA;
  smMouse.y  += (rawMouse.y - smMouse.y) * P.MOUSE_INERTIA;
  mouseVelSm  = mouseVelSm * 0.84 + mouseVelRaw * 0.16;
  mouseVelRaw *= 0.78;

  // ── Upload video texture ──────────────────────────────────────────────
  if (videoEl.readyState >= 2) {
    videoTexture.image      = videoEl;
    videoTexture.needsUpdate = true;
  }

  // ── Write main uniforms ───────────────────────────────────────────────
  const u          = program.uniforms;
  u.uTime.value    = elapsed;
  u.uActive.value  = REDUCED ? 0 : activeEase;
  u.uMouse.value   = [smMouse.x, smMouse.y];
  u.uMouseVel.value = Math.min(mouseVelSm * 50, 1);
  u.uAudio.value   = audioLevel * audioEase;
  u.uBass.value    = audioBass  * audioEase;
  u.uHigh.value    = audioHigh  * audioEase;
  u.uGlitch.value  = glitchActive;
  u.uGlitchY.value = glitchY;
  u.uGlitchH.value = glitchH;
  u.uGlitchOff.value = glitchOff;
  u.uVideoUV.value = videoUvTransform;

  renderer.render({ scene: mesh });

  // ── Particles ─────────────────────────────────────────────────────────
  if (particleMesh && !REDUCED) {
    const pu          = particleProgram.uniforms;
    pu.uTime.value    = elapsed;
    pu.uActive.value  = activeEase;
    pu.uMouse.value   = [smMouse.x, smMouse.y];
    pu.uBass.value    = audioBass * audioEase;
    pu.uVideoUV.value = videoUvTransform;
    renderer.render({ scene: particleMesh });
  }
}

// ─── Activate: IDLE → POINTER (→ MIC) ────────────────────────────────────
async function activate() {
  if (state !== STATE.IDLE) return;
  state = STATE.POINTER;

  // Fade out the breathing dot
  if (dotEl) {
    dotEl.classList.add('hero-dot--exit');
    setTimeout(() => { if (dotEl) dotEl.style.display = 'none'; }, 1400);
  }

  // Request mic in background — fails silently, stays in POINTER
  await initAudio();
}

// ─── Visibility: pause when tab hidden ───────────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelAnimationFrame(rafId);
    rafId  = null;
    videoEl?.pause();
  } else if (!rafId) {
    lastTs = null;
    rafId  = requestAnimationFrame(tick);
    videoEl?.play().catch(() => {});
  }
});

// ─── Cleanup on unload ────────────────────────────────────────────────────
window.addEventListener('beforeunload', () => {
  cancelAnimationFrame(rafId);
  audioStream?.getTracks().forEach(t => t.stop());
});

// ─── Entry point ─────────────────────────────────────────────────────────
function init() {
  const ok = initWebGL();
  if (!ok) {
    // Fallback: show original video + grain only, hide dot
    if (dotEl) dotEl.style.display = 'none';
    return;
  }

  // Hide original video element (still plays as texture source)
  videoEl.style.opacity = '0';

  // Start render loop
  rafId = requestAnimationFrame(tick);

  // Update UV transform once video dimensions are known
  videoEl.addEventListener('loadedmetadata', computeVideoUV, { once: true });
  if (videoEl.videoWidth) computeVideoUV();

  // Dot interaction
  if (dotEl) {
    dotEl.addEventListener('click', activate);
    dotEl.addEventListener('touchend', (e) => { e.preventDefault(); activate(); },
                           { passive: false });
  }
}

init();
