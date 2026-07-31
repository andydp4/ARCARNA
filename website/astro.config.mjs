import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://viger.cloud",
  output: "static",
  build: {
    format: "directory",
  },
  trailingSlash: "never",
  integrations: [sitemap({ filter: (page) => !page.includes("/apps") })],
});
