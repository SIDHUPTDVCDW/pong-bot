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

module.exports = injectPixelAnalyzer;