const { chromium } = require('playwright');

/**
 * ============================================================================
 *  Pong Bot — Automation Challenge 24
 * ============================================================================
 *  Autonomous Pong player using Playwright for browser automation.
 *  Detects game state via real-time pixel analysis on HTML5 canvas,
 *  predicts ball trajectory with multi-bounce reflection modeling,
 *  and applies spin mechanics for strategic angled returns.
 *
 *  Architecture:
 *    GameConfig       – Centralized tuning parameters
 *    BrowserManager   – Lifecycle & page interaction layer
 *    PixelAnalyzer    – Injected canvas state reader (runs in browser context)
 *    PhysicsEngine    – Ball trajectory prediction & reflection math
 *    PaddleController – Continuous key-hold movement with deadzone
 *    GameOrchestrator – Main loop, score tracking, spin strategy
 *
 *  Usage:  node pong-bot.js
 * ============================================================================
 */

// ─── Configuration ──────────────────────────────────────────────────────────

const GameConfig = Object.freeze({
  browser: {
    headless: true,
    viewportWidth: 800,
    viewportHeight: 600
  },
  url: 'https://www.ponggame.org/',
  menu: {
    players: '1',
    input: 'k',
    difficulty: 'h',
    stepDelay: 200,
    loadDelay: 400
  },
  // 1-player keyboard mode always assigns right paddle to the player
  controlSide: 'right',
  timing: {
    loopDelay: 3,
    refocusInterval: 2000,
    refocusSafetyZone: 0.6,
    maxRuntime: 900000,
    focusSettleDelay: 8
  },
  paddle: {
    deadzone: 3,
    stuckThreshold: 3,
    stuckMovementEpsilon: 1.1,
    stuckDiffMinimum: 10,
    edgeBuffer: 4
  },
  prediction: {
    velocityEpsilon: 0.05,
    stallPersistFrames: 20,
    minVelocityFallback: 0.5
  },
  spin: {
    offset: 32,
    activationRange: 200
  },
  recovery: {
    missRefocusInterval: 60
  },
  winScore: 10
});

// ─── Physics Engine ─────────────────────────────────────────────────────────

class PhysicsEngine {
  /**
   * Predicts the Y-coordinate after reflecting off top/bottom walls.
   * Uses modular arithmetic for accurate multi-bounce calculation.
   */
  static reflectY(y, height) {
    if (height <= 0) return 0;
    const period = 2 * height;
    y = ((y % period) + period) % period;
    return y <= height ? y : period - y;
  }

  /**
   * Predicts ball intercept Y at the paddle's X position.
   */
  static predictIntercept(ball, vx, vy, paddleX, height) {
    const dx = Math.abs(paddleX - ball.x);
    if (dx <= 0) return null;
    const frames = dx / Math.abs(vx);
    const y = this.reflectY(ball.y + vy * frames, height);
    return { y, frames };
  }

  /**
   * Estimates where the ball will be after bouncing off the opponent wall
   * and returning. Used for pre-positioning when ball is moving away.
   */
  static anticipateReturn(ball, vx, vy, paddleX, opponentX, height) {
    const absVx = Math.max(Math.abs(vx), GameConfig.prediction.minVelocityFallback);
    const totalFrames = (Math.abs(opponentX - ball.x) + Math.abs(paddleX - opponentX)) / absVx;
    const returnY = this.reflectY(ball.y + vy * totalFrames, height);
    return returnY * 0.55 + height * 0.225;
  }

  /**
   * Calculates spin offset to ensure the paddle is moving on contact,
   * producing angled returns that are harder for the AI opponent.
   */
  static calculateSpin(dx, predicted, oppPaddle, height) {
    if (dx >= GameConfig.spin.activationRange) return 0;
    const direction = oppPaddle
      ? (oppPaddle.y > height / 2 ? -1 : 1)
      : (predicted > height / 2 ? -1 : 1);
    const closeness = 1 - (dx / GameConfig.spin.activationRange);
    return GameConfig.spin.offset * closeness * direction;
  }
}

// ─── Paddle Controller ──────────────────────────────────────────────────────

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

// ─── Browser Manager ────────────────────────────────────────────────────────

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

// ─── Pixel Analyzer (injected into browser context) ─────────────────────────

