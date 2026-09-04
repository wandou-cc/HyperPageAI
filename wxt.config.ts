import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: "__MSG_extensionName__",
    description: "__MSG_extensionDescription__",
    default_locale: "en",
    minimum_chrome_version: "116",
    permissions: ["storage", "clipboardWrite", "contextMenus", "tabs"],
    host_permissions: ["<all_urls>"],
    web_accessible_resources: [
      {
        resources: ["icon/16.png", "icon/32.png", "icon/48.png"],
        matches: ["http://*/*", "https://*/*"],
      },
    ],
    action: {
      default_title: "HyperPage AI",
    },
    icons: {
      "16": "icon/16.png",
      "32": "icon/32.png",
      "48": "icon/48.png",
      "128": "icon/128.png",
    },
  },
});
