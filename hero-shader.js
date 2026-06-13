// ═══════════════════════════════════════════════════════════════════════════
// hero-shader.js — mikihoo / 微氣候  interactive hero
// Vanilla OGL WebGL, no build step. ESM module.
//
// Tone: the video is a STILL base (duotone + barely-there breath). The
// particles and rare glitches are the lead visual. The pointer does not drag
// light around — it parts the particle field. Clicking anywhere in the hero
// silently requests the mic; granted, it eases audio reactivity into the
// particles and glitches over ~1.5s. No explicit visual "wake" event.
// ═══════════════════════════════════════════════════════════════════════════

import { Renderer, Program, Mesh, Triangle, Texture, Geometry }
  from 'https://cdn.jsdelivr.net/npm/ogl/+esm';

// ─── TUNABLE PARAMETERS ───────────────────────────────────────────────────
const P = {
  // ── Duotone color mapping (normalized 0-1 RGB) ──────────────────────────
  SHADOW_COLOR:    [0.122, 0.086, 0.063],  // #1f1610 warm dark (NOT pure black)
  HIGHLIGHT_COLOR: [0.769, 0.694, 0.620],  // #c4b19e warm grey highlight
  DUOTONE_MIX:     0.52,                    // 0=pure b&w  1=full duotone

  // ── Video displacement — a breath, not a wave (UV units; 0.003 ≈ 0.3%) ──
  DISP_BASE:       0.0030,

  // ── Autonomous light flare — faint vestige only (0 to remove entirely) ──
  FLARE_BASE:      0.045,    // very low; this is NOT the lead effect anymore
  FLARE_CLAMP:     0.16,

  // ── Video block glitch (square-block displace + chroma, rare/short) ─────
  BLOCK_GLITCH_RATE:  0.12,         // events/sec base (~1 per 8s)
  BLOCK_GLITCH_DUR:   0.16,         // seconds each event lasts
  BLOCK_GLITCH_COUNT: [16.0, 10.0], // block grid columns × rows
  BLOCK_GLITCH_AMT:   0.07,         // max UV displacement of a glitched block
  VIDEO_RGB_BASE:     0.0,          // baseline video RGB split (≈0, idle)

  // ── Pointer / ease ──────────────────────────────────────────────────────
  MOUSE_INERTIA:   0.08,
  ACTIVE_EASE_DUR: 2.2,      // load → fully active fade-in

  // ── Particles (the main visual) ──────────────────────────────────────────
  PARTICLES:        true,
  PART_SIZE:        2.2,     // base point size (px, scaled by dpr & lum)
  PART_ALPHA:       0.50,    // overall opacity — kept low so video shows through
  PART_DRIFT:       0.012,   // autonomous noise-flow drift (UV)
  PART_REPEL:       0.17,    // pointer repulsion strength
  PART_REPEL_R:     0.10,    // pointer repulsion radius (UV²-ish)
  PART_STREAK:      1.6,     // fast-pointer streak multiplier
  PART_GLITCH_FRAC: 0.12,    // base fraction that RGB-glitch-jump (0-1)
  PART_GLITCH_AMP:  0.05,    // glitch jump distance (UV)
  PART_PULSE_RATE:  9.0,     // glitch tick frequency (higher = more often)

  // ── Scanline alignment glitch (particles snap to a row, then scatter) ───
  SCANLINE_RATE: 0.18,       // events/sec (~1 per 5.5s)
  SCANLINE_DUR:  0.45,       // seconds (short tick)

  // ── Audio mapping (all gains tunable; effects ease in over easeInDuration)
  audio: {
    easeInDuration: 1.5,     // mic granted → reactivity ramps 0→1 (seconds)
    rms: {
      particleJitterGain:     0.030,  // RMS → per-particle micro jitter amplitude
      particleSpeedGain:      1.60,   // RMS → drift speed multiplier
      particleBrightnessGain: 0.85,   // RMS → particle alpha/brightness lift
    },
    bass: {
      scatterGain:               1.40, // bass → field scatter amplitude
      blockGlitchProbMultiplier: 2.00, // bass → video block-glitch rate ×
    },
    high: {
      particleRgbSplitRatio: 0.35,    // treble → glitch fraction rises toward this
      scanlineFreqMultiplier: 1.80,   // treble → scanline rate ×
      videoRgbSplitGain:      0.0045, // treble → subtle video RGB split
    },
    transient: {
      threshold:      0.060,  // onset detection: level jump above EMA
      glitchBurstGain: 1.00,  // transient → one-shot glitch burst strength
    },
  },
};
// ─────────────────────────────────────────────────────────────────────────

