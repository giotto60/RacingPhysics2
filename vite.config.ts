import { defineConfig } from 'vite';

// GitHub Pages serves this project from https://<user>.github.io/RacingPhysics2/
// so assets must resolve against that subpath in production builds.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/RacingPhysics2/' : '/',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    host: true,
  },
}));