function injectPixelAnalyzer() {
  window.__pongReadState = function readGameState(prev) {
    const canvas = document.getElementById('gameCanvas');
    const p1El = document.getElementById('player1Score');
    const p2El = document.getElementById('player2Score');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const w = canvas.width, h = canvas.height;
    const data = ctx.getImageData(0, 0, w, h).data;
    const tracker = window.__pongTracker || { prevFrame: null };

    const isBright = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      const i = (y * w + x) * 4;
      return data[i + 3] > 80 && data[i] > 165 && data[i + 1] > 165 && data[i + 2] > 165;
    };
    const hasChanged = (x, y) => {
      if (!tracker.prevFrame) return false;
      const i = (y * w + x) * 4;
      return Math.abs(data[i] - tracker.prevFrame[i]) +
             Math.abs(data[i + 1] - tracker.prevFrame[i + 1]) +
             Math.abs(data[i + 2] - tracker.prevFrame[i + 2]) > 120;
    };

    function floodFillComponents(testFn) {
      const visited = new Uint8Array(w * h);
      const components = [];
      const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (let y = 0; y < h; y += 2) {
        for (let x = 0; x < w; x += 2) {
          const id = y * w + x;
          if (visited[id]) continue;
          visited[id] = 1;
          if (!testFn(x, y)) continue;
          let minX = x, maxX = x, minY = y, maxY = y, count = 0;
          const stack = [[x, y]];
          while (stack.length) {
            const [cx, cy] = stack.pop();
            if (!testFn(cx, cy)) continue;
            count++;
            if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
            if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
            for (const [dx, dy] of directions) {
              const nx = cx + dx, ny = cy + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              const nid = ny * w + nx;
              if (visited[nid]) continue;
              visited[nid] = 1;
              stack.push([nx, ny]);
            }
          }
          if (count >= 4) {
            components.push({
              x: (minX + maxX) / 2, y: (minY + maxY) / 2,
              minX, maxX, minY, maxY,
              w: maxX - minX + 1, h: maxY - minY + 1,
              area: (maxX - minX + 1) * (maxY - minY + 1)
            });
          }
        }
      }
      return components;
    }

    const brightComponents = floodFillComponents(isBright);

    function identifyPaddle(side, previous) {
      let candidates = brightComponents.filter(c => {
        const onSide = side === 'left' ? c.minX < w * 0.19 : c.maxX > w * 0.81;
        return onSide && c.w >= 2 && c.w <= 32 && c.h >= 7 && c.h <= 170 && c.h >= c.w * 1.05;
      });
      if (!candidates.length) return previous || null;
      if (previous) {
        candidates.sort((a, b) =>
          Math.hypot(a.x - previous.x, a.y - previous.y) -
          Math.hypot(b.x - previous.x, b.y - previous.y)
        );
      } else {
        candidates.sort((a, b) => side === 'left' ? a.x - b.x : b.x - a.x);
      }
      return candidates[0];
    }

    const leftPaddle = identifyPaddle('left', prev?.leftPaddle || null);
    const rightPaddle = identifyPaddle('right', prev?.rightPaddle || null);
    const motionComponents = floodFillComponents((x, y) => isBright(x, y) && hasChanged(x, y));

    function isBallCandidate(c) {
      if (c.w < 2 || c.h < 2 || c.w > 18 || c.h > 18) return false;
      if (Math.abs(c.w - c.h) > 6) return false;
      if (c.minY < 95 && Math.abs(c.x - w / 2) < w * 0.24) return false;
      if (leftPaddle && Math.abs(c.x - leftPaddle.x) < 22 && Math.abs(c.y - leftPaddle.y) < 65) return false;
      if (rightPaddle && Math.abs(c.x - rightPaddle.x) < 22 && Math.abs(c.y - rightPaddle.y) < 65) return false;
      return true;
    }

    const movingBalls = motionComponents.filter(isBallCandidate);
    const staticBalls = brightComponents.filter(isBallCandidate);
    let ball = null;

    if (prev?.ball && movingBalls.length) {
      const nearest = movingBalls
        .map(c => ({ c, d: Math.hypot(c.x - prev.ball.x, c.y - prev.ball.y) }))
        .filter(v => v.d < 150)
        .sort((a, b) => a.d - b.d);
      if (nearest.length) ball = nearest[0].c;
    }
    if (!ball && movingBalls.length) {
      movingBalls.sort((a, b) =>
        (a.area + Math.abs(a.x - w / 2) * 0.01) -
        (b.area + Math.abs(b.x - w / 2) * 0.01)
      );
      ball = movingBalls[0];
    }
    if (!ball && prev?.ball) ball = prev.ball;
    if (!ball && staticBalls.length) {
      staticBalls.sort((a, b) =>
        (Math.abs(a.area - 64) + Math.abs(a.x - w / 2) * 0.015) -
        (Math.abs(b.area - 64) + Math.abs(b.x - w / 2) * 0.015)
      );
      ball = staticBalls[0];
    }

    tracker.prevFrame = new Uint8ClampedArray(data);
    window.__pongTracker = tracker;
    const parseScore = (el) => el ? parseInt((el.textContent || '0').trim(), 10) : null;

    return {
      width: w, height: h,
      score1: parseScore(p1El), score2: parseScore(p2El),
      leftPaddle: leftPaddle ? { x: leftPaddle.x, y: leftPaddle.y, h: leftPaddle.h, w: leftPaddle.w } : null,
      rightPaddle: rightPaddle ? { x: rightPaddle.x, y: rightPaddle.y, h: rightPaddle.h, w: rightPaddle.w } : null,
      ball: ball ? { x: ball.x, y: ball.y } : null
    };
  };
}

