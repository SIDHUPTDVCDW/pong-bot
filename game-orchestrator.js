const GameConfig = require('./config');
const PhysicsEngine = require('./physics');
const PaddleController = require('./paddle-controller');
const BrowserManager = require('./browser-manager');
const injectPixelAnalyzer = require('./pixel-analyzer');

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
    await this.browserMgr.page.evaluate(injectPixelAnalyzer);
    await this.browserMgr.startGame();
    this.paddleCtrl = new PaddleController(this.browserMgr.page);
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

  _shouldRefocus(ball, paddle, width) {
    const s = this.state;
    const interval = GameConfig.timing.refocusInterval;
    if (s.loop < interval) return false;
    if ((s.loop - s.lastRefocus) < interval) return false;

    if (ball && paddle) {
      const dx = Math.abs(ball.x - paddle.x);
      if (dx < width * GameConfig.timing.refocusSafetyZone) return false;
    }

    const forced = (s.loop - s.lastRefocus) >= interval * 4;
    return forced || true;
  }

  _generateScreenshotName() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const date = `${pad(now.getDate())}-${months[now.getMonth()]}-${now.getFullYear()}`;
    const time = `${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
    return `pong-result_${date}_${time}.png`;
  }

  _formatTimestamp() {
    return new Date().toLocaleString('en-IN', {
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

module.exports = GameOrchestrator;