
// ===== Live data =====
// Set CONFIG.api to the backend URL at launch (e.g. "https://api.exposure.fun").
// The site calls GET {api}/state and fills every page from it. Until then everything shows empty states.
const CONFIG={
  api:"/api",
  xLink:false,        // X account linking (off for now; turn on once the X developer app is set up)
  demo:false,         // sample data + live simulation (preview only). Keep false for the live site
  refreshMs:20000,
  botWallet:"",       // claims fees + sends payouts
  top20Wallet:"H6cXX7wzgdVizvMT7yumtd7qcXR7YUBfyt11J51wvZzV",     // Top 20 bonus wallet
  extraLaunchPrograms:[], // add a program id here only if pump.fun launches need it (e.g. custom pairs)
  xpMint:"",          // $EXPO contract address, set on launch day
  reserveWallet:"4mxjihySJSjKD21xWpz6pCMYUQ6HZGyiFbJKbQC6JHGY",   // public $EXPO buyback reserve wallet
  top20Wallet:"H6cXX7wzgdVizvMT7yumtd7qcXR7YUBfyt11J51wvZzV"      // Top 20 bonus wallet
};
let DEMO_ON=false,demoTimer=null,DEMO_ME=null,XIDX={};
// ===== security: clean everything the server sends before it touches the page =====
// Numbers become real numbers, enums are checked against allowed values, image URLs must be https (or a safe data: image),
// and anything else is forced to a plain string. Rendering code then escapes strings as before.
const NUMK=new Set(["pool","mc","calls","paid","fee","createdAt","at","t","sol","likes","hl","n","wt","sc","earned","calls30","wins","wins30","avgPeak","bestX","avgPeak30","bestX30","earned30","stars","starsN","streak","gain","entered","balance","added","total","claimed","callers","top20","reserve","solUsd","top20Pool","paidTotal","xp","launchedAt","burned"]);
const ENUMK={pl:["pump","fomo","gmgn"],kind:["claim","payout","top20","reserve","burn","std","stock","crypto"]};
const IMGK=new Set(["img","avatar"]);
function safeImg(u){u=String(u||"");if(/^https:\/\/[^\s"'<>]+$/i.test(u))return u;if(/^data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,]/i.test(u)&&u.length<200000)return u;return ""}
function clean(v,k,depth=0){
  if(depth>8)return null;
  if(Array.isArray(v))return v.slice(0,2000).map(x=>clean(x,k,depth+1));
  if(v&&typeof v==="object"){const o={};for(const kk of Object.keys(v)){if(kk==="__proto__"||kk==="constructor"||kk==="prototype")continue;o[kk]=clean(v[kk],kk,depth+1)}return o}
  if(NUMK.has(k)){const n=Number(v);return Number.isFinite(n)?n:0}
  if(ENUMK[k])return ENUMK[k].includes(v)?v:ENUMK[k][0];
  if(IMGK.has(k))return safeImg(v);
  if(v==null||typeof v==="boolean")return v;
  return String(v).slice(0,500);
}
// only send people to places we expect
function safeRedirect(u,hosts){try{const x=new URL(u,location.href);return x.protocol==="https:"&&hosts.some(h=>x.hostname===h||x.hostname.endsWith("."+h))?x.href:null}catch(e){return null}}

// ===== launch transaction check: refuse to sign anything that isn't a plain pump.fun launch paid by you =====
const LAUNCH_PROGRAMS=new Set([
  "11111111111111111111111111111111",            // System
  "ComputeBudget111111111111111111111111111111", // Compute budget
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",  // SPL Token
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",  // Token-2022
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // Associated token accounts
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",  // Token metadata
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",  // pump.fun
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"   // PumpSwap
]);
(CONFIG.extraLaunchPrograms||[]).forEach(p=>LAUNCH_PROGRAMS.add(p));
function checkLaunchTx(vtx,me){
  const msg=vtx.message,keys=(msg.staticAccountKeys||msg.accountKeys||[]).map(k=>String(k));
  if(!keys.length||keys[0]!==me)return "This launch isn't set up to be paid by your wallet, so we stopped it.";
  if(msg.addressTableLookups&&msg.addressTableLookups.length)return "This launch uses an unexpected account lookup, so we stopped it.";
  const ix=msg.compiledInstructions||msg.instructions||[];
  for(const i of ix){const pid=keys[i.programIdIndex];if(!LAUNCH_PROGRAMS.has(pid))return "This launch includes an unexpected program, so we stopped it before your wallet opened."}
  // System-program transfers out of your wallet are only allowed to pump.fun-owned accounts in the same instruction set; anything else is refused
  for(const i of ix){if(keys[i.programIdIndex]!=="11111111111111111111111111111111")continue;const d=i.data;const tag=d&&d.length>=4?(d[0]|d[1]<<8|d[2]<<16|d[3]<<24):-1;
    if(tag===2){const to=keys[i.accountKeyIndexes?i.accountKeyIndexes[1]:i.accounts[1]];if(to&&!ix.some(j=>keys[j.programIdIndex]==="6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"&&(j.accountKeyIndexes||j.accounts).some(a=>keys[a]===to)))return "This launch tries to send SOL somewhere unexpected, so we stopped it."}}
  return null;
}

const W={pump:.45,fomo:.35,gmgn:.20},CAP=.5,THRESH=1,BONUS=n=>Math.min(1+.25*(n-1),1.75),NAMES={pump:"pump.fun",fomo:"Fomo",gmgn:"GMGN"};
const COLORS=["#3c7d0e","#5f8f10","#0e6a4c","#2f6b1a","#7a9a12","#14553a","#4d7a0a","#21602a"];
const colFor=s=>COLORS[[...String(s)].reduce((a,c)=>a+c.charCodeAt(0),0)%COLORS.length];
/* Shape returned by {api}/state:
  coins:   [{mint,t,n,img,mc,pool,calls,createdAt,paid}]          pool/paid in SOL, createdAt ms
  round:   {MINT:[{u,w,pl,n,likes,hl,wt}]}                        callouts since that coin's last payout
  callouts:[{u,w,coin,pl,n,likes,hl,sc,earned,at}]               scored callouts (leaderboard)
  callers: [{u,w,earned,calls,wins,avgPeak,bestX,calls30,wins30,avgPeak30,bestX30,earned30}]
  payouts: [{u,w,coin,sol,pl,likes,at,tx}]
  top20:   [{u,w,tick,gain,likes,entered}]   top20Pool: SOL
  reserve: {balance,history:[{at,added,total}]}   solUsd: number */
let D={coins:[],round:{},callouts:[],callers:[],payouts:[],top20:[],top20Pool:0,reserve:{balance:0,history:[]},solUsd:0,live:false};
const $id=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtMC=v=>v>=1e6?"$"+(v/1e6).toFixed(2)+"M":v>=1e3?"$"+Math.round(v/1e3)+"K":"$"+Math.round(v||0);
const age=ms=>{const h=Math.max(0,(Date.now()-ms)/36e5);return h<1?Math.max(1,Math.round(h*60))+"m":h<24?Math.round(h)+"h":Math.round(h/24)+"d"};
const avatar=(name,col,cls="")=>{const x=XIDX[name];if(x&&x.avatar)return `<div class="av ${cls} pfp" aria-hidden="true"><img src="${esc(x.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>`;return `<div class="av ${cls}" style="--c:${col||colFor(name)}" aria-hidden="true">${esc(String(name||"?")[0].toUpperCase())}</div>`};
const coinAv=(c,cls="lg sq")=>c.img?`<div class="av ${cls}" aria-hidden="true" style="--c:${colFor(c.t)};overflow:hidden"><img src="${esc(c.img)}" alt="" style="width:100%;height:100%;object-fit:cover"></div>`:avatar(c.t,null,cls);
const shortW=w=>w&&w.length>10?w.slice(0,4)+"…"+w.slice(-4):(w||"");
const sol=(x,d=3)=>(+x||0).toFixed(d)+" SOL";
const empty=(msg,cta)=>`<div class="empty"><p>${msg}</p>${cta||""}</div>`;
const emptyRow=(cols,msg)=>`<tr><td colspan="${cols}" class="emptyCell">${msg}</td></tr>`;
const coinBy=k=>D.coins.find(c=>c.mint===k||c.t===k);

// payouts
const ago=ms=>{const m=Math.max(0,Math.round((Date.now()-ms)/6e4));return m<60?m+"m ago":m<1440?Math.floor(m/60)+"h ago":Math.floor(m/1440)+"d ago"};
const payRow=x=>{const c=coinBy(x.coin)||{t:x.coin};return `<div class="pay">${avatar(x.u)}<div class="t"><b>${uL(x.u,x.w)} · $${esc(c.t)}</b><span>${x.pl==="gmgn"?"Verified call on GMGN":(x.likes|0)+" holder likes on "+NAMES[x.pl]} · ${ago(x.at)}</span></div>
  <div class="amt">+${(+x.sol).toFixed(3)} SOL${D.solUsd?`<small>$${(x.sol*D.solUsd).toFixed(2)}</small>`:""}</div>${shareBtn(x)}<a class="tx" href="https://solscan.io/tx/${encodeURIComponent(x.tx)}" target="_blank" rel="noopener">${esc(shortW(x.tx))} ↗</a></div>`};
function renderPays(){
  const p=D.payouts;
  $id("recentPays").innerHTML=p.length?p.slice(0,6).map(payRow).join(""):empty("No payouts yet. The first one goes out when a coin's pool reaches 1 SOL.");
  $id("allPays").innerHTML=p.length?p.map(payRow).join(""):empty("No payouts yet. Every payout will show here with its Solscan transaction.",`<a class="btn sm sig" href="#launch">Expose a coin <span class="arr" aria-hidden="true">→</span></a>`);
  const tw=$id("track").closest("section > div")||$id("track").parentElement.parentElement;
  if(p.length){const tk=p.slice(0,12).map(x=>{const c=coinBy(x.coin)||{t:x.coin};return `<div class="tk">${avatar(x.u)}<span>${uL(x.u,x.w)}</span><b>+${(+x.sol).toFixed(3)} SOL</b><span>$${esc(c.t)}</span></div>`}).join("");$id("track").innerHTML=tk+tk;tw.hidden=false}
  else{$id("track").innerHTML="";tw.hidden=true}
}

// caller ranks: win = coin hits 1.5x from callout market cap within 24h; ranked by Wilson lower bound
const TIERS=[
  {n:"Oracle",min:.62,calls:25,c:"#ffd27a",c2:"#b8862e",perk:"The best in the trenches"},
  {n:"Elite",min:.5,c:"#ff9a4d",c2:"#b4521a",perk:"Wins more than they miss"},
  {n:"Sharp",min:.38,c:"#e0a27a",c2:"#8e5434",perk:"Reliably early"},
  {n:"Caller",min:.25,c:"#b5998a",c2:"#6d574b",perk:"Finding their edge"},
  {n:"Rookie",min:0,c:"#857469",c2:"#4a3e37",perk:"Every caller starts here"}];
TIERS.forEach((t,i)=>t.lvl=TIERS.length-i);
function wilson(w,n){if(!n)return 0;const z=1.64,p=w/n;return (p+z*z/(2*n)-z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n)))/(1+z*z/n)}
function tierFor(w,n){if(n<10)return null;const lb=wilson(w,n);for(const T of TIERS){if(lb>=T.min&&(!T.calls||n>=T.calls))return T}return TIERS[TIERS.length-1]}
function callerRanks(period){
  const a=period==="all";
  return D.callers.map(c=>{
    const n=(a?c.calls:c.calls30)|0,won=Math.min(n,(a?c.wins:c.wins30)|0);
    return {...c,n,won,wr:n?won/n:0,lb:wilson(won,n),avg:+(a?c.avgPeak:c.avgPeak30)||0,best:+(a?c.bestX:c.bestX30)||0,tier:tierFor(won,n),earnedP:+(a?c.earned:c.earned30)||0,streak:c.streak|0,stars:+c.stars||0,starsN:c.starsN|0,starsSort:(c.starsN|0)>=3?(+c.stars||0):0};
  }).filter(c=>c.n>0).sort((a,b)=>(b.tier?1:0)-(a.tier?1:0)||b.lb-a.lb);
}
// emblem: faceted hexagon in the tier's metal, with one chevron per level (star for Oracle)
let emSeq=0;
function emblem(t,size=40){
  const T=t||{n:"Unranked",c:"#5a4c44",c2:"#2e2621",lvl:0},id="em"+(emSeq++);
  const hex=(r)=>{const pts=[];for(let k=0;k<6;k++){const a=Math.PI/180*(60*k-90);pts.push((24+r*Math.cos(a)).toFixed(2)+","+(24+r*Math.sin(a)).toFixed(2))}return pts.join(" ")};
  let marks="";
  if(T.lvl===5)marks=`<path d="M24 13.5l3 6.2 6.8.9-5 4.7 1.3 6.7L24 28.8l-6.1 3.2 1.3-6.7-5-4.7 6.8-.9z" fill="url(#${id})"/>`;
  else for(let k=0;k<T.lvl;k++){const y=30-k*5.2+(T.lvl-1)*2.6;marks+=`<path d="M16.5 ${y}l7.5-4.6 7.5 4.6" fill="none" stroke="url(#${id})" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`}
  if(!t)marks=`<path d="M19 24h10" stroke="#6f625a" stroke-width="2.6" stroke-linecap="round"/>`;
  return `<svg class="emblem" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${T.c}"/><stop offset=".55" stop-color="${T.c2}"/><stop offset="1" stop-color="${T.c}"/></linearGradient></defs>
    <polygon points="${hex(22)}" fill="url(#${id})"/><polygon points="${hex(18.5)}" fill="#160f0b"/><polygon points="${hex(18.5)}" fill="none" stroke="${T.c}" stroke-opacity=".25"/>${marks}</svg>`;
}
const badge=t=>`<span class="badge" style="--tc:${t?t.c:"#6f625a"}">${emblem(t,18)}${t?t.n:"Unranked"}</span>`;
function nextStep(c){
  if(c.n<10){const k=10-c.n;return{txt:`${k} more call${k>1?"s":""} to get ranked`,pct:c.n/10,next:TIERS[TIERS.length-1]}}
  const i=TIERS.indexOf(c.tier);if(i<=0)return{txt:"Top rank. Keep the rating above 62 to hold it.",pct:1,next:null};
  const nx=TIERS[i-1];let k=0;while(k<500&&!(wilson(c.won+k,c.n+k)>=nx.min&&(!nx.calls||c.n+k>=nx.calls)))k++;
  const pct=Math.max(0,Math.min(1,(c.lb-c.tier.min)/(nx.min-c.tier.min)));
  return{txt:`${k} winning call${k>1?"s":""} in a row reaches ${nx.n}`,pct,next:nx};
}
let rkP="30",rkS="lb";
function renderRanks(){
  const list=callerRanks(rkP);
  const counts=Object.fromEntries(TIERS.map(t=>[t.n,0]));list.forEach(c=>{if(c.tier)counts[c.tier.n]++});
  $id("ladder").innerHTML=TIERS.slice().reverse().map(t=>`<li class="rung" style="--tc:${t.c}">${emblem(t,52)}<div><b>${t.n}</b><small>${t.min?"Rating "+Math.round(t.min*100)+"+":"10+ calls"}${t.calls?" · "+t.calls+"+ calls":""}</small><span>${t.perk}</span></div><em>${counts[t.n]} caller${counts[t.n]===1?"":"s"}</em></li>`).join("");
  const ranked=list.filter(c=>c.tier);
  $id("rkPodium").innerHTML=`<h2 style="margin-bottom:12px">Top callers</h2><div class="pods">`+[0,1,2].map(i=>{const c=ranked[i];
    return c?`<div class="rp${i===0?" first":""}"><span class="pl">#${i+1}</span>${emblem(c.tier,i===0?64:52)}<b>${uL(c.u,c.w)}</b><span class="rt">${Math.round(c.lb*100)}<small>rating</small></span><span class="sub">${Math.round(c.wr*100)}% wins · best ${c.best}×</span>${starLine(c)}</div>`
      :`<div class="rp open"><span class="pl">#${i+1}</span>${emblem(null,i===0?64:52)}<b>Unclaimed</b><span class="sub">Make 10 calls to qualify</span></div>`}).join("")+`</div>`;
  const sorted=rkS==="lb"?list:list.slice().sort((a,b)=>(b[rkS]-a[rkS])||(b.lb-a.lb));
  $id("rkRows").innerHTML=sorted.length?sorted.map((c,i)=>`<tr>
    <td>${c.tier?(rkS==="lb"?i+1:ranked.indexOf(c)+1):"—"}</td><td><span class="cwho">${avatar(c.u)}${uL(c.u,c.w)}${c.streak>=3?`<span class="hot" title="${c.streak} wins in a row">🔥 ${c.streak}</span>`:""}</span></td><td>${badge(c.tier)}</td>
    <td class="num"><b class="mono">${Math.round(c.lb*100)}</b></td><td class="num"><span class="wr"><span class="meter"><i style="width:${Math.round(c.wr*100)}%"></i></span>${Math.round(c.wr*100)}%</span></td>
    <td class="num">${c.won} / ${c.n}</td><td class="num">${c.best}×</td><td class="num" style="color:var(--ok)">${c.earnedP.toFixed(2)} SOL</td><td class="num"><span class="starCell">${starLine(c)}${c.tier?`<button class="rateBtn" type="button" data-rate="${esc(c.w)}" aria-label="Rate @${esc(c.u)}">Rate</button>`:""}</span></td></tr>`).join("")
    :emptyRow(9,"No callers yet. Ranks fill in as callouts come in, and you need 10 calls to get a rank.");
}
function showMyRank(c,wal){
  const box=$id("rkMe"),m=$id("rkMsg");
  if(!c||!c.n){m.className="msg";m.textContent="No calls from this wallet yet. Hold an Exposure coin and post a callout to start your record.";box.hidden=true;return}
  const st=nextStep(c);m.className="msg";m.textContent="";
  box.innerHTML=`<div class="me" style="--tc:${c.tier?c.tier.c:"#6f625a"}">${emblem(c.tier,72)}<div><div class="eyebrow">${rkP==="all"?"All time":"Last 30 days"}</div><b class="meT">${c.tier?c.tier.n:"Unranked"}</b><span>@${esc(c.u||shortW(wal))}</span></div></div>
    <div class="meStats"><div><small>Rating</small><b>${Math.round(c.lb*100)}</b></div><div><small>Win rate</small><b>${Math.round(c.wr*100)}%</b></div><div><small>Wins / calls</small><b>${c.won} / ${c.n}</b></div><div><small>Best call</small><b>${c.best}×</b></div></div><div class="meStars">${starLine(c,true)}</div>
    <div class="rkProg"><div class="bar"><i style="width:${Math.round(st.pct*100)}%"></i></div><p>${st.txt}</p></div>`;
  box.hidden=false;
}

// community stars: 1-5, one per wallet per ranked caller, proven with a free wallet signature
const STAR_WORDS=["","Wouldn't follow","Hit and miss","Solid","Great calls","Must follow"];
function starLine(c,big){
  const n=c.starsN|0,avg=+c.stars||0;
  if(n<3)return `<span class="stars new${big?" big":""}" title="Not enough ratings yet">${big?"No star rating yet":"New"}</span>`;
  const pct=Math.max(0,Math.min(100,avg/5*100));
  return `<span class="stars${big?" big":""}" aria-label="${avg.toFixed(1)} out of 5 stars from ${n} ratings"><span class="sbar" aria-hidden="true"><i style="width:${pct}%"></i></span><b>${avg.toFixed(1)}</b><small>(${n})</small></span>`;
}
let rateFor=null;
const rateDlg=$id("rateDlg");
function openRate(w){
  const c=callerRanks(rkP).find(x=>x.w===w);if(!c||!c.tier)return;rateFor=c;
  $id("rateWho").innerHTML=`<span class="cwho">${avatar(c.u)}<span><b>@${esc(c.u)}</b><br>${badge(c.tier)}</span></span>`;
  $id("rateTitle").textContent="Rate @"+c.u;
  document.querySelectorAll('#starPick input').forEach(r=>r.checked=false);
  $id("starWord").textContent="Pick 1 to 5 stars";const m=$id("rateMsg");m.textContent="";m.className="msg";
  if(rateDlg.showModal)rateDlg.showModal();else rateDlg.setAttribute("open","");
  setTimeout(()=>$id("st5").focus(),30);
}
document.addEventListener("click",e=>{const b=e.target.closest("[data-rate]");if(b)openRate(b.dataset.rate)});
$id("starPick").addEventListener("change",e=>{const v=+e.target.value;$id("starWord").textContent=v+" star"+(v>1?"s":"")+" · "+STAR_WORDS[v];const m=$id("rateMsg");if(m.classList.contains("err")){m.textContent="";m.className="msg"}});
rateDlg.addEventListener("click",e=>{if(e.target===rateDlg)rateDlg.close()});
function walletProvider(){return (window.phantom&&window.phantom.solana)||window.solflare||(window.backpack&&window.backpack.solana)||window.solana||null}
// On phones, Safari/Chrome can't reach wallet apps. Open this page inside the Phantom app's browser instead.
const IS_MOBILE=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
function openInWalletApp(){if(!IS_MOBILE)return false;const u=encodeURIComponent(location.href),r=encodeURIComponent(location.origin);location.href="https://phantom.app/ul/browse/"+u+"?ref="+r;return true}
function waitForWallet(ms=1500){return new Promise(ok=>{const p=walletProvider();if(p)return ok(p);const t0=Date.now(),iv=setInterval(()=>{const q=walletProvider();if(q||Date.now()-t0>ms){clearInterval(iv);ok(q)}},100)})}
const walletErr=err=>err&&err.code===4001?"You cancelled in your wallet. Nothing was connected.":"Your wallet didn't connect"+(err&&err.message?" ("+String(err.message).slice(0,120)+")":"")+". Unlock Phantom and try again."
const b64=u8=>{let s="";u8.forEach(x=>s+=String.fromCharCode(x));return btoa(s)};
$id("rateGo").addEventListener("click",async()=>{
  const m=$id("rateMsg"),pick=document.querySelector('#starPick input:checked');
  if(!pick){m.className="msg err";m.textContent="Pick a star rating first.";$id("st5").focus();return}
  if(!CONFIG.api){m.className="msg";m.textContent="Ratings open when Exposure goes live. Your pick isn't saved yet.";return}
  const prov=walletProvider();
  if(!prov){if(openInWalletApp())return;m.className="msg err";m.textContent="No Solana wallet found in this browser. Open Exposure in Phantom, Solflare or Backpack, or install one, then try again.";return}
  const stars=+pick.value,go=$id("rateGo");go.disabled=true;
  try{
    m.className="msg";m.textContent="Approve the connection in your wallet…";
    const conn=await prov.connect();const me=String((conn&&conn.publicKey)||prov.publicKey);
    if(me===rateFor.w){m.className="msg err";m.textContent="You can't rate your own calls.";return}
    const msg=`Exposure rating\nCaller: ${rateFor.w}\nStars: ${stars}\nWallet: ${me}\nTime: ${new Date().toISOString()}`;
    m.textContent="Sign the message in your wallet. It's free and sends nothing.";
    const signed=await prov.signMessage(new TextEncoder().encode(msg),"utf8");
    const sig=signed&&signed.signature?signed.signature:signed;
    const r=await fetch(CONFIG.api.replace(/\/$/,"")+"/rate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({caller:rateFor.w,stars,wallet:me,message:msg,signature:b64(new Uint8Array(sig))})});
    const j=clean(await r.json().catch(()=>({})));
    if(!r.ok){m.className="msg err";m.textContent=j.error==="not_holder"?"This wallet doesn't hold an Exposure coin yet. Buy any Exposure coin, then rate.":(j.error||"The rating didn't save. Try again in a minute.");return}
    const c=D.callers.find(x=>x.w===rateFor.w);if(c&&j.stars!=null){c.stars=j.stars;c.starsN=j.starsN}
    m.className="msg okm";m.textContent=`Saved. You gave @${rateFor.u} ${stars} star${stars>1?"s":""}.`;renderRanks();renderTopCallers();
    setTimeout(()=>{if(rateDlg.open)rateDlg.close()},1200);
  }catch(err){m.className="msg err";m.textContent=(err&&err.code===4001)?"You cancelled in your wallet. Nothing was saved.":"Your wallet didn't respond. Try again.";}
  finally{go.disabled=false}
});

$id("rkF").addEventListener("submit",e=>{e.preventDefault();
  const wal=$id("rkWallet").value.trim(),m=$id("rkMsg");
  if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wal)){m.className="msg err";m.textContent="We couldn't read that Solana address. Paste the full address from your wallet.";$id("rkMe").hidden=true;return}
  const local=callerRanks(rkP).find(c=>c.w===wal);
  if(local||!CONFIG.api){showMyRank(local,wal);return}
  m.className="msg";m.textContent="Looking up your calls…";
  fetch(CONFIG.api.replace(/\/$/,"")+"/wallet/"+encodeURIComponent(wal),{cache:"no-store"}).then(r=>r.json()).then(clean).then(j=>{
    const c=j.caller;if(!c){showMyRank(null,wal);return}
    const a=rkP==="all",n=(a?c.calls:c.calls30)|0,won=Math.min(n,(a?c.wins:c.wins30)|0);
    showMyRank({...c,n,won,wr:n?won/n:0,lb:wilson(won,n),best:+(a?c.bestX:c.bestX30)||0,tier:tierFor(won,n),stars:+c.stars||0,starsN:c.starsN|0},wal)})
   .catch(()=>{m.className="msg err";m.textContent="We couldn't load your rank right now. Try again in a minute."});
});
$id("rkWallet").addEventListener("input",()=>{const m=$id("rkMsg");if(m.classList.contains("err")){m.textContent="";m.className="msg"}});
$id("rkPeriod").addEventListener("click",e=>{const b=e.target.closest("[data-rp]");if(!b)return;rkP=b.dataset.rp;document.querySelectorAll("#rkPeriod .chip").forEach(x=>x.setAttribute("aria-pressed",x===b));renderRanks();if(!$id("rkMe").hidden)$id("rkF").requestSubmit()});
$id("rkSort").addEventListener("click",e=>{const b=e.target.closest("[data-rs]");if(!b)return;rkS=b.dataset.rs;document.querySelectorAll("#rkSort .chip").forEach(x=>x.setAttribute("aria-pressed",x===b));renderRanks()});

