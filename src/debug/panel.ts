import GUI from 'lil-gui';

/**
 * Live tuning panel. Every parameter added here must apply immediately with
 * no reload. Folder layout mirrors the physics specification so the panel
 * grows in place as later milestones land.
 */
export class DebugPanel {
  readonly gui: GUI;
  private folders = new Map<string, GUI>();

  constructor() {
    this.gui = new GUI({ title: 'RacingPhysics2', width: 320 });
    this.gui.domElement.style.zIndex = '10';
  }

  folder(name: string): GUI {
    let f = this.folders.get(name);
    if (!f) {
      f = this.gui.addFolder(name);
      f.close();
      this.folders.set(name, f);
    }
    return f;
  }

  refresh(): void {
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }
}
