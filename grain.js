(function () {
  // ── Canvas grain ──
  const canvas = document.createElement('canvas');
  canvas.style.cssText = [
    'position:fixed', 'top:0', 'left:0',
    'width:100%', 'height:100%',
    'pointer-events:none',
    'z-index:50',
    'opacity:0'
  ].join(';');
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const TILE = 200;
  const offscreen = document.createElement('canvas');
  offscreen.width = offscreen.height = TILE;
  const octx = offscreen.getContext('2d');

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();

  function drawNoise() {
    const id = octx.createImageData(TILE, TILE);
    const d  = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() * 255 | 0;
      d[i] = d[i+1] = d[i+2] = v;
      d[i+3] = 255;
    }
    octx.putImageData(id, 0, 0);
  }

  // ── Opacity state ──
  const isMobile   = window.innerWidth <= 768;
  const BASE       = isMobile ? 0.009 : 0.018;
  const SCROLL_MAX = isMobile ? 0.015 : 0.03;
  let displayOpacity = 0;
  let scrollTarget   = BASE;
  let fadeStart      = null;
  const FADE_MS      = 2000;

  function easeIn(t) { return t * t; }

  // ── Scroll handler (window + weather col elements) ──
  let scrollTimer = null;
  function onScroll() {
    const maxScroll = Math.max(1, document.body.scrollHeight - window.innerHeight);
    const frac = maxScroll > 10
      ? Math.min(window.scrollY / maxScroll, 1)
      : 0.5; // 컬럼 내부 스크롤 시 중간값 사용
    scrollTarget = BASE + frac * (SCROLL_MAX - BASE);
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => { scrollTarget = BASE; }, 150);
  }

  function onColScroll() {
    scrollTarget = SCROLL_MAX;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => { scrollTarget = BASE; }, 150);
  }

  window.addEventListener('scroll',    onScroll, { passive: true });
  window.addEventListener('touchmove', onScroll, { passive: true });

  // weather 페이지 컬럼 스크롤 연동
  window.addEventListener('load', () => {
    const cols = document.querySelectorAll('.weather-col-left, .weather-col-right');
    cols.forEach(el => el.addEventListener('scroll', onColScroll, { passive: true }));
  });

  // ── RAF loop ──
  let frame = 0;
  function tick(ts) {
    requestAnimationFrame(tick);

    if (fadeStart === null) fadeStart = ts;
    const t = Math.min((ts - fadeStart) / FADE_MS, 1);
    const fadeFactor = easeIn(t);

    displayOpacity += (scrollTarget - displayOpacity) * 0.012;
    canvas.style.opacity = fadeFactor * displayOpacity;

    frame++;
    if (frame % 2 === 0) {
      drawNoise();
      const pattern = ctx.createPattern(offscreen, 'repeat');
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }
  requestAnimationFrame(tick);

  // ── Click / touch ripple ──
  function ripple(x, y) {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed',
      `left:${x - 15}px`,   // 30px 원 (절반)
      `top:${y - 15}px`,
      'width:30px',
      'height:30px',
      'border-radius:50%',
      'background:rgba(168,168,158,0.15)',
      'pointer-events:none',
      'z-index:49',
      'transform:scale(0)',
      'opacity:1',
      'transition:transform 1.5s cubic-bezier(0.2,0,0.4,1),opacity 1.5s ease-out'
    ].join(';');
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      el.style.transform = 'scale(3)';
      el.style.opacity   = '0';
    });
    setTimeout(() => el.remove(), 1600);
  }

  document.addEventListener('click', e => {
    if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
    ripple(e.clientX, e.clientY);
  });
  document.addEventListener('touchstart', e => {
    for (const t of e.touches) ripple(t.clientX, t.clientY);
  }, { passive: true });

  // 모바일에서 관리 버튼 강제 숨김
  if (window.innerWidth <= 768 || 'ontouchstart' in window) {
    document.querySelectorAll('.footer-admin').forEach(el => el.style.display = 'none');
  }
})();
