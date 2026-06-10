(function () {
  if (sessionStorage.getItem('intro_done')) return;
  sessionStorage.setItem('intro_done', '1');

  // ── Overlay ──
  const overlay = document.createElement('div');
  overlay.id = 'intro-overlay';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:999',
    'background:#0f0f0f', 'display:flex',
    'align-items:center', 'justify-content:center'
  ].join(';');
  document.body.appendChild(overlay);

  // Block page scroll during intro
  document.body.style.overflow = 'hidden';

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
  overlay.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();

  const isMobile  = window.innerWidth <= 768;
  const fontSize  = Math.round(window.innerWidth * (isMobile ? 0.12 : 0.06));
  const TEXT      = '微氣候';
  const TEXT_COLOR = '#e8e4dc';

  // ── Phase timing (ms) ──
  const T_FADEIN  = 300;   // fade in text
  const T_HOLD    = 500;   // hold
  const T_SCATTER = 700;   // scatter + dissolve
  const T_TOTAL   = T_FADEIN + T_HOLD + T_SCATTER;

  // ── Sample text pixels → particles ──
  function sampleParticles() {
    // Render text to offscreen canvas for pixel sampling
    const off = document.createElement('canvas');
    const pad = fontSize * 0.6;
    off.width  = canvas.width;
    off.height = canvas.height;
    const octx = off.getContext('2d');
    octx.font = `400 ${fontSize}px 'EB Garamond', serif`;
    octx.fillStyle = '#ffffff';
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    octx.fillText(TEXT, off.width / 2, off.height / 2);

    const data = octx.getImageData(0, 0, off.width, off.height).data;
    const pts  = [];
    const step = 3; // sample every N pixels for density control

    for (let y = 0; y < off.height; y += step) {
      for (let x = 0; x < off.width; x += step) {
        const i = (y * off.width + x) * 4;
        if (data[i + 3] > 128) pts.push({ x, y });
      }
    }

    // Limit to 800
    if (pts.length > 800) {
      const skip = pts.length / 800;
      const sampled = [];
      for (let i = 0; i < pts.length; i += skip) sampled.push(pts[Math.floor(i)]);
      return sampled;
    }
    return pts;
  }

  let particles = null;

  function initParticles() {
    const pts = sampleParticles();
    particles = pts.map(p => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3.5;
      const grey  = Math.random() > 0.5 ? 232 : 168; // #e8e4dc vs #a8a89e
      return {
        x: p.x, y: p.y,
        ox: p.x, oy: p.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 1 + Math.random(),
        color: `rgb(${grey},${grey - 4},${grey - 12})`,
      };
    });
  }

  // ── Grain helper ──
  let grainAlpha = 0;
  function drawGrain(alpha) {
    if (alpha <= 0) return;
    const tileSize = 120;
    const offG = document.createElement('canvas');
    offG.width = offG.height = tileSize;
    const gctx = offG.getContext('2d');
    const id = gctx.createImageData(tileSize, tileSize);
    const d  = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() * 255 | 0;
      d[i] = d[i+1] = d[i+2] = v;
      d[i+3] = 255;
    }
    gctx.putImageData(id, 0, 0);
    const pat = ctx.createPattern(offG, 'repeat');
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  // ── RAF loop ──
  let startTime = null;

  function tick(ts) {
    if (!startTime) startTime = ts;
    const elapsed = ts - startTime;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0f0f0f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (elapsed < T_FADEIN) {
      // Phase 1: fade in text
      const t = elapsed / T_FADEIN;
      ctx.globalAlpha = t * t; // ease-in
      ctx.font = `400 ${fontSize}px 'EB Garamond', serif`;
      ctx.fillStyle = TEXT_COLOR;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(TEXT, canvas.width / 2, canvas.height / 2);
      ctx.globalAlpha = 1;
      requestAnimationFrame(tick);

    } else if (elapsed < T_FADEIN + T_HOLD) {
      // Phase 2: hold
      ctx.globalAlpha = 1;
      ctx.font = `400 ${fontSize}px 'EB Garamond', serif`;
      ctx.fillStyle = TEXT_COLOR;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(TEXT, canvas.width / 2, canvas.height / 2);
      ctx.globalAlpha = 1;

      // Init particles at hold start
      if (!particles) initParticles();
      requestAnimationFrame(tick);

    } else if (elapsed < T_TOTAL) {
      // Phase 3: scatter
      const t = (elapsed - T_FADEIN - T_HOLD) / T_SCATTER;
      const ease = t * t; // ease-in scatter

      // Grain peaks at 0.4, then fades
      grainAlpha = t < 0.4
        ? (t / 0.4) * 0.18
        : ((1 - t) / 0.6) * 0.18;
      drawGrain(grainAlpha);

      if (particles) {
        particles.forEach(p => {
          p.x = p.ox + p.vx * ease * fontSize * 0.8;
          p.y = p.oy + p.vy * ease * fontSize * 0.8;
          ctx.globalAlpha = Math.max(0, 1 - ease * 1.4);
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x, p.y, p.size, p.size);
        });
        ctx.globalAlpha = 1;
      }
      requestAnimationFrame(tick);

    } else {
      // Done — fade out overlay, fade in page content
      overlay.style.transition = 'opacity 0.3s ease';
      overlay.style.opacity = '0';
      document.body.style.overflow = '';

      // Fade in page
      const pageContent = document.getElementById('pageContent');
      if (pageContent) {
        pageContent.style.transition = 'opacity 0.3s ease';
        pageContent.style.opacity = '1';
      }

      setTimeout(() => {
        overlay.style.display = 'none';
      }, 320);
    }
  }

  // Wait for font to load before starting
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => requestAnimationFrame(tick));
  } else {
    requestAnimationFrame(tick);
  }
})();
