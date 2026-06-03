const GameOrchestrator = require('./game-orchestrator');

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