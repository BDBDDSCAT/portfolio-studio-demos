#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (
  args.length &&
  (args.length !== 2 || args[0] !== "--port" || !/^\d+$/.test(args[1]))
) {
  process.stderr.write("Usage: node bin/serve.js [--port 8080]\n");
  process.exit(1);
}
const port = args.length ? Number(args[1]) : 8080;
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  process.stderr.write("Port must be an integer between 1 and 65535.\n");
  process.exit(1);
}
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".md": "text/plain; charset=utf-8",
};
const server = createServer(async (request, response) => {
  try {
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }
    const path = decodeURIComponent(
      new URL(request.url, "http://127.0.0.1").pathname,
    );
    let file = resolve(root, `.${path}`);
    if (file !== root && !file.startsWith(`${root}${sep}`)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
    const content = await readFile(file);
    response.writeHead(200, {
      "Content-Type": mime[extname(file)] ?? "application/octet-stream",
      "Content-Length": content.length,
      "Cache-Control": "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    const status =
      error instanceof URIError
        ? 400
        : ["ENOENT", "ENOTDIR", "EISDIR"].includes(error.code)
          ? 404
          : 500;
    response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(
      status === 404
        ? "Not found"
        : status === 400
          ? "Bad request"
          : "Server error",
    );
  }
});
server.on("error", (error) => {
  process.stderr.write(`thinfilm serve: ${error.message}\n`);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
  process.stdout.write(`Thinfilm: http://127.0.0.1:${port}\n`),
);
process.on("SIGINT", () => server.close());
