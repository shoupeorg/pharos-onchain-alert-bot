import { CHAIN_ID, decodeTransfer, matches, makeAlert, nextRange, normalizeAddress, parseUnits } from "./core.js";
import { RpcReader, readMetadata } from "./rpc.js";

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
  return { state: m.state, config: { ...c, webhookConfigured: undefined }, cursorBlock: m.cursor_block, lastScheduledCheck: m.last_scheduled_at, lastSuccessfulCheck: m.last_success_at, processedRange: m.last_range_from == null ? null : [m.last_range_from, m.last_range_to], nextCheck: m.next_check_at, failure: m.last_error };
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
  if (!env.DISCORD_WEBHOOK_URL) return { blocked: true, reason: "CHANNEL_SECRET_NOT_CONFIGURED" };
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
    const url=env.DISCORD_WEBHOOK_URL+(env.DISCORD_WEBHOOK_URL.includes("?")?"&":"?")+"wait=true";
    const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({content,allowed_mentions:{parse:[]}}),signal:controller.signal});
    const text=await response.text();
    if(response.ok){
      let messageId=null; try{messageId=JSON.parse(text).id||null}catch{}
      if(!messageId) throw new Error("Discord accepted the request without a message ID.");
      await env.DB.prepare("UPDATE outbox SET state='DELIVERED',message_id=?,response_status=?,delivered_at=?,updated_at=?,last_error=NULL WHERE event_key=? AND state='DELIVERING'").bind(messageId,response.status,now(),now(),e.event_key).run();
    } else if(response.status===429){
      let retry=5; try{retry=Math.max(1,Math.min(300,Number(JSON.parse(text).retry_after)||5))}catch{}
      await env.DB.prepare("UPDATE outbox SET state='RETRYABLE_FAILURE',response_status=429,next_attempt_at=?,last_error='Discord rate limited delivery.',updated_at=? WHERE event_key=? AND state='DELIVERING'").bind(new Date(Date.now()+retry*1000).toISOString(),now(),e.event_key).run();
    } else if(response.status>=500){
      await env.DB.prepare("UPDATE outbox SET state='RETRYABLE_FAILURE',response_status=?,next_attempt_at=?,last_error=?,updated_at=? WHERE event_key=? AND state='DELIVERING'").bind(response.status,new Date(Date.now()+60000).toISOString(),"Discord server rejected delivery.",now(),e.event_key).run();
    } else {
      await env.DB.prepare("UPDATE outbox SET state='REJECTED',response_status=?,last_error=?,updated_at=? WHERE event_key=? AND state='DELIVERING'").bind(response.status,"Discord definitively rejected delivery.",now(),e.event_key).run();
    }
  } catch(error) {
    await env.DB.prepare("UPDATE outbox SET state='UNKNOWN_DELIVERY',last_error=?,updated_at=? WHERE event_key=? AND state='DELIVERING'").bind("Delivery outcome is ambiguous after network/timeout failure; automatic resend is disabled.",now(),e.event_key).run();
  } finally { clearTimeout(timer); }
}
async function api(request, env, path) {
  if(path==="/api/public/status") return json({engine:env.ENGINE_VERSION,chainId:CHAIN_ID,monitor:publicMonitor(await row(env)),channelConfigured:Boolean(env.DISCORD_WEBHOOK_URL)});
  if(path==="/api/public/events") return json({events:await listEvidence(env)});
  if(!owner(request,env)) return json({error:"OWNER_AUTH_REQUIRED"},401);
  if(path==="/api/owner/configure"&&request.method==="POST") return json(await configure(request,env));
  if(path==="/api/owner/start"&&request.method==="POST") return json(await setState(env,"ACTIVE"));
  if(path==="/api/owner/pause"&&request.method==="POST") return json(await setState(env,"PAUSED"));
  if(path==="/api/owner/resume"&&request.method==="POST") return json(await setState(env,"ACTIVE"));
  if(path==="/api/owner/run"&&request.method==="POST") return json(await detect(env,"OWNER_MANUAL"));
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
