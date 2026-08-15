import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    target: "es2022",
    // Keep permanent uploads small. The large AO signer chunk is lazy-loaded
    // only when a visitor reads or writes process state.
    sourcemap: false,
    chunkSizeWarningLimit: 1900,
  },
});
