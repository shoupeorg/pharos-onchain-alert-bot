const $=id=>document.getElementById(id);
const val=id=>$(id).value.trim();
const headers=()=>({"content-type":"application/json","authorization":"Bearer "+val("ownerToken")});
const show=(message,kind="")=>{const n=$("notice");n.textContent=message;n.className="notice "+kind};
async function call(path,body){const r=await fetch(path,{method:"POST",headers:headers(),body:body?JSON.stringify(body):"{}"});const j=await r.json();if(!r.ok)throw new Error(j.error||"Request failed");return j}
async function refresh(){
  try{
    const [s,e]=await Promise.all([fetch("/api/public/status").then(r=>r.json()),fetch("/api/public/events").then(r=>r.json())]);
    const m=s.monitor||{};$("state").textContent=m.state||"NOT CONFIGURED";$("scheduled").textContent=m.lastScheduledCheck||"—";$("success").textContent=m.lastSuccessfulCheck||"—";$("range").textContent=m.processedRange?m.processedRange.join(" – "):"—";$("next").textContent=m.nextCheck||"—";$("cursorBlock").textContent=m.cursorBlock??"—";$("channel").textContent=s.channelConfigured?"CONFIGURED":"NOT CONFIGURED";$("failure").textContent=m.failure||"NONE";$("engine").textContent="ENGINE "+s.engine;
    show(s.channelConfigured?"Channel configured. Owner actions remain protected.":"Channel secret is not configured; detection can run but real delivery cannot complete.",s.channelConfigured?"good":"");
    const rows=(e.events||[]).map(x=>`<tr><td><code>${esc(x.event_key)}</code></td><td>${esc(x.amount_raw)} raw ${esc(x.symbol)}</td><td><code>${esc(x.sender)}</code><br>→<br><code>${esc(x.recipient)}</code></td><td>${x.block_number}<br><a target="_blank" rel="noopener noreferrer" href="https://pharosscan.xyz/tx/${encodeURIComponent(x.tx_hash)}">Open transaction</a></td><td>${esc(x.detection_mode)}</td><td>${esc(x.delivery_state||"DETECTED")}${x.message_id?"<br>ID "+esc(x.message_id):""}</td></tr>`).join("");
    $("events").innerHTML=rows||'<tr><td colspan="6">No saved events.</td></tr>';
  }catch(e){show(e.message,"bad")}
}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
$("configure").onclick=async()=>{try{await call("/api/owner/configure",{token:val("token"),minimumAmount:val("minimumAmount"),confirmationDelay:Number(val("confirmationDelay")),sender:val("sender"),recipient:val("recipient"),backfillFromBlock:val("backfillFromBlock")});show("Configuration saved and paused.","good");await refresh()}catch(e){show(e.message,"bad")}};
for(const action of ["start","pause","resume","run","test-channel"])$(action).onclick=async()=>{try{await call("/api/owner/"+action);show(action+" completed.","good");await refresh()}catch(e){show(e.message,"bad")}};
refresh();setInterval(refresh,15000);

