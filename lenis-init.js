// Lenis smooth scroll — desktop only
if (window.innerWidth > 768 && typeof Lenis !== 'undefined') {
  const lenis = new Lenis({
    lerp: 0.12,
    smoothWheel: true,
    smoothTouch: false,
  });

  function raf(time) {
    lenis.raf(time);
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);

  window.lenis = lenis;
}
