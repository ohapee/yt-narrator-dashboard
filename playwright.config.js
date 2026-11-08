import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  use: {baseURL: "http://127.0.0.1:8791", headless: true, launchOptions: {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}},
  webServer: {command: "npm run dev -- --ip 127.0.0.1 --port 8791 --persist-to /tmp/yt-narrator-browser-state", url: "http://127.0.0.1:8791", reuseExistingServer: !process.env.CI},
});
