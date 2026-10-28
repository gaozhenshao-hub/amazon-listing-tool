import test from "node:test";
import assert from "node:assert/strict";
import { checkRuntimeIdentifiers } from "./check-client-runtime-identifiers.mjs";

const logger = { log() {}, error() {} };
test("compiler failures and interruptions never pass the runtime gate", () => {
  for (const result of [
    { status: null, signal: "SIGKILL" },
    { status: null, error: new Error("ETIMEDOUT") },
    { status: null, error: new Error("ENOENT") },
    { status: 137 },
    { status: 1, stdout: "Some unrelated compiler error" },
    {
      status: 0,
      stdout:
        "client/src/page.tsx(1,2): error TS2304: Cannot find name 'missing'.",
    },
  ]) {
    assert.equal(checkRuntimeIdentifiers({ run: () => result, logger }), 1);
  }
});
test("successful compiler uses bounded memory and a portable node entry point", () => {
  let observed;
  assert.equal(
    checkRuntimeIdentifiers({
      env: {},
      logger,
      run: (...args) => {
        observed = args;
        return { status: 0, stdout: "", stderr: "" };
      },
    }),
    0
  );
  assert.equal(observed[0], process.execPath);
  assert.equal(observed[2].env.NODE_OPTIONS, "--max-old-space-size=4096");
  assert.equal(observed[2].timeout, 600_000);
});
test("explicit runner memory budget is preserved", () => {
  checkRuntimeIdentifiers({
    env: { NODE_OPTIONS: "--max-old-space-size=2048" },
    logger,
    run: (_command, _args, options) => {
      assert.equal(options.env.NODE_OPTIONS, "--max-old-space-size=2048");
      return { status: 0 };
    },
  });
});
