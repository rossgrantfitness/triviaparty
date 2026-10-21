// The drawing pad for Doodle Duel, and a renderer for showing drawings.
// Coordinates are stored 0..1000 on a square canvas, so drawings look the same on every screen.

import { MAX_STROKES, PEN_COLORS, PEN_WIDTHS, type Stroke } from "@trivia/shared";

const CANVAS_UNITS = 1000;
/** Skip points closer than this to the previous one (in canvas units) to keep drawings small. */
const MIN_POINT_GAP = 4;
const MAX_POINTS_PER_STROKE = 1999;

/** Draw strokes onto a 2D context that covers `size` pixels. */
export function renderStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], size: number): void {
  const scale = size / CANVAS_UNITS;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of strokes) {
    ctx.strokeStyle = PEN_COLORS[stroke.c] ?? PEN_COLORS[0];
    ctx.lineWidth = (PEN_WIDTHS[stroke.w] ?? PEN_WIDTHS[1]) * scale;
    ctx.beginPath();
    const p = stroke.p;
    ctx.moveTo(p[0]! * scale, p[1]! * scale);
    if (p.length === 2) ctx.lineTo(p[0]! * scale + 0.01, p[1]! * scale);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i]! * scale, p[i + 1]! * scale);
    ctx.stroke();
  }
}

/** A canvas element that shows a finished drawing at a given size (CSS pixels). */
export function drawingImage(strokes: Stroke[], cssSize: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const ratio = window.devicePixelRatio || 1;
  canvas.width = canvas.height = Math.round(cssSize * ratio);
  canvas.style.width = canvas.style.height = `${cssSize}px`;
  canvas.className = "drawing-view";
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  renderStrokes(ctx, strokes, canvas.width);
  return canvas;
}

/** Touch/mouse drawing on a square canvas. */
export class DrawingPad {
  strokes: Stroke[] = [];
  color = 0;
  width = 1;
  private current: Stroke | null = null;
  private ctx: CanvasRenderingContext2D;
  private pixels = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly onChange: () => void = () => {},
    private readonly maxStrokes: number = MAX_STROKES,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    canvas.addEventListener("pointerup", () => this.up());
    canvas.addEventListener("pointercancel", () => this.up());
    canvas.addEventListener("pointerleave", () => this.up());
    // Stop the page from scrolling or zooming while drawing.
    canvas.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    canvas.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  }

  /** Match the canvas's pixel size to how big it is on screen. */
  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    this.pixels = Math.max(1, Math.round(rect.width * ratio));
    this.canvas.width = this.canvas.height = this.pixels;
    this.redraw();
  }

  undo(): void {
    this.strokes.pop();
    this.redraw();
    this.onChange();
  }

  clear(): void {
    this.strokes = [];
    this.redraw();
    this.onChange();
  }

  get isFull(): boolean {
    return this.strokes.length >= this.maxStrokes;
  }

  private toUnits(e: PointerEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * CANVAS_UNITS;
    const y = ((e.clientY - rect.top) / rect.height) * CANVAS_UNITS;
    return [Math.round(Math.min(CANVAS_UNITS, Math.max(0, x))), Math.round(Math.min(CANVAS_UNITS, Math.max(0, y)))];
  }

  private down(e: PointerEvent): void {
    if (this.isFull) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    const [x, y] = this.toUnits(e);
    this.current = { c: this.color, w: this.width, p: [x, y] };
    this.strokes.push(this.current);
    this.redraw();
  }

  private move(e: PointerEvent): void {
    if (!this.current) return;
    const p = this.current.p;
    if (p.length >= MAX_POINTS_PER_STROKE * 2) {
      // Very long line: start a new stroke from here so nothing is lost.
      const lastX = p[p.length - 2]!;
      const lastY = p[p.length - 1]!;
      if (this.isFull) return this.up();
      this.current = { c: this.color, w: this.width, p: [lastX, lastY] };
      this.strokes.push(this.current);
    }
    const [x, y] = this.toUnits(e);
    const q = this.current.p;
    if (Math.hypot(x - q[q.length - 2]!, y - q[q.length - 1]!) < MIN_POINT_GAP) return;
    q.push(x, y);
    this.redraw();
  }

  private up(): void {
    if (!this.current) return;
    this.current = null;
    this.onChange();
  }

  private redraw(): void {
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(0, 0, this.pixels, this.pixels);
    renderStrokes(this.ctx, this.strokes, this.pixels);
  }
}
