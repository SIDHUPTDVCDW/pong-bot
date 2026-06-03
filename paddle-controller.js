const GameConfig = require('./config');

class PaddleController {
  constructor(page) {
    this._page = page;
    this._heldKey = null;
  }

  async hold(key) {
    if (this._heldKey === key) return;
    if (this._heldKey) await this._page.keyboard.up(this._heldKey);
    await this._page.keyboard.down(key);
    this._heldKey = key;
  }

  async release() {
    if (this._heldKey) {
      try { await this._page.keyboard.up(this._heldKey); } catch (_) {}
      this._heldKey = null;
    }
  }

  async moveTo(paddleY, targetY) {
    const diff = targetY - paddleY;
    if (Math.abs(diff) <= GameConfig.paddle.deadzone) {
      await this.release();
    } else {
      await this.hold(diff > 0 ? 'ArrowDown' : 'ArrowUp');
    }
  }
}

module.exports = PaddleController;