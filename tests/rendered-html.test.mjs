import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the VeilRisk product surface", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>VeilRisk/);
  assert.match(html, /Prove the policy/);
  assert.match(html, /Private portfolio compliance/);
  assert.match(html, /Portfolio allocation/);
  assert.match(html, /Compliance preview/);
  assert.match(html, /Local prototype/);
  assert.match(html, /not on-chain/i);
  assert.doesNotMatch(html, /Midnight · Preprod|vr_[a-z0-9]+/i);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview/);
});
