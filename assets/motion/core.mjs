const OFF = Object.freeze({ disconnect() {} });

export function initMotionCore({ documentRoot, windowObject, reduced }) {
  const { gsap, ScrollTrigger, Lenis } = windowObject ?? {};
  if (reduced || !gsap || !ScrollTrigger || typeof Lenis !== 'function') {
    documentRoot.dataset.smooth = 'off';
    return OFF;
  }
  gsap.registerPlugin(ScrollTrigger);
  const lenis = new Lenis({ autoRaf: false, lerp: 0.1, anchors: { duration: 0.9 } });
  lenis.on('scroll', ScrollTrigger.update);
  const tick = (seconds) => lenis.raf(seconds * 1000);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);
  documentRoot.dataset.smooth = 'on';
  return {
    disconnect() {
      gsap.ticker.remove(tick);
      lenis.destroy();
      documentRoot.dataset.smooth = 'off';
    }
  };
}
