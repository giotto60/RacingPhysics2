import * as THREE from 'three';

/**
 * Corner map.
 *
 * An isometric camera that stays close enough to read the car gives away all
 * sense of where that car is on the circuit, so the map exists to answer one
 * question -- which part of the lap is this -- and nothing else.
 */
export class MiniMap {
  readonly element: HTMLCanvasElement;
  visible = true;

  private ctx: CanvasRenderingContext2D;
  private size = 176;
  private minX = 0;
  private minZ = 0;
  private scale = 1;
  private start: { x: number; y: number; angle: number } = { x: 0, y: 0, angle: 0 };
  private path: Array<{ x: number; y: number }> = [];

  constructor(centreline: THREE.Vector3[]) {
    this.element = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.element.width = this.size * dpr;
    this.element.height = this.size * dpr;
    this.element.style.cssText = [
      'position:fixed',
      'left:16px',
      'top:16px',
      `width:${this.size}px`,
      `height:${this.size}px`,
      'background:rgba(10,13,17,0.86)',
      'border:1px solid rgba(190,205,220,0.22)',
      'border-radius:10px',
      'pointer-events:none',
      'z-index:6',
    ].join(';');
    document.body.appendChild(this.element);

    const ctx = this.element.getContext('2d')!;
    ctx.scale(dpr, dpr);
    this.ctx = ctx;

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of centreline) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const pad = 14;
    const span = Math.max(maxX - minX, maxZ - minZ) || 1;
    this.scale = (this.size - pad * 2) / span;
    this.minX = (minX + maxX) / 2 - span / 2;
    this.minZ = (minZ + maxZ) / 2 - span / 2;

    const step = Math.max(1, Math.floor(centreline.length / 240));
    for (let i = 0; i < centreline.length; i += step) {
      this.path.push(this.project(centreline[i]));
    }

    const here = centreline[0];
    const next = centreline[6 % centreline.length];
    const a = this.project(here);
    const b = this.project(next);
    this.start = { x: a.x, y: a.y, angle: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  toggle(): void {
    this.visible = !this.visible;
    this.element.style.display = this.visible ? 'block' : 'none';
  }

  private project(p: THREE.Vector3): { x: number; y: number } {
    const pad = 14;
    return {
      x: pad + (p.x - this.minX) * this.scale,
      y: pad + (p.z - this.minZ) * this.scale,
    };
  }

  update(position: THREE.Vector3, heading: number): void {
    if (!this.visible) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.size, this.size);

    // The circuit.
    ctx.strokeStyle = 'rgba(120,132,145,0.85)';
    ctx.lineWidth = 4.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    this.path.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(196,206,216,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Start line, drawn across the road.
    ctx.save();
    ctx.translate(this.start.x, this.start.y);
    ctx.rotate(this.start.angle);
    ctx.fillStyle = '#eef2f6';
    ctx.fillRect(-1.5, -5, 3, 10);
    ctx.restore();

    // The car, clamped to the edge if it has wandered off the circuit.
    const p = this.project(position);
    const edge = 6;
    const x = Math.max(edge, Math.min(this.size - edge, p.x));
    const y = Math.max(edge, Math.min(this.size - edge, p.y));
    const offMap = x !== p.x || y !== p.y;

    ctx.save();
    ctx.translate(x, y);
    // Forward is local -Z, so the world heading maps to this screen angle.
    ctx.rotate(Math.atan2(-Math.cos(heading), -Math.sin(heading)));
    ctx.fillStyle = offMap ? '#e5b13c' : '#e2604a';
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-4.5, 4);
    ctx.lineTo(-4.5, -4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