const REDUCED  = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const IS_MOB   = window.innerWidth <= 768 || 'ontouchstart' in window;

function particleCount() {
  const w = window.innerWidth;
  if (REDUCED)      return 6000;
  if (w <= 480)     return 5000;
  if (w <= 768)     return 9000;
  if (w <= 1280)    return 24000;
  if (w <= 1920)    return 40000;
  return 52000;
}

// ─── Shared GLSL: Simplex 2D noise ─────────────────────────────────────────
const NOISE_GLSL = /* glsl */`
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
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}`;

// ─── GLSL: Main vertex (fullscreen triangle) ─────────────────────────────
const VERT = /* glsl */`
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

// ─── GLSL: Main fragment — still video base + rare block glitch ───────────
const FRAG = /* glsl */`
precision highp float;

uniform sampler2D tVideo;
uniform float uTime;
uniform float uActive;
uniform vec4  uVideoUV;       // [scaleX, scaleY, offX, offY] — object-fit:cover
uniform vec3  uShadowColor;
uniform vec3  uHighlightColor;
uniform float uDuotoneMix;
uniform float uDispBase;
uniform float uFlareBase;
uniform float uFlareClamp;
uniform float uBlockGlitch;   // 0 or 1
uniform float uBlockSeed;
uniform vec2  uBlockCount;
uniform float uBlockAmt;
uniform float uVideoRgbSplit; // treble + block-driven, ≈0 idle

varying vec2 vUv;

${NOISE_GLSL}

vec2 videoUV(vec2 uv) { return uv * uVideoUV.xy + uVideoUV.zw; }

float flare(vec2 uv, vec2 c, float r) {
  vec2 d = uv - c;
  return exp(-dot(d,d) / (r*r));
}