// top callers
function renderTopCallers(){
  const ranks=Object.fromEntries(callerRanks("30").map(c=>[c.u,c]));
  const top=[...D.callers].sort((a,b)=>(b.earned||0)-(a.earned||0)).filter(c=>c.earned>0).slice(0,4);
  $id("topCallers").innerHTML=top.length?top.map((c,i)=>{const r=ranks[c.u];return `<div class="card caller">
  <div class="who">${avatar(c.u,null,"lg")}<div><b>${uL(c.u,c.w)}</b><span class="mono">${esc(shortW(c.w))}</span></div><span class="rank">#${i+1}</span></div>
  <div><div class="eyebrow">Earned</div><div class="earned">${(+c.earned).toFixed(2)} SOL</div></div>
  <div class="mini"><span>${badge(r&&r.tier)}</span><span>Win rate <b>${r?Math.round(r.wr*100):0}%</b></span></div></div>`}).join("")
  :`<div style="grid-column:1/-1">${empty("No callers have been paid yet. Hold an Exposure coin and post a callout to be the first.")}</div>`;
}

// coins
let coinSort="pool";
function renderCoins(){
  const s=coinSort,list=[...D.coins].filter(c=>pairF==="all"||pairOf(c).kind===pairF).sort((a,b)=>s==="new"?b.createdAt-a.createdAt:s==="mc"?b.mc-a.mc:b.pool-a.pool);
  if(!list.length&&D.coins.length){$id("coinGrid").innerHTML=`<div style="grid-column:1/-1">${empty("No coins with this pair yet.",`<a class="btn sm sig" href="#launch">Expose one <span class="arr" aria-hidden="true">→</span></a>`)}</div>`;return}
  $id("coinGrid").innerHTML=list.length?list.map(c=>`<article class="card coin">
    <a class="coin-top coinLink" href="#coin-${encodeURIComponent(c.mint)}">${coinAv(c)}<div><b>${esc(c.n)}</b><span>$${esc(c.t)} <span class="pairTag">/ ${esc(pairOf(c).sym)}</span></span></div><span class="age">${age(c.createdAt)} ago</span></a>
    ${sparkline(c)}
    <div class="kv"><div><small>In pool</small><b class="pool">${(+c.pool).toFixed(2)} SOL</b></div><div><small>Waiting</small><b>${(c.pool*.7).toFixed(2)} SOL</b></div><div><small>Callouts</small><b>${c.calls|0}</b></div></div>
    <div class="coin-foot"><span>Mkt cap ${fmtMC(c.mc)}</span><span>${(+c.paid||0).toFixed(2)} SOL paid out so far</span></div>
    <div class="coin-actions"><a class="btn sm" href="https://pump.fun/coin/${encodeURIComponent(c.mint)}" target="_blank" rel="noopener">Buy on pump.fun</a><a class="btn sm ghost" href="#coin-${encodeURIComponent(c.mint)}">Open coin</a></div>
  </article>`).join("")
  :`<div style="grid-column:1/-1">${empty("No coins launched yet. Be the first, and your coin's creator fees start paying its callers.",`<a class="btn sm sig" href="#launch">Expose a coin <span class="arr" aria-hidden="true">→</span></a>`)}</div>`;
}
document.querySelectorAll("[data-sort]").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll("[data-sort]").forEach(x=>x.setAttribute("aria-pressed",x===b));coinSort=b.dataset.sort;renderCoins()}));

// pairs: pump.fun Custom Pairs (Sept 2026). Creator fees are paid in the paired asset.
// The backend should replace this list with pump.fun's live list of supported quote assets (93 at launch).
const PAIRS=[
  {sym:"SOL",name:"Solana",kind:"std"},{sym:"USDC",name:"USD Coin",kind:"std"},
  {sym:"NVDA",name:"Nvidia",kind:"stock"},{sym:"TSLA",name:"Tesla",kind:"stock"},{sym:"SPY",name:"S&P 500",kind:"stock"},
  {sym:"RDDT",name:"Reddit",kind:"stock"},{sym:"SHOP",name:"Shopify",kind:"stock"},{sym:"COST",name:"Costco",kind:"stock"},
  {sym:"BA",name:"Boeing",kind:"stock"},{sym:"BABA",name:"Alibaba",kind:"stock"},{sym:"RIVN",name:"Rivian",kind:"stock"},
  {sym:"DELL",name:"Dell",kind:"stock"},{sym:"IBM",name:"IBM",kind:"stock"},{sym:"LMT",name:"Lockheed Martin",kind:"stock"},
  {sym:"JNJ",name:"Johnson & Johnson",kind:"stock"},{sym:"UPS",name:"UPS",kind:"stock"},
  {sym:"BTC",name:"Bitcoin (wrapped)",kind:"crypto"},{sym:"ETH",name:"Ether (wrapped)",kind:"crypto"}];
const pairOf=c=>{const q=c&&c.quote;if(!q)return PAIRS[0];if(typeof q==="string")return PAIRS.find(p=>p.sym===q)||{sym:q,name:q,kind:"stock"};return q};
let pairF="all";
$id("pairFilter").addEventListener("click",e=>{const b=e.target.closest("[data-pf]");if(!b)return;pairF=b.dataset.pf;document.querySelectorAll("#pairFilter .chip").forEach(x=>x.setAttribute("aria-pressed",x===b));renderCoins()});
let pairSel="SOL",pairKind="std";
function drawPairs(){
  $id("pairGrid").innerHTML=PAIRS.filter(p=>p.kind===pairKind).map(p=>`<label class="pair${p.sym===pairSel?" on":""}"><input type="radio" name="lPair" value="${p.sym}"${p.sym===pairSel?" checked":""}><b>${p.sym}</b><span>${esc(p.name)}</span></label>`).join("");
  document.querySelectorAll("#pairPick .ptab").forEach(t=>t.setAttribute("aria-selected",t.dataset.pk===pairKind));
}
function syncPair(){
  const p=PAIRS.find(x=>x.sym===pairSel)||PAIRS[0],custom=p.sym!=="SOL";
  $id("feeRow").hidden=!custom;
  const fee=custom?(+$id("lFee").value):0.3;
  $id("lFeeOut").textContent=fee.toFixed(2)+"%";
  $id("pvFee").textContent=fee.toFixed(2)+"%";
  const assetName=p.kind==="stock"?"tokenized "+p.sym:p.sym;
  $id("pvFeeAsset").textContent=assetName;$id("pvPair").textContent="/ "+p.sym;$id("buyUnit").textContent=p.sym;
  $id("pvPaidIn").innerHTML=`Callers get paid in <b>${esc(assetName)}</b>`;
  $id("pairNote").textContent=p.kind==="stock"?`Your coin trades against tokenized ${p.name} stock. Creator fees build up in it, so your callers get paid in ${p.sym}.`
    :p.kind==="crypto"?`Your coin trades against ${p.name}. Creator fees and caller payouts are in ${p.sym}.`
    :p.sym==="USDC"?"Your coin trades against USDC. Creator fees and caller payouts are in dollars.":"The standard pump.fun launch. Creator fees and payouts are in SOL.";
}
$id("pairPick").addEventListener("click",e=>{const t=e.target.closest(".ptab");if(!t)return;pairKind=t.dataset.pk;
  const first=PAIRS.find(p=>p.kind===pairKind);if(!PAIRS.some(p=>p.kind===pairKind&&p.sym===pairSel))pairSel=first.sym;drawPairs();syncPair()});
