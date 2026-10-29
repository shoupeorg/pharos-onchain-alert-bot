import { CHAIN_ID, decodeTransfer, matches, makeAlert, nextRange, normalizeAddress, parseUnits } from "./core.js";
import { RpcReader, readMetadata } from "./rpc.js";
import { classifyTelegramResponse, telegramRequest } from "./telegram.js";

const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const now = () => new Date().toISOString();
function owner(request, env) {
  const expected = env.OWNER_TOKEN;
  const supplied = request.headers.get("authorization") || "";
  return Boolean(expected && supplied === "Bearer " + expected);
}
async function row(env) { return env.DB.prepare("SELECT * FROM monitor WHERE id=1").first(); }
function publicMonitor(m) {
  if (!m) return null;
  const c = JSON.parse(m.config_json);
  return { state: m.state, config: c, cursorBlock: m.cursor_block, lastScheduledCheck: m.last_scheduled_at, lastSuccessfulCheck: m.last_success_at, processedRange: m.last_range_from == null ? null : [m.last_range_from, m.last_range_to], nextCheck: m.next_check_at, failure: m.last_error };
}
async function listEvidence(env) {
  const result = await env.DB.prepare(`SELECT e.*,o.state delivery_state,o.message_id,o.response_status,o.last_error delivery_error,o.delivered_at
    FROM events e LEFT JOIN outbox o USING(event_key) ORDER BY e.block_number DESC,e.log_index DESC LIMIT 100`).all();
  return result.results || [];
}
async function configure(request, env) {
  const body = await request.json();
  const reader = new RpcReader(env.RPC_URL);
  await reader.verifyChain();
  const metadata = await readMetadata(reader, body.token);
  const confirmationDelay = Number(body.confirmationDelay ?? 12);
  if (!Number.isInteger(confirmationDelay) || confirmationDelay < 0 || confirmationDelay > 10000) throw new Error("Confirmation delay must be an integer from 0 to 10000 blocks.");
  const thresholdDisplay = String(body.minimumAmount ?? "");
  const config = {
    ...metadata,
    thresholdDisplay,
    thresholdRaw: parseUnits(thresholdDisplay, metadata.decimals).toString(),
    sender: normalizeAddress(body.sender, "sender"),
    recipient: normalizeAddress(body.recipient, "recipient"),
    confirmationDelay,
    detectionMode: body.backfillFromBlock == null || body.backfillFromBlock === "" ? "LIVE_MONITOR" : "HISTORICAL_BACKFILL"
  };
  const head = await reader.latestBlock();
  let cursor = head - confirmationDelay + 1;
  if (config.detectionMode === "HISTORICAL_BACKFILL") {
    cursor = Number(body.backfillFromBlock);
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > head) throw new Error("Backfill start block is invalid.");
    if (head - cursor > 10000) throw new Error("Historical backfill is bounded to the most recent 10,000 blocks.");
  }
  const t = now();
  await env.DB.prepare(`INSERT INTO monitor(id,config_json,state,cursor_block,updated_at)
    VALUES(1,?,'PAUSED',?,?) ON CONFLICT(id) DO UPDATE SET config_json=excluded.config_json,state='PAUSED',cursor_block=excluded.cursor_block,last_error=NULL,updated_at=excluded.updated_at`)
    .bind(JSON.stringify(config), cursor, t).run();
  return { config, state: "PAUSED", cursorBlock: cursor };
}
async function setState(env, state) {
  const result = await env.DB.prepare("UPDATE monitor SET state=?,updated_at=? WHERE id=1").bind(state, now()).run();
  if (!result.meta.changes) throw new Error("Configure a monitor first.");
  return publicMonitor(await row(env));
}
async function detect(env, trigger = "SCHEDULED") {
  const m = await row(env);
  if (!m || m.state !== "ACTIVE") return { skipped: true, reason: !m ? "NOT_CONFIGURED" : "NOT_ACTIVE" };
  const scheduledAt = now(), nextCheck = new Date(Date.now() + 60000).toISOString();
  await env.DB.prepare("UPDATE monitor SET last_scheduled_at=?,next_check_at=?,updated_at=? WHERE id=1").bind(scheduledAt, nextCheck, scheduledAt).run();
  try {
    const config = JSON.parse(m.config_json), reader = new RpcReader(env.RPC_URL);
    await reader.verifyChain();
    const confirmedHead = (await reader.latestBlock()) - config.confirmationDelay;
    const range = nextRange(m.cursor_block, confirmedHead);
    if (!range) {
      await env.DB.prepare("UPDATE monitor SET last_success_at=?,last_error=NULL,updated_at=? WHERE id=1").bind(now(), now()).run();
      return { processed: 0, range: null };
    }
    const rawLogs = await reader.logs(config.token, range.from, range.to);
    const matched = rawLogs.filter(x => !x.removed).map(x => decodeTransfer(x, config)).filter(x => matches(x, config));
    const t = now(), statements = [];
    for (const e of matched) {
      statements.push(env.DB.prepare(`INSERT INTO events(event_key,chain_id,token,symbol,decimals,amount_raw,sender,recipient,block_number,tx_hash,log_index,detection_mode,detected_at,config_snapshot)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_key) DO NOTHING`).bind(e.eventKey,e.chainId,e.token,e.symbol,e.decimals,e.amountRaw,e.sender,e.recipient,e.blockNumber,e.txHash,e.logIndex,config.detectionMode,t,JSON.stringify(config)));
      statements.push(env.DB.prepare(`INSERT INTO outbox(event_key,state,queued_at,updated_at) SELECT ?,'QUEUED',?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_key=?) ON CONFLICT(event_key) DO NOTHING`).bind(e.eventKey,t,t,e.eventKey));
    }
    statements.push(env.DB.prepare("UPDATE monitor SET cursor_block=?,last_success_at=?,last_range_from=?,last_range_to=?,last_error=NULL,updated_at=? WHERE id=1").bind(range.to+1,t,range.from,range.to,t));
    await env.DB.batch(statements);
    await deliverQueued(env);
    return { trigger, processed: matched.length, sourceLogs: rawLogs.length, range };
  } catch (error) {
    await env.DB.prepare("UPDATE monitor SET last_error=?,updated_at=? WHERE id=1").bind(String(error.message).slice(0,500),now()).run();
    throw error;
  }
}
async function deliverQueued(env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return { blocked: true, reason: "CHANNEL_SECRET_NOT_CONFIGURED" };
  const candidates = await env.DB.prepare(`SELECT e.*,o.attempts FROM outbox o JOIN events e USING(event_key)
    WHERE o.state IN ('QUEUED','RETRYABLE_FAILURE') AND (o.next_attempt_at IS NULL OR o.next_attempt_at<=?) ORDER BY o.queued_at LIMIT 10`).bind(now()).all();
  for (const e of candidates.results || []) await deliverOne(env, e);
  return { considered: candidates.results?.length || 0 };
}
async function deliverOne(env, e) {
  const t=now(), claimed=await env.DB.prepare(`UPDATE outbox SET state='DELIVERING',attempts=attempts+1,updated_at=? WHERE event_key=? AND state IN ('QUEUED','RETRYABLE_FAILURE')`).bind(t,e.event_key).run();
  if (!claimed.meta.changes) return;
  const config=JSON.parse(e.config_snapshot), event={eventKey:e.event_key,chainId:e.chain_id,token:e.token,symbol:e.symbol,decimals:e.decimals,amountRaw:e.amount_raw,sender:e.sender,recipient:e.recipient,blockNumber:e.block_number,txHash:e.tx_hash,logIndex:e.log_index};
  const content=makeAlert(event,config,env.EXPLORER_TX_BASE);
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),10000);
  try {
    const request=telegramRequest(env.TELEGRAM_BOT_TOKEN,env.TELEGRAM_CHAT_ID,content);
    const response=await fetch(request.url,{...request.init,signal:controller.signal});
    const text=await response.text(), outcome=classifyTelegramResponse(response.status,text);
    if(outcome.kind==="DELIVERED"){
      await env.DB.prepare("UPDATE outbox SET state='DELIVERED',message_id=?,response_status=?,delivered_at=?,updated_at=?,last_error=NULL WHERE event_key=? AND state='DELIVERING'").bind(outcome.messageId,response.status,now(),now(),e.event_key).run();
    } else if(outcome.kind==="RATE_LIMIT"){
      await env.DB.prepare("UPDATE outbox SET state='RETRYABLE_FAILURE',response_status=429,next_attempt_at=?,last_error=?,updated_at=? WHERE event_key=? AND state='DELIVERING'").bind(new Date(Date.now()+outcome.retryAfter*1000).toISOString(),outcome.error,now(),e.event_key).run();
    } else if(outcome.kind==="RETRYABLE_FAILURE"){
      await env.DB.prepare("UPDATE outbox SET state='RETRYABLE_FAILURE',response_status=?,next_attempt_at=?,last_error=?,updated_at=? WHERE event_key=? AND state='DELIVERING'").bind(response.status,new Date(Date.now()+60000).toISOString(),outcome.error,now(),e.event_key).run();
    } else {
      await env.DB.prepare("UPDATE outbox SET state='REJECTED',response_status=?,last_error=?,updated_at=? WHERE event_key=? AND state='DELIVERING'").bind(response.status,outcome.error,now(),e.event_key).run();
    }
  } catch(error) {
    await env.DB.prepare("UPDATE outbox SET state='UNKNOWN_DELIVERY',last_error=?,updated_at=? WHERE event_key=? AND state='DELIVERING'").bind("Delivery outcome is ambiguous after network/timeout failure; automatic resend is disabled.",now(),e.event_key).run();
  } finally { clearTimeout(timer); }
}
async function sendSetupTest(env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) throw new Error("Telegram secrets are not configured.");
  const existing=await env.DB.prepare("SELECT * FROM channel_evidence WHERE kind='SETUP_TEST'").first();
  if(existing && existing.state!=="RETRYABLE_FAILURE") return {kind:existing.kind,state:existing.state,messageId:existing.message_id,alreadyAttempted:true};
  const t=now();
  if(!existing) await env.DB.prepare("INSERT INTO channel_evidence(kind,state,created_at,updated_at) VALUES('SETUP_TEST','DELIVERING',?,?)").bind(t,t).run();
  else {
    const claim=await env.DB.prepare("UPDATE channel_evidence SET state='DELIVERING',updated_at=? WHERE kind='SETUP_TEST' AND state='RETRYABLE_FAILURE'").bind(t).run();
    if(!claim.meta.changes) return {kind:"SETUP_TEST",state:"NOT_CLAIMED"};
  }
  const text="PHAROS ON-CHAIN ALERT BOT — SETUP TEST\nChannel: owner-authorized private Telegram chat\nNetwork monitor: Pharos Pacific Mainnet (chain ID 1672)\nThis is a setup test only; it is not an on-chain event alert.";
  const request=telegramRequest(env.TELEGRAM_BOT_TOKEN,env.TELEGRAM_CHAT_ID,text);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try {
    const response=await fetch(request.url,{...request.init,signal:controller.signal});
    const body=await response.text(),outcome=classifyTelegramResponse(response.status,body);
    if(outcome.kind==="DELIVERED"){
      await env.DB.prepare("UPDATE channel_evidence SET state='DELIVERED',message_id=?,response_status=?,delivered_at=?,last_error=NULL,updated_at=? WHERE kind='SETUP_TEST' AND state='DELIVERING'").bind(outcome.messageId,response.status,now(),now()).run();
      return {kind:"SETUP_TEST",state:"DELIVERED",messageId:outcome.messageId};
    }
    const state=outcome.kind==="RATE_LIMIT"?"RETRYABLE_FAILURE":outcome.kind;
    await env.DB.prepare("UPDATE channel_evidence SET state=?,response_status=?,last_error=?,updated_at=? WHERE kind='SETUP_TEST' AND state='DELIVERING'").bind(state,response.status,outcome.error,now()).run();
    return {kind:"SETUP_TEST",state,error:outcome.error};
  } catch(error) {
    await env.DB.prepare("UPDATE channel_evidence SET state='UNKNOWN_DELIVERY',last_error=?,updated_at=? WHERE kind='SETUP_TEST' AND state='DELIVERING'").bind("Setup delivery outcome is ambiguous after network/timeout failure; automatic resend is disabled.",now()).run();
    return {kind:"SETUP_TEST",state:"UNKNOWN_DELIVERY"};
  } finally {clearTimeout(timer);}
}
async function api(request, env, path) {
  if(path==="/api/public/status"){ const channelEvidence=await env.DB.prepare("SELECT kind,state,message_id,response_status,last_error,delivered_at FROM channel_evidence ORDER BY updated_at DESC LIMIT 5").all(); return json({engine:env.ENGINE_VERSION,chainId:CHAIN_ID,channel:"TELEGRAM",monitor:publicMonitor(await row(env)),channelConfigured:Boolean(env.TELEGRAM_BOT_TOKEN&&env.TELEGRAM_CHAT_ID),channelEvidence:channelEvidence.results||[]}); }
  if(path==="/api/public/events") return json({events:await listEvidence(env)});
  if(!owner(request,env)) return json({error:"OWNER_AUTH_REQUIRED"},401);
  if(path==="/api/owner/configure"&&request.method==="POST") return json(await configure(request,env));
  if(path==="/api/owner/start"&&request.method==="POST") return json(await setState(env,"ACTIVE"));
  if(path==="/api/owner/pause"&&request.method==="POST") return json(await setState(env,"PAUSED"));
  if(path==="/api/owner/resume"&&request.method==="POST") return json(await setState(env,"ACTIVE"));
  if(path==="/api/owner/run"&&request.method==="POST") return json(await detect(env,"OWNER_MANUAL"));
  if(path==="/api/owner/test-channel"&&request.method==="POST") return json(await sendSetupTest(env));
  return json({error:"NOT_FOUND"},404);
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    try { return url.pathname.startsWith("/api/") ? await api(request,env,url.pathname) : env.ASSETS.fetch(request); }
    catch(error){ return json({error:String(error.message||error)},400); }
  },
  async scheduled(_controller,env,ctx){ ctx.waitUntil(detect(env,"CLOUDFLARE_CRON").catch(()=>{})); }
};
export { detect, deliverQueued };