// ─── Game Orchestrator ──────────────────────────────────────────────────────

class GameOrchestrator {
  constructor() {
    this.browserMgr = new BrowserManager();
    this.paddleCtrl = null;
    this.controlSide = GameConfig.controlSide;
    this.state = this._initState();
  }

  _initState() {
    return {
      lastBall: null, lastLP: null, lastRP: null,
      lastPadY: null, lastVx: 0, lastVy: 0,
      lastTarget: null, stallFrames: 0,
      missStreak: 0, edgeStuck: 0,
      loop: 0, lastRefocus: 0, lastScore: '0:0'
    };
  }

  async initialize() {
    await this.browserMgr.launch();
    await this.browserMgr.navigateToGame();

    // Inject analyzer BEFORE game starts so it's ready on frame 1
    await this.browserMgr.page.evaluate(injectPixelAnalyzer);

    await this.browserMgr.startGame();
    this.paddleCtrl = new PaddleController(this.browserMgr.page);

    // Single quick focus — then straight into main loop, zero prewarm
    await this.browserMgr.focusCanvas();

    console.log(`🏓 Pong Bot started | controlling: ${this.controlSide} paddle`);
  }

  async _readState(prev) {
    return this.browserMgr.page.evaluate(
      ({ prev }) => window.__pongReadState?.(prev) ?? null, { prev }
    );
  }

  async _safeFocus() {
    await this.paddleCtrl?.release();
    await this.browserMgr.focusCanvas();
  }

  _getMyPaddle(frame) {
    return this.controlSide === 'right'
      ? (frame.rightPaddle || this.state.lastRP)
      : (frame.leftPaddle || this.state.lastLP);
  }

  _getOpponentPaddle(frame) {
    return this.controlSide === 'right'
      ? (frame.leftPaddle || this.state.lastLP)
      : (frame.rightPaddle || this.state.lastRP);
  }

  _getScores(frame) {
    const my = this.controlSide === 'right' ? (frame.score2 ?? 0) : (frame.score1 ?? 0);
    const opp = this.controlSide === 'right' ? (frame.score1 ?? 0) : (frame.score2 ?? 0);
    return { my, opp, display: `${my}:${opp}` };
  }

  _computeTarget(frame, ball, prevBall, paddle) {
    const { height, width } = frame;
    const s = this.state;
    const cfg = GameConfig.prediction;

    // No previous ball — chase current ball position directly
    if (!prevBall || !frame.ball) {
      return ball ? ball.y : (s.lastTarget ?? height / 2);
    }

    let vx = ball.x - prevBall.x;
    let vy = ball.y - prevBall.y;

    if (Math.abs(vx) > cfg.velocityEpsilon || Math.abs(vy) > cfg.velocityEpsilon) {
      s.lastVx = vx; s.lastVy = vy; s.stallFrames = 0;
    } else {
      s.stallFrames++;
      if (s.stallFrames <= cfg.stallPersistFrames) { vx = s.lastVx; vy = s.lastVy; }
    }

    const ballApproaching = this.controlSide === 'right'
      ? vx > cfg.velocityEpsilon
      : vx < -cfg.velocityEpsilon;

    if (ballApproaching) {
      const dx = Math.abs(paddle.x - ball.x);
      if (dx <= 0) return ball.y;

      const intercept = PhysicsEngine.predictIntercept(ball, vx, vy, paddle.x, height);
      if (!intercept) return ball.y;

      const spin = PhysicsEngine.calculateSpin(
        dx, intercept.y, this._getOpponentPaddle(frame), height
      );
      return intercept.y + spin;
    }

    // Ball moving away — anticipate return trajectory
    const oppX = this.controlSide === 'right'
      ? (s.lastLP?.x || width * 0.05)
      : (s.lastRP?.x || width * 0.95);

    return PhysicsEngine.anticipateReturn(ball, vx, vy, paddle.x, oppX, height);
  }

  _detectEdgeStuck(paddle, targetY, top, bot) {
    const s = this.state;
    const cfg = GameConfig.paddle;
    const absDiff = Math.abs(targetY - paddle.y);
    const nearEdge = paddle.y <= top + cfg.edgeBuffer || paddle.y >= bot - cfg.edgeBuffer;

    if (s.lastPadY !== null &&
        Math.abs(paddle.y - s.lastPadY) < cfg.stuckMovementEpsilon &&
        absDiff > cfg.stuckDiffMinimum && nearEdge) {
      s.edgeStuck++;
    } else {
      s.edgeStuck = 0;
    }
    return s.edgeStuck > cfg.stuckThreshold;
  }