$id("pairPick").addEventListener("change",e=>{if(e.target.name!=="lPair")return;pairSel=e.target.value;drawPairs();syncPair();
  const r=document.querySelector(`#pairGrid input[value="${pairSel}"]`);r&&r.focus()});
$id("pairPick").addEventListener("keydown",e=>{const t=e.target.closest(".ptab");if(!t||!["ArrowLeft","ArrowRight"].includes(e.key))return;
  const tabs=[...document.querySelectorAll("#pairPick .ptab")],i=tabs.indexOf(t),n=tabs[(i+(e.key==="ArrowRight"?1:tabs.length-1))%tabs.length];n.focus();n.click()});
$id("lFee").addEventListener("input",syncPair);
drawPairs();syncPair();

// leaderboard by coin
function score(list,pool){
  const avg={};for(const k in W){const xs=list.filter(r=>r.pl===k).map(r=>r.wt);avg[k]=xs.length?xs.reduce((a,b)=>a+b,0)/xs.length||1:1}
  list.forEach(r=>{r.bonus=BONUS(r.n);r.sc=W[r.pl]*(r.wt/avg[r.pl])*r.bonus});
  const tot=list.reduce((a,b)=>a+b.sc,0)||1;
  list.forEach(r=>{const raw=pool*.7*r.sc/tot;r.raw=raw;r.pay=Math.min(raw,CAP);r.cap=raw>CAP});
  return list.sort((a,b)=>b.sc-a.sc);
}
let boardCoin=null;
function renderBoard(k){
  if(k)boardCoin=k;const c=coinBy(boardCoin)||D.coins[0];
  $id("boardTabs").innerHTML=D.coins.map(x=>`<button class="chip" type="button" data-tab="${esc(x.mint)}" aria-pressed="${c&&x.mint===c.mint}">$${esc(x.t)}</button>`).join("");
  if(!c){$id("rows").innerHTML=emptyRow(8,"No coins yet. Once a coin launches, its callers and their estimated payouts show here.");return}
  const rows=score((D.round[c.mint]||[]).map(r=>({...r})),THRESH),max=rows[0]?.sc||1;
  $id("rows").innerHTML=rows.length?rows.map((r,i)=>{const g=r.pl==="gmgn";return`<tr>
   <td>${i+1}</td><td><span class="cwho">${avatar(r.u)}${uL(r.u,r.w)}</span></td><td><span class="plat">${NAMES[r.pl]}</span></td>
   <td class="num">${r.n}</td><td class="num">${g?"—":r.hl}</td><td class="num">${r.bonus.toFixed(2)}×</td>
   <td><span class="meter"><i style="width:${(r.sc/max*100).toFixed(0)}%"></i></span><span class="mono" style="font-size:12px">${r.sc.toFixed(2)}</span></td>
   <td class="num">${r.pay.toFixed(3)} SOL${r.cap?'<span class="capped">capped</span>':''}</td></tr>`}).join("")
   :emptyRow(8,`No callouts for $${esc(c.t)} this round yet. Hold it and post a callout on pump.fun or Fomo to get in.`);
}
$id("boardTabs").addEventListener("click",e=>{const b=e.target.closest("[data-tab]");if(b)renderBoard(b.dataset.tab)});
$id("coinGrid").addEventListener("click",e=>{const board=e.target.closest("[data-board]");if(board){renderBoard(board.dataset.board);go("leaderboard")}});

// reserve
function renderReserve(){
  const h=D.reserve.history||[];
  $id("resRows").innerHTML=h.length?h.slice().reverse().map(r=>`<tr><td>${new Date(r.at).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</td><td class="num">+${(+r.added).toFixed(2)} SOL</td><td class="num" style="color:var(--burn);font-weight:600">${(+r.total).toFixed(2)} SOL</td></tr>`).join("")
    :emptyRow(3,"Nothing added yet. 20% of every payout lands here.");
  $id("resBal").textContent=(+D.reserve.balance||0).toFixed(2)+" SOL";
  $id("resWallet").innerHTML=CONFIG.reserveWallet?`<a class="mono" href="https://solscan.io/account/${encodeURIComponent(CONFIG.reserveWallet)}" target="_blank" rel="noopener" style="color:inherit">${esc(shortW(CONFIG.reserveWallet))} ↗</a>`:"shown at launch";
}

// headline stats
function renderStats(){
  const pool=D.coins.reduce((a,c)=>a+(+c.pool||0),0),paid=D.payouts.reduce((a,p)=>a+(+p.sol||0),0),calls=D.coins.reduce((a,c)=>a+(c.calls|0),0);
  $id("hPool").textContent=pool.toFixed(2)+" SOL";$id("hWait").textContent=(pool*.7).toFixed(2)+" SOL";
  $id("hPaid").textContent=(D.paidTotal!=null?+D.paidTotal:paid).toFixed(2)+" SOL";$id("hCalls").textContent=calls;
}

// best callouts
let bcP="today",bcPl="all";
function bestCallouts(period){
  const now=Date.now(),span={today:864e5,week:6048e5,all:Infinity}[period];
  return D.callouts.filter(x=>now-x.at<=span).sort((a,b)=>(b.earned-a.earned)||(b.hl-a.hl)||(b.sc-a.sc));
}
function renderBest(){
  const list=bestCallouts(bcP).filter(x=>bcPl==="all"||x.pl===bcPl);
  $id("podium").innerHTML=list.slice(0,3).map((x,i)=>{const c=coinBy(x.coin)||{t:x.coin};return `<article class="pod${i===0?" first":""}"><span class="num" aria-hidden="true">${i+1}</span>
    <div class="who">${avatar(x.u,null,"lg")}<div><b>${uL(x.u,x.w)}</b><span>$${esc(c.t)} · ${NAMES[x.pl]}</span></div></div>
    <div class="hl">${x.pl==="gmgn"?"Called":x.hl}<small>${x.pl==="gmgn"?"verified on GMGN":"holder likes"}</small></div>
    <div class="foot"><span>${x.n} callout${x.n>1?"s":""} · ${x.pl==="gmgn"?"flat score":x.likes+" likes"}</span><b>+${(+x.earned).toFixed(3)} SOL</b></div></article>`}).join("")
    ||empty(bcPl==="all"?"No callouts yet for this period.":`No ${NAMES[bcPl]} callouts yet for this period.`);
  const max=list[0]?.sc||1;
  $id("bcRows").innerHTML=list.length>3?list.slice(3,28).map((x,i)=>{const g=x.pl==="gmgn",c=coinBy(x.coin)||{t:x.coin};return`<tr>
    <td>${i+4}</td><td><span class="cwho">${avatar(x.u)}${uL(x.u,x.w)}</span></td><td class="mono">$${esc(c.t)}</td><td><span class="plat">${NAMES[x.pl]}</span></td>
    <td class="num">${x.n}</td><td class="num">${g?"—":x.hl}</td>
    <td><span class="meter"><i style="width:${Math.min(100,x.sc/max*100).toFixed(0)}%"></i></span><span class="mono" style="font-size:12px">${(+x.sc).toFixed(2)}</span></td>
    <td class="num" style="color:var(--ok)">+${(+x.earned).toFixed(3)} SOL</td></tr>`}).join(""):emptyRow(8,list.length?"Positions 4 and down fill in as more callouts come in.":"The leaderboard fills in as soon as holders start posting callouts.");
  const today=bestCallouts("today");
  $id("bestToday").innerHTML=today.length?today.slice(0,5).map((x,i)=>{const c=coinBy(x.coin)||{t:x.coin};return `<div class="pay best"><span class="rk">#${i+1}</span>${avatar(x.u)}<div class="t"><b>${uL(x.u,x.w)} · $${esc(c.t)}</b><span>${x.pl==="gmgn"?"Verified call on GMGN":x.hl+" holder likes on "+NAMES[x.pl]}</span></div><div class="amt">+${(+x.earned).toFixed(3)} SOL<small>today</small></div></div>`}).join("")
    :empty("No callouts today yet. Hold an Exposure coin and post about it on pump.fun or Fomo.");
}
$id("bcPeriod").addEventListener("click",e=>{const b=e.target.closest("[data-p]");if(!b)return;bcP=b.dataset.p;document.querySelectorAll("#bcPeriod .chip").forEach(x=>x.setAttribute("aria-pressed",x===b));renderBest()});
$id("bcPlat").addEventListener("click",e=>{const b=e.target.closest("[data-pl]");if(!b)return;bcPl=b.dataset.pl;document.querySelectorAll("#bcPlat .chip").forEach(x=>x.setAttribute("aria-pressed",x===b));renderBest()});

