import { mkdir } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = fileURLToPath(new URL("../docs/screenshots/", import.meta.url));
const MAIN_VIEWPORT = { width: 1280, height: 800 };

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const settle = async (page) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
};

const waitForNote = async (page) => {
  await page.locator(".tack-editor .ProseMirror").waitFor();
  await page.locator(".tack-list-item").first().waitFor();
};

const scrollToTop = (page) =>
  page.evaluate(() => {
    for (const element of [document.scrollingElement, ...document.querySelectorAll("*")]) {
      if (element && element.scrollTop > 0) element.scrollTop = 0;
    }
  });

const typeAtEndOf = async (page, text, typed) => {
  const paragraph = page.locator(".tack-editor .ProseMirror p", { hasText: text }).first();
  const box = await paragraph.boundingBox();
  await paragraph.click({ position: { x: box.width - 2, y: box.height / 2 } });
  await page.keyboard.type(typed, { delay: 40 });
  await scrollToTop(page);
};

const scenes = [
  {
    file: "main-light.png",
    scene: "main",
    run: waitForNote,
  },
  {
    file: "main-dark.png",
    scene: "main",
    colorScheme: "dark",
    run: waitForNote,
  },
  {
    file: "search.png",
    scene: "main",
    run: async (page) => {
      await waitForNote(page);
      await page.waitForTimeout(500);
      await page.keyboard.press("Meta+k");
      await page.locator(".tack-palette-input").pressSequentially("kubctl rolout", { delay: 40 });
      await page.locator(".tack-palette-line").first().waitFor();
    },
  },
  {
    file: "link-picker.png",
    scene: "main",
    run: async (page) => {
      await waitForNote(page);
      await page.waitForTimeout(500);
      await typeAtEndOf(page, "#weekly-sync", " Related: [[");
      await page.locator(".tack-link-picker:not([hidden])").waitFor();
    },
  },
  {
    file: "ask-claude.png",
    scene: "main",
    run: async (page) => {
      await waitForNote(page);
      await page.waitForTimeout(500);
      await page.keyboard.press("Meta+j");
      await page.locator(".tack-claude-quick button", { hasText: "Summarize" }).click();
      await page.locator(".tack-claude-actions button", { hasText: "Accept" }).waitFor();
    },
  },
  {
    file: "history.png",
    scene: "main",
    run: async (page) => {
      await waitForNote(page);
      await page.waitForTimeout(500);
      await page.keyboard.press("Meta+Shift+h");
      await page.locator(".tack-history-entry", { hasText: "Before Ask Claude: Check" }).click();
      await page.locator(".tack-history .tack-claude-actions").waitFor();
    },
  },
  {
    file: "grammar.png",
    scene: "grammar",
    run: async (page) => {
      await waitForNote(page);
      const underline = page.locator(".tack-grammar").first();
      await underline.waitFor({ timeout: 30_000 });
      await underline.click();
      await page.locator(".tack-grammar-popover:not([hidden])").waitFor();
    },
  },
  {
    file: "quick-capture.png",
    scene: "capture",
    viewport: { width: 960, height: 520 },
    run: async (page) => {
      const input = page.locator(".tack-capture-input");
      await input.waitFor();
      await input.pressSequentially("Ask Alex if the feature flag can go to 50% before Friday", { delay: 20 });
    },
  },
  {
    file: "conflict.png",
    scene: "conflict",
    run: async (page) => {
      await waitForNote(page);
      await page.waitForTimeout(500);
      await typeAtEndOf(page, "Staging is green", " Looks good.");
      await page.waitForTimeout(1000);
      await page.locator(".tack-conflict").waitFor();
      await page.locator(".tack-editor .ProseMirror").blur();
      await scrollToTop(page);
    },
  },
];

const only = process.argv.slice(2);

await mkdir(outDir, { recursive: true });
const port = await freePort();
const server = await createServer({
  root,
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  logLevel: "error",
  server: { port, strictPort: true, host: "127.0.0.1", hmr: false },
});
await server.listen();

const browser = await chromium.launch({ channel: "chrome" });
let failed = false;
try {
  for (const { file, scene, colorScheme = "light", viewport = MAIN_VIEWPORT, run } of scenes) {
    if (only.length > 0 && !only.some((name) => file.startsWith(name))) continue;
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${port}/demo/index.html?scene=${scene}`);
      await run(page);
      await settle(page);
      await page.screenshot({ path: `${outDir}${file}` });
      console.log(`saved ${file}`);
    } catch (error) {
      failed = true;
      console.error(`failed ${file}: ${error.message}`, errors);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
if (failed) process.exitCode = 1;
