import test from "node:test";
import assert from "node:assert/strict";
import { classifyTelegramResponse, telegramRequest, validateTelegramSecrets } from "../src/telegram.js";

const token="123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcd";
test("Telegram request targets sendMessage and preserves exact private chat ID",()=>{
  const request=telegramRequest(token,"987654321","hello");
  assert.equal(request.url,"https://api.telegram.org/bot"+token+"/sendMessage");
  const body=JSON.parse(request.init.body);
  assert.deepEqual(body,{chat_id:"987654321",text:"hello",link_preview_options:{is_disabled:true}});
});
test("Telegram success requires a returned message ID",()=>{
  assert.deepEqual(classifyTelegramResponse(200,JSON.stringify({ok:true,result:{message_id:42}})),{kind:"DELIVERED",messageId:"42"});
  assert.equal(classifyTelegramResponse(200,JSON.stringify({ok:true,result:{}})).kind,"REJECTED");
});
test("Telegram rate limit uses bounded retry_after",()=>{
  assert.deepEqual(classifyTelegramResponse(429,JSON.stringify({ok:false,description:"Too Many Requests",parameters:{retry_after:9}})),{kind:"RATE_LIMIT",retryAfter:9,error:"Too Many Requests"});
  assert.equal(classifyTelegramResponse(429,JSON.stringify({parameters:{retry_after:9999}})).retryAfter,300);
});
test("Telegram definite rejection and server failure remain distinct",()=>{
  assert.equal(classifyTelegramResponse(403,JSON.stringify({ok:false,description:"bot was blocked"})).kind,"REJECTED");
  assert.equal(classifyTelegramResponse(503,"unavailable").kind,"RETRYABLE_FAILURE");
});
test("Telegram secrets reject malformed values",()=>{
  assert.throws(()=>validateTelegramSecrets("bad","123"),/token/);
  assert.throws(()=>validateTelegramSecrets(token,"not-a-chat"),/chat ID/);
});
