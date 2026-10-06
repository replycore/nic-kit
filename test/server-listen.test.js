import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

const indexUrl = new URL("../index.js", import.meta.url).href;

// 回归：主 HTTP server 曾经没有 'error' 监听，端口被占时以未捕获异常直接崩溃。
// 现在应输出一句明确的状态行并 exit(1)。
test("端口被占：startServer 友好报错并 exit(1)，而不是未捕获异常崩溃", async () => {
  const blocker = createServer((req, res) => res.end("ok"));
  await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const port = blocker.address().port;
  try {
    const code = [
      `process.env.NIC_SKIP_MAIN = "1";`,
      `const { startServer } = await import(${JSON.stringify(indexUrl)});`,
      `startServer({ port: ${port} }, { status: () => ({ ok: true }) });`,
      // 8s 还没退出说明 error 监听没生效（旧行为会直接崩溃，这里是保险）
      `setTimeout(() => { console.error("TIMEOUT: server did not exit"); process.exit(42); }, 8000).unref();`,
    ].join("\n");
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    const exitCode = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(exitCode, 1, `expected exit 1, got ${exitCode}\n${out}`);
    assert.match(out, /cannot listen/, `missing friendly message\n${out}`);
    assert.match(out, /EADDRINUSE/, `missing error code\n${out}`);
    assert.doesNotMatch(out, /TIMEOUT/, `server error handler did not fire\n${out}`);
  } finally {
    blocker.close();
  }
});
