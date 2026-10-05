/* ===== Swap this object for real data at launch ===== */
const DATA = {
  example: true,
  ticker: "$BLOXSTRAT",
  ca: null,                         // contract address, e.g. "AbC...pump"
  buyUrl: null,                     // pump.fun coin page
  treasury: "7xKXbS4qPz3mNf9vR2tLwYcE8hJd5uGa1oBnQk6TpMs",
  solscan: "https://solscan.io",
  supply: 1_000_000_000,
  tokenPriceSol: 0.00000012,        // used to estimate burns in the simulator
  resaleFee: 0.30,                  // Roblox's cut of each resale
  targetPct: 50,
  feesInSol: 142.6,
  feesToday: 9.8,
  items: [
    { name:"Valkyrie Helm",          art:"valk",   cost:14.2, value:19.8 },
    { name:"Domino Crown",           art:"crown",  cost:21.0, value:22.1 },
    { name:"Dominus Frigidus",       art:"hood",   cost:30.5, value:46.9 },
    { name:"Bluesteel Bathelm",      art:"helm",   cost:6.8,  value:10.4 },
    { name:"Midnight Shades",        art:"shades", cost:4.1,  value:4.0  },
    { name:"Rainbow Shaggy",         art:"hair",   cost:8.6,  value:10.1 },
    { name:"Sparkle Time Fedora",    art:"fedora", cost:9.3,  sold:14.3, when:"2h ago",  tx:"5Kd9…q2Wm" },
    { name:"Bighead",                art:"head",   cost:6.2,  sold:9.4,  when:"9h ago",  tx:"3Hn7…vX1c" },
    { name:"Clockwork's Shades",     art:"shades", cost:18.0, sold:29.2, when:"1d ago",  tx:"2Lp4…Tr8a" },
    { name:"Purple Banded Top Hat",  art:"tophat", cost:5.0,  sold:7.5,  when:"2d ago",  tx:"4Qe1…Mn6d" },
    { name:"Red Grape Soda",         art:"soda",   cost:3.1,  sold:5.0,  when:"3d ago",  tx:"6Wz3…Bk9p" }
  ]
};
/* ==================================================== */

const $ = id => document.getElementById(id);
const sol = (n, d=1) => n.toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d}) + " SOL";
const sgn = (n, d=1) => (n>=0?"+":"−") + Math.abs(n).toFixed(d);
const tok = n => n>=1e6 ? (n/1e6).toFixed(1)+"M" : n>=1e3 ? (n/1e3).toFixed(1)+"K" : Math.round(n).toString();
const short = s => s.length>12 ? s.slice(0,4)+"…"+s.slice(-4) : s;
const link = path => DATA.example ? DATA.solscan : DATA.solscan + path;
const ext = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>';

const ART = {
  tophat:'<rect x="20" y="10" width="24" height="30" rx="3"/><rect x="20" y="32" width="24" height="5" opacity=".4"/><rect x="10" y="40" width="44" height="7" rx="3.5"/>',
  fedora:'<path d="M19 40c1-14 7-22 13-22s12 8 13 22z"/><rect x="19" y="33" width="26" height="4" opacity=".4"/><ellipse cx="32" cy="43" rx="25" ry="6"/>',
  crown:'<path d="M11 44 13 20l10 11 9-16 9 16 10-11 2 24z"/><rect x="11" y="45" width="42" height="6" rx="2" opacity=".55"/>',
  helm:'<path d="M14 42c0-13 8-24 18-24s18 11 18 24v6H14z"/><rect x="21" y="34" width="22" height="5" rx="2" opacity=".35"/>',
  valk:'<path d="M17 44c0-12 7-21 15-21s15 9 15 21v5H17z"/><path d="M17 33 4 18l15 7zM47 33l13-15-15 7z" opacity=".7"/><rect x="23" y="37" width="18" height="4" rx="2" opacity=".35"/>',
  hood:'<path d="M15 52C15 27 23 11 32 11s17 16 17 41z"/><path d="M24 52c0-14 4-22 8-22s8 8 8 22z" opacity=".3"/>',
  shades:'<rect x="9" y="25" width="20" height="13" rx="5"/><rect x="35" y="25" width="20" height="13" rx="5"/><rect x="28" y="28" width="8" height="3" rx="1.5"/>',
  hair:'<path d="M12 42c0-17 9-28 20-28s20 11 20 28c-4-4-8-6-10-6-2 3-6 4-10 4s-8-1-10-4c-2 0-6 2-10 6z"/>',
  head:'<circle cx="32" cy="32" r="19"/><circle cx="25" cy="29" r="2.5" opacity=".35"/><circle cx="39" cy="29" r="2.5" opacity=".35"/>',
  soda:'<rect x="22" y="12" width="20" height="40" rx="5"/><rect x="22" y="24" width="20" height="14" opacity=".35"/>'
};
const tierOf = v => v>=25 ? ["Legendary","var(--legend)"] : v>=10 ? ["Epic","var(--epic)"] : ["Rare","var(--rare)"];
const art = it => { const [,c]=tierOf(it.value ?? it.sold); return `<span class="art" style="--tier:${c}"><svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">${ART[it.art]||ART.head}</svg></span>`; };

