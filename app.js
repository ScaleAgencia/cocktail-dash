'use strict';
// ===================== Cocktail Cardi Nigro dashboard =====================
const D = window.DASH_DATA;
const TARGET_CPL_QLF = 150;   // meta CPL qualificado (R$)
const TARGET_CAC     = 1500;  // meta CAC (R$)
const PRETTY = { 'SEM_UTM':'— sem rastreio —', 'NAO_ATRIBUIDO':'— não atribuído —' };
const pretty = s => PRETTY[s] || s;

// ---- formatters ----
const nf2 = new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const nf0 = new Intl.NumberFormat('pt-BR');
const money = v => 'R$ ' + nf2.format(v||0);
const int   = v => nf0.format(Math.round(v||0));
const pct   = v => (v||0).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%';
const safe  = (a,b) => (b>0 ? a/b : 0);

// ---- date utils (YYYY-MM-DD) ----
const parseD = s => { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); };
const fmtD   = dt => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
const addDays= (dt,n)=>{ const x=new Date(dt); x.setDate(x.getDate()+n); return x; };
const dayspan= (a,b)=> Math.round((parseD(b)-parseD(a))/86400000)+1;

const DMIN = D.dateMin, DMAX = D.dateMax;
let state = { start:null, end:null, level:'campaign', sort:{key:'qlf',asc:false} };

// ---- aggregation ----
function sumDaily(start,end){
  const o={spend:0,impr:0,clicks:0,lpv:0,leads:0,qlf:0,sales:0,revenue:0};
  for(const r of D.daily){ if(r.date>=start && r.date<=end){ for(const k in o) o[k]+=r[k]||0; } }
  return o;
}
function metrics(a){
  return {
    spend:a.spend, impr:a.impr, clicks:a.clicks, lpv:a.lpv, leads:a.leads, qlf:a.qlf, sales:a.sales, revenue:a.revenue,
    cpm:safe(a.spend,a.impr)*1000, cpc:safe(a.spend,a.clicks), ctr:safe(a.clicks,a.impr)*100,
    cpv:safe(a.spend,a.lpv), cr:safe(a.lpv,a.clicks)*100, convlp:safe(a.leads,a.lpv)*100,
    cpl:safe(a.spend,a.leads), txqual:safe(a.qlf,a.leads)*100,
    cplqlf:safe(a.spend,a.qlf), txvenda:safe(a.sales,a.qlf)*100,
    cac:safe(a.spend,a.sales), roas:safe(a.revenue,a.spend), ticket:safe(a.revenue,a.sales)
  };
}
function groupGrain(start,end,level){
  const map=new Map();
  for(const r of D.grain){
    if(r.date<start || r.date>end) continue;
    let key,label,sub;
    if(level==='campaign'){ key=r.campaign; label=pretty(r.campaign); sub=''; }
    else if(level==='adset'){ key=r.campaign+'¦'+r.adset; label=pretty(r.adset); sub=pretty(r.campaign); }
    else { key=r.campaign+'¦'+r.adset+'¦'+r.ad; label=pretty(r.ad); sub=pretty(r.adset); }
    let o=map.get(key);
    if(!o){ o={label,sub,spend:0,impr:0,clicks:0,lpv:0,leads:0,qlf:0,sales:0,revenue:0}; map.set(key,o); }
    o.spend+=r.spend; o.impr+=r.impr; o.clicks+=r.clicks; o.lpv+=r.lpv;
    o.leads+=r.leads; o.qlf+=r.qlf; o.sales+=r.sales; o.revenue+=r.revenue;
  }
  return [...map.values()];
}

// ---- delta rendering ----
function deltaHTML(cur,prev,goodWhenUp=true){
  if(prev===0||prev==null) return '';
  const ch=(cur-prev)/prev*100;
  const good = goodWhenUp ? ch>=0 : ch<0;
  const cls = Math.abs(ch)<0.05 ? 'flat' : (good?'up':'down');
  const arr = ch>0?'▲':(ch<0?'▼':'—');
  return `<span class="delta ${cls}">${arr} ${Math.abs(ch).toFixed(1)}%</span>`;
}

