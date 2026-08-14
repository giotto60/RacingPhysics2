import type { Car } from '../vehicle/car';

/**
 * The only always-on readout: speed, gear and revs. Everything else that used
 * to live on screen is a diagnostic and now hides behind the panel toggles.
 */
export class Speedo {
  readonly element: HTMLDivElement;

  private valueEl: HTMLDivElement;
  private gearEl: HTMLDivElement;
  private revBar: HTMLDivElement;

  constructor() {
    this.element = document.createElement('div');
    this.element.style.cssText = [
      'position:fixed',
      'left:16px',
      'bottom:16px',
      'padding:10px 16px 12px',
      'background:rgba(10,13,17,0.62)',
      'border:1px solid rgba(190,205,220,0.22)',
      'border-radius:10px',
      'color:#e6ecf2',
      'font:12px ui-monospace,SFMono-Regular,Menlo,monospace',
      'pointer-events:none',
      'z-index:6',
      'min-width:150px',
    ].join(';');

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:baseline;gap:8px';

    this.valueEl = document.createElement('div');
    this.valueEl.style.cssText =
      'font-size:38px;line-height:1;font-weight:600;letter-spacing:-1px;min-width:78px;text-align:right';
    this.valueEl.textContent = '0';

    const unit = document.createElement('div');
    unit.style.cssText = 'font-size:12px;opacity:0.62';
    unit.textContent = 'km/h';

    this.gearEl = document.createElement('div');
    this.gearEl.style.cssText =
      'margin-left:auto;font-size:20px;font-weight:600;opacity:0.9;min-width:22px;text-align:center';
    this.gearEl.textContent = '1';

    row.append(this.valueEl, unit, this.gearEl);

    const track = document.createElement('div');
    track.style.cssText =
      'margin-top:8px;height:4px;border-radius:2px;background:rgba(190,205,220,0.18);overflow:hidden';
    this.revBar = document.createElement('div');
    this.revBar.style.cssText = 'height:100%;width:0%;background:#5fc27e';
    track.appendChild(this.revBar);

    this.element.append(row, track);
    document.body.appendChild(this.element);
  }

  update(car: Car, limiterRPM: number): void {
    const kmh = Math.abs(car.forwardSpeed) * 3.6;
    this.valueEl.textContent = kmh.toFixed(0);
    this.gearEl.textContent = car.drivetrain.gear < 0 ? 'R' : String(car.drivetrain.gear);

    const fraction = Math.max(0, Math.min(1, car.drivetrain.rpm / Math.max(1, limiterRPM)));
    this.revBar.style.width = `${(fraction * 100).toFixed(0)}%`;
    this.revBar.style.background = fraction > 0.92 ? '#e2604a' : fraction > 0.78 ? '#e5b13c' : '#5fc27e';
  }
}
