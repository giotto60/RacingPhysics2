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

/** Where the sun sits relative to whatever the camera is looking at. */
const KEY_LIGHT_OFFSET = new THREE.Vector3(38, 76, 25);

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

  private hemi: THREE.HemisphereLight;
  private key: THREE.DirectionalLight;
  private keyTarget = new THREE.Object3D();
  private shadowHalfExtent = 0;
  private daylight = 1;

  constructor(container: HTMLElement, cameraConfig: IsoCameraConfig = { ...defaultIsoCamera }) {
    this.cameraConfig = cameraConfig;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Left permanently on: toggling it at runtime forces every material in the
    // scene to recompile, so the switch in the panel moves `castShadow` on the
    // lights instead, which three.js handles by itself.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x14181d);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    this.scene.add(this.camera);

    this.hemi = new THREE.HemisphereLight(0xdfe8f2, 0x30363c, 1.15);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xffffff, 1.1);
    this.key.position.copy(KEY_LIGHT_OFFSET);
    this.key.castShadow = true;
    // The shadow map covers only what the camera can see, and follows it, so a
    // 2k map buys centimetre-scale detail instead of being spread over a
    // kilometre of track that is not on screen.
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.06;
    this.key.shadow.camera.near = 1;
    this.key.shadow.camera.far = 240;
    this.scene.add(this.key);
    this.scene.add(this.keyTarget);
    this.key.target = this.keyTarget;

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  /**
   * The canvas covers the window exactly, and the drawing buffer behind it is
   * the display's own resolution.
   *
   * Both halves matter. `setSize` with the style suppressed sets the buffer to
   * `size * devicePixelRatio` and leaves the element's CSS size unset, so the
   * canvas lays *itself* out at the buffer size in CSS pixels -- on a 1.5x
   * display that is a canvas half again wider than the window, pinned to the
   * top left, with the middle of the view at three quarters of the way across
   * the screen. Letting three.js write the CSS size is what keeps the two in
   * step at any pixel ratio.
   */
  private resize = (): void => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.updateProjection();
  };

  updateProjection(): void {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const halfH = (this.cameraConfig.viewHeight * this.zoom) * 0.5;
    const halfW = halfH * aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  /** Sun shadows on or off. Cheap to toggle; the shadow map itself stays on. */
  setShadows(enabled: boolean): void {
    this.key.castShadow = enabled;
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
    this.updateShadowFrustum();
  }

  /**
   * March the sun along with the view. A directional light's shadow needs a
   * bounded volume, so it tracks the camera target and is sized from the
   * visible width, which keeps the whole screen shadowed at any zoom.
   */
  private updateShadowFrustum(): void {
    this.key.position.copy(this.target).add(KEY_LIGHT_OFFSET);
    this.keyTarget.position.copy(this.target);

    const half = Math.max(30, (this.camera.right - this.camera.left) * 0.6);
    // Only rebuild the projection when it has moved enough to matter: the
    // camera pulls back continuously with speed and the frustum does not need
    // to follow every centimetre of it.
    if (Math.abs(half - this.shadowHalfExtent) < 2) return;
    this.shadowHalfExtent = half;
    const cam = this.key.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
