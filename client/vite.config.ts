import { defineConfig } from "vite";

export default defineConfig({
  server: {
    // Listen on the local network too, so phones on the same Wi-Fi can open the page.
    host: true,
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 4173,
  },
});
