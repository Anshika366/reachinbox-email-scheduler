const { RedisMemoryServer } = require("redis-memory-server");

async function start() {
  const server = new RedisMemoryServer({
    instance: {
      port: 6379
    }
  });

  await server.start();
  console.log("Redis server is listening on port 6379");
}

start();