// ---- funnel ----
function renderFunnel(cur,prev){
  const c=metrics(cur), p=metrics(prev);
  const rows=[
    {label:'Impressões', val:int(c.impr), sk:'CPM', sv:money(c.cpm), rl:'CTR', rv:pct(c.ctr), d:deltaHTML(c.ctr,p.ctr)},
    {label:'Link Clicks', val:int(c.clicks), sk:'CPC', sv:money(c.cpc), rl:'CR (clique → LP)', rv:pct(c.cr), d:deltaHTML(c.cr,p.cr)},
    {label:'Page Views', val:int(c.lpv), sk:'CPV', sv:money(c.cpv), rl:'Conversão LP', rv:pct(c.convlp), d:deltaHTML(c.convlp,p.convlp)},
    {label:'Leads', val:int(c.leads), sk:'CPL', sv:money(c.cpl), rl:'Taxa de qualificação', rv:pct(c.txqual), d:deltaHTML(c.txqual,p.txqual)},
    {label:'Leads Qualificados', val:int(c.qlf), sk:'CPL QLF', sv:money(c.cplqlf), rl:'Conversão p/ venda', rv:pct(c.txvenda), d:deltaHTML(c.txvenda,p.txvenda),
       hl:true, target:{val:c.cplqlf,max:TARGET_CPL_QLF,label:`meta R$ ${nf0.format(TARGET_CPL_QLF)}`}, sd:deltaHTML(c.cplqlf,p.cplqlf,false)},
    {label:'Vendas', val:int(c.sales), sk:'CAC', sv:money(c.cac), rl:'ROAS', rv:(c.roas).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'x', d:deltaHTML(c.roas,p.roas),
       hl:true, target:{val:c.cac,max:TARGET_CAC,label:`meta R$ ${nf0.format(TARGET_CAC)}`}, sd:deltaHTML(c.cac,p.cac,false)}
  ];
  document.getElementById('funnel').innerHTML = rows.map(r=>{
    let tbar='';
    if(r.target){ const ratio=Math.min(r.target.val/r.target.max,1.3); const col=r.target.val<=r.target.max*0.6?'var(--green)':(r.target.val<=r.target.max?'var(--yellow)':'var(--red)');
      tbar=`<div class="target-bar"><div style="width:${Math.min(ratio*100,100)}%;background:${col}"></div></div><div class="fextra">${r.target.label}</div>`; }
    return `<div class="frow ${r.hl?'hl':''}">
      <div class="fmain"><div class="flabel">${r.label}</div><div class="fval">${r.val}</div></div>
      <div class="fside"><div class="sk">${r.sk}</div><div class="sv">${r.sv} ${r.sd||''}</div>
        <div class="fextra">${r.rl}: <b>${r.rv}</b> ${r.d}</div>${tbar}</div>
    </div>`;
  }).join('');
}

// ---- investment card ----
function renderInvest(cur){
  const goal = Number(localStorage.getItem('ccn_goal')||15000);
  document.getElementById('goalInput').value = goal;
  const pctv = goal>0 ? cur.spend/goal*100 : 0;
  document.getElementById('investVal').textContent = money(cur.spend);
  document.getElementById('investPct').textContent = pct(pctv);
  document.getElementById('investPct').style.color = pctv>100?'var(--red)':'var(--green)';
  document.getElementById('investBar').style.width = Math.min(pctv,100)+'%';
  document.getElementById('investBar').style.background = pctv>100?'var(--red)':'var(--green)';
  document.getElementById('goalLbl').textContent = 'Meta: '+money(goal);
}