// callout ring: 20 tablets, open spots until the Top 20 fills
let fillRing=()=>{};
(function(){
  const stage=$id("stage"),ring=$id("ring"),explore=$id("v-explore");
  const still=matchMedia("(prefers-reduced-motion: reduce)").matches;
  const N=20,slabs=[];
  for(let i=0;i<N;i++){
    const el=document.createElement("div");el.className="slab";
    el.innerHTML=`<div class="f front"></div><div class="f back"><span class="xp">Exposure</span><i class="sh"></i></div><div class="e et"></div><div class="e eb"></div><div class="e el"></div><div class="e er"></div>`;
    ring.appendChild(el);el.dataset.i=i;slabs.push({el,front:el.querySelector(".front"),bs:el.querySelector(".back .sh"),a:i*360/N,h:0,lf:-1,lb:-1});
  }
  fillRing=function(){
    const pool=+D.top20Pool||0;
    slabs.forEach((s,i)=>{const x=D.top20[i];
      s.front.innerHTML=(x?`<div class="cRow"><span class="cPlat">$${esc(x.tick)}</span><span class="cLike">#${i+1}</span></div><div class="cUser">${uL(x.u,x.w)}</div><div class="cRow"><span class="cSol">▲ ${Math.round(x.gain).toLocaleString()}%</span><span class="cLike">♥ ${x.likes|0}</span></div><div class="cRow"><span class="cBonus">★ +${(pool*(20-i)/210).toFixed(3)}</span><span class="cLike">${x.entered|0} calls</span></div>`
        :`<div class="cRow"><span class="cPlat">OPEN</span><span class="cLike">#${i+1}</span></div><div class="cUser">Your spot</div><div class="cRow"><span class="cSol">Post a callout</span></div><div class="cRow"><span class="cBonus">★ Top 20 bonus</span></div>`)+`<i class="sh"></i>`;
      s.fs=s.front.querySelector(".sh");s.lf=-1;});
    const filled=D.top20.length;
    $id("ringCap").innerHTML=filled?`Top 20 bonus pool <b>${pool.toFixed(2)} SOL</b> · ${matchMedia("(hover: none)").matches?"tap a tablet to read it, tap again for their profile":"hover a tablet to read it, click for their profile"}`:`<b>20 open spots</b> in the Top 20 · the best callers get a bonus from every payout`;
  };
  fillRing();
  let R=280,S=160,lastW=0,hov=-1;
  function size(){const w=stage.clientWidth,h=stage.clientHeight;lastW=w;if(!w)return;const out=Math.min(400,w*.42,h*.78);const cw=Math.max(100,out*.5);R=out-cw/2;S=cw;
    ring.style.setProperty("--w",cw+"px");ring.style.setProperty("--h",cw*.52+"px");ring.style.setProperty("--d",Math.max(3,cw*.026)+"px");}
  size();addEventListener("resize",size);
  const BASE=-24;let spin=0,tx=BASE,ty=0,cx=BASE,cy=0;
  function aim(x,y){const r=stage.getBoundingClientRect();const dx=(x-(r.left+r.width/2))/r.width,dy=(y-(r.top+r.height/2))/r.height;
    tx=BASE-Math.max(-1,Math.min(1,dy))*10;ty=Math.max(-1,Math.min(1,dx))*28}
  addEventListener("pointermove",e=>aim(e.clientX,e.clientY),{passive:true});
  let want=-1,wantAt=0;
  const pick=e=>{const sl=e.target.closest&&e.target.closest(".slab");return sl?+sl.dataset.i:-1};
  stage.addEventListener("pointerleave",()=>{tx=BASE;ty=0;want=-1;wantAt=performance.now()});
  stage.addEventListener("pointermove",e=>{const t=pick(e);if(t!==want){want=t;wantAt=performance.now()}},{passive:true});
  let ZOOM=.15;const setZoom=()=>{ZOOM=stage.clientWidth<600?1.05:.15};setZoom();addEventListener("resize",setZoom);
  stage.addEventListener("click",e=>{if(e.target.closest(".uLink"))return;const t=pick(e);if(t>=0&&t===hov&&D.top20[t]){go("u-"+encodeURIComponent(D.top20[t].w));return}hov=want=t;wantAt=0});
  let last=performance.now();
  function frame(now){
    const dt=Math.min(50,now-last);last=now;
    if(!explore.hidden){
      if(stage.clientWidth!==lastW)size();
      if(want!==hov&&now-wantAt>(want<0?260:140))hov=want;
      if(!still&&hov<0)spin=(spin+dt*.006)%360;
      cx+=(tx-cx)*.06;cy+=(ty-cy)*.06;
      ring.style.transform=`rotateX(${cx}deg) rotateZ(${cy*.35}deg) rotateY(${spin}deg)`;
      const cz=cy*.35;
      slabs.forEach((s,i)=>{s.h+=((i===hov?1:0)-s.h)*(still?1:.14);const h=s.h<.002?0:s.h;
        let turn=((s.a+spin)%360+540)%360-180;
        s.el.style.transform=`rotateY(${s.a}deg) translateZ(${R*(1-h)}px) rotateY(${-turn*h}deg) rotateZ(${-cz*h}deg) rotateX(${-cx*h}deg) translateZ(${h*(R*.85+S*.2)}px) translateY(${-h*S*.25}px) rotateY(${90*(1-h)}deg) rotateX(${8*(1-h)}deg) scale(${1+h*ZOOM})`;});
      for(const s of slabs){const sn=Math.sin((s.a+spin)*Math.PI/180);
        const f=+Math.min(.45,.45*(1-Math.max(0,sn))*(1-s.h)).toFixed(2),bk=+Math.min(.45,.45*(1-Math.max(0,-sn))*(1-s.h)).toFixed(2);
        if(f!==s.lf&&s.fs){s.fs.style.opacity=f;s.lf=f}if(bk!==s.lb){s.bs.style.opacity=bk;s.lb=bk}}
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

// search
(function(){
  const q=$id("q"),box=$id("qres");
  function close(){box.hidden=true}
  function render(){
    const v=q.value.trim().toLowerCase();if(!v){close();return}
    const cs=D.coins.filter(c=>c.t.toLowerCase().includes(v)||c.n.toLowerCase().includes(v)||(c.mint||"").toLowerCase()===v||pairOf(c).sym.toLowerCase()===v||pairOf(c).name.toLowerCase().includes(v)).slice(0,5);
    const ps=D.callers.filter(c=>c.u.toLowerCase().includes(v)||(c.w||"").toLowerCase().includes(v)||(c.x&&((c.x.name||"").toLowerCase().includes(v)||(c.x.handle||"").toLowerCase().includes(v.replace(/^@/,""))))).slice(0,5);
    let h="";
    if(cs.length)h+='<div class="grp">Coins</div>'+cs.map(c=>`<button type="button" data-coin="${esc(c.mint)}">${coinAv(c,"sq")}<b>${esc(c.n)}</b><span>$${esc(c.t)} / ${esc(pairOf(c).sym)} · ${(+c.pool).toFixed(2)} SOL pool</span></button>`).join("");
    if(ps.length)h+='<div class="grp">Callers</div>'+ps.map(c=>`<button type="button" data-caller="${esc(c.w||c.u)}">${avatar(c.u)}<b>@${esc(c.u)}</b><span>${c.x?esc(c.x.name)+" · ":""}${(+c.earned||0).toFixed(2)} SOL earned</span></button>`).join("");
    box.innerHTML=h||`<div class="none">${D.coins.length?`Nothing matches “${esc(v)}”. Try a ticker or a caller name.`:"No coins launched yet. Search will find coins, callers and wallets once they're live."}</div>`;
    box.hidden=false;
  }
  q.addEventListener("input",render);q.addEventListener("focus",render);
  document.addEventListener("click",e=>{if(!e.target.closest(".search"))close()});
  q.addEventListener("keydown",e=>{if(e.key==="Escape"){q.value="";close();q.blur()}});
  addEventListener("keydown",e=>{if(e.key==="/"&&!/input|textarea|select/i.test(document.activeElement.tagName)){e.preventDefault();q.focus()}});
  box.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;
    if(b.dataset.coin){openCoin(b.dataset.coin)}else{go("u-"+encodeURIComponent(b.dataset.caller))}
    q.value="";close()});
})();

// $EXPO page
function renderXP(){
  const X=D.xp||{},live=!!CONFIG.xpMint,burns=X.burns||[];
  const bought=burns.reduce((a,b)=>a+(+b.sol||0),0),burned=burns.reduce((a,b)=>a+(+b.xp||0),0);
  const big=n=>n>=1e9?(n/1e9).toFixed(2)+"B":n>=1e6?(n/1e6).toFixed(2)+"M":n>=1e3?(n/1e3).toFixed(1)+"K":Math.round(n).toLocaleString();
  $id("xpStatus").innerHTML=live?`<span class="xpPill isLive"><i></i>Live</span><a class="btn sig" href="https://pump.fun/coin/${encodeURIComponent(CONFIG.xpMint)}" target="_blank" rel="noopener">Buy $EXPO on pump.fun <span class="arr" aria-hidden="true">→</span></a>`
    :`<span class="xpPill"><i></i>Not launched yet</span><span class="xpSoon">Launches after the launchpad. Follow <a href="https://x.com/exposurefun" target="_blank" rel="noopener">@exposurefun</a> for the date.</span>`;
  $id("xpAddr").textContent=live?CONFIG.xpMint:"Posted here on launch day";
  $id("xpCaBtns").innerHTML=live?`<button class="btn sm ghost" type="button" id="xpCopy">Copy address</button><a class="btn sm ghost" href="https://solscan.io/token/${encodeURIComponent(CONFIG.xpMint)}" target="_blank" rel="noopener">Solscan ↗</a>`:"";
  $id("xpRes").textContent=(+D.reserve.balance||0).toFixed(2)+" SOL";
  $id("xpBought").textContent=bought.toFixed(2)+" SOL";
  $id("xpBurned").textContent=big(burned);
  $id("xpBurnN").textContent=burns.length;
  $id("xpWhen").textContent=live?(X.launchedAt?new Date(X.launchedAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):"Live"):"After the launchpad";
  $id("xpResW").innerHTML=CONFIG.reserveWallet?`<a class="mono" href="https://solscan.io/account/${encodeURIComponent(CONFIG.reserveWallet)}" target="_blank" rel="noopener">${esc(shortW(CONFIG.reserveWallet))} ↗</a>`:"Shown at launch";
  $id("xpBurnRows").innerHTML=burns.length?burns.slice().reverse().map(b=>`<tr><td>${new Date(b.at).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</td><td class="num">${(+b.sol).toFixed(3)} SOL</td><td class="num burnTxt">${big(+b.xp)}</td><td class="num"><a class="mono" href="https://solscan.io/tx/${encodeURIComponent(b.tx)}" target="_blank" rel="noopener">${esc(shortW(b.tx))} ↗</a></td></tr>`).join("")
    :emptyRow(4,live?"No burns yet. The first one happens with the next payout.":"Burns start the day $EXPO launches. The whole reserve goes into the first one.");
}
document.addEventListener("click",e=>{const b=e.target.closest("#xpCopy");if(!b)return;
  const done=()=>{b.textContent="Copied";setTimeout(()=>b.textContent="Copy address",1500)};
  const fallback=()=>{const r=document.createRange();r.selectNodeContents($id("xpAddr"));const s=getSelection();s.removeAllRanges();s.addRange(r);b.textContent="Press Ctrl+C"};
  try{navigator.clipboard.writeText(CONFIG.xpMint).then(done,fallback)}catch(x){fallback()}});

// ===== share-your-payout image =====
const SHARE_HANDLE="@exposurefun";
function shareData(x){return encodeURIComponent(JSON.stringify({u:x.u||"",w:x.w||"",sol:+x.sol||0,coin:x.coin||"",pl:x.pl||"pump",likes:x.likes|0,at:x.at||Date.now()}))}
function shareBtn(x){return `<button class="shareBtn" type="button" data-share="${shareData(x)}" aria-label="Share this payout"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg></button>`}
function drawMark(g,cx,cy,s){g.save();g.translate(cx,cy);const gr=g.createLinearGradient(-s,-s,s,s);gr.addColorStop(0,"#ffe7cf");gr.addColorStop(.5,"#d96a26");gr.addColorStop(1,"#6b2a0c");g.fillStyle=gr;
  for(let k=0;k<9;k++){g.save();g.rotate(k*40*Math.PI/180);const w=s*.26,h=s*.57,r=w/2;g.beginPath();g.roundRect(-w/2,-s,w,h,r);g.fill();g.restore()}g.restore()}
async function makeShareCard(x){
  try{await Promise.all([document.fonts.load('800 120px "Bricolage Grotesque"'),document.fonts.load('600 40px Geist'),document.fonts.load('500 30px "Geist Mono"')])}catch(e){}
  const W=1200,H=675,cv=document.createElement("canvas");cv.width=W*2;cv.height=H*2;const g=cv.getContext("2d");g.scale(2,2);
  const c=coinBy(x.coin)||{t:x.coin||"COIN"},p=pairOf(c);
  let bg=g.createRadialGradient(880,300,40,880,300,760);bg.addColorStop(0,"#3e1f0d");bg.addColorStop(.45,"#1d0f08");bg.addColorStop(1,"#0e0806");g.fillStyle=bg;g.fillRect(0,0,W,H);
  // copper coin on the right
  const cx=930,cy=330,R=190;let rim=g.createLinearGradient(cx-R,cy-R,cx+R,cy+R);rim.addColorStop(0,"#ffe7cf");rim.addColorStop(.4,"#d96a26");rim.addColorStop(.7,"#6b2a0c");rim.addColorStop(1,"#ffa45c");
  g.beginPath();g.arc(cx,cy,R,0,7);g.fillStyle=rim;g.shadowColor="rgba(255,140,60,.35)";g.shadowBlur=60;g.fill();g.shadowBlur=0;
  let face=g.createRadialGradient(cx-60,cy-70,10,cx,cy,R);face.addColorStop(0,"#ffc08a");face.addColorStop(.45,"#d96a26");face.addColorStop(1,"#55210c");
  g.beginPath();g.arc(cx,cy,R-16,0,7);g.fillStyle=face;g.fill();
  g.fillStyle="#351306";g.textAlign="center";g.textBaseline="middle";let tk="$"+c.t,fs=96;g.font=`800 ${fs}px "Bricolage Grotesque",sans-serif`;while(g.measureText(tk).width>R*1.55&&fs>30){fs-=4;g.font=`800 ${fs}px "Bricolage Grotesque",sans-serif`}
  g.fillText(tk,cx,cy+4);
  g.textAlign="left";g.textBaseline="alphabetic";
  // brand
  drawMark(g,84,82,22);g.fillStyle="#f7ece3";g.font='700 34px "Bricolage Grotesque",sans-serif';g.fillText("Exposure",118,94);
  // copy
  g.fillStyle="#ff9a4d";g.font='500 22px "Geist Mono",monospace';g.fillText("PAID FOR A CALLOUT",72,214);
  g.fillStyle="#f7ece3";g.font='600 40px Geist,sans-serif';let who="@"+(x.u||shortW(x.w)||"caller");while(g.measureText(who).width>560)who=who.slice(0,-2);g.fillText(who,72,272);
  const amt="+"+(+x.sol).toFixed(3)+" SOL";let af=118;g.font=`800 ${af}px "Bricolage Grotesque",sans-serif`;while(g.measureText(amt).width>600&&af>60){af-=4;g.font=`800 ${af}px "Bricolage Grotesque",sans-serif`}
  let tg=g.createLinearGradient(72,300,640,400);tg.addColorStop(0,"#ffe7cf");tg.addColorStop(.4,"#ffa45c");tg.addColorStop(1,"#d96a26");g.fillStyle=tg;g.fillText(amt,68,392);
  g.fillStyle="#b09a8c";g.font='500 30px Geist,sans-serif';g.fillText(`for calling $${c.t}${p.sym!=="SOL"?" / "+p.sym:""} on Exposure`,72,446);
  // chips
  const chip=(t,x0)=>{g.font='500 22px "Geist Mono",monospace';const w=g.measureText(t).width+36;g.strokeStyle="rgba(255,164,92,.4)";g.lineWidth=1.5;g.beginPath();g.roundRect(x0,500,w,46,23);g.stroke();g.fillStyle="#f7ece3";g.fillText(t,x0+18,531);return x0+w+12};
  let cx0=72;cx0=chip(x.pl==="gmgn"?"Verified call on GMGN":`${x.likes|0} holder likes · ${NAMES[x.pl]||"pump.fun"}`,cx0);chip(new Date(x.at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),cx0);
  // footer
  g.fillStyle="rgba(255,164,92,.25)";g.fillRect(0,H-64,W,1);g.fillStyle="#b09a8c";g.font='500 22px "Geist Mono",monospace';g.fillText("Hold it. Call it. Get paid.",72,H-24);
  g.textAlign="right";g.fillStyle="#f7ece3";g.fillText(SHARE_HANDLE,W-72,H-24);
  return cv.toDataURL("image/png");
}
const shareDlg=$id("shareDlg");let shareText="";
async function openShare(x){
  const c=coinBy(x.coin)||{t:x.coin},mine=ME&&x.w===ME;
  shareText=mine?`Just got paid ${(+x.sol).toFixed(3)} SOL for calling $${c.t} on Exposure 🔥\n\nHold a coin, call it out, get paid from its creator fees.`
    :`@${x.u} just got paid ${(+x.sol).toFixed(3)} SOL for calling $${c.t} on Exposure 🔥\n\nHold a coin, call it out, get paid from its creator fees.`;
  $id("shareImg").removeAttribute("src");$id("shareCopy").textContent="Copy text";
  $id("shareX2").href="https://x.com/intent/post?text="+encodeURIComponent(shareText);
  if(shareDlg.showModal)shareDlg.showModal();else shareDlg.setAttribute("open","");
  const url=await makeShareCard(x);$id("shareImg").src=url;$id("shareDl").href=url;$id("shareDl").download=`exposure-${c.t}-payout.png`;
}
document.addEventListener("click",e=>{const b=e.target.closest("[data-share]");if(!b)return;e.preventDefault();try{openShare(JSON.parse(decodeURIComponent(b.dataset.share)))}catch(x){}});
$id("shareX").addEventListener("click",()=>shareDlg.close());
shareDlg.addEventListener("click",e=>{if(e.target===shareDlg)shareDlg.close()});
$id("shareCopy").addEventListener("click",()=>{const b=$id("shareCopy");try{navigator.clipboard.writeText(shareText).then(()=>{b.textContent="Copied"},()=>{b.textContent="Copy failed"})}catch(x){b.textContent="Copy failed"}});

// ===== wallet connect + My Exposure =====
let ME=null,MEDATA=null,meMsg="";
try{ME=localStorage.getItem("exposure-wallet")||null}catch(e){}
const isAddr=v=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v||"");
function syncWalletBtn(){const b=$id("walletBtn");if(!b)return;b.innerHTML=ME?`<i class="wDot"></i><span class="mono">${esc(shortW(ME))}</span>`:`<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="3"/><path d="M16 12.5h2"/><path d="M3 9h15a3 3 0 0 1 3 3"/></svg><span>Connect wallet</span>`;b.classList.toggle("on",!!ME)}
async function connectWallet(){
  const prov=await waitForWallet();
  if(!prov){if(openInWalletApp())return;meMsg="No Solana wallet found in this browser. Install Phantom (phantom.app) and refresh, or paste an address below to look it up.";go("me");renderMe();return}
  try{const r=await prov.connect();const a=String((r&&r.publicKey)||prov.publicKey);if(!isAddr(a))throw new Error("no address returned");setMe(a);go("me")}
  catch(err){meMsg=walletErr(err);go("me");renderMe()}
}
function setMe(a){ME=a;MEDATA=null;meMsg="";try{a?localStorage.setItem("exposure-wallet",a):localStorage.removeItem("exposure-wallet")}catch(e){}syncWalletBtn();loadMe()}
async function loadMe(){
  if(!ME){renderMe();return}
  if(CONFIG.api){try{const r=await fetch(CONFIG.api.replace(/\/$/,"")+"/wallet/"+encodeURIComponent(ME),{cache:"no-store"});if(r.ok)MEDATA=clean(await r.json())}catch(e){}}
  renderMe();
}
function meData(){
  const d=MEDATA||{};
  return{caller:d.caller||D.callers.find(c=>c.w===ME)||null,callouts:d.callouts||D.callouts.filter(x=>x.w===ME),payouts:d.payouts||D.payouts.filter(x=>x.w===ME),coins:d.coins||D.coins.filter(c=>c.creator===ME)};
}
$id("walletBtn").addEventListener("click",()=>{if(ME)go("me");else connectWallet()});
function renderMe(){
  const el=$id("mePage");if(!el)return;
  if(!ME){el.innerHTML=`<div class="meEmpty card">
    <div class="eyebrow">My Exposure</div><h1>Your earnings, callouts and rank in one place</h1>
    <p>Connect your wallet to see what you've earned, which callouts are in this round, your caller rank and every payout you've had. Connecting only shares your public address. It can't move funds.</p>
    <div class="meCta"><button class="btn sig" type="button" id="meConnect">Connect wallet</button>${DEMO_ON?`<button class="btn ghost" type="button" id="meDemo">Try with a demo wallet</button>`:""}</div>
    ${meMsg?`<p class="msg err">${esc(meMsg)}</p>`:""}
    <form class="meLook" id="meLook" novalidate><label for="meAddr">Or look up any wallet<input id="meAddr" placeholder="Solana address" autocomplete="off"></label><button class="btn ghost" type="submit">Look up</button></form>
    <p class="msg" id="meLookMsg" role="status"></p></div>`;return}
  const m=meData(),ranks=callerRanks("30"),r=ranks.find(c=>c.w===ME),ranked=ranks.filter(c=>c.tier);
  const earned=m.caller?(+m.caller.earned||0):m.payouts.reduce((a,p)=>a+(+p.sol||0),0);
  const est=m.callouts.filter(x=>Date.now()-x.at<864e5).reduce((a,x)=>a+(+x.earned||0),0);
  const name=m.caller&&m.caller.u?"@"+m.caller.u:shortW(ME);
  const pos=r&&r.tier?ranked.indexOf(r)+1:0,t20i=D.top20.findIndex(x=>x.w===ME)+1,xo=xOf(ME);
  const st=r?nextStep(r):null;
  el.innerHTML=`<div class="meHead">
      <div class="meWho">${xo?`<div class="bigPfp"><img src="${esc(xo.avatar)}" alt="" referrerpolicy="no-referrer">${emblem(r&&r.tier,30)}</div>`:emblem(r&&r.tier,64)}<div><div class="eyebrow">My Exposure</div><h1>${esc(xo?xo.name:name)}</h1>${xo?`<div class="upSub"><span class="mono">${esc(name)}</span> on Exposure · ${xLinkBadge(xo)}</div>`:""}<div class="meTags">${badge(r&&r.tier)}${t20i?`<span class="pill t20">Top 20 · #${t20i}</span>`:""}${r?starLine(r):""}</div></div></div>
      <div class="meActs">${!CONFIG.xLink?"":xo?`<button class="btn sm ghost" type="button" id="meUnlinkX">Unlink X</button>`:`<button class="btn sm xBtn" type="button" id="meLinkX">${X_ICON}Link X account</button>`}<a class="btn sm ghost" href="#u-${encodeURIComponent(ME)}">Public profile</a><button class="btn sm ghost" type="button" id="meCopy">Copy address</button><a class="btn sm ghost" href="https://solscan.io/account/${encodeURIComponent(ME)}" target="_blank" rel="noopener">Solscan ↗</a><button class="btn sm ghost" type="button" id="meOut">Disconnect</button></div>
    </div>
    ${CONFIG.xLink&&!xo?`<div class="card xPromo">${X_ICON}<div><b>Link your X account</b><p>Show your X name and profile picture next to your Exposure username on your profile, the rankings and every payout.</p></div><button class="btn sm sig" type="button" id="meLinkX2">Link X</button></div>`:""}<p class="msg" id="meXMsg" role="status"></p>
    <div class="statbar meStatbar" role="group" aria-label="Your totals">
      <div><small>Earned, all time</small><b class="up">${earned.toFixed(3)} SOL</b></div>
      <div><small>Estimated, today</small><b>${est.toFixed(3)} SOL</b></div>
      <div><small>Caller rank</small><b>${pos?"#"+pos:"Unranked"}</b></div>
      <div><small>Win rate</small><b>${r?Math.round(r.wr*100)+"%":"—"}</b></div>
    </div>
    ${st?`<div class="card meNext"><div class="rkProg"><div class="bar"><i style="width:${Math.round(st.pct*100)}%"></i></div><p>${esc(st.txt)}</p></div></div>`:""}
    <div class="two">
      <div><div class="sec-head"><div><h2>Your callouts</h2><p>Callouts in open rounds, with your estimated share.</p></div></div>
        <div class="list">${m.callouts.length?m.callouts.slice(0,12).map(x=>{const c=coinBy(x.coin)||{t:x.coin,mint:x.coin};return `<a class="pay rowLink" href="#coin-${encodeURIComponent(c.mint||x.coin)}">${coinAv(c,"sq")}<div class="t"><b>$${esc(c.t)} · ${NAMES[x.pl]}</b><span>${x.pl==="gmgn"?"Verified call":(x.hl|0)+" holder likes"} · ${x.n} callout${x.n>1?"s":""}</span></div><div class="amt">+${(+x.earned||0).toFixed(3)} SOL<small>estimated</small></div></a>`}).join(""):empty("No callouts yet. Hold an Exposure coin and post about it on pump.fun or Fomo. It enters by itself.",`<a class="btn sm" href="#explore">Find a coin</a>`)}</div></div>
      <div><div class="sec-head"><div><h2>Your payouts</h2><p>Every payout sent to this wallet.</p></div></div>
        <div class="list">${m.payouts.length?m.payouts.map(payRow).join(""):empty("No payouts yet. You'll see each one here with its transaction, and a button to share it.")}</div></div>
    </div>
    <div><div class="sec-head"><div><h2>Coins you launched</h2><p>Coins created from this wallet on Exposure.</p></div></div>
      <div class="grid g3">${m.coins.length?m.coins.map(c=>`<a class="card coin coinMini" href="#coin-${encodeURIComponent(c.mint)}"><div class="coin-top">${coinAv(c)}<div><b>${esc(c.n)}</b><span>$${esc(c.t)} <span class="pairTag">/ ${esc(pairOf(c).sym)}</span></span></div></div><div class="kv"><div><small>In pool</small><b class="pool">${(+c.pool).toFixed(2)} SOL</b></div><div><small>Paid out</small><b>${(+c.paid||0).toFixed(2)} SOL</b></div><div><small>Callouts</small><b>${c.calls|0}</b></div></div></a>`).join("")
        :`<div style="grid-column:1/-1">${empty("You haven't launched a coin yet.",`<a class="btn sm sig" href="#launch">Launch a coin <span class="arr" aria-hidden="true">→</span></a>`)}</div>`}</div></div>`;
}
document.addEventListener("click",e=>{
  if(e.target.closest("#meConnect"))connectWallet();
  if(e.target.closest("#meOut")){try{const p=walletProvider();p&&p.disconnect&&p.disconnect()}catch(x){}setMe(null)}
  const cp=e.target.closest("#meCopy");if(cp){try{navigator.clipboard.writeText(ME).then(()=>{cp.textContent="Copied"},()=>{cp.textContent="Copy failed"})}catch(x){}}
});
document.addEventListener("submit",e=>{if(e.target.id!=="meLook")return;e.preventDefault();const v=$id("meAddr").value.trim(),m=$id("meLookMsg");
  if(!isAddr(v)){m.className="msg err";m.textContent="We couldn't read that Solana address. Paste the full address.";return}setMe(v)});
// ===== linked X accounts =====
// caller.x = {handle, name, avatar}. Linking is wallet-signed, then X sign-in (OAuth) runs on the backend.
function xOf(w){const c=D.callers.find(k=>k.w===w);return (c&&c.x)||(D.xLinks&&D.xLinks[w])||null}
function rebuildX(){XIDX={};D.callers.forEach(c=>{if(c.x)XIDX[c.u]=c.x})}
const X_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.8 3h3.1l-6.8 7.8 8 10.2h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.4L1.8 3h6.4l4.4 5.9zm-1.1 16.2h1.7L7.4 4.7H5.6z"/></svg>';
function demoPfp(seed){let h=0;for(const ch of seed)h=(h*31+ch.charCodeAt(0))>>>0;const a=h%360,b=(a+40+h%80)%360;
  const svg=`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${a},70%,58%)'/><stop offset='1' stop-color='hsl(${b},65%,32%)'/></linearGradient></defs><rect width='64' height='64' fill='url(#g)'/><circle cx='32' cy='26' r='11' fill='rgba(255,255,255,.85)'/><path d='M12 60c2-12 10-18 20-18s18 6 20 18z' fill='rgba(255,255,255,.85)'/></svg>`;
  return "data:image/svg+xml,"+encodeURIComponent(svg)}
const xLinkBadge=x=>x?`<a class="xBadge" href="https://x.com/${encodeURIComponent(x.handle)}" target="_blank" rel="noopener">${X_ICON}@${esc(x.handle)}</a>`:"";
const xDlg=$id("xDlg");
async function linkX(){
  if(!ME||!CONFIG.xLink)return;
  if(!CONFIG.api){$id("xHandle").value="";$id("xName").value="";$id("xMsg").textContent="";if(xDlg.showModal)xDlg.showModal();else xDlg.setAttribute("open","");setTimeout(()=>$id("xHandle").focus(),30);return}
  const prov=walletProvider(),m=$id("meXMsg");
  if(!prov||!walletConnected()){if(m){m.className="msg err";m.textContent="Connect this wallet first. Linking X needs a signature from it."}return}
  try{const msg=`Link an X account to Exposure\nWallet: ${ME}\nTime: ${new Date().toISOString()}`;
    const s=await prov.signMessage(new TextEncoder().encode(msg),"utf8");const sig=s&&s.signature?s.signature:s;
    const r=await fetch(CONFIG.api.replace(/\/$/,"")+"/x/link",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wallet:ME,message:msg,signature:b64(new Uint8Array(sig)),returnTo:location.href.split("#")[0]+"#me"})});
    const j=await r.json();const go2=r.ok&&j&&safeRedirect(j.url,["x.com","twitter.com"]);if(!go2)throw 0;location.href=go2;
  }catch(err){if(m){m.className="msg err";m.textContent=err&&err.code===4001?"You cancelled in your wallet. Nothing was linked.":"We couldn't start linking X. Try again in a minute."}}
}
async function unlinkX(){
  if(!ME)return;
  if(!CONFIG.api){const c=D.callers.find(k=>k.w===ME);if(c)delete c.x;if(D.xLinks)delete D.xLinks[ME];rebuildX();renderAll();return}
  const prov=walletProvider(),m=$id("meXMsg");
  try{const msg=`Unlink X from Exposure\nWallet: ${ME}\nTime: ${new Date().toISOString()}`;const s=await prov.signMessage(new TextEncoder().encode(msg),"utf8");const sig=s&&s.signature?s.signature:s;
    const r=await fetch(CONFIG.api.replace(/\/$/,"")+"/x/unlink",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wallet:ME,message:msg,signature:b64(new Uint8Array(sig))})});if(!r.ok)throw 0;
    MEDATA=null;await loadState();loadMe();
  }catch(err){if(m){m.className="msg err";m.textContent="We couldn't unlink X. Try again in a minute."}}
}
document.addEventListener("click",e=>{if(e.target.closest("#meLinkX")||e.target.closest("#meLinkX2"))linkX();if(e.target.closest("#meUnlinkX"))unlinkX();if(e.target.closest("#xCancel"))xDlg.close()});
xDlg.addEventListener("click",e=>{if(e.target===xDlg)xDlg.close()});
$id("xForm").addEventListener("submit",e=>{e.preventDefault();const h=$id("xHandle").value.trim().replace(/^@/,""),nm=$id("xName").value.trim()||h,m=$id("xMsg");
  if(!/^[A-Za-z0-9_]{1,15}$/.test(h)){m.className="msg err";m.textContent="X handles are 1 to 15 letters, numbers or underscores.";return}
  const x={handle:h,name:nm,avatar:demoPfp(h)},c=D.callers.find(k=>k.w===ME);if(c)c.x=x;else{D.xLinks=D.xLinks||{};D.xLinks[ME]=x}
  xDlg.close();rebuildX();renderAll();if(window.CUR_VIEW==="me")renderMe()});