void main() {
  vec2 uv  = vUv;
  float t  = uTime;
  float act = uActive;

  // ── Barely-there breath (a still photo that just slightly inhales) ─────
  float nx = snoise(uv * 2.4 + vec2(t*0.07,        t*0.05));
  float ny = snoise(uv * 2.4 + vec2(t*0.06 + 3.7,  t*0.08 + 1.3));
  vec2 sampleUV = uv + vec2(nx, ny) * uDispBase * mix(0.4, 1.0, act);

  // ── Video block glitch (rare, short — a precise digital accident) ──────
  float chroma = uVideoRgbSplit;
  if (uBlockGlitch > 0.5) {
    vec2 bid = floor(uv * uBlockCount);
    float h  = hash21(bid + uBlockSeed);
    if (h > 0.65) {                       // ~35% of blocks pop
      sampleUV.x += (fract(h*91.7) - 0.5) * uBlockAmt;
      sampleUV.y += (fract(h*57.3) - 0.5) * uBlockAmt * 0.5;
      chroma     += 0.013;
    }
  }

  // ── Sample with horizontal RGB split (≈0 unless treble/glitch) ─────────
  float r = texture2D(tVideo, clamp(videoUV(sampleUV + vec2(chroma,0.0)), 0.0, 1.0)).r;
  float g = texture2D(tVideo, clamp(videoUV(sampleUV),                    0.0, 1.0)).g;
  float b = texture2D(tVideo, clamp(videoUV(sampleUV - vec2(chroma,0.0)), 0.0, 1.0)).b;
  float lum = dot(vec3(r,g,b), vec3(0.299, 0.587, 0.114));

  // ── Duotone ────────────────────────────────────────────────────────────
  vec3 duo   = mix(uShadowColor, uHighlightColor, lum);
  vec3 color = mix(vec3(lum), duo, uDuotoneMix);

  // ── Faint autonomous flare vestige (no pointer tracking) ──────────────
  if (uFlareBase > 0.001) {
    float ft = t * 0.10;
    vec2 fc  = vec2(0.42 + 0.18*snoise(vec2(ft,     0.0)),
                    0.52 + 0.16*snoise(vec2(0.0,     ft+1.3)));
    float f  = flare(uv, fc, 0.32) * uFlareBase;
    float fT = clamp(f * act, 0.0, uFlareClamp);
    color    = 1.0 - (1.0 - color) * (1.0 - fT);
  }

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

// ─── GLSL: Particle vertex ────────────────────────────────────────────────
const PART_VERT = /* glsl */`
attribute vec2  aUV;      // home position in video space [0,1]
attribute float aSpeed;
attribute float aRand;
uniform sampler2D tVideo;
uniform float uTime;
uniform float uActive;
uniform vec2  uMouse;
uniform float uMouseVel;
uniform vec4  uVideoUV;
uniform float uPointSize;
uniform float uDpr;
uniform float uDrift;
uniform float uRepel;
uniform float uRepelR;
uniform float uStreak;
uniform float uGlitchFrac;
uniform float uGlitchAmp;
uniform float uPulseRate;
uniform float uScatterAmt;   // bass + transient driven
uniform float uExcite;       // RMS × ease
uniform float uJitterGain;
uniform float uSpeedGain;
uniform float uBrightGain;
uniform float uScanline;
uniform float uScanlineY;
uniform vec3  uShadowColor;
uniform vec3  uHighlightColor;
varying float vLum;
varying float vAlpha;
varying vec3  vColor;
varying float vGlitch;

${NOISE_GLSL}

void main() {
  vec2 uv = aUV;
  vec2 texUV = clamp(uv * uVideoUV.xy + uVideoUV.zw, 0.0, 1.0);
  float lum  = texture2D(tVideo, texUV).r;
  vLum = lum;

  // ── Autonomous noise-flow drift (speeds up with loudness) ────────────
  float t  = uTime * (0.25 + aSpeed*0.35) * (1.0 + uExcite*uSpeedGain);
  float dx = snoise(uv*3.0 + vec2(t*0.30, aRand*10.0)) * uDrift;
  float dy = snoise(uv*3.0 + vec2(aRand*10.0, t*0.26)) * uDrift;
  vec2 pos = uv + vec2(dx, dy);

  // ── RMS micro-jitter (whole field gets restless when loud) ───────────
  pos += vec2(snoise(uv*42.0 + uTime*9.0 + aRand*7.0),
              snoise(uv*42.0 - uTime*9.0)) * uExcite * uJitterGain;

  // ── Pointer repulsion — the field parts around the cursor ────────────
  vec2  toM  = pos - uMouse;
  float md2  = dot(toM, toM);
  float push = exp(-md2 / uRepelR) * uRepel * uActive;
  vec2  dir  = normalize(toM + 0.0001);
  pos += dir * push;
  pos += dir * push * uMouseVel * uStreak;   // fast pointer → streak

  // ── Bass scatter / transient burst ────────────────────────────────────
  pos += vec2(snoise(uv*8.0 + uTime), snoise(uv*8.0 - uTime)) * uScatterAmt;

  // ── Glitch jump (RGB-split tick on a fraction of particles) ──────────
  float gWindow = step(aRand, uGlitchFrac);
  float gPulse  = step(0.90, fract(uTime*uPulseRate + aRand*53.0)) * gWindow;
  vGlitch = 0.0;
  if (gPulse > 0.5) {
    vec2 j = vec2(snoise(uv*20.0 + uTime*9.0),
                  snoise(uv*20.0 - uTime*9.0));
    pos += j * uGlitchAmp;
    vGlitch = sign(j.x);
  }

  // ── Scanline alignment event ─────────────────────────────────────────
  pos.y = mix(pos.y, uScanlineY, uScanline * (0.6 + 0.4*aRand));

  // ── Color from duotone palette + per-particle warm/cool variance ─────
  vec3 base = mix(uShadowColor, uHighlightColor, clamp(lum*1.15, 0.0, 1.0));
  vec3 warm = base * vec3(1.08, 1.0, 0.92);
  vec3 cool = base * vec3(0.92, 0.98, 1.08);
  vColor = mix(cool, warm, aRand) * (0.8 + lum*0.6);

  // ── Density: bright video → denser/brighter; loud → lifted ───────────
  float bright = 1.0 + uExcite * uBrightGain;
  vAlpha = uActive * smoothstep(0.10, 0.55, lum) * (0.5 + aRand*0.5) * bright;

  vec2 clip = pos * 2.0 - 1.0;
  gl_PointSize = uPointSize * uDpr * (0.6 + lum*0.9);
  gl_Position  = vec4(clip, 0.0, 1.0);
}`;

// ─── GLSL: Particle fragment ──────────────────────────────────────────────
const PART_FRAG = /* glsl */`
precision mediump float;
uniform float uAlpha;
varying float vLum;
varying float vAlpha;
varying vec3  vColor;
varying float vGlitch;
void main() {
  vec2  d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float a = (0.5 - r) * 2.0;
  a *= a;
  vec3 col = vColor;
  col.r += max(vGlitch, 0.0) * 0.5;
  col.b += max(-vGlitch, 0.0) * 0.5;
  gl_FragColor = vec4(col, vAlpha * a * uAlpha);
}`;

// ─── STATE ───────────────────────────────────────────────────────────────
const STATE = { LIVE: 0, MIC: 1 };
let state      = STATE.LIVE;
let activeEase = 0;
let audioEase  = 0;
let micRequested = false;

// ─── POINTER ─────────────────────────────────────────────────────────────
const rawMouse = { x: 0.5, y: 0.5 };
const smMouse  = { x: 0.5, y: 0.5 };
let mouseVelRaw = 0, mouseVelSm = 0;

function onPointerMove(e) {
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  const nx = cx / window.innerWidth;
  const ny = 1.0 - cy / window.innerHeight;
  const dx = nx - rawMouse.x, dy = ny - rawMouse.y;
  mouseVelRaw = Math.sqrt(dx*dx + dy*dy);
  rawMouse.x  = nx;
  rawMouse.y  = ny;
}
window.addEventListener('mousemove', onPointerMove, { passive: true });
window.addEventListener('touchmove', onPointerMove, { passive: true });

// ─── AUDIO ────────────────────────────────────────────────────────────────
let analyser, freqData, audioStream;
let audioLevel = 0, audioBass = 0, audioHigh = 0;
let emaLevel = 0, transient = 0;   // onset detection

async function initAudio() {
  if (micRequested) return;
  micRequested = true;
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
    state    = STATE.MIC;
  } catch(_) { /* denied/unsupported — audio mapping stays 0 forever */ }
}

