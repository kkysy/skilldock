import assert from "node:assert/strict";
import { extractReadableHtml, isSafePublicHttpUrl } from "../shared/web.js";

assert.equal(isSafePublicHttpUrl("https://example.com/weather"), true);
assert.equal(isSafePublicHttpUrl("http://localhost:3000/"), false);
assert.equal(isSafePublicHttpUrl("http://127.0.0.1/"), false);
assert.equal(isSafePublicHttpUrl("http://192.168.1.1/"), false);
assert.equal(isSafePublicHttpUrl("https://example.com:8443/"), false);
assert.equal(isSafePublicHttpUrl("file:///etc/passwd"), false);

const page = extractReadableHtml(`<!doctype html><title>Weather &amp; news</title><meta name="description" content="Daily &amp; local"><main><h1>Tomorrow</h1><p>Sunny &amp; warm.</p><script>secret()</script></main>`);
assert.equal(page.title, "Weather & news");
assert.equal(page.description, "Daily & local");
assert.match(page.text, /Tomorrow/);
assert.match(page.text, /Sunny & warm/);
assert.doesNotMatch(page.text, /secret/);
console.log("web result reader helpers: passed");
