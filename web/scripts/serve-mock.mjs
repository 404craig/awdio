// Starts the Vite dev server in mock mode on a free port; shared by the screenshot and perf scripts.
import { createServer } from "vite";

export async function startMockServer(port = 5198) {
  const server = await createServer({
    mode: "mock",
    configFile: new URL("../vite.config.ts", import.meta.url).pathname,
    root: new URL("..", import.meta.url).pathname,
    server: { port, strictPort: false },
    logLevel: "warn",
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0]?.replace(/\/$/, "") ?? `http://localhost:${port}`;
  return { url, close: () => server.close() };
}
