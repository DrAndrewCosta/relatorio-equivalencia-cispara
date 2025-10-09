import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react")) return "react";
          if (id.includes("node_modules/react-dom")) return "react";
          if (id.includes("node_modules/html2canvas")) return "html2canvas";
          if (id.includes("node_modules/jspdf")) return "jspdf";
        },
      },
    },
  },
});