  /**
   * Determines if a refocus is safe. Only refocuses when the ball
   * is far from our paddle to avoid interrupting active rallies.
   */
  _shouldRefocus(ball, paddle, width) {
    const s = this.state;
    const interval = GameConfig.timing.refocusInterval;

    // Never refocus in the first interval cycles
    if (s.loop < interval) return false;
    if ((s.loop - s.lastRefocus) < interval) return false;

    // Only refocus when ball is far from our paddle (>60% of field away)
    if (ball && paddle) {
      const dx = Math.abs(ball.x - paddle.x);
      if (dx < width * GameConfig.timing.refocusSafetyZone) return false;
    }

    const forced = (s.loop - s.lastRefocus) >= interval * 4;
    return forced || true;
  }

  _generateScreenshotName() {
    const now = new Date();
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const date = `${pad(now.getDate())}-${months[now.getMonth()]}-${now.getFullYear()}`;
    const time = `${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
    return `pong-result_${date}_${time}.png`;
  }

  _formatTimestamp() {
    const now = new Date();
    return now.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: true
    });
  }

  async run() {
    const s = this.state;
    const t0 = Date.now();

    while (Date.now() - t0 < GameConfig.timing.maxRuntime) {
      const prev = {
        ball: s.lastBall ? { ...s.lastBall } : null,
        leftPaddle: s.lastLP ? { ...s.lastLP } : null,
        rightPaddle: s.lastRP ? { ...s.lastRP } : null
      };

      const frame = await this._readState(prev);
      if (!frame) { await this.browserMgr.page.waitForTimeout(GameConfig.timing.loopDelay); continue; }

      if (frame.leftPaddle) s.lastLP = { ...frame.leftPaddle };
      if (frame.rightPaddle) s.lastRP = { ...frame.rightPaddle };

      const paddle = this._getMyPaddle(frame);
      const prevBall = s.lastBall ? { ...s.lastBall } : null;
      const ball = frame.ball || prevBall;
      if (frame.ball) s.lastBall = { ...frame.ball };

      const scores = this._getScores(frame);
      if (scores.display !== s.lastScore) {
        console.log(`   📊 Score: ${scores.display} (me:opponent)`);
        s.lastScore = scores.display;
      }

      if (scores.my >= GameConfig.winScore || scores.opp >= GameConfig.winScore) {
        await this.paddleCtrl.release();
        console.log(scores.my >= GameConfig.winScore
          ? `🏆 Victory! Final: ${scores.display}`
          : `💀 Defeat. Final: ${scores.display}`);
        break;
      }

      if (!paddle || !ball) {
        s.missStreak++;
        if (s.missStreak % GameConfig.recovery.missRefocusInterval === 0) await this._safeFocus();
        await this.browserMgr.page.waitForTimeout(GameConfig.timing.loopDelay);
        continue;
      }
      s.missStreak = 0;

      const { height, width } = frame;
      const halfPad = Math.max(10, Math.round((paddle.h || 30) / 2));
      const topLimit = halfPad + 3;
      const botLimit = height - halfPad - 3;

      let targetY = this._computeTarget(frame, ball, prevBall, paddle);
      targetY = Math.max(topLimit, Math.min(botLimit, targetY));
      s.lastTarget = targetY;

      await this.paddleCtrl.moveTo(paddle.y, targetY);

      if (this._detectEdgeStuck(paddle, targetY, topLimit, botLimit)) {
        await this._safeFocus();
        s.edgeStuck = 0;
      }

      if (this._shouldRefocus(ball, paddle, width)) {
        await this._safeFocus();
        s.lastRefocus = s.loop;
      }

      s.lastPadY = paddle.y;
      s.loop++;
      await this.browserMgr.page.waitForTimeout(GameConfig.timing.loopDelay);
    }
  }

  async shutdown() {
    await this.paddleCtrl?.release();
    const filename = this._generateScreenshotName();
    await this.browserMgr.screenshot(filename);
    console.log(`✅ Done — screenshot saved as ${filename} | ${this._formatTimestamp()}`);
    await this.browserMgr.close();
  }
}

// ─── Entry Point ────────────────────────────────────────────────────────────

(async () => {
  const game = new GameOrchestrator();

  const gracefulExit = async () => { await game.shutdown(); process.exit(0); };
  process.on('SIGINT', gracefulExit);
  process.on('SIGTERM', gracefulExit);

  try {
    await game.initialize();
    await game.run();
    await game.shutdown();
  } catch (err) {
    console.error('❌ Error:', err.message);
    await game.shutdown();
    process.exit(1);
  }
})();