import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
test("owner mutation rejects missing owner authentication",async()=>{const env={OWNER_TOKEN:"secret",ASSETS:{fetch:()=>new Response("asset")}};const r=await worker.fetch(new Request("https://example.test/api/owner/start",{method:"POST"}),env);assert.equal(r.status,401);assert.equal((await r.json()).error,"OWNER_AUTH_REQUIRED")});
test("public assets do not require owner authentication",async()=>{const env={ASSETS:{fetch:()=>new Response("ok",{status:200})}};const r=await worker.fetch(new Request("https://example.test/"),env);assert.equal(r.status,200);assert.equal(await r.text(),"ok")});
