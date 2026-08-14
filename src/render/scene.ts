import * as THREE from 'three';

/**
 * Renderer, scene and isometric camera.
 *
 * Visual fidelity is worth zero here: flat untextured colour only. The camera
 * is a true orthographic isometric rig -- the later expression layer hangs
 * speed-scaled lead, pull-back and the two orientation modes off this.
 */

export interface IsoCameraConfig {
  /** World-units of vertical view height at zoom 1. */
  viewHeight: number;
  /** Yaw of the camera rig, radians. Mode A pins this; Mode B damps toward car heading. */
  yaw: number;
  /** Elevation angle above the ground plane, radians. */
  pitch: number;
  distance: number;
}

export const defaultIsoCamera: IsoCameraConfig = {
  viewHeight: 26,
  yaw: Math.PI * 0.25,
  pitch: Math.atan(Math.SQRT1_2), // ~35.264deg -- true isometric
  distance: 60,
};

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly cameraConfig: IsoCameraConfig;
  readonly target = new THREE.Vector3();

  zoom = 1;
  /**
   * Pixels to slide the visible window right. The tuning panel occupies the
   * right-hand edge of the window, so without this the car sits under it
   * instead of in the middle of what the player can actually see.
   */
  viewOffsetX = 0;

  private hemi: THREE.HemisphereLight;
  private key: THREE.DirectionalLight;
  private daylight = 1;

  constructor(container: HTMLElement, cameraConfig: IsoCameraConfig = { ...defaultIsoCamera }) {
    this.cameraConfig = cameraConfig;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x14181d);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    this.scene.add(this.camera);

    this.hemi = new THREE.HemisphereLight(0xdfe8f2, 0x30363c, 1.15);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xffffff, 1.1);
    this.key.position.set(30, 60, 20);
    this.scene.add(this.key);

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  private resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.updateProjection();
  };

  updateProjection(): void {
    const height = Math.max(1, window.innerHeight);
    const aspect = window.innerWidth / height;
    const halfH = (this.cameraConfig.viewHeight * this.zoom) * 0.5;
    const halfW = halfH * aspect;
    // Convert the pixel offset into world units at the current zoom, so the
    // framing stays put as the camera pulls back with speed.
    const shift = (this.viewOffsetX / height) * this.cameraConfig.viewHeight * this.zoom;
    this.camera.left = -halfW + shift;
    this.camera.right = halfW + shift;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  /** Scene brightness. Dimming it is what makes the headlights mean anything. */
  setDaylight(level: number): void {
    if (level === this.daylight) return;
    this.daylight = level;
    this.hemi.intensity = 1.15 * level;
    this.key.intensity = 1.1 * level;
    const ground = 0x14181d;
    const shade = Math.max(0.35, Math.min(1, level));
    (this.scene.background as THREE.Color).setHex(ground).multiplyScalar(shade);
  }

  /** Place the orthographic rig looking at `target` from the configured angles. */
  updateCamera(): void {
    const { yaw, pitch, distance } = this.cameraConfig;
    const horizontal = Math.cos(pitch) * distance;
    this.camera.position.set(
      this.target.x + Math.sin(yaw) * horizontal,
      this.target.y + Math.sin(pitch) * distance,
      this.target.z + Math.cos(yaw) * horizontal,
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
