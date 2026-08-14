import { clamp, signedPow } from './math';
import type { Params } from './params';

/**
 * Keyboard and gamepad input. Produces analogue-style axes only -- the
 * steering actuator in the vehicle turns `steer` into an actual rack angle,
 * so nothing here ever writes a wheel angle directly.
 */
export interface InputState {
  throttle: number;
  brake: number;
  /** Raw steering demand, -1 (right) .. +1 (left). */
  steer: number;
  reverse: boolean;
  /** Held camera rotation demand, -1 .. +1. */
  cameraRotate: number;
  gamepadConnected: boolean;
}

export type ActionName =
  | 'respawn'
  | 'reset'
  | 'resetProps'
  | 'pause'
  | 'singleStep'
  | 'toggleTelemetry'
  | 'toggleDebugDraw'
  | 'toggleCameraMode'
  | 'slowMotion';

export class Input {
  readonly state: InputState = {
    throttle: 0,
    brake: 0,
    steer: 0,
    reverse: false,
    cameraRotate: 0,
    gamepadConnected: false,
  };

  /** Raised on the first real interaction, so audio can start. */
  onFirstGesture: (() => void) | null = null;
  onAction: ((action: ActionName) => void) | null = null;

  private keys = new Set<string>();
  private gestureFired = false;
  private steerSmoothed = 0;
  /** True once the brake has been held at a standstill long enough to back up. */
  private reverseLatch = false;
  private reverseHold = 0;

  constructor(private params: Params) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('pointerdown', this.fireGesture);
    window.addEventListener('gamepadconnected', () => {
      this.state.gamepadConnected = true;
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.state.gamepadConnected = false;
    });
  }

  private fireGesture = (): void => {
    if (this.gestureFired) return;
    this.gestureFired = true;
    this.onFirstGesture?.();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement) return;
    this.fireGesture();
    this.keys.add(e.code);
    switch (e.code) {
      case 'KeyR':
        this.onAction?.(e.shiftKey ? 'reset' : 'respawn');
        break;
      case 'KeyP':
        this.onAction?.('resetProps');
        break;
      case 'Space':
        this.onAction?.('pause');
        e.preventDefault();
        break;
      case 'Period':
        this.onAction?.('singleStep');
        break;
      case 'KeyT':
        this.onAction?.('toggleTelemetry');
        break;
      case 'KeyG':
        this.onAction?.('toggleDebugDraw');
        break;
      case 'KeyC':
        this.onAction?.('toggleCameraMode');
        break;
      case 'KeyM':
        this.onAction?.('slowMotion');
        break;
      default:
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private axisFromKeys(negative: string[], positive: string[]): number {
    let v = 0;
    if (negative.some((k) => this.keys.has(k))) v -= 1;
    if (positive.some((k) => this.keys.has(k))) v += 1;
    return v;
  }

  /** Apply deadzone then the response curve. */
  private shape(raw: number): number {
    const dz = this.params.steering.deadzone;
    const a = Math.abs(raw);
    if (a <= dz) return 0;
    const scaled = ((a - dz) / (1 - dz)) * Math.sign(raw);
    return signedPow(scaled, this.params.steering.inputCurve);
  }

  update(dt: number, forwardSpeed = 0): void {
    const pads = navigator.getGamepads?.() ?? [];
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p && p.connected) {
        pad = p;
        break;
      }
    }
    this.state.gamepadConnected = pad !== null;

    let throttle = 0;
    let brake = 0;
    let steerRaw = 0;

    if (pad) {
      steerRaw = -(pad.axes[0] ?? 0);
      throttle = pad.buttons[7]?.value ?? 0;
      brake = pad.buttons[6]?.value ?? 0;
      if (pad.buttons[0]?.pressed) throttle = Math.max(throttle, 1);
      if (pad.buttons[1]?.pressed) brake = Math.max(brake, 1);
      this.fireGesture();
    }

    const keySteer = this.axisFromKeys(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']);
    const keyThrottle = this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0;
    const keyBrake = this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0;

    // Keyboard steering is ramped so a digital key still produces an analogue
    // demand; the rack actuator then adds its own weight on top.
    const target = keySteer !== 0 ? keySteer : 0;
    const ramp = keySteer !== 0 ? 4.5 : 9.0;
    this.steerSmoothed += (target - this.steerSmoothed) * Math.min(1, ramp * dt);
    if (Math.abs(this.steerSmoothed) < 1e-4) this.steerSmoothed = 0;

    steerRaw = Math.abs(steerRaw) > Math.abs(this.steerSmoothed) ? steerRaw : this.steerSmoothed;
    throttle = Math.max(throttle, keyThrottle);
    brake = Math.max(brake, keyBrake);

    const explicitReverse = this.keys.has('ShiftLeft') || (pad?.buttons[2]?.pressed ?? false);
    [throttle, brake] = this.resolveReverse(throttle, brake, explicitReverse, forwardSpeed, dt);

    this.state.throttle = clamp(throttle, 0, 1);
    this.state.brake = clamp(brake, 0, 1);
    this.state.steer = clamp(this.shape(steerRaw), -1, 1);
    this.state.cameraRotate = this.axisFromKeys(['KeyE'], ['KeyQ']);
  }

  /**
   * Reverse works the way every arcade racer's does: hold the brake once the
   * car has stopped and it backs up, and a dab of throttle while reversing
   * brakes and then puts it back into drive. Holding the explicit reverse
   * button forces it regardless.
   */
  private resolveReverse(
    throttle: number,
    brake: number,
    explicit: boolean,
    forwardSpeed: number,
    dt: number,
  ): [number, number] {
    if (explicit) {
      this.reverseLatch = true;
      this.reverseHold = 0;
    } else if (forwardSpeed > 0.8) {
      this.reverseLatch = false;
      this.reverseHold = 0;
    } else if (!this.reverseLatch && brake > 0.2 && forwardSpeed < 0.5) {
      this.reverseHold += dt;
      if (this.reverseHold > 0.18) this.reverseLatch = true;
    } else if (brake <= 0.2) {
      this.reverseHold = 0;
    }

    if (!this.reverseLatch) {
      this.state.reverse = false;
      return [throttle, brake];
    }

    // In reverse the pedals swap: brake drives backwards, throttle slows and
    // then hands control back to first gear.
    const forwardDemand = throttle;
    const result: [number, number] = [brake, forwardDemand];
    if (forwardDemand > 0 && forwardSpeed > -0.5) {
      this.reverseLatch = false;
      this.reverseHold = 0;
      this.state.reverse = false;
      return [forwardDemand, 0];
    }
    this.state.reverse = true;
    return result;
  }
}
