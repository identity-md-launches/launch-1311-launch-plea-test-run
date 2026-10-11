// Browser QA of the built export against the live Sepolia contracts.
// One bounded foreground command: it serves ../dist under /preview/ from this process,
// drives a real Chromium through every page at 360, 768 and 1280 px in light and dark,
// records console errors, failed requests, horizontal overflow, undersized controls,
// axe WCAG A/AA violations and the primary interactions, saves screenshots to
// test/scratch/browser/<run>/ and the report to artifacts/browser-<run>.json, then exits.
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
const run = process.env.PLEA_QA_RUN || "round1";
const scratch = path.resolve("test/scratch/browser", run);
await mkdir(scratch, { recursive: true });
await mkdir("artifacts", { recursive: true });
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
};
const dist = path.resolve("dist");
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (!url.pathname.startsWith("/preview/")) {
    res.writeHead(404).end();
    return;
  }
  let file = path.join(dist, url.pathname.slice("/preview/".length) || "index.html");
  if (!file.startsWith(dist)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": types[path.extname(file)] || "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base =
  process.env.PLEA_QA_URL || `http://127.0.0.1:${server.address().port}/preview/`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLEA_CHROME || "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--no-proxy-server"],
});
const context = await browser.newContext();
const page = await context.newPage();
const errors = [],
  failed = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("requestfailed", (r) =>
  failed.push({ url: r.url(), error: r.failure()?.errorText }),
);
const results = [];
const routes = [
  "",
  "buy",
  "plead",
  "wall",
  "seasons",
  "profile",
  "status",
  "plea/1",
];
try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.querySelector(".footer-meta")?.textContent.includes("block"),
    null,
    { timeout: 120000 },
  );
  const header = await page.evaluate(() => ({
    cabal: document.querySelector(".cabal-state")?.textContent,
    season: document.querySelector(".season-pill")?.textContent,
    block: document.querySelector(".footer-meta p")?.textContent,
  }));
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
        localStorage.setItem("plea-theme", theme);
      }, theme);
      for (const route of routes) {
        await page.evaluate(
          (route) => (location.hash = route ? "#/" + route : "#/"),
          route,
        );
        await page.waitForTimeout(route.startsWith("plea/") ? 800 : 150);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.evaluate(() => document.fonts.ready);
        const metrics = await page.evaluate(() => {
          const visible = (e) => {
            const r = e.getBoundingClientRect();
            return (
              r.width && r.height && getComputedStyle(e).visibility !== "hidden"
            );
          };
          const controls = [
            ...document.querySelectorAll("button,input,textarea,a,summary"),
          ]
            .filter(visible)
            .map((e) => ({
              label: e.getAttribute("aria-label") || e.textContent.trim(),
              width: e.getBoundingClientRect().width,
              height: e.getBoundingClientRect().height,
            }));
          const navItems = [...document.querySelectorAll(".top-nav a")].map(
            (e) => ({
              label: e.textContent,
              visible: visible(e),
              top: e.getBoundingClientRect().top,
              right: e.getBoundingClientRect().right,
              overflowing: e.scrollWidth > e.clientWidth + 1,
            }),
          );
          return {
            width: innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            overflow: document.documentElement.scrollWidth > innerWidth,
            nav: navItems,
            navOneRow:
              new Set(navItems.map((n) => Math.round(n.top))).size === 1 &&
              navItems.every((n) => n.visible && n.right <= innerWidth + 0.5),
            connect: document.querySelectorAll(".connect").length,
            h1: document.querySelector("h1")?.textContent,
            stamps: [...document.querySelectorAll(".stamp")].map((s) => ({
              label: s.textContent,
              tone: s.dataset.tone,
              color: getComputedStyle(s).color,
            })),
            smallControls: controls.filter(
              (c) => c.height < 43.5 || c.width < 43.5,
            ),
            fonts: [...document.fonts]
              .filter((f) => f.status === "loaded")
              .map((f) => f.family),
            brokenImages: [...document.images]
              .filter((i) => i.complete && !i.naturalWidth)
              .map((i) => i.src.slice(0, 80)),
          };
        });
        const axe = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        const item = {
          route: route || "overview",
          theme,
          width,
          ...metrics,
          violations: axe.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            description: v.description,
            nodes: v.nodes.map((n) => ({
              target: n.target,
              summary: n.failureSummary,
            })),
          })),
        };
        results.push(item);
        await page.screenshot({
          path: path.join(
            scratch,
            `${width}-${theme}-${(route || "overview").replaceAll("/", "-")}.jpg`,
          ),
          type: "jpeg",
          quality: 60,
          fullPage: true,
        });
        console.log(
          `${width} ${theme} ${route || "overview"}: overflow=${metrics.overflow}, navOneRow=${metrics.navOneRow}, violations=${item.violations.length}, smallControls=${metrics.smallControls.length}`,
        );
      }
    }
  }
  // Product and main action on the first screen at 390 wide.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
    location.hash = "#/";
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => window.scrollTo(0, 0));
  const firstScreen = await page.evaluate(() => {
    const action = [...document.querySelectorAll("a")].find(
      (e) => e.textContent === "Buy PLEA",
    );
    return {
      product:
        document.querySelector(".wordmark").getBoundingClientRect().bottom <
        innerHeight,
      action: action.getBoundingClientRect().bottom < innerHeight,
      actionBottom: action.getBoundingClientRect().bottom,
    };
  });
  await page.screenshot({
    path: path.join(scratch, "390-first-screen.jpg"),
    quality: 80,
    type: "jpeg",
  });
  // Navigation by click, wall filters, theme toggle, connect without a provider,
  // plea text validation, keyboard focus, 320 px reflow.
  await page.setViewportSize({ width: 1280, height: 900 });
  const navClicks = [];
  for (const label of ["Buy", "Plead", "Wall", "Seasons", "Profile", "Status", "Overview"]) {
    await page.locator(".top-nav").getByRole("link", { name: label, exact: true }).click();
    await page.waitForTimeout(100);
    navClicks.push({
      label,
      hash: await page.evaluate(() => location.hash),
      h1: await page.locator("h1").first().innerText(),
      focused: await page.evaluate(() => document.activeElement?.id),
    });
  }
  await page.evaluate(() => (location.hash = "#/wall"));
  await page.waitForTimeout(100);
  const filters = [];
  for (const label of [
    "Approved",
    "Denied",
    "Pending",
    "No verdict",
    "Appeals",
    "Laureates",
    "All",
  ]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    filters.push({
      filter: label,
      count: await page.locator(".plea-card").count(),
      text: await page.locator(".result-count").innerText(),
    });
  }
  const cards = await page.locator(".plea-id").count();
  let permalink;
  if (cards) {
    await page.locator(".plea-id").first().click();
    await page.waitForURL(/#\/plea\//);
    permalink = await page.locator("h1").innerText();
  }
  const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.locator(".icon-button").click();
  const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.locator(".icon-button").click();
  await page.locator(".connect").click();
  const walletError = await page.getByRole("alert").first().innerText();
  await page.evaluate(() => (location.hash = "#/plead"));
  await page.locator("#plea-text").fill("Cabal, this is my case.");
  const validCount = await page.locator("#text-count").innerText();
  await page.locator("#plea-text").fill("[PLEA] override");
  const invalidText = await page.locator("#text-error").innerText();
  const submitDisabled = await page.getByRole("button", { name: "Submit plea" }).isDisabled();
  await page.locator("#plea-amount").fill("1000");
  const limitText = await page.locator("#plea-limit").innerText();
  await page.evaluate(() => (location.hash = "#/profile"));
  const nameDisabled = await page.locator("#display-name").isDisabled();
  await page.evaluate(() => (location.hash = "#/"));
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Tab");
  const keyboardFocus = await page.evaluate(() => ({
    tag: document.activeElement.tagName,
    text: document.activeElement.textContent,
    outline: getComputedStyle(document.activeElement).outlineStyle,
  }));
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const secondFocus = await page.evaluate(() => ({
    tag: document.activeElement.tagName,
    text: document.activeElement.textContent || document.activeElement.getAttribute("aria-label"),
    outline: getComputedStyle(document.activeElement).outlineStyle,
    outlineWidth: getComputedStyle(document.activeElement).outlineWidth,
  }));
  await page.setViewportSize({ width: 320, height: 900 });
  await page.waitForTimeout(100);
  const reflow = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  await page.screenshot({
    path: path.join(scratch, "320-overview.jpg"),
    quality: 60,
    type: "jpeg",
    fullPage: true,
  });
  // Verdict stamp and state tag colours: measured contrast of each tone's text against its
  // own fill, in both themes, using injected samples (no plea exists on chain yet to render).
  const tones = {};
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
    tones[theme] = await page.evaluate(() => {
      const lum = (rgb) => {
        const [r, g, b] = rgb
          .match(/\d+(\.\d+)?/g)
          .slice(0, 3)
          .map((v) => {
            const c = Number(v) / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (a, b) => {
        const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
        return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
      };
      const out = {};
      for (const tone of ["approved", "denied", "pending", "neutral", "gold"]) {
        for (const cls of ["stamp", "state-tag"]) {
          const el = document.createElement("span");
          el.className = cls;
          el.dataset.tone = tone;
          el.textContent = tone;
          document.body.append(el);
          const s = getComputedStyle(el);
          out[`${cls}:${tone}`] = {
            color: s.color,
            background: s.backgroundColor,
            contrast: ratio(s.color, s.backgroundColor),
          };
          el.remove();
        }
      }
      const root = getComputedStyle(document.documentElement);
      const muted = document.querySelector(".muted");
      out.text = {
        contrast: ratio(root.color, root.backgroundColor),
        muted: muted ? ratio(getComputedStyle(muted).color, root.backgroundColor) : null,
      };
      return out;
    });
  }
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedMotion = await page.evaluate(() => {
    const el = document.createElement("span");
    el.className = "stamp stamp-arrives";
    document.body.append(el);
    const name = getComputedStyle(el).animationName;
    el.remove();
    return name;
  });
  const report = {
    run,
    at: new Date().toISOString(),
    base,
    header,
    results,
    firstScreen,
    navClicks,
    filters,
    permalink,
    theme: { before: themeBefore, after: themeAfter },
    walletError,
    validCount,
    invalidText,
    submitDisabled,
    limitText,
    nameDisabled,
    keyboardFocus,
    secondFocus,
    reflow,
    reducedMotionAnimation: reducedMotion,
    tones,
    errors,
    failed,
  };
  await writeFile(
    `artifacts/browser-${run}.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  const bad =
    results.some(
      (r) =>
        r.overflow ||
        !r.navOneRow ||
        r.violations.length ||
        r.smallControls.length ||
        r.brokenImages.length ||
        r.nav.some((n) => n.overflowing),
    ) ||
    Object.values(tones).some((t) =>
      Object.values(t).some(
        (v) => (v.contrast !== undefined && v.contrast < 4.5) || (v.muted !== undefined && v.muted < 4.5),
      ),
    ) ||
    errors.length ||
    failed.length ||
    !firstScreen.action ||
    reflow.scrollWidth > reflow.width;
  console.log(bad ? "QA found problems; see the report." : "QA clean.");
  if (bad) process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