// ===== caller profile pages (#u-WALLET) =====
const uL=(u,w)=>`<a class="uLink" href="#u-${encodeURIComponent(w||u||"")}">@${esc(u)}${XIDX[u]?`<span class="xMini" title="X linked: @${esc(XIDX[u].handle)}">${X_ICON}</span>`:""}</a>`;
let userKey=null,USERDATA={};
function findCaller(k){return D.callers.find(c=>c.w===k)||D.callers.find(c=>c.u===k)||null}
async function loadUser(k){if(!CONFIG.api||!k||USERDATA[k])return;try{const r=await fetch(CONFIG.api.replace(/\/$/,"")+"/wallet/"+encodeURIComponent(k),{cache:"no-store"});if(r.ok){USERDATA[k]=clean(await r.json());if(window.CUR_VIEW==="user")renderUserPage()}}catch(e){}}
function renderUserPage(){
  const el=$id("userPage");if(!el)return;
  const k=userKey,d=USERDATA[k]||{},base=d.caller||findCaller(k);
  const w=(base&&base.w)||k,u=(base&&base.u)||(D.payouts.find(x=>x.w===w)||D.callouts.find(x=>x.w===w)||{}).u;
  const callouts=d.callouts||D.callouts.filter(x=>x.w===w),payouts=d.payouts||D.payouts.filter(x=>x.w===w),coins=d.coins||D.coins.filter(c=>c.creator===w);
  if(!base&&!u&&!callouts.length&&!payouts.length){el.innerHTML=empty(D.callers.length?"We couldn't find that caller on Exposure.":"Caller profiles fill in once people start posting callouts.",`<a class="btn sm" href="#ranks">See caller ranks</a>`);loadUser(k);return}
  const ranks30=callerRanks("30"),rAll=callerRanks("all"),r=ranks30.find(c=>c.w===w),ra=rAll.find(c=>c.w===w);
  const ranked=ranks30.filter(c=>c.tier),pos=r&&r.tier?ranked.indexOf(r)+1:0,t20=D.top20.findIndex(x=>x.w===w)+1;
  const earned=base?(+base.earned||0):payouts.reduce((a,p)=>a+(+p.sol||0),0);
  const name=u?"@"+u:shortW(w),isMe=ME&&ME===w,st=r?nextStep(r):null,xo=xOf(w);
  const stat=(l,v,cls="")=>`<div><small>${l}</small><b class="${cls}">${v}</b></div>`;
  el.innerHTML=`<div class="meHead">
      <div class="meWho">${xo?`<div class="bigPfp"><img src="${esc(xo.avatar)}" alt="" referrerpolicy="no-referrer">${emblem(r&&r.tier,30)}</div>`:emblem(r&&r.tier,72)}<div><div class="eyebrow">Caller profile${isMe?" · this is you":""}</div><h1>${esc(xo?xo.name:name)}</h1>${xo?`<div class="upSub"><span class="mono">${esc(name)}</span> on Exposure · ${xLinkBadge(xo)}</div>`:""}
        <div class="meTags">${badge(r&&r.tier)}${pos?`<span class="pill rkPill">#${pos} ranked</span>`:""}${t20?`<span class="pill t20">Top 20 · #${t20}</span>`:""}${r&&r.streak>=3?`<span class="hot">🔥 ${r.streak} wins in a row</span>`:""}</div></div></div>
      <div class="meActs">${r&&r.tier&&!isMe?`<button class="btn sm sig" type="button" data-rate="${esc(w)}">Rate @${esc(u||"")}</button>`:""}${isMe?`<a class="btn sm" href="#me">Open My Exposure</a>`:""}<button class="btn sm ghost" type="button" data-copy="${esc(w)}">Copy wallet</button><a class="btn sm ghost" href="https://solscan.io/account/${encodeURIComponent(w)}" target="_blank" rel="noopener">Solscan ↗</a></div>
    </div>
    <div class="upRate card">
      <div class="upStars">${r?starLine(r,true):starLine({starsN:0},true)}<span>${r&&r.starsN>=3?`from ${r.starsN} holder ratings`:"Needs 3 ratings to show stars"}</span></div>
      <div class="upRank">${r&&r.tier?`<b style="color:${r.tier.c}">${r.tier.n}</b> · rating ${Math.round(r.lb*100)}`:`<b>Unranked</b> · ${r?Math.max(0,10-r.n):10} more call${r&&10-r.n===1?"":"s"} to get ranked`}</div>
    </div>
    <div class="statbar upStats" role="group" aria-label="Caller stats, last 30 days">
      ${stat("Win rate · 30d",r?Math.round(r.wr*100)+"%":"—")}
      ${stat("Wins / calls · 30d",r?`${r.won} / ${r.n}`:"—")}
      ${stat("Best call · 30d",r?r.best+"×":"—")}
      ${stat("Earned, all time",earned.toFixed(3)+" SOL","up")}
    </div>
    <div class="statbar upStats" role="group" aria-label="Caller stats, all time">
      ${stat("Win rate · all time",ra?Math.round(ra.wr*100)+"%":"—")}
      ${stat("Wins / calls · all time",ra?`${ra.won} / ${ra.n}`:"—")}
      ${stat("Avg peak · all time",ra?ra.avg.toFixed(2)+"×":"—")}
      ${stat("Best call · all time",ra?ra.best+"×":"—")}
    </div>
    ${st&&st.next?`<div class="card meNext"><div class="rkProg"><div class="bar"><i style="width:${Math.round(st.pct*100)}%"></i></div><p>Next rank: ${esc(st.txt)}</p></div></div>`:""}
    <div class="two">
      <div><div class="sec-head"><div><h2>Open callouts</h2><p>Callouts in rounds that haven't paid out yet.</p></div></div>
        <div class="list">${callouts.length?callouts.slice(0,12).map(x=>{const c=coinBy(x.coin)||{t:x.coin,mint:x.coin};return `<a class="pay rowLink" href="#coin-${encodeURIComponent(c.mint||x.coin)}">${coinAv(c,"sq")}<div class="t"><b>$${esc(c.t)} · ${NAMES[x.pl]}</b><span>${x.pl==="gmgn"?"Verified call":(x.hl|0)+" holder likes"} · ${x.n} callout${x.n>1?"s":""}</span></div><div class="amt">+${(+x.earned||0).toFixed(3)} SOL<small>estimated</small></div></a>`}).join(""):empty("No open callouts right now.")}</div></div>
      <div><div class="sec-head"><div><h2>Payouts</h2><p>Every payout this caller has received.</p></div></div>
        <div class="list">${payouts.length?payouts.slice(0,20).map(payRow).join(""):empty("No payouts yet.")}</div></div>
    </div>
    ${coins.length?`<div><div class="sec-head"><div><h2>Coins launched</h2></div></div><div class="grid g3">${coins.map(c=>`<a class="card coin coinMini" href="#coin-${encodeURIComponent(c.mint)}"><div class="coin-top">${coinAv(c)}<div><b>${esc(c.n)}</b><span>$${esc(c.t)} <span class="pairTag">/ ${esc(pairOf(c).sym)}</span></span></div></div><div class="kv"><div><small>In pool</small><b class="pool">${(+c.pool).toFixed(2)} SOL</b></div><div><small>Paid out</small><b>${(+c.paid||0).toFixed(2)} SOL</b></div><div><small>Callouts</small><b>${c.calls|0}</b></div></div></a>`).join("")}</div></div>`:""}`;
  loadUser(k);
}

// ===== coin charts =====
// c.hist = [{t:ms, mc:usd}] market-cap history (backend sends it; demo builds it live)
function histOf(c){return (c.hist&&c.hist.length>1)?c.hist:null}
function chgOf(h){const a=h[0].mc,b=h[h.length-1].mc;return a?(b-a)/a*100:0}
function chgTag(h){const p=chgOf(h),up=p>=0;return `<span class="chg ${up?"up":"dn"}">${up?"▲":"▼"} ${Math.abs(p).toFixed(1)}%</span>`}
function sparkline(c){
  const h=histOf(c);if(!h)return "";
  const W=120,H=36,t0=h[0].t,t1=h[h.length-1].t||t0+1,mn=Math.min(...h.map(p=>p.mc)),mx=Math.max(...h.map(p=>p.mc)),sp=mx-mn||1;
  const pts=h.map(p=>[((p.t-t0)/(t1-t0||1))*W,H-3-((p.mc-mn)/sp)*(H-6)]);
  const line=pts.map((p,i)=>(i?"L":"M")+p[0].toFixed(1)+" "+p[1].toFixed(1)).join(""),last=pts[pts.length-1];
  return `<div class="spark" aria-label="Market cap trend, ${chgOf(h).toFixed(1)}% over the period shown"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="sA" d="${line}L${W} ${H}L0 ${H}Z"/><path class="sL" d="${line}" vector-effect="non-scaling-stroke"/></svg>${chgTag(h)}</div>`;
}
let chartHover=null;
function chartBlock(c){
  if(!DEMO_ON&&CONFIG.api)return `<div class="card cpChartCard"><div class="cpChartHead"><div><div class="eyebrow">Live chart</div><b>${fmtMC(c.mc)} <small>market cap</small></b></div><a class="btn sm ghost" href="https://dexscreener.com/solana/${encodeURIComponent(c.mint)}" target="_blank" rel="noopener">Open on DexScreener ↗</a></div>
    <div class="cpFrame"><iframe title="$${esc(c.t)} live chart" loading="lazy" src="https://dexscreener.com/solana/${encodeURIComponent(c.mint)}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartTheme=dark&theme=dark&chartStyle=1&chartType=marketCap&interval=5"></iframe></div></div>`;
  const h=histOf(c);
  return `<div class="card cpChartCard"><div class="cpChartHead"><div><div class="eyebrow">Market cap${DEMO_ON?" · live demo":""}</div><b>${fmtMC(c.mc)} ${h?chgTag(h):""}</b></div><span class="cpLive"><i></i>Live</span></div>
    ${h?`<div class="cpChart" id="cpChart" data-mint="${esc(c.mint)}"></div>`:`<div class="cpChartEmpty">The chart fills in as $${esc(c.t)} trades.</div>`}</div>`;
}
function drawCoinChart(c){
  const box=$id("cpChart");if(!box||!c)return;const h=histOf(c);if(!h)return;
  const W=Math.max(280,box.clientWidth),H=Math.round(Math.min(300,Math.max(200,W*.36))),pl=8,pr=64,pt=12,pb=26;
  const t0=h[0].t,t1=h[h.length-1].t,mn0=Math.min(...h.map(p=>p.mc)),mx0=Math.max(...h.map(p=>p.mc)),pad=(mx0-mn0||mx0*.05)*.12,mn=mn0-pad,mx=mx0+pad;
  const X=t=>pl+((t-t0)/((t1-t0)||1))*(W-pl-pr),Y=v=>pt+(1-(v-mn)/((mx-mn)||1))*(H-pt-pb);
  const pts=h.map(p=>[X(p.t),Y(p.mc)]),line=pts.map((p,i)=>(i?"L":"M")+p[0].toFixed(1)+" "+p[1].toFixed(1)).join("");
  let grid="";for(let k=0;k<=3;k++){const v=mn+(mx-mn)*k/3,y=Y(v);grid+=`<line x1="${pl}" x2="${W-pr}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="cG"/><text x="${W-pr+8}" y="${(y+4).toFixed(1)}" class="cT">${fmtMC(v)}</text>`}
  const tf=t=>new Date(t).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});
  const xl=`<text x="${pl}" y="${H-6}" class="cT">${tf(t0)}</text><text x="${W-pr}" y="${H-6}" class="cT" text-anchor="end">${tf(t1)}</text>`;
  const last=pts[pts.length-1];
  box.innerHTML=`<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="$${esc(c.t)} market cap chart, ${fmtMC(h[0].mc)} to ${fmtMC(h[h.length-1].mc)}">
    <defs><linearGradient id="cpGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--signal)" stop-opacity=".28"/><stop offset="1" stop-color="var(--signal)" stop-opacity="0"/></linearGradient></defs>
    ${grid}${xl}<path d="${line}L${last[0].toFixed(1)} ${H-pb}L${pts[0][0].toFixed(1)} ${H-pb}Z" fill="url(#cpGrad)"/><path d="${line}" class="cL"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="5" class="cDot"/>
    <g class="cHov" id="cpHov" style="display:none"><line class="cX" y1="${pt}" y2="${H-pb}"/><circle r="5" class="cDot"/></g>
    <rect x="${pl}" y="${pt}" width="${W-pl-pr}" height="${H-pt-pb}" fill="transparent" id="cpHit"/></svg><div class="cTip" id="cpTip" hidden></div>`;
  const hit=$id("cpHit"),hov=$id("cpHov"),tip=$id("cpTip");
  const show=mx_=>{let bi=0,bd=1e9;pts.forEach((p,i)=>{const d=Math.abs(p[0]-mx_);if(d<bd){bd=d;bi=i}});const p=pts[bi],d=h[bi];
    hov.style.display="";hov.querySelector("line").setAttribute("x1",p[0]);hov.querySelector("line").setAttribute("x2",p[0]);hov.querySelector("circle").setAttribute("cx",p[0]);hov.querySelector("circle").setAttribute("cy",p[1]);
    tip.hidden=false;tip.innerHTML=`<b>${fmtMC(d.mc)}</b><span>${new Date(d.t).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",second:"2-digit"})}</span>`;
    const tw=tip.offsetWidth;tip.style.left=Math.min(W-tw-4,Math.max(4,p[0]-tw/2))+"px";tip.style.top=Math.max(0,p[1]-58)+"px"};
  const mv=e=>{const r=box.getBoundingClientRect();chartHover=(e.touches?e.touches[0].clientX:e.clientX)-r.left;show(chartHover)};
  hit.addEventListener("mousemove",mv);hit.addEventListener("touchmove",mv,{passive:true});hit.addEventListener("touchstart",mv,{passive:true});
  hit.addEventListener("mouseleave",()=>{chartHover=null;hov.style.display="none";tip.hidden=true});
  if(chartHover!=null)show(chartHover);
}
addEventListener("resize",()=>{if(window.CUR_VIEW==="coin")drawCoinChart(coinBy(coinKey))});

