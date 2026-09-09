import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  hooks: {
    "build:publicAssets": async (_wxt, files) => {
      for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
        const root = resolve("node_modules/pdfjs-dist", directory);
        for (const filename of await readdir(root)) {
          files.push({ absoluteSrc: resolve(root, filename), relativeDest: `pdfjs/${directory}/${filename}` });
        }
      }
      files.push({ absoluteSrc: resolve("node_modules/pdfjs-dist/LICENSE"), relativeDest: "pdfjs/LICENSE" });
    },
  },
  manifest: {
    name: "__MSG_extensionName__",
    description: "__MSG_extensionDescription__",
    default_locale: "en",
    minimum_chrome_version: "116",
    content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" },
    permissions: [
      "activeTab",
      "scripting",
      "storage",
      "clipboardWrite",
      "contextMenus",
    ],
    optional_host_permissions: ["http://*/*", "https://*/*"],
    web_accessible_resources: [
      {
        resources: [
          "content-scripts/page.css",
          "documents.html",
          "icon/16.png",
          "icon/32.png",
        ],
        matches: ["http://*/*", "https://*/*"],
      },
    ],
    action: {
      default_title: "HyperPage AI",
    },
    commands: {
      _execute_action: {
        suggested_key: { default: "Alt+Shift+H", mac: "Alt+Shift+H" },
      },
    },
    icons: {
      "16": "icon/16.png",
      "32": "icon/32.png",
      "48": "icon/48.png",
      "128": "icon/128.png",
    },
  },
});
