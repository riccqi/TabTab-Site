import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  trailingSlash: "always",
  site: "https://tabtabapp.net",
  integrations: [sitemap()],
});
