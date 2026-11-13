import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// A porta 1420 é a que o Tauri espera no modo de desenvolvimento (tauri.conf.json).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