// ---- optimization table ----
const COLS=[
  {k:'label',t:'Nome',num:false},
  {k:'spend',t:'Gasto',f:money},
  {k:'leads',t:'Leads',f:int},
  {k:'qlf',t:'QLF',f:int},
  {k:'txqual',t:'% Qualif',f:pct,calc:r=>safe(r.qlf,r.leads)*100},
  {k:'cplqlf',t:'CPL QLF',f:v=>v,calc:r=>safe(r.spend,r.qlf),pill:true},
  {k:'sales',t:'Vendas',f:int},
  {k:'cac',t:'CAC',f:money,calc:r=>safe(r.spend,r.sales)},
  {k:'ctr',t:'CTR',f:pct,calc:r=>safe(r.clicks,r.impr)*100}
];
function cplPill(v,qlf){
  if(qlf<=0) return '<span class="pill" style="background:#aab4bf">—</span>';
  const col = v<=90?'var(--green)':(v<=TARGET_CPL_QLF?'var(--yellow)':'var(--red)');
  return `<span class="pill" style="background:${col}">${money(v)}</span>`;
}
function renderTable(){
  const rows=groupGrain(state.start,state.end,state.level);
  for(const r of rows){ for(const c of COLS){ if(c.calc) r[c.k]=c.calc(r); } }
  const s=state.sort;
  rows.sort((a,b)=> s.asc ? (a[s.key]>b[s.key]?1:-1) : (a[s.key]<b[s.key]?1:-1));
  const thead=document.querySelector('#optTable thead');
  thead.innerHTML='<tr>'+COLS.map(c=>`<th data-k="${c.k}" class="${s.key===c.k?'sorted '+(s.asc?'asc':''):''}">${c.t}</th>`).join('')+'</tr>';
  thead.querySelectorAll('th').forEach(th=>th.onclick=()=>{
    const k=th.dataset.k; if(state.sort.key===k) state.sort.asc=!state.sort.asc; else state.sort={key:k,asc:(k==='label'||k==='cplqlf')};
    renderTable();
  });
  const tb=document.querySelector('#optTable tbody');
  tb.innerHTML=rows.map(r=>{
    return '<tr>'+COLS.map(c=>{
      if(c.k==='label') return `<td>${r.label}${r.sub?`<div class="sub">${r.sub}</div>`:''}</td>`;
      if(c.k==='cplqlf') return `<td>${cplPill(r.cplqlf,r.qlf)}</td>`;
      return `<td>${c.f(r[c.k])}</td>`;
    }).join('')+'</tr>';
  }).join('');
}

// ---- sales by campaign ----
function renderSales(){
  const map=new Map();
  for(const r of D.grain){ if(r.date<state.start||r.date>state.end) continue; if(r.sales<=0) continue;
    const key=r.campaign; let o=map.get(key); if(!o){o={label:pretty(r.campaign),sales:0,revenue:0,spend:0};map.set(key,o);}
    o.sales+=r.sales; o.revenue+=r.revenue;
  }
  // add spend per campaign (from grain) for CAC
  for(const r of D.grain){ if(r.date<state.start||r.date>state.end) continue; const o=map.get(r.campaign); if(o) o.spend+=r.spend; }
  const rows=[...map.values()].sort((a,b)=>b.sales-a.sales);
  const cur=sumDaily(state.start,state.end);
  const attributed=rows.filter(r=>r.label!=='— não atribuído —').reduce((s,r)=>s+r.sales,0);
  const head=['Campanha','Vendas','Receita','Ticket médio','CAC'];
  document.querySelector('#salesTable thead').innerHTML='<tr>'+head.map((h,i)=>`<th class="${i===0?'':''}">${h}</th>`).join('')+'</tr>';
  document.querySelector('#salesTable tbody').innerHTML=rows.map(r=>`<tr>
    <td>${r.label}</td><td>${int(r.sales)}</td><td>${money(r.revenue)}</td>
    <td>${money(safe(r.revenue,r.sales))}</td><td>${r.spend>0?money(safe(r.spend,r.sales)):'—'}</td></tr>`).join('');
  document.getElementById('attrNote').textContent =
    `${attributed} de ${cur.sales} vendas no período atribuídas a uma campanha (cruzando e-mail do comprador com a base de leads). No total da base: ${D.buyersMatched}/${D.buyersTotal} compradores casados.`;
}