/* derived numbers */
const T = DATA.targetPct, FEE = DATA.resaleFee;
const held = DATA.items.filter(i=>i.sold==null), sold = DATA.items.filter(i=>i.sold!=null);
sold.forEach(i=>{ i.profit = i.sold*(1-FEE) - i.cost; i.burned = Math.max(0,i.profit)/DATA.tokenPriceSol; i.gain=(i.sold/i.cost-1)*100; });
held.forEach(i=>{ i.gain=(i.value/i.cost-1)*100; });
const spent = DATA.items.reduce((a,i)=>a+i.cost,0);
const recycled = sold.reduce((a,i)=>a+i.cost,0);
const cash = DATA.feesInSol - spent + recycled;
const heldVal = held.reduce((a,i)=>a+i.value,0);
const profit = sold.reduce((a,i)=>a+i.profit,0);
const burned = sold.reduce((a,i)=>a+i.burned,0);
const burnPct = burned/DATA.supply*100;

/* hero */
$("kTreasury").textContent = sol(cash+heldVal);
$("kTreasurySub").textContent = `${sol(cash)} cash + ${held.length} items`;
$("kProfit").textContent = sgn(profit,2)+" SOL";
$("kProfitSub").textContent = `from ${sold.length} sales, after fees`;
$("kBurn").textContent = burnPct.toFixed(2)+"%";
$("kBurnSub").textContent = `${tok(burned)} ${DATA.ticker} burned`;
$("coreBurn").textContent = burnPct.toFixed(2)+"%";
$("coreSub").textContent = `${tok(burned)} tokens`;
$("cycle").textContent = `Running · ${sold.length} burns`;
if(!DATA.example) $("banner").hidden = true;
if(DATA.ca) $("caText").textContent = DATA.ca;
["buyNav","buyHero"].forEach(id=>{ if(DATA.buyUrl){ $(id).href=DATA.buyUrl; $(id).target="_blank"; $(id).rel="noopener"; } else $(id).addEventListener("click",e=>{e.preventDefault(); const b=e.currentTarget, t=b.textContent; b.textContent="Launching soon"; setTimeout(()=>b.textContent=t,1600);}); });

/* flywheel stations */
const stations=[["01","Volume","Trades pay fees"],["02","Fees","Claimed to treasury"],["03","Limiteds","Bought on Roblox"],["04","Sell",`At +${T}% target`],["05","Burn","Profit buys back"]];
const wheel=$("wheel"), chev=$("chev");
stations.forEach((s,k)=>{
  const a=(-90+k*72)*Math.PI/180, x=50+34*Math.cos(a), y=50+34*Math.sin(a);
  const d=document.createElement("div"); d.className="station"+(k===4?" burn":"");
  d.style.left=x+"%"; d.style.top=y+"%";
  d.innerHTML=`<span class="n">${s[0]}</span><b>${s[1]}</b><small>${s[2]}</small>`;
  wheel.appendChild(d);
  const m=(-90+k*72+36), mr=m*Math.PI/180, cx=50+34*Math.cos(mr), cy=50+34*Math.sin(mr);
  chev.insertAdjacentHTML("beforeend",`<path d="M-1.1 -1.6 1 0 -1.1 1.6" transform="translate(${cx.toFixed(2)} ${cy.toFixed(2)}) rotate(${m+90})" fill="none" stroke="var(--faint)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`);
});

