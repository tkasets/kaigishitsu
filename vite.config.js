import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served at the root of the custom domain kaigishitsu.t-kasets.com
export default defineConfig({
  plugins: [react()],
  base: "/",
});
