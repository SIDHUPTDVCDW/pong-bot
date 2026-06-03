const GameConfig = Object.freeze({
  browser: {
    headless: false,       // true = headless, false = headed
    viewportWidth: 1280,
    viewportHeight: 800
  },
  url: 'https://www.ponggame.org/',
  menu: {
    players: '1',
    input: 'k',
    difficulty: 'h',
    stepDelay: 200,
    loadDelay: 400
  },
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

module.exports = GameConfig;