// ===== coin pages =====
let coinKey=null;
function renderCoinPage(){
  const el=$id("coinPage");if(!el)return;const c=coinKey&&coinBy(coinKey);
  if(!c){el.innerHTML=empty(D.coins.length?"We couldn't find that coin on Exposure.":"Coin pages fill in once coins launch on Exposure.",`<a class="btn sm" href="#explore">Back to Explore</a>`);return}
  const p=pairOf(c),pct=Math.max(0,Math.min(100,(+c.pool||0)/THRESH*100)),rows=score((D.round[c.mint]||[]).map(r=>({...r})),THRESH),max=rows[0]?.sc||1;
  const pays=D.payouts.filter(x=>x.coin===c.mint||x.coin===c.t),fee=c.fee!=null?+c.fee:(p.sym==="SOL"?0.3:null);
  const pageUrl=location.href.split("#")[0]+"#coin-"+encodeURIComponent(c.mint);
  const xText=`$${c.t} is on Exposure. Holders who call it out get paid from its creator fees.\n\n`;
  el.innerHTML=`<div class="cpHead">
      <div class="cpWho">${coinAv(c,"xl sq")}<div><div class="eyebrow">${age(c.createdAt)} old · ${esc(p.kind==="stock"?"Stock pair":p.kind==="crypto"?"Crypto pair":"SOL pair")}</div><h1>${esc(c.n)}</h1>
        <div class="cpTick"><span class="mono">$${esc(c.t)}</span> <span class="pairTag">/ ${esc(p.sym)}</span>${c.creatorU?` · <span>by @${esc(c.creatorU)}</span>`:""}</div></div></div>
      <div class="cpActs"><a class="btn sig" href="https://pump.fun/coin/${encodeURIComponent(c.mint)}" target="_blank" rel="noopener">Buy on pump.fun</a>
        <a class="btn ghost" href="https://dexscreener.com/solana/${encodeURIComponent(c.mint)}" target="_blank" rel="noopener">Chart ↗</a>
        <a class="btn ghost" href="https://x.com/intent/post?text=${encodeURIComponent(xText)}&url=${encodeURIComponent(pageUrl)}" target="_blank" rel="noopener">Share on X</a></div>
    </div>
    <div class="card cpMint"><span class="eyebrow">Contract</span><span class="mono cpAddr">${esc(c.mint)}</span><button class="btn sm ghost" type="button" data-copy="${esc(c.mint)}">Copy</button></div>
    ${chartBlock(c)}
    <div class="card cpPool">
      <div class="cpPoolTop"><div><div class="eyebrow">Callout pool</div><b class="cpPoolAmt">${(+c.pool).toFixed(3)} <small>/ ${THRESH} SOL</small></b></div><span class="cpPoolPct mono">${Math.round(pct)}% to next payout</span></div>
      <div class="cpBar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-label="Pool progress to 1 SOL"><i style="width:${pct}%"></i></div>
      <p>When the pool is worth 1 SOL it pays out: <b>${(THRESH*.7).toFixed(2)} SOL</b> to this round's callers, <b>${(THRESH*.1).toFixed(2)}</b> to the Top 20 and <b>${(THRESH*.2).toFixed(2)}</b> to the $EXPO reserve.${p.sym!=="SOL"?` Callers are paid in ${esc(p.sym)}.`:""}</p>
    </div>
    <div class="statbar cpStats" role="group" aria-label="Coin stats">
      <div><small>Market cap</small><b>${fmtMC(c.mc)}</b></div>
      <div><small>Paid out so far</small><b class="up">${(+c.paid||0).toFixed(2)} SOL</b></div>
      <div><small>Callouts this round</small><b>${rows.length||c.calls|0}</b></div>
      <div><small>Creator fee</small><b>${fee!=null?fee.toFixed(2)+"%":"—"}</b></div>
    </div>
    <div class="two">
      <div><div class="sec-head"><div><h2>This round's callers</h2><p>Estimated split if the pool paid out now.</p></div></div>
        <div class="tablewrap"><table style="min-width:520px"><thead><tr><th>#</th><th>Caller</th><th>Platform</th><th class="num">Holder likes</th><th>Score</th><th class="num">Est. payout</th></tr></thead><tbody>
        ${rows.length?rows.map((r,i)=>`<tr><td>${i+1}</td><td><span class="cwho">${avatar(r.u)}${uL(r.u,r.w)}</span></td><td><span class="plat">${NAMES[r.pl]}</span></td><td class="num">${r.pl==="gmgn"?"—":r.hl}</td><td><span class="meter"><i style="width:${(r.sc/max*100).toFixed(0)}%"></i></span></td><td class="num">${r.pay.toFixed(3)} SOL${r.cap?'<span class="capped">capped</span>':''}</td></tr>`).join(""):emptyRow(6,`No callouts this round yet. Be the first to call $${esc(c.t)}.`)}
        </tbody></table></div></div>
      <div class="card"><h2 style="margin-bottom:12px">Get paid from $${esc(c.t)}</h2>
        <ol class="pfSteps"><li><b>Buy and hold $${esc(c.t)}.</b> Only holders' callouts count.</li><li><b>Post a callout</b> on pump.fun or Fomo. It enters by itself.</li><li><b>Get holder likes.</b> Likes from wallets holding $${esc(c.t)} raise your score.</li><li><b>Get paid</b> when the pool reaches 1 SOL, straight to the wallet that posted.</li></ol></div>
    </div>
    <div><div class="sec-head"><div><h2>Payouts from $${esc(c.t)}</h2></div></div>
      <div class="list">${pays.length?pays.map(payRow).join(""):empty("No payouts from this coin yet. The first goes out when the pool reaches 1 SOL.")}</div></div>`;
  el.querySelectorAll(".tablewrap tbody").forEach(labelTable);
  drawCoinChart(c);
}
function openCoin(k){go("coin-"+encodeURIComponent(k))}
document.addEventListener("click",e=>{const b=e.target.closest("[data-copy]");if(!b)return;try{navigator.clipboard.writeText(b.dataset.copy).then(()=>{b.textContent="Copied";setTimeout(()=>b.textContent="Copy",1400)},()=>{b.textContent="Copy failed"})}catch(x){}});

// ===== transparency =====
function renderProof(){
  const W=[["Fee and payout wallet",CONFIG.botWallet,"Claims each coin's creator fees from pump.fun and sends payouts. It only holds what's waiting to be paid."],
    ["Top 20 bonus wallet",CONFIG.top20Wallet,"Collects 10% of every payout and pays the Top 20 callers by rank."],
    ["$EXPO buyback reserve",CONFIG.reserveWallet,"Collects 20% of every payout. It's only ever used to buy $EXPO and burn it."],
    ["$EXPO token",CONFIG.xpMint,"The $EXPO contract address."]];
  $id("pfWallets").innerHTML=W.map(([n,a,d])=>`<div class="pfW"><div><b>${n}</b><p>${d}</p></div>${a?`<div class="pfA"><span class="mono">${esc(shortW(a))}</span><button class="btn sm ghost" type="button" data-copy="${esc(a)}">Copy</button><a class="btn sm ghost" href="https://solscan.io/${n.includes("token")?"token":"account"}/${encodeURIComponent(a)}" target="_blank" rel="noopener">Solscan ↗</a></div>`:`<span class="pfSoon mono">Published at launch</span>`}</div>`).join("");
  const T=D.totals||{},paid=D.payouts.reduce((a,p)=>a+(+p.sol||0),0);
  $id("pfClaimed").textContent=(+T.claimed||0).toFixed(2)+" SOL";
  $id("pfCallers").textContent=(T.callers!=null?+T.callers:paid).toFixed(2)+" SOL";
  $id("pfTop").textContent=(+T.top20||0).toFixed(2)+" SOL";
  $id("pfRes").textContent=(T.reserve!=null?+T.reserve:(+D.reserve.balance||0)).toFixed(2)+" SOL";
  const K={claim:"Fee claim",payout:"Caller payout",top20:"Top 20 payout",reserve:"To reserve",burn:"$EXPO burn"},A=D.activity||[];
  $id("pfActivity").innerHTML=A.length?A.slice(0,25).map(a=>{const c=coinBy(a.coin);return `<div class="pay"><span class="actK ${a.kind}">${K[a.kind]||a.kind}</span><div class="t"><b>${c?"$"+esc(c.t):"Exposure"}</b><span>${ago(a.at)}</span></div><div class="amt">${(+a.sol).toFixed(3)} SOL</div><a class="tx" href="https://solscan.io/tx/${encodeURIComponent(a.tx)}" target="_blank" rel="noopener">${esc(shortW(a.tx))} ↗</a></div>`}).join("")
    :empty("Nothing yet. Every fee claim, payout and burn will show here with its transaction.");
}