/* proof */
const last = sold[0];
const icW='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="3"/><path d="M16 12.5h2M3 10h18"/></svg>';
const icF='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/></svg>';
const icS='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16M14 6l6 6-6 6"/></svg>';
$("proofCards").innerHTML = `
  <article class="card"><div class="k">${icW}Treasury wallet</div><div class="v">${sol(cash)}</div><div class="meta">Cash on hand, plus ${held.length} items worth ${sol(heldVal)}</div>
    <div class="src"><code>${short(DATA.treasury)}</code><a class="tx" href="${link("/account/"+DATA.treasury)}" target="_blank" rel="noopener">Solscan ${ext}</a></div></article>
  <article class="card"><div class="k">${icF}Last burn</div><div class="v">${tok(last.burned)} ${DATA.ticker}</div><div class="meta">${last.when} · from the ${last.name} sale</div>
    <div class="src"><code>${last.tx}</code><a class="tx" href="${link("/tx/"+last.tx)}" target="_blank" rel="noopener">Solscan ${ext}</a></div></article>
  <article class="card"><div class="k">${icS}Last sale</div><div class="v">${sgn(last.profit,2)} SOL</div><div class="meta">${last.name} sold at ${sgn(last.gain)}%, after Roblox's fee</div>
    <div class="src"><code>${sol(last.cost)} → ${sol(last.sold)}</code><a class="tx" href="#burns">Burn log</a></div></article>`;
$("walletHero").href = link("/account/"+DATA.treasury); $("walletHero").target="_blank"; $("walletHero").rel="noopener";

/* positions */
const statusOf = i => i.sold!=null ? ["sold","Sold · burned"] : i.gain>=T ? ["ready","Ready to sell"] : i.gain>=T-15 ? ["near","Near target"] : ["hold","Holding"];
const progOf = i => i.sold!=null ? 1 : Math.max(0,Math.min(1,i.gain/T));
let filter="all", sort="progress";
const FILTERS=[["all","All"],["hold","Holding"],["near","Near target"],["sold","Sold"]];
const matches=(i,f)=>{ const s=statusOf(i)[0]; return f==="all" || (f==="hold" && (s==="hold")) || (f==="near" && (s==="near"||s==="ready")) || (f==="sold" && s==="sold"); };
function renderChips(){
  $("chips").innerHTML = FILTERS.map(([k,l])=>`<button class="chip" type="button" data-f="${k}" aria-pressed="${filter===k}">${l}<span class="c">${DATA.items.filter(i=>matches(i,k)).length}</span></button>`).join("");
}
function renderPositions(){
  const list = DATA.items.filter(i=>matches(i,filter)).sort((a,b)=>{
    if(sort==="pl") return b.gain-a.gain;
    if(sort==="value") return (b.value??b.sold)-(a.value??a.sold);
    const sa=a.sold!=null, sb=b.sold!=null; if(sa!==sb) return sa?1:-1;
    return progOf(b)-progOf(a) || b.gain-a.gain;
  });
  if(!list.length){ $("tbody").innerHTML=`<tr><td colspan="6" class="empty">No items match this filter.</td></tr>`; $("cards").innerHTML=`<div class="empty">No items match this filter.</div>`; return; }
  $("tbody").innerHTML = list.map(i=>{
    const [s,l]=statusOf(i), p=progOf(i), [tier]=tierOf(i.value??i.sold), v=i.value??i.sold;
    return `<tr><td><div class="itm">${art(i)}<div><div class="nm">${i.name}</div><div class="rar">${tier}${i.sold!=null?" · sold "+i.when:""}</div></div></div></td>
      <td class="r">${sol(i.cost)}</td><td class="r">${sol(v)}</td><td class="r pl ${i.gain>=0?"up":"down"}">${sgn(i.gain)}%</td>
      <td><div class="prog"><div class="bar ${s}"><i style="width:${(p*100).toFixed(0)}%"></i></div><span>${i.sold!=null?"Done":Math.round(p*100)+"%"}</span></div></td>
      <td><span class="status ${s}">${l}</span></td></tr>`;
  }).join("");
  $("cards").innerHTML = list.map(i=>{
    const [s,l]=statusOf(i), p=progOf(i), [tier]=tierOf(i.value??i.sold), v=i.value??i.sold;
    return `<article class="pcard"><div class="top">${art(i)}<div style="min-width:0"><div class="nm">${i.name}</div><span class="status ${s}" style="margin-top:6px">${l}</span></div></div>
      <div class="grid"><div>Cost<b>${i.cost.toFixed(1)}</b></div><div>${i.sold!=null?"Sold":"Value"}<b>${v.toFixed(1)}</b></div><div>Gain<b class="pl ${i.gain>=0?"up":"down"}">${sgn(i.gain)}%</b></div></div>
      <div class="bar ${s}"><i style="width:${(p*100).toFixed(0)}%"></i></div>
      <div class="foot"><span>${tier} · SOL</span><span>${i.sold!=null?"Sold "+i.when:Math.round(p*100)+"% to +"+T+"%"}</span></div></article>`;
  }).join("");
}
$("chips").addEventListener("click",e=>{ const b=e.target.closest(".chip"); if(!b) return; filter=b.dataset.f; renderChips(); renderPositions(); });
$("sortSel").addEventListener("change",e=>{ sort=e.target.value; renderPositions(); });
$("posSub").textContent = `Each item is held until its Rolimons value is up ${T}% from cost.`;
renderChips(); renderPositions();

