const { chromium } = require('playwright');
const GameConfig = require('./config');

class BrowserManager {
  constructor() {
    this.browser = null;
    this.page = null;
    this.canvas = null;
  }

  async launch() {
    const { headless, viewportWidth, viewportHeight } = GameConfig.browser;
    this.browser = await chromium.launch({ headless });
    const context = await this.browser.newContext({
      viewport: { width: viewportWidth, height: viewportHeight }
    });
    this.page = await context.newPage();
  }

  async navigateToGame() {
    await this.page.goto(GameConfig.url, { waitUntil: 'domcontentloaded' });
    await this.page.waitForTimeout(800);
    await this.page.evaluate(() => {
      window.scrollTo(0, 0);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', e => {
        if (['ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
      }, { capture: true });
    });
  }

  async startGame() {
    const { players, input, difficulty, stepDelay, loadDelay } = GameConfig.menu;
    await this.page.keyboard.press(players);
    await this.page.waitForTimeout(stepDelay);
    await this.page.keyboard.press(input);
    await this.page.waitForTimeout(stepDelay);
    await this.page.keyboard.press(difficulty);
    await this.page.waitForTimeout(loadDelay);
    this.canvas = this.page.locator('#gameCanvas');
    await this.canvas.waitFor({ state: 'visible' });
  }

  async focusCanvas() {
    await this.page.evaluate(() => window.scrollTo(0, 0));
    const box = await this.canvas.boundingBox();
    if (!box) throw new Error('gameCanvas bounding box unavailable');
    await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await this.page.waitForTimeout(GameConfig.timing.focusSettleDelay);
  }

  async screenshot(filename) {
    try { if (this.canvas) await this.canvas.screenshot({ path: filename }); } catch (_) {}
  }

  async close() {
    try { if (this.browser) await this.browser.close(); } catch (_) {}
  }
}

module.exports = BrowserManager;