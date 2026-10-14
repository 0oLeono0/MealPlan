import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // S1-24 supplies the actual deployment base; relative assets also work in a subdirectory.
  base: process.env.MEALPLAN_BASE ?? './',
  build: { target: ['es2020', 'safari15'], cssTarget: 'safari15' },
  worker: { format: 'es' },
});
