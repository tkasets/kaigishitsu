import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// ネイティブアプリ(Expo/WebView)向けビルド。
// ゲーム全体を1枚の自己完結HTML(JS/CSS/画像すべてインライン)に固め、
// Expoアプリの assets に出力する。オフラインで動作し、外部ネットワーク不要。
// エントリは広告スクリプトを除いた app.html。
export default defineConfig({
  base: "./",
  define: {
    "import.meta.env.VITE_NATIVE_APP": JSON.stringify("1"),
  },
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "mobile/assets",
    emptyOutDir: false, // アイコン等の他アセットを消さない
    rollupOptions: {
      input: "app.html",
    },
  },
});