/* simulator */
const rng=$("target"), BE=(1/(1-FEE)-1)*100;
rng.value=T;
$("beMark").style.left = ((BE-rng.min)/(rng.max-rng.min)*100)+"%";
$("beMark").textContent = `Break-even +${Math.round(BE)}%`;
function renderSim(){
  const t=+rng.value; $("tOut").textContent="+"+t+"%";
  const go = held.filter(i=>i.gain>=t);
  const gross = go.reduce((a,i)=>a+i.value,0), cost=go.reduce((a,i)=>a+i.cost,0);
  const pr = gross*(1-FEE)-cost;
  $("oCount").textContent = go.length+" of "+held.length;
  $("oGross").textContent = sol(gross);
  $("oProfit").textContent = go.length ? sgn(pr,2)+" SOL" : "0 SOL";
  $("oProfit").style.color = pr<0 ? "var(--down)" : pr>0 ? "var(--up)" : "";
  $("oBurn").textContent = pr>0 ? tok(pr/DATA.tokenPriceSol) : "0";
  $("oItems").innerHTML = go.length ? go.map(i=>`<span>${art(i)}${i.name}</span>`).join("") : `<span style="padding-left:12px;color:var(--dim)">No items are up ${t}% yet.</span>`;
  const w=$("oWarn");
  if(go.length && pr<0){ w.hidden=false; w.textContent=`Below break-even. Selling these now would lose ${Math.abs(pr).toFixed(2)} SOL after Roblox's fee, so nothing would be burned.`; }
  else w.hidden=true;
}
rng.addEventListener("input",renderSim); renderSim();

/* burn timeline */
const flame='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/></svg>';
$("timeline").innerHTML = sold.map(i=>`<li><span class="node">${flame}</span>
  <div class="ev"><div class="main"><div class="amt">${tok(i.burned)} ${DATA.ticker}</div><div class="det">${i.name} sold at ${sgn(i.gain)}% · ${sgn(i.profit,2)} SOL profit</div></div>
  <div style="display:flex;align-items:center;gap:14px"><span class="when">${i.when}</span><a class="tx" href="${link("/tx/"+i.tx)}" target="_blank" rel="noopener"><span class="mono" style="font-size:13px">${i.tx}</span>${ext}</a></div></div></li>`).join("");

/* copy CA */
$("copyCa").addEventListener("click",e=>{
  const b=e.currentTarget, done=t=>{b.textContent=t; setTimeout(()=>b.textContent="Copy",1600);};
  if(!DATA.ca) return done("Not live yet");
  navigator.clipboard.writeText(DATA.ca).then(()=>done("Copied")).catch(()=>{ const r=document.createRange(); r.selectNodeContents($("caText")); const s=getSelection(); s.removeAllRanges(); s.addRange(r); done("Selected"); });
});

/* theme toggle: dark by default */
const root=document.documentElement;
try{ const saved=localStorage.getItem("bs-theme"); if(saved) root.dataset.theme=saved; }catch(e){}
$("themeBtn").addEventListener("click",()=>{
  const next = root.dataset.theme==="light" ? "dark" : "light";
  root.dataset.theme=next; try{ localStorage.setItem("bs-theme",next); }catch(e){}
});
