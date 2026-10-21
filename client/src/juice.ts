// Little bits of game feel for the phone: confetti, shakes, count-ups, stamps.

const CONFETTI_COLORS = ["#f47a1f", "#ffc53d", "#de4a3b", "#5b7486", "#1e1f22", "#ffffff"];

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** A burst of confetti from a point on screen (defaults to the middle). */
export function confetti(count = 36, x = window.innerWidth / 2, y = window.innerHeight * 0.4): void {
  if (reducedMotion()) return;
  for (let i = 0; i < count; i++) {
    const bit = document.createElement("span");
    bit.className = "confetti";
    bit.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length]!;
    bit.style.left = `${x}px`;
    bit.style.top = `${y}px`;
    const angle = Math.random() * Math.PI * 2;
    const speed = 120 + Math.random() * 220;
    bit.style.setProperty("--dx", `${Math.cos(angle) * speed}px`);
    bit.style.setProperty("--dy", `${Math.sin(angle) * speed - 140}px`);
    bit.style.setProperty("--spin", `${Math.random() * 720 - 360}deg`);
    document.body.append(bit);
    window.setTimeout(() => bit.remove(), 1300);
  }
}

/** Shake an element (wrong answer, got robbed). */
export function shake(el: HTMLElement): void {
  if (reducedMotion()) return;
  el.classList.remove("shake");
  void el.offsetWidth; // restart the animation
  el.classList.add("shake");
}

/** Count a number up inside an element, e.g. "+0" to "+1,375". */
export function countUp(el: HTMLElement, to: number, format: (n: number) => string, ms = 700): void {
  if (reducedMotion() || to === 0) {
    el.textContent = format(to);
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = format(Math.round(to * eased));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** A big stamp across the screen ("YOINK!", "BULLSEYE!"). */
export function stamp(text: string, color = "#de4a3b"): void {
  if (reducedMotion()) return;
  const el = document.createElement("div");
  el.className = "stamp";
  el.textContent = text;
  el.style.color = color;
  document.body.append(el);
  window.setTimeout(() => el.remove(), 1200);
}
