import { clamp } from '../core/math';
import type { Car } from '../vehicle/car';
import { WHEEL_NAMES } from '../vehicle/car';

/**
 * One 2D plot per wheel showing current lateral and longitudinal demand
 * against the available grip boundary. This is the clearest window into
 * combined slip there is, and it is the tool that will get used most.
 */
export class FrictionCircles {
  readonly element: HTMLDivElement;
  visible = true;

  private canvases: HTMLCanvasElement[] = [];
  private size = 104;

  constructor() {
    this.element = document.createElement('div');
    this.element.style.cssText = [
      'position:fixed',
      'left:8px',
      'bottom:8px',
      'display:grid',
      'grid-template-columns:repeat(2,auto)',
      'gap:6px',
      'pointer-events:none',
      'z-index:5',
    ].join(';');

    for (let i = 0; i < 4; i += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = this.size;
      canvas.height = this.size;
      canvas.style.cssText = 'background:rgba(12,16,20,0.65);border-radius:4px';
      this.element.appendChild(canvas);
      this.canvases.push(canvas);
    }
    document.body.appendChild(this.element);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.element.style.display = this.visible ? 'grid' : 'none';
  }

  update(car: Car): void {
    if (!this.visible) return;
    const half = this.size / 2;
    const radius = half - 12;

    car.wheels.forEach((wheel, i) => {
      const ctx = this.canvases[i].getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, this.size, this.size);

      // Grip boundary.
      ctx.strokeStyle = 'rgba(150,170,190,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(half, half, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(150,170,190,0.2)';
      ctx.beginPath();
      ctx.moveTo(half - radius, half);
      ctx.lineTo(half + radius, half);
      ctx.moveTo(half, half - radius);
      ctx.lineTo(half, half + radius);
      ctx.stroke();

      // Demand as a fraction of available grip: the boundary circle is
      // exactly 100%, so a dot outside it is a tyre asking for more than it
      // has. Lateral is plotted on X, longitudinal on Y.
      const nx = clamp(wheel.demandLat, -1.4, 1.4);
      const ny = clamp(wheel.demandLong, -1.4, 1.4);

      const saturated = wheel.utilisation >= 1;
      ctx.fillStyle = saturated ? '#e2604a' : wheel.utilisation > 0.8 ? '#e5b13c' : '#5fc27e';
      ctx.beginPath();
      ctx.arc(half + nx * radius, half - ny * radius, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(214,221,228,0.85)';
      ctx.font = '10px ui-monospace,monospace';
      ctx.fillText(WHEEL_NAMES[i], 5, 12);
      ctx.fillText(`${(wheel.utilisation * 100).toFixed(0)}%`, 5, this.size - 5);
      if (!wheel.grounded) {
        ctx.fillStyle = 'rgba(226,96,74,0.9)';
        ctx.fillText('AIR', this.size - 28, 12);
      }
    });
  }
}