function renderAll(){rebuildX();renderXP();renderPays();renderRanks();renderTopCallers();renderCoins();renderBoard();renderReserve();renderStats();renderBest();fillRing();renderProof();if(window.CUR_VIEW==="coin")renderCoinPage();if(window.CUR_VIEW==="user")renderUserPage();renderMe()}
renderAll();
async function loadState(){
  if(!CONFIG.api)return;
  try{const r=await fetch(CONFIG.api.replace(/\/$/,"")+"/state",{cache:"no-store"});if(!r.ok)throw 0;
    const j=clean(await r.json());if(!j||typeof j!=="object")throw 0;D={...D,...j,live:true};renderAll()}catch(e){/* keep last good data; retry on the next tick */}
}
// ===== DEMO MODE =====
// Fills the site with sample data and simulates trading, callouts and payouts so you can watch it run.
// Only runs while CONFIG.api is empty. Set CONFIG.demo to false before launch.
function demoRng(seed){return()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646}}
function demoAddr(r,tail=""){const a="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";let s="";for(let k=0;k<44-tail.length;k++)s+=a[Math.floor(r()*a.length)];return s+tail}
function buildDemo(){
  const r=demoRng(20261001),now=Date.now(),pick=a=>a[Math.floor(r()*a.length)];
  const NAMES=["degenwhisper","solsniff","bagsofbags","frogcaller","midcurve","gmgnmaxi","pingpong","trenchnurse","loudlarry","echochamber","callmeout","sniperjoe","rugdodger","chartghost","bondingbae","trenchking","alphaleak","moonmath","pumpsensei","exitliq","candlewick","greenfrog","jeetslayer","dipbuyer"];
  const callers=NAMES.map((u,i)=>{const skill=.22+r()*.55,calls=Math.round(8+r()*60),wins=Math.round(calls*skill),c30=Math.max(3,Math.round(calls*(.35+r()*.3))),w30=Math.min(c30,Math.round(c30*(skill+(r()-.5)*.12)));
    const sn=Math.round(r()*r()*140),st=sn>=3?+(2.4+skill*3.6+(r()-.5)*.6).toFixed(1):0;
    return{u,w:demoAddr(r),calls,wins,calls30:c30,wins30:Math.max(0,w30),avgPeak:+(1.2+skill*2.4).toFixed(2),bestX:+(2+skill*14*r()+1).toFixed(1),avgPeak30:+(1.1+skill*2.2).toFixed(2),bestX30:+(1.6+skill*10*r()+1).toFixed(1),earned:0,earned30:0,stars:Math.min(5,st),starsN:sn,streak:r()<.18?3+Math.floor(r()*5):0}});
  callers.forEach((c,i)=>{if(i%3!==2)c.x={handle:c.u,name:c.u[0].toUpperCase()+c.u.slice(1).replace(/(caller|whisper|sniff|curve|maxi|pong|nurse|larry|chamber|out|joe|dodger|ghost|bae|king|leak|math|sensei|liq|wick|frog|slayer|buyer)$/,s=>" "+s[0].toUpperCase()+s.slice(1)),avatar:demoPfp(c.u)}});
  const C=[["MEGA","Megaphone Dog","NVDA"],["LOUD","Loud Frog","SOL"],["SIGNAL","Signal Owl","TSLA"],["ECHO","Echo Cat","SOL"],["BULLHORN","Bullhorn","BTC"],["PING","Ping","SOL"],["RALLY","Rally Cat","SPY"],["HYPE","Hype Hound","SOL"]];
  const coins=C.map(([t,n,q],i)=>{const cr=pick(callers);return{mint:demoAddr(r,"pump"),t,n,quote:q,mc:Math.round(9000+r()*r()*480000),pool:+(r()*.85).toFixed(3),calls:0,createdAt:now-Math.round((1+r()*70)*36e5),paid:0,fee:q==="SOL"?.3:[.3,.5,.6,1][Math.floor(r()*4)],creator:cr.w,creatorU:cr.u}});
  coins.forEach(c=>{let v=c.mc;const N=90,hist=[{t:now,mc:c.mc}];for(let i=1;i<=N;i++){v=Math.max(4000,v/(1+(r()-.45)*.035));hist.unshift({t:now-i*2600,mc:Math.round(v)})}c.hist=hist});
  const round={};coins.forEach(c=>{const k=2+Math.floor(r()*6),used=new Set();round[c.mint]=[];for(let i=0;i<k;i++){let p;do{p=pick(callers)}while(used.has(p.u));used.add(p.u);
    const pl=r()<.12?"gmgn":(r()<.58?"pump":"fomo"),n=1+Math.floor(r()*r()*4),likes=pl==="gmgn"?0:Math.round(6+r()*150),hl=pl==="gmgn"?0:Math.round(likes*(.3+r()*.5));
    round[c.mint].push({u:p.u,w:p.w,pl,n,likes,hl,wt:pl==="gmgn"?1:+(hl*(.7+r()*.8)).toFixed(1),at:now-Math.round(r()*18*36e5)})}c.calls=round[c.mint].reduce((a,x)=>a+x.n,0)});
  const payouts=[],activity=[];let reserve=0,top20p=0,claimed=0,callersPaid=0;
  for(let i=0;i<34;i++){const c=pick(coins),p=pick(callers),sol=+(.02+r()*.42).toFixed(3),at=now-Math.round((i*2.1+r()*2)*36e5),pl=r()<.55?"pump":"fomo";
    payouts.push({u:p.u,w:p.w,coin:c.mint,sol,pl,likes:Math.round(8+r()*120),at,tx:demoAddr(r).slice(0,44)});p.earned+=sol;if(at>now-30*864e5)p.earned30+=sol;c.paid+=sol;callersPaid+=sol}
  payouts.sort((a,b)=>b.at-a.at);
  const nPay=Math.round(callersPaid/.7);reserve=+(callersPaid/.7*.2).toFixed(3);top20p=+(callersPaid/.7*.1).toFixed(3);claimed=+(callersPaid/.7).toFixed(3);
  for(let i=0;i<14;i++){const c=pick(coins),at=now-Math.round(i*1.4*36e5+r()*36e5),kind=pick(["claim","claim","payout","reserve","top20"]);activity.push({kind,coin:c.mint,sol:+(kind==="claim"?.05+r()*.3:kind==="payout"?.7:kind==="reserve"?.2:.1).toFixed(3),at,tx:demoAddr(r)})}
  activity.sort((a,b)=>b.at-a.at);
  const history=[];let tot=0;for(let d=7;d>=0;d--){const add=+(reserve/9*(.6+r()*.8)).toFixed(3);tot+=add;history.push({at:now-d*864e5,added:add,total:+tot.toFixed(3)})}
  const callouts=[];coins.forEach(c=>{score(round[c.mint].map(x=>({...x})),THRESH).forEach(x=>callouts.push({u:x.u,w:x.w,coin:c.mint,pl:x.pl,n:x.n,likes:x.likes,hl:x.hl,sc:x.sc,earned:Math.min(x.raw,CAP),at:x.at}))});
  const top20=callers.map(p=>{const mine=callouts.filter(x=>x.w===p.w);return{p,likes:mine.reduce((a,x)=>a+x.likes,0)+Math.round(r()*200),entered:p.calls30,gain:Math.round(p.bestX30*100-100),tick:mine[0]?(coins.find(c=>c.mint===mine[0].coin)||{}).t:pick(coins).t}});
  const rk=k=>{const v=top20.map(x=>x[k]).sort((a,b)=>a-b);top20.forEach(x=>x["r_"+k]=v.indexOf(x[k])/(v.length-1))};["gain","likes","entered"].forEach(rk);
  top20.forEach(x=>x.s=.45*x.r_gain+.4*x.r_likes+.15*x.r_entered);
  const T20=top20.sort((a,b)=>b.s-a.s).slice(0,20).map(x=>({u:x.p.u,w:x.p.w,tick:x.tick||pick(coins).t,gain:x.gain,likes:x.likes,entered:x.entered}));
  return{coins,round,callouts,callers,payouts,top20:T20,top20Pool:top20p*.4,reserve:{balance:tot,history},totals:{claimed,callers:+callersPaid.toFixed(3),top20:top20p,reserve:tot},activity,solUsd:152,paidTotal:+callersPaid.toFixed(3),live:false};
}
function demoToast(html){const t=$id("demoToast");if(!t)return;const el=document.createElement("div");el.className="dToast";el.innerHTML=html;t.appendChild(el);while(t.children.length>3)t.firstElementChild.remove();setTimeout(()=>{el.classList.add("out");setTimeout(()=>el.remove(),400)},4200)}
// redraw only the page on screen; hidden pages refresh when you open them
const VIEW_RENDER={explore:()=>{renderPays();renderCoins();renderStats();renderBest();renderTopCallers();fillRing()},leaderboard:()=>{renderBoard();renderBest()},ranks:renderRanks,
  payouts:renderPays,reserve:renderReserve,proof:renderProof,expo:renderXP,coin:renderCoinPage,user:renderUserPage,me:()=>{if(ME)renderMe()}};
function renderView(v){rebuildX();const f=VIEW_RENDER[v];if(f)f()}
function demoRender(){renderView(window.CUR_VIEW||"explore")}
function demoTick(){
  const r=Math.random,now=Date.now();
  // trading: creator fees trickle into pools (faster on bigger coins)
  D.coins.forEach(c=>{const add=(.004+r()*.02)*Math.min(3,Math.max(.4,c.mc/80000));c.pool=+(+c.pool+add).toFixed(4);c.mc=Math.max(5000,Math.round(c.mc*(1+(r()-.47)*.04)));if(c.hist){c.hist.push({t:now,mc:c.mc});if(c.hist.length>140)c.hist.shift()}});
  D.totals.claimed=+(D.totals.claimed+.02).toFixed(3);
  // new callout or likes
  if(r()<.55){const c=D.coins[Math.floor(r()*D.coins.length)],rd=D.round[c.mint];
    if(r()<.4&&rd.length<9){const p=D.callers[Math.floor(r()*D.callers.length)];if(!rd.some(x=>x.w===p.w)){const pl=r()<.6?"pump":"fomo",likes=3+Math.floor(r()*20);rd.push({u:p.u,w:p.w,pl,n:1,likes,hl:Math.round(likes*.6),wt:Math.round(likes*.6),at:now});c.calls++;
      D.activity.unshift({kind:"claim",coin:c.mint,sol:+(.02+r()*.06).toFixed(3),at:now,tx:demoAddr(demoRng(now%2147483646||7))});
      demoToast(`📣 <b>@${esc(p.u)}</b> called <b>$${esc(c.t)}</b> on ${NAMES[pl]}`)}}
    else if(rd.length){const x=rd[Math.floor(r()*rd.length)];if(x.pl!=="gmgn"){const add=1+Math.floor(r()*6);x.likes+=add;x.hl+=Math.round(add*.7);x.wt=+(x.hl*1.1).toFixed(1)}}}
  // payouts when a pool reaches 1 SOL
  D.coins.forEach(c=>{if(c.pool<THRESH)return;const rows=score((D.round[c.mint]||[]).map(x=>({...x})),THRESH);c.pool=+(c.pool-THRESH).toFixed(4);
    let paid=0;rows.forEach(x=>{if(x.pay<.001)return;paid+=x.pay;const tx=demoAddr(demoRng(Math.floor(r()*2e9)+1));
      D.payouts.unshift({u:x.u,w:x.w,coin:c.mint,sol:+x.pay.toFixed(3),pl:x.pl,likes:x.hl,at:now,tx});const cl=D.callers.find(k=>k.w===x.w);if(cl){cl.earned+=x.pay;cl.earned30+=x.pay}});
    c.paid=+(c.paid+paid).toFixed(3);D.paidTotal=+((D.paidTotal||0)+paid).toFixed(3);D.totals.callers=+(D.totals.callers+paid).toFixed(3);D.totals.top20=+(D.totals.top20+.1).toFixed(3);D.top20Pool=+((D.top20Pool||0)+.1).toFixed(3);
    D.reserve.balance=+(D.reserve.balance+.2).toFixed(3);D.totals.reserve=D.reserve.balance;const h=D.reserve.history[D.reserve.history.length-1];h.added=+(h.added+.2).toFixed(3);h.total=D.reserve.balance;
    const tx=demoAddr(demoRng(Math.floor(r()*2e9)+1));D.activity.unshift({kind:"reserve",coin:c.mint,sol:.2,at:now,tx},{kind:"payout",coin:c.mint,sol:+paid.toFixed(3),at:now,tx});
    D.round[c.mint]=[];c.calls=0;
    D.callouts=D.callouts.filter(x=>x.coin!==c.mint);
    demoToast(`💸 <b>$${esc(c.t)}</b> paid out <b>${paid.toFixed(2)} SOL</b> to ${rows.length} caller${rows.length===1?"":"s"}`)});
  // refresh estimated callouts
  D.callouts=[];D.coins.forEach(c=>score((D.round[c.mint]||[]).map(x=>({...x})),THRESH).forEach(x=>D.callouts.push({u:x.u,w:x.w,coin:c.mint,pl:x.pl,n:x.n,likes:x.likes,hl:x.hl,sc:x.sc,earned:Math.min(x.raw,CAP),at:x.at||now})));
  D.payouts=D.payouts.slice(0,80);D.activity=D.activity.slice(0,60);
  demoRender();
}
function startDemo(){if(CONFIG.api)return;DEMO_ON=true;D={...D,...buildDemo()};
  // make a few demo callers creators/holders so My Exposure has content
  const best=callerRanks("30").find(c=>c.tier)||D.callers[0];DEMO_ME=best.w;D.coins[0].creator=DEMO_ME;D.coins[0].creatorU=best.u;
  [D.coins[0],D.coins[2]].forEach(c=>{if(!D.round[c.mint].some(x=>x.w===DEMO_ME)){D.round[c.mint].push({u:best.u,w:DEMO_ME,pl:"pump",n:2,likes:64,hl:41,wt:45,at:Date.now()-2e6});c.calls+=2}});
  D.callouts=[];D.coins.forEach(c=>score(D.round[c.mint].map(x=>({...x})),THRESH).forEach(x=>D.callouts.push({u:x.u,w:x.w,coin:c.mint,pl:x.pl,n:x.n,likes:x.likes,hl:x.hl,sc:x.sc,earned:Math.min(x.raw,CAP),at:x.at})));
  renderAll();syncDemoUI();clearInterval(demoTimer);demoTimer=setInterval(demoTick,2600)}
function stopDemo(){DEMO_ON=false;clearInterval(demoTimer);demoTimer=null;
  D={coins:[],round:{},callouts:[],callers:[],payouts:[],top20:[],top20Pool:0,reserve:{balance:0,history:[]},solUsd:0,live:false};
  if(ME===DEMO_ME){ME=null;MEDATA=null;syncWalletBtn()}renderAll();syncDemoUI()}
function syncDemoUI(){const b=$id("demoBar");if(b)b.hidden=!DEMO_ON;const f=$id("demoToggle");if(f){f.textContent=DEMO_ON?"Turn off demo":"Show demo";f.parentElement.hidden=!!CONFIG.api||!CONFIG.demo}}
document.addEventListener("click",e=>{
  if(e.target.closest("#demoToggle")){e.preventDefault();DEMO_ON?stopDemo():startDemo()}
  if(e.target.closest("#demoOff")){DEMO_ON?stopDemo():0}
  if(e.target.closest("#meDemo")){if(DEMO_ON){ME=DEMO_ME;MEDATA=null;meMsg="";syncWalletBtn();renderMe()}}
});

loadState();if(CONFIG.api)setInterval(loadState,CONFIG.refreshMs);
syncWalletBtn();loadMe();
if(CONFIG.demo&&!CONFIG.api)startDemo();else syncDemoUI();


// blur-first validation: check a field when you leave it, clear the message as you edit
(function(){
  const rules={
    fWallet:()=>{const v=document.getElementById("fWallet").value.trim();return !v||/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)?"":"We couldn't read that Solana address. Paste the full address from your wallet."},
    lName:()=>"",
    lTick:()=>{const v=document.getElementById("lTick").value.trim();return !v||v.length>=2?"":"Tickers need at least 2 characters."}
  };
  const msgFor=id=>document.getElementById(id.startsWith("f")?"fMsg":"lMsg");
  Object.keys(rules).forEach(id=>{const el=document.getElementById(id);if(!el)return;
    el.addEventListener("blur",()=>{const e=rules[id]();const m=msgFor(id);if(e){m.className="msg err";m.textContent=e;el.setAttribute("aria-invalid","true")}});
    el.addEventListener("input",()=>{const m=msgFor(id);if(m.classList.contains("err")){m.textContent="";m.className="msg"}el.removeAttribute("aria-invalid")});
  });
})();


