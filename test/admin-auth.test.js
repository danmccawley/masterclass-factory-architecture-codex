// Regression tests for owner authentication. All datastore requests are stubbed.
const assert = require("node:assert/strict");
const { test, beforeEach, afterEach, after } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const KEY = "test-owner-secret";
const admin = require("../api/admin.js");
const poll = require("../api/poll.js");
const embed = require("../api/template-embed.js");
const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "masterclass-admin-auth-"));
// Load the embedded deployment files in isolation, so missing dependencies fail.
for (const name of ["api/poll.js", "lib/admin-auth.js"]) {
  if (embed[name]) {
    const file = path.join(bundleRoot, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(embed[name], "base64"));
  }
}
const embeddedPoll = require(path.join(bundleRoot, "api/poll.js"));
after(() => fs.rmSync(bundleRoot, { recursive: true, force: true }));

let savedEnv, savedFetch, requests;
beforeEach(() => {
  savedEnv = { ...process.env };
  savedFetch = global.fetch;
  process.env.POLL_ADMIN_KEY = KEY;
  process.env.KV_REST_API_URL = "https://test.invalid";
  process.env.KV_REST_API_TOKEN = "test-kv-token";
  requests = [];
  global.fetch = async (url, options) => {
    assert.equal(url, "https://test.invalid/pipeline");
    const commands = JSON.parse(options.body);
    requests.push(commands);
    return { ok: true, json: async () => commands.map(([command]) => ({
      result: command === "HGETALL" ? ["0", "2", "1", "3"] : 1
    })) };
  };
});
afterEach(() => {
  for (const name of ["POLL_ADMIN_KEY", "KV_REST_API_URL", "KV_REST_API_TOKEN"]) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  global.fetch = savedFetch;
});

async function call(handler, url, headers, method) {
  const res = {
    statusCode: 200, headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end(value) { this.body = JSON.parse(value); }
  };
  await handler({ url, headers, method }, res);
  return res;
}

const targets = [
  { name: "admin summary", handler: admin, url: "/api/admin", method: "GET", disabled: 503 },
  { name: "poll reset", handler: poll, url: "/api/poll?qid=test&reset=1", method: "POST", disabled: 403 },
  { name: "embedded poll reset", handler: embeddedPoll, url: "/api/poll?qid=test&reset=1", method: "POST", disabled: 403 }
];

for (const target of targets) {
  const invoke = (headers, query = "") => call(target.handler,
    target.url + (query ? (target.url.includes("?") ? "&" : "?") + query : ""), headers, target.method);

  for (const query of ["key=" + KEY, "%6bey=" + KEY, "key=wrong&key=" + KEY]) {
    test(target.name + " rejects query-only credentials: " + query.split("=")[0], async () => {
      assert.equal((await invoke(undefined, query)).statusCode, 403);
      assert.deepEqual(requests, [], "unauthorized requests must not access KV");
    });
  }
  for (const [name, headers] of [
    ["x-admin-key", { "x-admin-key": KEY }],
    ["Bearer", { authorization: "Bearer " + KEY }],
    ["case-insensitive Bearer with whitespace", { authorization: "bEaReR\t" + KEY + " " }],
    ["legacy raw Authorization", { authorization: KEY }]
  ]) {
    test(target.name + " accepts " + name + " and ignores query credentials", async () => {
      const res = await invoke(headers, "key=wrong");
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      if (target.handler === admin) {
        assert.equal(res.body.summary.classes, res.body.classes.length);
        assert.ok(res.body.classes.some(item => item.slug === "bake-bread"));
      } else assert.deepEqual(requests, [[["DEL", "poll:test"]]]);
    });
  }
  for (const [name, headers] of [
    ["missing", undefined], ["empty", {}],
    ["wrong key", { "x-admin-key": "incorrect" }],
    ["wrong Bearer", { authorization: "Bearer incorrect" }],
    ["empty Bearer", { authorization: "Bearer " }],
    ["unsupported scheme", { authorization: "Basic " + KEY }],
    ["array header", { "x-admin-key": [KEY] }],
    ["array Authorization", { authorization: ["Bearer " + KEY] }],
    ["conflicting headers", { "x-admin-key": "incorrect", authorization: "Bearer " + KEY }]
  ]) {
    test(target.name + " rejects " + name + " headers despite a valid query key", async () => {
      assert.equal((await invoke(headers, "key=" + KEY)).statusCode, 403);
      assert.deepEqual(requests, []);
    });
  }
  for (const configured of [undefined, "", "   "]) {
    test(target.name + " fails closed with an unconfigured key: " + JSON.stringify(configured), async () => {
      if (configured === undefined) delete process.env.POLL_ADMIN_KEY;
      else process.env.POLL_ADMIN_KEY = configured;
      assert.equal((await invoke({ "x-admin-key": KEY })).statusCode, target.disabled);
      assert.deepEqual(requests, []);
    });
  }
}

test("admin summary preserves GET-only contract", async () => {
  assert.equal((await call(admin, "/api/admin", { "x-admin-key": KEY }, "POST")).statusCode, 405);
});

for (const [name, handler] of [["runtime", poll], ["embedded", embeddedPoll]]) {
  for (const method of ["GET", "PUT", "DELETE"]) {
    test(name + " poll reset requires POST (rejects " + method + ")", async () => {
      const res = await call(handler, "/api/poll?qid=test&reset=1", { "x-admin-key": KEY }, method);
      assert.equal(res.statusCode, 405);
      assert.deepEqual(requests, []);
    });
  }
  test(name + " public poll reads and voting remain unauthenticated", async () => {
    delete process.env.POLL_ADMIN_KEY;
    const read = await call(handler, "/api/poll?qid=test&n=2", {}, "GET");
    assert.equal(read.statusCode, 200);
    assert.deepEqual(read.body, { counts: [2, 3] });
    const vote = await call(handler, "/api/poll?qid=test&n=2&opt=1", {}, "POST");
    assert.equal(vote.statusCode, 200);
    assert.deepEqual(vote.body, { counts: [2, 3] });
    assert.deepEqual(requests, [[["HGETALL", "poll:test"]],
      [["HINCRBY", "poll:test", "1", "1"], ["HGETALL", "poll:test"]]]);
  });
}

test("embedded poll authentication files match their source templates", () => {
  for (const name of ["api/poll.js", "lib/admin-auth.js"]) {
    assert.equal(typeof embed[name], "string", name + " must be embedded");
    assert.equal(Buffer.from(embed[name], "base64").toString("utf8"),
      fs.readFileSync(path.join(__dirname, "../template", name), "utf8"));
  }
});