function updateAudio() {
  if (!analyser || !freqData) return;
  analyser.getByteFrequencyData(freqData);
  let s = 0;
  for (let i = 0; i < freqData.length; i++) s += (freqData[i]/255)**2;
  audioLevel = Math.sqrt(s / freqData.length);
  let b = 0;
  for (let i = 0; i < 4; i++) b += freqData[i]/255;
  audioBass = b / 4;
  let h = 0, hN = freqData.length - 80;
  for (let i = 80; i < freqData.length; i++) h += freqData[i]/255;
  audioHigh = hN > 0 ? h / hN : 0;

  // Transient / onset: level rising sharply above its slow EMA
  const onset = audioLevel - emaLevel;
  emaLevel += (audioLevel - emaLevel) * 0.20;
  if (onset > P.audio.transient.threshold) transient = Math.min(1, transient + onset * 5);
  transient *= 0.86;
}

// ─── GLITCH timing (video block + particle scanline) ───────────────────────
let blockActive = 0, blockTimer = 0, blockSeed = 0;
let scanline = 0, scanlineTimer = 0, scanlineY = 0.5;

function maybeGlitch(dt, transientEff) {
  // Video block glitch — bass & transient raise its rate
  if (blockTimer > 0) {
    blockTimer -= dt;
    if (blockTimer <= 0) { blockActive = 0; blockTimer = 0; }
  } else {
    const bassMul = 1 + audioBass * audioEase * (P.audio.bass.blockGlitchProbMultiplier - 1);
    const rate = P.BLOCK_GLITCH_RATE * bassMul + transientEff * 2.2;
    if (Math.random() < rate * dt) {
      blockActive = 1;
      blockTimer  = P.BLOCK_GLITCH_DUR;
      blockSeed   = Math.random() * 100;
    }
  }
  // Particle scanline alignment — treble raises its rate
  if (scanlineTimer > 0) {
    scanlineTimer -= dt;
    const k = Math.max(0, scanlineTimer / P.SCANLINE_DUR);
    scanline = Math.sin(k * Math.PI);          // ease in then out
    if (scanlineTimer <= 0) { scanline = 0; scanlineTimer = 0; }
  } else {
    const highMul = 1 + audioHigh * audioEase * (P.audio.high.scanlineFreqMultiplier - 1);
    if (Math.random() < P.SCANLINE_RATE * highMul * dt) {
      scanlineTimer = P.SCANLINE_DUR;
      scanlineY     = 0.25 + Math.random() * 0.5;
    }
  }
}

