import { RAD } from '../core/math';
import type { Car } from '../vehicle/car';
import { WHEEL_NAMES } from '../vehicle/car';

/**
 * Live telemetry overlay. Every number here is read straight out of the
 * simulation, including the commanded-versus-actual steering gap that makes
 * understeer legible as a number as well as a picture.
 */
export class TelemetryOverlay {
  readonly element: HTMLDivElement;
  visible = true;

  constructor() {
    this.element = document.createElement('div');
    this.element.id = 'telemetry';
    this.element.style.cssText = [
      'position:fixed',
      'left:8px',
      'top:8px',
      'color:#d6dde4',
      'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
      'white-space:pre',
      'pointer-events:none',
      'text-shadow:0 1px 2px #000',
      'z-index:5',
    ].join(';');
    document.body.appendChild(this.element);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.element.style.display = this.visible ? 'block' : 'none';
  }

  update(car: Car, fps: number, stepsLastFrame: number, dynamicBodies: number): void {
    if (!this.visible) return;
    const d = car.drivetrain;
    const s = car.steering;
    const kmh = car.forwardSpeed * 3.6;

    const rows = [
      `fps ${fps.toFixed(0)}   steps/frame ${stepsLastFrame}   bodies ${dynamicBodies}`,
      `speed   ${kmh.toFixed(1)} km/h   (${car.forwardSpeed.toFixed(1)} m/s)`,
      `rpm     ${d.rpm.toFixed(0)}   gear ${d.gear < 0 ? 'R' : d.gear}`,
      `steer   cmd ${(s.commanded * RAD).toFixed(1)}deg  act ${(s.actual * RAD).toFixed(1)}deg  assist ${(s.assist * RAD).toFixed(1)}deg`,
      `body slip ${(car.bodySlip * RAD).toFixed(1)}deg   wheels down ${car.groundedCount}/4`,
      '',
      'wheel  slipA   slipR    load     surf     grip%',
    ];

    car.wheels.forEach((w, i) => {
      rows.push(
        `${WHEEL_NAMES[i].padEnd(6)} ` +
          `${(w.slipAngle * RAD).toFixed(1).padStart(6)} ` +
          `${w.slipRatio.toFixed(2).padStart(7)} ` +
          `${w.load.toFixed(0).padStart(7)}N ` +
          `${w.surface.padEnd(8)} ` +
          `${(w.utilisation * 100).toFixed(0).padStart(4)}%`,
      );
    });

    this.element.textContent = rows.join('\n');
  }
}
