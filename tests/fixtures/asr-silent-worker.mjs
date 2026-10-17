// A child that starts but never says ready (tests the pool's start timeout).
setInterval(() => {}, 1000);
process.on("disconnect", () => process.exit(0));