// ─── DOM refs ─────────────────────────────────────────────────────────────
const heroEl  = document.querySelector('.hero');
const videoEl = document.querySelector('.hero-video');

// ─── WEBGL ────────────────────────────────────────────────────────────────
let canvasEl, renderer, gl, program, mesh, videoTexture;
let particleMesh, particleProgram, particleGeo;
let videoUvTransform = [1, 1, 0, 0];
let dpr = 1;

const vidCanvas = document.createElement('canvas');
let   vidCtx    = null;

function computeVideoUV() {
  if (!videoEl || !canvasEl) return;
  const vw = videoEl.videoWidth  || 1920;
  const vh = videoEl.videoHeight || 1080;
  const cw = canvasEl.offsetWidth  || window.innerWidth;
  const ch = canvasEl.offsetHeight || window.innerHeight;
  const vAR = vw / vh, cAR = cw / ch;
  let sx = 1, sy = 1, ox = 0, oy = 0;
  if (vAR > cAR) { sx = cAR / vAR; ox = (1 - sx) * 0.5; }
  else           { sy = vAR / cAR; oy = (1 - sy) * 0.5; }
  videoUvTransform = [sx, sy, ox, oy];
  if (program)         program.uniforms.uVideoUV.value = videoUvTransform;
  if (particleProgram) particleProgram.uniforms.uVideoUV.value = videoUvTransform;
}

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function resize() {
  renderer?.setSize(window.innerWidth, window.innerHeight);
  computeVideoUV();
}

// ─── Init WebGL ───────────────────────────────────────────────────────────
function initWebGL() {
  try {
    canvasEl = document.createElement('canvas');
    canvasEl.id = 'heroShaderCanvas';
    canvasEl.style.cssText = [
      'position:absolute','top:0','left:0','width:100%','height:100%',
      'pointer-events:none','z-index:1',
    ].join(';');
    heroEl.insertBefore(canvasEl, heroEl.children[1] || null);

    dpr = Math.min(window.devicePixelRatio, 2);
    renderer = new Renderer({ canvas: canvasEl, alpha: false, antialias: false, dpr });
    gl = renderer.gl;
    renderer.autoClear = false;

    resize();
    window.addEventListener('resize', debounce(resize, 200));

    videoTexture = new Texture(gl, {
      generateMipmaps: false,
      wrapS: gl.CLAMP_TO_EDGE, wrapT: gl.CLAMP_TO_EDGE,
      minFilter: gl.LINEAR, magFilter: gl.LINEAR,
    });

    const geo = new Triangle(gl);
    program   = new Program(gl, {
      vertex: VERT, fragment: FRAG,
      uniforms: {
        tVideo:          { value: videoTexture },
        uTime:           { value: 0 },
        uActive:         { value: 0 },
        uVideoUV:        { value: [1, 1, 0, 0] },
        uShadowColor:    { value: P.SHADOW_COLOR },
        uHighlightColor: { value: P.HIGHLIGHT_COLOR },
        uDuotoneMix:     { value: P.DUOTONE_MIX },
        uDispBase:       { value: P.DISP_BASE },
        uFlareBase:      { value: P.FLARE_BASE },
        uFlareClamp:     { value: P.FLARE_CLAMP },
        uBlockGlitch:    { value: 0 },
        uBlockSeed:      { value: 0 },
        uBlockCount:     { value: P.BLOCK_GLITCH_COUNT },
        uBlockAmt:       { value: P.BLOCK_GLITCH_AMT },
        uVideoRgbSplit:  { value: P.VIDEO_RGB_BASE },
      },
    });
    mesh = new Mesh(gl, { geometry: geo, program });
    return true;
  } catch(e) {
    console.warn('[mikihoo-hero] WebGL failed, falling back to plain video', e);
    return false;
  }
}

