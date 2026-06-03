const GameConfig = require('./config');

class PhysicsEngine {
  static reflectY(y, height) {
    if (height <= 0) return 0;
    const period = 2 * height;
    y = ((y % period) + period) % period;
    return y <= height ? y : period - y;
  }

  static predictIntercept(ball, vx, vy, paddleX, height) {
    const dx = Math.abs(paddleX - ball.x);
    if (dx <= 0) return null;
    const frames = dx / Math.abs(vx);
    const y = this.reflectY(ball.y + vy * frames, height);
    return { y, frames };
  }

  static anticipateReturn(ball, vx, vy, paddleX, opponentX, height) {
    const absVx = Math.max(Math.abs(vx), GameConfig.prediction.minVelocityFallback);
    const totalFrames = (Math.abs(opponentX - ball.x) + Math.abs(paddleX - opponentX)) / absVx;
    const returnY = this.reflectY(ball.y + vy * totalFrames, height);
    return returnY * 0.55 + height * 0.225;
  }

  static calculateSpin(dx, predicted, oppPaddle, height) {
    if (dx >= GameConfig.spin.activationRange) return 0;
    const direction = oppPaddle
      ? (oppPaddle.y > height / 2 ? -1 : 1)
      : (predicted > height / 2 ? -1 : 1);
    const closeness = 1 - (dx / GameConfig.spin.activationRange);
    return GameConfig.spin.offset * closeness * direction;
  }
}

module.exports = PhysicsEngine;