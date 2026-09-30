// anim.js 的 ESM 版：React Bits 效果的纯静态复刻（无依赖）。
// 逻辑逐行照搬，只改导出形态；countUp 仍以 DOM 节点为参数，
// 因为它要在元素上写 dataset.shown 作为下次动画的起点。

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Count-Up：数字缓动计数；from/to 为数值
export function countUp(el, to, dur) {
  if (!el) return;
  to = Number(to) || 0;
  const from = Number(el.dataset.shown || 0);
  el.textContent = from;
  const done = () => { el.textContent = to; el.dataset.shown = to; };
  if (reduced() || from === to) { done(); return; }
  const t0 = performance.now();
  const ms = dur || 700;
  setTimeout(done, ms + 120); // 后台标签页 rAF 冻结时的兜底
  function frame(now) {
    const p = Math.min((now - t0) / ms, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(frame);
    else done();
  }
  requestAnimationFrame(frame);
}

// Scroll reveal：进入视口播放一次
const io = ('IntersectionObserver' in window) && !reduced()
  ? new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting) { en.target.classList.add('revealed'); io.unobserve(en.target); }
      }
    }, { threshold: 0.12 })
  : null;

export function reveal(el) {
  if (!el) return;
  if (!io) { el.classList.add('revealed'); return; }
  el.classList.add('reveal');
  io.observe(el);
}

// Magnetic：鼠标靠近按钮时轻微吸附
export function magnetic(el) {
  if (!el || el.dataset.magnetized || reduced()) return;
  el.dataset.magnetized = '1';
  el.classList.add('magnetic');
  el.addEventListener('mousemove', (e) => {
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - r.left - r.width / 2) / r.width;
    const dy = (e.clientY - r.top - r.height / 2) / r.height;
    el.style.transform = `translate(${dx * 5}px, ${dy * 4}px)`;
  });
  el.addEventListener('mouseleave', () => { el.style.transform = ''; });
}