// ─── Particle system ──────────────────────────────────────────────────────
let liveCount = 0;

function initParticles() {
  const N    = particleCount();
  const uvs  = new Float32Array(N * 2);
  const spds = new Float32Array(N);
  const rnd  = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    uvs[i*2]   = Math.random();
    uvs[i*2+1] = Math.random();
    spds[i]    = 0.4 + Math.random() * 0.8;
    rnd[i]     = Math.random();
  }
  particleGeo = new Geometry(gl, {
    aUV:    { size: 2, data: uvs },
    aSpeed: { size: 1, data: spds },
    aRand:  { size: 1, data: rnd },
  });
  liveCount = N;
  if (particleGeo.drawRange) particleGeo.drawRange.count = N;

  particleProgram = new Program(gl, {
    vertex: PART_VERT, fragment: PART_FRAG,
    uniforms: {
      tVideo:          { value: videoTexture },
      uTime:           { value: 0 },
      uActive:         { value: 0 },
      uMouse:          { value: [0.5, 0.5] },
      uMouseVel:       { value: 0 },
      uVideoUV:        { value: [1, 1, 0, 0] },
      uPointSize:      { value: P.PART_SIZE },
      uDpr:            { value: dpr },
      uDrift:          { value: REDUCED ? P.PART_DRIFT * 0.25 : P.PART_DRIFT },
      uRepel:          { value: P.PART_REPEL },
      uRepelR:         { value: P.PART_REPEL_R },
      uStreak:         { value: P.PART_STREAK },
      uGlitchFrac:     { value: REDUCED ? 0 : P.PART_GLITCH_FRAC },
      uGlitchAmp:      { value: P.PART_GLITCH_AMP },
      uPulseRate:      { value: P.PART_PULSE_RATE },
      uScatterAmt:     { value: 0 },
      uExcite:         { value: 0 },
      uJitterGain:     { value: P.audio.rms.particleJitterGain },
      uSpeedGain:      { value: P.audio.rms.particleSpeedGain },
      uBrightGain:     { value: P.audio.rms.particleBrightnessGain },
      uScanline:       { value: 0 },
      uScanlineY:      { value: 0.5 },
      uAlpha:          { value: P.PART_ALPHA },
      uShadowColor:    { value: P.SHADOW_COLOR },
      uHighlightColor: { value: P.HIGHLIGHT_COLOR },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  particleProgram.setBlendFunc(gl.SRC_ALPHA, gl.ONE);   // additive

  particleMesh = new Mesh(gl, { geometry: particleGeo, program: particleProgram,
                                 mode: gl.POINTS });
}

// ─── FPS monitor → reduce particle count if struggling ─────────────────────
let fpsAccum = 0, fpsFrames = 0, fpsReduced = false;
function monitorFPS(dt) {
  if (fpsReduced || !particleGeo) return;
  fpsAccum += dt; fpsFrames++;
  if (fpsAccum >= 2.0) {
    const fps = fpsFrames / fpsAccum;
    if (fps < 30 && liveCount > 4000) {
      liveCount = Math.floor(liveCount * 0.6);
      if (particleGeo.drawRange) particleGeo.drawRange.count = liveCount;
    } else {
      fpsReduced = true;
    }
    fpsAccum = 0; fpsFrames = 0;
  }
}

// ─── Render loop ──────────────────────────────────────────────────────────
let rafId = null, lastTs = null, elapsed = 0;

function tick(ts) {
  rafId = requestAnimationFrame(tick);
  const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : 0.016;
  lastTs   = ts;
  elapsed += dt;

  if (!REDUCED) activeEase = Math.min(1, activeEase + dt / P.ACTIVE_EASE_DUR);
  else          activeEase = 0.6;
  if (state === STATE.MIC && !REDUCED)
    audioEase = Math.min(1, audioEase + dt / P.audio.easeInDuration);

  updateAudio();
  const transientEff = transient * audioEase * P.audio.transient.glitchBurstGain;
  if (!REDUCED) maybeGlitch(dt, transientEff);
  monitorFPS(dt);

  smMouse.x  += (rawMouse.x - smMouse.x) * P.MOUSE_INERTIA;
  smMouse.y  += (rawMouse.y - smMouse.y) * P.MOUSE_INERTIA;
  mouseVelSm  = mouseVelSm * 0.84 + mouseVelRaw * 0.16;
  mouseVelRaw *= 0.78;
  const mvel  = Math.min(mouseVelSm * 50, 1);

  // Video frame upload via canvas bridge
  if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    if (vidCanvas.width !== vw || vidCanvas.height !== vh) {
      vidCanvas.width = vw; vidCanvas.height = vh;
      vidCtx = vidCanvas.getContext('2d');
      computeVideoUV();
    }
    vidCtx.drawImage(videoEl, 0, 0, vw, vh);
    videoTexture.image = vidCanvas;
    videoTexture.needsUpdate = true;
  }

  // ── Main shader uniforms ──────────────────────────────────────────────
  const u = program.uniforms;
  u.uTime.value         = elapsed;
  u.uActive.value       = activeEase;
  u.uBlockGlitch.value  = blockActive;
  u.uBlockSeed.value    = blockSeed;
  u.uVideoRgbSplit.value = P.VIDEO_RGB_BASE
                         + audioHigh * audioEase * P.audio.high.videoRgbSplitGain;
  u.uVideoUV.value      = videoUvTransform;
  renderer.render({ scene: mesh });

  // ── Particle uniforms ─────────────────────────────────────────────────
  if (particleMesh) {
    const pu = particleProgram.uniforms;
    const baseFrac = REDUCED ? 0 : P.PART_GLITCH_FRAC;
    let frac = baseFrac + audioHigh * audioEase * (P.audio.high.particleRgbSplitRatio - baseFrac);
    frac = Math.min(0.6, frac + transientEff * 0.3);          // transient burst

    pu.uTime.value      = elapsed;
    pu.uActive.value    = activeEase;
    pu.uMouse.value     = [smMouse.x, smMouse.y];
    pu.uMouseVel.value  = mvel;
    pu.uExcite.value    = audioLevel * audioEase;
    pu.uScatterAmt.value = audioBass * audioEase * P.audio.bass.scatterGain * 0.05
                         + transientEff * 0.04;
    pu.uGlitchFrac.value = frac;
    pu.uScanline.value  = scanline;
    pu.uScanlineY.value = scanlineY;
    pu.uVideoUV.value   = videoUvTransform;
    renderer.render({ scene: particleMesh });
  }
}

// ─── Visibility: pause when tab hidden ───────────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelAnimationFrame(rafId);
    rafId = null;
    videoEl?.pause();
  } else if (!rafId) {
    lastTs = null;
    rafId  = requestAnimationFrame(tick);
    videoEl?.play().catch(() => {});
  }
});

// ─── Cleanup ──────────────────────────────────────────────────────────────
window.addEventListener('beforeunload', () => {
  cancelAnimationFrame(rafId);
  audioStream?.getTracks().forEach(t => t.stop());
});

// ─── Entry point ─────────────────────────────────────────────────────────
function init() {
  if (!initWebGL()) return;

  videoEl.style.opacity = '0';
  videoEl.play().catch(e => console.warn('[mikihoo-hero] video play failed', e));

  if (P.PARTICLES) {
    try { initParticles(); }
    catch(e) { console.warn('[mikihoo-hero] particles failed', e); }
  }

  rafId = requestAnimationFrame(tick);

  videoEl.addEventListener('loadedmetadata', computeVideoUV, { once: true });
  if (videoEl.videoWidth) computeVideoUV();

  // Whole hero area silently requests mic
  heroEl.addEventListener('click', () => { initAudio(); });
  heroEl.addEventListener('touchend', () => { initAudio(); }, { passive: true });
}

init();