// opening intro: play the clip once, then reveal the site
(function(){
  const el=document.getElementById("intro"),v=document.getElementById("introVid"),vb=document.getElementById("introBg");if(!el||!v)return;
  let done=false,guard;
  function finish(){if(done)return;done=true;clearTimeout(guard);el.classList.add("out");setTimeout(()=>{el.hidden=true;try{v.pause();vb&&vb.pause()}catch(e){}},650)}
  function start(){done=false;el.hidden=false;el.classList.remove("out");
    if(vb&&getComputedStyle(vb).display!=="none"){try{vb.currentTime=0;const q=vb.play();q&&q.catch&&q.catch(()=>{})}catch(e){}}
    try{v.currentTime=0}catch(e){}
    tap.hidden=true;v.muted=true;
    // phones (Low Power Mode, wallet-app browsers) can block autoplay: show a tap-to-play button instead of skipping
    const p=v.play();if(p&&p.catch)p.catch(()=>{tap.hidden=false;clearTimeout(guard);guard=setTimeout(finish,15000)});
    clearTimeout(guard);guard=setTimeout(()=>{if(v.paused&&v.currentTime===0){tap.hidden=false;guard=setTimeout(finish,15000)}else finish()},v.paused?2500:9000)}
  const tap=document.getElementById("introTap");
  tap.addEventListener("click",()=>{tap.hidden=true;v.muted=true;const q=v.play();if(q&&q.catch)q.catch(()=>finish());clearTimeout(guard);guard=setTimeout(finish,9000)});
  v.addEventListener("playing",()=>{tap.hidden=true;clearTimeout(guard);guard=setTimeout(finish,9000)});
  v.addEventListener("ended",finish);v.addEventListener("error",finish);const srcs=v.querySelectorAll("source");srcs[srcs.length-1].addEventListener("error",finish);
  document.getElementById("introSkip").addEventListener("click",finish);
  addEventListener("keydown",e=>{if(e.key==="Escape")finish()});
  window.replayIntro=start;
  if(matchMedia("(prefers-reduced-motion: reduce)").matches){el.hidden=true;done=true;return}
  start();
})();

document.getElementById("replayIntro").addEventListener("click",e=>{e.preventDefault();window.replayIntro&&window.replayIntro()});

// phone menu + table labels
const mSheet=document.getElementById("mSheet"),mMore=document.getElementById("mMore");
function closeSheet(){if(!mSheet.hidden){mSheet.hidden=true;mMore.setAttribute("aria-expanded","false")}}
mMore.addEventListener("click",e=>{e.stopPropagation();const open=mSheet.hidden;mSheet.hidden=!open;mMore.setAttribute("aria-expanded",String(open));if(open)mSheet.querySelector("a").focus({preventScroll:true})});
document.addEventListener("click",e=>{if(!e.target.closest("#mSheet,#mMore"))closeSheet()});
addEventListener("keydown",e=>{if(e.key==="Escape"&&!mSheet.hidden){closeSheet();mMore.focus()}});
document.getElementById("mSnd").addEventListener("click",()=>document.getElementById("sndBtn").click());
function labelTable(tb){const hs=[...tb.closest("table").querySelectorAll("thead th")].map(th=>th.textContent.trim());
  tb.querySelectorAll("tr").forEach(tr=>{const cells=[...tr.children];cells.forEach((td,i)=>{if(!td.hasAttribute("colspan"))td.dataset.label=hs[i]||""});const who=cells.find(td=>td.querySelector(".cwho"));if(who&&hs[0]==="#")who.dataset.n=cells[0].textContent.trim()})}
document.querySelectorAll(".tablewrap tbody").forEach(tb=>{labelTable(tb);new MutationObserver(()=>labelTable(tb)).observe(tb,{childList:true})});

// routing
const VIEWS=["explore","me","launch","leaderboard","ranks","expo","coin","user","payouts","reserve","how","proof","terms"];
// navigation sound: a short copper "tick" plus a soft air puff, built with Web Audio (no files)
let AC=null,SND=true;try{SND=localStorage.getItem("exposure-sound")!=="off"}catch(e){}
// nav sound: "soft tap", a barely-there tick (short filtered noise + a tiny high blip), pitched per tab
const NOTES=[0,2,4,7,9,12,14,16];let TAPNOISE=null;
function chime(ctx,dest,t,idx){
  const f=440*Math.pow(2,(NOTES[idx%NOTES.length]+3)/12);
  if(!TAPNOISE||TAPNOISE.sampleRate!==ctx.sampleRate){TAPNOISE=ctx.createBuffer(1,Math.round(ctx.sampleRate*.05),ctx.sampleRate);const d=TAPNOISE.getChannelData(0);for(let k=0;k<d.length;k++)d[k]=Math.random()*2-1}
  const out=ctx.createGain();out.gain.value=.85;out.connect(dest);
  const s=ctx.createBufferSource(),hp=ctx.createBiquadFilter(),ng=ctx.createGain();s.buffer=TAPNOISE;hp.type="highpass";hp.frequency.value=3000;
  ng.gain.setValueAtTime(0,t);ng.gain.linearRampToValueAtTime(.3,t+.002);ng.gain.exponentialRampToValueAtTime(.0001,t+.01);
  s.connect(hp);hp.connect(ng);ng.connect(out);s.start(t);s.stop(t+.05);
  const o=ctx.createOscillator(),g=ctx.createGain();o.type="sine";o.frequency.value=f*4;
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.05,t+.001);g.gain.exponentialRampToValueAtTime(.0001,t+.021);
  o.connect(g);g.connect(out);o.start(t);o.stop(t+.06);
}
function navSound(v){if(!SND)return;try{AC=AC||new (window.AudioContext||window.webkitAudioContext)();if(AC.state==="suspended")AC.resume();
  chime(AC,AC.destination,AC.currentTime+.005,Math.max(0,VIEWS.indexOf(v)))}catch(e){}}
const sndBtn=document.getElementById("sndBtn");
function setSnd(on){SND=on;sndBtn.setAttribute("aria-pressed",on);sndBtn.querySelector("span").textContent=on?"Sounds on":"Sounds off";const ms=document.querySelector("#mSnd span");if(ms)ms.textContent=on?"Sounds on":"Sounds off";try{localStorage.setItem("exposure-sound",on?"on":"off")}catch(e){}}
setSnd(SND);sndBtn.addEventListener("click",()=>{setSnd(!SND);if(SND)navSound()});
let curView=null;
function go(v,push=true){
  if(typeof v==="string"&&v.startsWith("u-")){try{userKey=decodeURIComponent(v.slice(2))}catch(e){userKey=v.slice(2)}v="user";renderUserPage()}
  if(typeof v==="string"&&v.startsWith("coin-")){try{coinKey=decodeURIComponent(v.slice(5))}catch(e){coinKey=v.slice(5)}v="coin";renderCoinPage()}
  if(!VIEWS.includes(v))v="explore";
  if(v==="me")renderMe();
  const changed=curView!==null&&curView!==v;curView=v;window.CUR_VIEW=v;
  if(DEMO_ON&&v!==curView&&typeof renderView==="function"&&v!=="coin"&&v!=="user")renderView(v);
  VIEWS.forEach(x=>document.getElementById("v-"+x).hidden=x!==v);
  if(v==="coin")drawCoinChart(coinBy(coinKey));
  if(changed){const vw=document.getElementById("v-"+v);vw.classList.remove("enter");void vw.offsetWidth;vw.classList.add("enter");
    const sw=document.getElementById("navSweep");sw.classList.remove("go");void sw.offsetWidth;sw.classList.add("go");
    const ln=document.querySelector(`.side .tabs a[data-v="${v}"]`);if(ln){ln.classList.remove("pop");void ln.offsetWidth;ln.classList.add("pop")}
    navSound(v)}
  document.querySelectorAll(".tabs a,.mbar [data-v],.msheet [data-v]").forEach(a=>a.classList.toggle("on",a.dataset.v===v));document.getElementById("mMore").classList.toggle("on",["expo","payouts","reserve","how","proof","terms"].includes(v));closeSheet();
  {const h=v==="coin"?"coin-"+encodeURIComponent(coinKey||""):v==="user"?"u-"+encodeURIComponent(userKey||""):v;if(push&&location.hash.slice(1)!==h)history.replaceState(null,"","#"+h)}
  window.scrollTo(0,0);
}
document.addEventListener("click",e=>{const a=e.target.closest('a[href^="#"]');if(!a)return;const v=a.getAttribute("href").slice(1);if(VIEWS.includes(v)||v.startsWith("coin-")||v.startsWith("u-")){e.preventDefault();go(v)}});
addEventListener("hashchange",()=>go(location.hash.slice(1),false));
go(location.hash.slice(1)||"explore",false);

// launch preview
const pv={img:document.getElementById("pvImg"),n:document.getElementById("pvName"),t:document.getElementById("pvTick"),d:document.getElementById("pvDesc")};
document.getElementById("lName").addEventListener("input",e=>pv.n.textContent=e.target.value||"Coin name");
document.getElementById("lDesc").addEventListener("input",e=>pv.d.textContent=e.target.value||"Your description shows here.");
document.getElementById("lTick").addEventListener("input",e=>{const v=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"");e.target.value=v;pv.t.textContent="$"+(v||"TICKER");if(!pv.img.querySelector("img"))pv.img.textContent=v[0]||"?"});
document.getElementById("lImg").addEventListener("change",e=>{const f=e.target.files[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{pv.img.innerHTML=`<img alt="Coin image preview" src="${esc(rd.result)}">`};rd.readAsDataURL(f)});
// ===== launch: your wallet signs and pays =====
const b64u8=b=>Uint8Array.from(atob(b),c=>c.charCodeAt(0));
let web3P=null;
function loadWeb3(){if(window.solanaWeb3)return Promise.resolve(window.solanaWeb3);
  web3P=web3P||new Promise((ok,no)=>{const sc=document.createElement("script");sc.src="https://cdn.jsdelivr.net/npm/@solana/web3.js@1.95.3/lib/index.iife.min.js";sc.onload=()=>window.solanaWeb3?ok(window.solanaWeb3):no(new Error("web3"));sc.onerror=()=>{web3P=null;no(new Error("web3"))};document.head.appendChild(sc)});return web3P}
function walletConnected(){const p=walletProvider();return !!(ME&&p&&p.publicKey&&String(p.publicKey)===ME)}
function lfSetStep(n){document.querySelectorAll("#lfSteps li").forEach((li,i)=>{li.classList.toggle("done",i<n-1);li.classList.toggle("on",i===n-1)})}
function lfWalletUI(){const el=$id("lfWallet");if(!el)return;const buy=+($id("lBuy").value||0),unit=$id("buyUnit")?$id("buyUnit").textContent:"SOL";
  el.innerHTML=walletConnected()?`<i class="wDot"></i><span>Launching from <b class="mono">${esc(shortW(ME))}</b>${buy>0?` · dev buy ${buy} ${esc(unit)}`:""}</span>`
    :`<span>Your own wallet signs the launch${buy>0?" and pays the dev buy":""}. Exposure never holds your funds.</span><button type="button" class="btn sm" id="lfConnect">Connect wallet</button>`}
document.addEventListener("click",async e=>{if(!e.target.closest("#lfConnect"))return;const m=$id("lMsg"),prov=await waitForWallet();
  if(!prov){if(openInWalletApp())return;m.className="msg err";m.textContent="No Solana wallet found in this browser. Install Phantom (phantom.app) and refresh.";return}
  try{const r=await prov.connect();const a=String((r&&r.publicKey)||prov.publicKey);setMe(a);lfWalletUI();m.textContent="";m.className="msg"}
  catch(err){m.className="msg err";m.textContent=walletErr(err)}});
$id("lBuy").addEventListener("input",lfWalletUI);
document.getElementById("lf").addEventListener("submit",async e=>{
  e.preventDefault();const m=$id("lMsg"),n=$id("lName").value.trim(),t=$id("lTick").value.trim(),go_=$id("lfGo");
  m.className="msg err";
  if(!n){m.textContent="Give the coin a name.";$id("lName").focus();return}
  if(t.length<2){m.textContent="Tickers need at least 2 characters.";$id("lTick").focus();return}
  if(!$id("lImg").files[0]){m.textContent="Add an image. pump.fun requires one.";return}
  if(!CONFIG.api){m.className="msg";m.textContent=DEMO_ON?"Demo mode: this is where your wallet would pop up to sign the launch. Launches open on launch day.":"Launches open soon. Your details are checked and ready, so come back on launch day.";if(DEMO_ON){lfSetStep(2);setTimeout(()=>lfSetStep(1),2500)}return}
  const prov=walletProvider();
  if(!prov){if(openInWalletApp())return;m.textContent="No Solana wallet found in this browser. Open Exposure in Phantom, Solflare or Backpack, or install one.";return}
  go_.disabled=true;
  try{
    m.className="msg";m.textContent="Approve the connection in your wallet…";
    const c=await prov.connect();const me=String((c&&c.publicKey)||prov.publicKey);if(me!==ME)setMe(me);lfWalletUI();
    lfSetStep(2);m.textContent="Preparing your launch…";
    const fd=new FormData();fd.append("name",n);fd.append("ticker",t);fd.append("description",$id("lDesc").value.trim());
    fd.append("twitter",$id("lX").value.trim());fd.append("devBuy",$id("lBuy").value||"0");fd.append("quote",pairSel);fd.append("creatorFeePct",pairSel==="SOL"?"0.3":$id("lFee").value);fd.append("image",$id("lImg").files[0]);fd.append("creator",me);
    const r=await fetch(CONFIG.api.replace(/\/$/,"")+"/launch",{method:"POST",body:fd});const j=await r.json().catch(()=>({}));
    if(!r.ok||j.error||typeof j.tx!=="string"||!isAddr(j.mint))throw{stage:"prep",msg:j.error?String(j.error).slice(0,160):""};
    const W3=await loadWeb3().catch(()=>{throw{stage:"web3"}});
    const vtx=W3.VersionedTransaction.deserialize(b64u8(j.tx));
    const bad=checkLaunchTx(vtx,me);if(bad)throw{stage:"check",msg:bad};
    m.textContent=`Approve the launch in your wallet. It shows exactly what you'll pay${+$id("lBuy").value>0?", including your dev buy":""}.`;
    const res=await prov.signAndSendTransaction(vtx);const sig=(res&&res.signature)||res;
    m.textContent="Confirming on Solana…";
    await fetch(CONFIG.api.replace(/\/$/,"")+"/launch/confirm",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mint:j.mint,signature:String(sig),creator:me})}).catch(()=>{});
    lfSetStep(3);m.className="msg okm";m.textContent=`$${t} is live. Opening its page…`;
    await loadState();setTimeout(()=>openCoin(j.mint),900);
  }catch(err){
    lfSetStep(1);m.className="msg err";
    m.textContent=err&&err.code===4001?"You cancelled in your wallet. Nothing was charged."
      :err&&err.stage==="prep"?(err.msg||"We couldn't prepare the launch. Nothing was charged. Try again in a minute.")
      :err&&err.stage==="check"?err.msg+" Nothing was charged.":err&&err.stage==="web3"?"A wallet helper didn't load. Check your connection and try again. Nothing was charged."
      :"The launch didn't go through. If your wallet showed a sent transaction, check My Exposure before trying again.";
  }finally{go_.disabled=false}
});
lfWalletUI();

// callout check
document.getElementById("f").addEventListener("submit",e=>{
  e.preventDefault();
  const wal=document.getElementById("fWallet").value.trim(),m=document.getElementById("fMsg"),box=document.getElementById("myCalls");
  if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wal)){m.className="msg err";m.textContent="We couldn't read that Solana address. Paste the full address from your wallet.";box.hidden=true;return}
  const show=mine=>{
    if(!mine.length){m.className="msg";m.textContent="No callouts from this wallet this round. Post one on pump.fun or Fomo about any Exposure coin you hold.";box.hidden=true;return}
    m.className="msg okm";m.textContent=`${mine.length} callout${mine.length>1?"s":""} entered this round.`;
    box.innerHTML=mine.map(x=>{const c=coinBy(x.coin)||{t:x.coin};return `<div class="pay">${avatar(x.u||wal)}<div class="t"><b>$${esc(c.t)} · ${NAMES[x.pl]}</b><span>${x.pl==="gmgn"?"Verified call":(x.hl|0)+" holder likes"}</span></div><div class="amt">+${(+x.earned||0).toFixed(3)} SOL<small>est. this round</small></div></div>`}).join("");
    box.hidden=false};
  if(!CONFIG.api){show(D.callouts.filter(x=>x.w===wal));return}
  m.className="msg";m.textContent="Checking…";
  fetch(CONFIG.api.replace(/\/$/,"")+"/wallet/"+encodeURIComponent(wal),{cache:"no-store"}).then(r=>r.json()).then(clean).then(j=>show(j.callouts||[]))
    .catch(()=>{m.className="msg err";m.textContent="We couldn't load callouts right now. Try again in a minute.";box.hidden=true});
});

