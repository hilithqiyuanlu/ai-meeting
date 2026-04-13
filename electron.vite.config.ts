import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { cpSync, existsSync, mkdirSync } from "node:fs";

function copySherpaVendor() {
  return {
    name: "copy-sherpa-vendor",
    closeBundle() {
      const source = resolve("vendor/sherpa-onnx");
      if (!existsSync(source)) {
        return;
      }

      const target = resolve("dist-electron/vendor/sherpa-onnx");
      mkdirSync(resolve("dist-electron/vendor"), { recursive: true });
      cpSync(source, target, { recursive: true });
    }
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copySherpaVendor()],
    build: {
      outDir: "dist-electron/main"
    },
    resolve: {
      alias: {
        "@main": resolve("src/main"),
        "@shared": resolve("src/shared")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist-electron/preload"
    },
    resolve: {
      alias: {
        "@shared": resolve("src/shared")
      }
    }
  },
  renderer: {
    build: {
      outDir: "dist-electron/renderer"
    },
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
        "@shared": resolve("src/shared")
      }
    },
    plugins: [react()]
  }
});