// ===================== charts (SVG, no libs) =====================
function seriesDaily(start,end){
  return D.daily.filter(r=>r.date>=start&&r.date<=end).sort((a,b)=>a.date<b.date?-1:1);
}
function renderLeadsChart(){
  const data=seriesDaily(state.start,state.end);
  const W=600,H=200,pad={l:34,r:10,t:12,b:24};
  const iw=W-pad.l-pad.r, ih=H-pad.t-pad.b;
  const max=Math.max(1,...data.map(d=>d.leads));
  const n=data.length, gw=iw/Math.max(n,1), bw=Math.min(gw*0.38,14);
  let bars='', xl='';
  data.forEach((d,i)=>{
    const x=pad.l+i*gw+gw/2;
    const hL=d.leads/max*ih, hQ=d.qlf/max*ih;
    bars+=`<rect x="${x-bw-1}" y="${pad.t+ih-hL}" width="${bw}" height="${hL}" fill="var(--blue)" rx="2"/>`;
    bars+=`<rect x="${x+1}" y="${pad.t+ih-hQ}" width="${bw}" height="${hQ}" fill="var(--navy)" rx="2"/>`;
    if(n<=20 || i%Math.ceil(n/12)===0){ xl+=`<text x="${x}" y="${H-7}" font-size="9" text-anchor="middle" fill="#7b8794">${d.date.slice(8,10)}/${d.date.slice(5,7)}</text>`; }
  });
  let yl='';
  for(let g=0;g<=2;g++){ const v=Math.round(max*g/2); const y=pad.t+ih-(v/max*ih); yl+=`<line x1="${pad.l}" y1="${y}" x2="${W-pad.r}" y2="${y}" stroke="#eef2f6"/><text x="${pad.l-5}" y="${y+3}" font-size="9" text-anchor="end" fill="#7b8794">${v}</text>`; }
  document.getElementById('chartLeads').innerHTML=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${yl}${bars}${xl}</svg>`;
}
function renderSpendChart(){
  const data=seriesDaily(state.start,state.end);
  const W=600,H=200,pad={l:38,r:38,t:12,b:24};
  const iw=W-pad.l-pad.r, ih=H-pad.t-pad.b;
  const maxS=Math.max(1,...data.map(d=>d.spend));
  const cpl=data.map(d=>safe(d.spend,d.qlf));
  const maxC=Math.max(1,...cpl);
  const n=data.length, gw=iw/Math.max(n,1), bw=Math.min(gw*0.5,16);
  let bars='',xl='';
  data.forEach((d,i)=>{ const x=pad.l+i*gw+gw/2; const h=d.spend/maxS*ih;
    bars+=`<rect x="${x-bw/2}" y="${pad.t+ih-h}" width="${bw}" height="${h}" fill="var(--blue2)" rx="2" opacity=".85"/>`;
    if(n<=20 || i%Math.ceil(n/12)===0){ xl+=`<text x="${x}" y="${H-7}" font-size="9" text-anchor="middle" fill="#7b8794">${d.date.slice(8,10)}/${d.date.slice(5,7)}</text>`; }
  });
  let line='';
  data.forEach((d,i)=>{ const x=pad.l+i*gw+gw/2; const y=pad.t+ih-(cpl[i]/maxC*ih);
    line+= (i===0?`M${x},${y}`:` L${x},${y}`); });
  const pts=data.map((d,i)=>{const x=pad.l+i*gw+gw/2;const y=pad.t+ih-(cpl[i]/maxC*ih);return `<circle cx="${x}" cy="${y}" r="2.5" fill="var(--yellow)"/>`;}).join('');
  let yl='';
  for(let g=0;g<=2;g++){ const v=maxS*g/2; const y=pad.t+ih-(v/maxS*ih); yl+=`<text x="${pad.l-5}" y="${y+3}" font-size="9" text-anchor="end" fill="#7b8794">${int(v)}</text>`; const vc=maxC*g/2; yl+=`<text x="${W-pad.r+5}" y="${y+3}" font-size="9" text-anchor="start" fill="#7b8794">${int(vc)}</text>`; }
  document.getElementById('chartSpend').innerHTML=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${yl}${bars}<path d="${line}" fill="none" stroke="var(--yellow)" stroke-width="2"/>${pts}</svg>`;
}

