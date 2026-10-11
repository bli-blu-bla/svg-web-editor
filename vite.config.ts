import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // relative asset paths → works on GitHub Pages under /<repo-name>/
  base: './',
  plugins: [react()],
  optimizeDeps: { include: ['clipper-lib'] },
});