// ===================== render all =====================
function render(){
  document.getElementById('rangeLbl').textContent = `${state.start.split('-').reverse().join('/')} → ${state.end.split('-').reverse().join('/')} (${dayspan(state.start,state.end)} dias)`;
  document.getElementById('dStart').value=state.start;
  document.getElementById('dEnd').value=state.end;
  const cur=sumDaily(state.start,state.end);
  const len=dayspan(state.start,state.end);
  const prevEnd=fmtD(addDays(parseD(state.start),-1));
  const prevStart=fmtD(addDays(parseD(prevEnd),-(len-1)));
  const prev=sumDaily(prevStart,prevEnd);
  renderInvest(cur);
  renderFunnel(cur,prev);
  renderTable();
  renderSales();
  renderLeadsChart();
  renderSpendChart();
}

// ===================== presets & init =====================
function setRange(s,e){ state.start=s<DMIN?DMIN:s; state.end=e>DMAX?DMAX:e; render(); }
function lastN(n){ const e=DMAX; const s=fmtD(addDays(parseD(DMAX),-(n-1))); return [s,e]; }
const PRESETS=[
  ['Últimos 7 dias',()=>lastN(7)],
  ['Últimos 14 dias',()=>lastN(14)],
  ['Últimos 30 dias',()=>lastN(30)],
  ['Este mês',()=>{const d=parseD(DMAX);return [fmtD(new Date(d.getFullYear(),d.getMonth(),1)),DMAX];}],
  ['Mês passado',()=>{const d=parseD(DMAX);const s=new Date(d.getFullYear(),d.getMonth()-1,1);const e=new Date(d.getFullYear(),d.getMonth(),0);return [fmtD(s),fmtD(e)];}],
  ['Exemplo 01–19/mai',()=>['2026-05-01','2026-05-19']],
  ['Tudo',()=>[DMIN,DMAX]]
];
function buildPresets(){
  const box=document.getElementById('presets');
  box.innerHTML='';
  PRESETS.forEach(([name,fn],idx)=>{
    const b=document.createElement('button'); b.textContent=name;
    b.onclick=()=>{ box.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); const [s,e]=fn(); setRange(s,e); };
    if(idx===2) b.classList.add('active'); // default: últimos 30 dias
    box.appendChild(b);
  });
}
function init(){
  document.getElementById('updated').textContent = 'Atualizado: '+D.generatedAtBR;
  document.getElementById('qualNote').textContent = 'Qualificado = '+D.qualification;
  document.getElementById('taxNote').textContent = 'Gasto inclui imposto (× '+(D.taxMultiplier).toLocaleString('pt-BR',{minimumFractionDigits:4})+')';
  buildPresets();
  document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active')); t.classList.add('active');
    state.level=t.dataset.level; state.sort={key:'qlf',asc:false}; renderTable();
  });
  document.getElementById('applyRange').onclick=()=>{ document.getElementById('presets').querySelectorAll('button').forEach(x=>x.classList.remove('active')); setRange(document.getElementById('dStart').value,document.getElementById('dEnd').value); };
  document.getElementById('goalInput').onchange=e=>{ localStorage.setItem('ccn_goal',e.target.value||15000); render(); };
  const [s,e]=lastN(30); setRange(s,e);
}
init();
