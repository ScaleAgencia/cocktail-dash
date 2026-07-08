'use strict';
// ===================== Cocktail Cardi Nigro dashboard =====================
const D = window.DASH_DATA;
const OBJ = window.DASH_OBJ || {};
const INS = window.DASH_INSIGHTS || {};
const ESTUDO = window.DASH_ESTUDO || {};
const TARGET_CPL_QLF = 150;   // meta CPL qualificado (R$)
const TARGET_CAC     = 1500;  // meta CAC (R$)
const PRODUCT = 'Evento presencial para mulheres que já faturam acima de R$ 100 mil/mês — empresárias num patamar alto que querem escalar ainda mais, destravar e ir para o próximo nível.';
const PRETTY = { 'SEM_UTM':'— sem rastreio —', 'NAO_ATRIBUIDO':'— não atribuído —', 'SEM_VENDEDORA':'— sem vendedora —' };
const pretty = s => PRETTY[s] || s;
const OBJ_LABELS = {
  'Equipe & Pessoas':'Equipe & Pessoas', 'Delegacao & Escala':'Delegação & Escala',
  'Financeiro & Capital':'Financeiro & Capital', 'Vendas & Clientes':'Vendas & Clientes',
  'Marketing & Divulgacao':'Marketing & Divulgação', 'Gestao & Organizacao':'Gestão & Organização',
  'Estrategia & Direcao':'Estratégia & Direção', 'Mindset & Constancia':'Mindset & Constância',
  'Concorrencia & Mercado':'Concorrência & Mercado', 'Produto & Operacao':'Produto & Operação',
  'Sem empresa / Inicio':'Sem empresa / Início', 'Outros':'Outros'
};
const OBJ_COLORS = ['#1769b4','#2f7fd1','#4aa3e8','#2e9e3f','#7bc043','#e9a23b','#e0772f','#d4544a','#9b59b6','#7b8794','#b0bac4','#c8d0d8'];
const objLabel = k => OBJ_LABELS[k] || k;
const objColor = k => OBJ_COLORS[Math.max(0,(OBJ.objOrder||[]).indexOf(k)) % OBJ_COLORS.length];

// ---- formatters ----
const nf2 = new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const nf0 = new Intl.NumberFormat('pt-BR');
const money = v => 'R$ ' + nf2.format(v||0);
const int   = v => nf0.format(Math.round(v||0));
const pct   = v => (v||0).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%';
const safe  = (a,b) => (b>0 ? a/b : 0);
const esc   = s => String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])).replace(/\s*\n\s*/g,' ');

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
       x2:`Taxa de qualificação: <b>${pct(c.txqual)}</b> <span class="sub">(${int(c.qlf)} qualif. de ${int(c.leads)} leads)</span> ${deltaHTML(c.txqual,p.txqual)}`,
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
        ${r.x2?`<div class="fextra">${r.x2}</div>`:''}
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
const expanded = new Set();
function nodeM(){ return {spend:0,impr:0,clicks:0,lpv:0,leads:0,qlf:0,sales:0,revenue:0}; }
function addM(o,r){ o.spend+=r.spend;o.impr+=r.impr;o.clicks+=r.clicks;o.lpv+=r.lpv;o.leads+=r.leads;o.qlf+=r.qlf;o.sales+=r.sales;o.revenue+=r.revenue; }
function buildTree(start,end){
  const camps=new Map();
  for(const r of D.grain){ if(r.date<start||r.date>end) continue;
    let c=camps.get(r.campaign); if(!c){ c={key:'c:'+r.campaign,label:pretty(r.campaign),m:nodeM(),kids:new Map()}; camps.set(r.campaign,c); } addM(c.m,r);
    let a=c.kids.get(r.adset); if(!a){ a={key:'a:'+r.campaign+'¦'+r.adset,label:pretty(r.adset),m:nodeM(),kids:new Map()}; c.kids.set(r.adset,a); } addM(a.m,r);
    let d=a.kids.get(r.ad); if(!d){ d={key:'d:'+r.campaign+'¦'+r.adset+'¦'+r.ad,label:pretty(r.ad),m:nodeM(),kids:null}; a.kids.set(r.ad,d); } addM(d.m,r);
  }
  const arr=[...camps.values()].sort((x,y)=>y.m.spend-x.m.spend);
  for(const c of arr){ c.kidsArr=[...c.kids.values()].sort((x,y)=>y.m.spend-x.m.spend);
    for(const a of c.kidsArr){ a.kidsArr=[...a.kids.values()].sort((x,y)=>y.m.spend-x.m.spend); } }
  return arr;
}
function treeRow(node,level,hasKids){
  const m=node.m, cplqlf=safe(m.spend,m.qlf), cac=safe(m.spend,m.sales), ctr=safe(m.clicks,m.impr)*100, txq=safe(m.qlf,m.leads)*100;
  const car = hasKids ? `<span class="caret">${expanded.has(node.key)?'▾':'▸'}</span>` : '<span class="caret0"></span>';
  return `<tr class="trow lvl${level}" data-key="${esc(node.key)}" data-k="${hasKids?1:0}">
    <td class="tlabel" style="padding-left:${8+level*22}px">${car}${esc(node.label)}</td>
    <td>${money(m.spend)}</td><td>${int(m.leads)}</td><td>${int(m.qlf)}</td><td>${pct(txq)}</td>
    <td>${cplPill(cplqlf,m.qlf)}</td><td>${int(m.sales)}</td><td>${m.sales>0?money(cac):'—'}</td><td>${pct(ctr)}</td></tr>`;
}
function cplPill(v,qlf){
  if(qlf<=0) return '<span class="pill" style="background:#aab4bf">—</span>';
  const col = v<=90?'var(--green)':(v<=TARGET_CPL_QLF?'var(--yellow)':'var(--red)');
  return `<span class="pill" style="background:${col}">${money(v)}</span>`;
}
function renderTable(){
  const tree=buildTree(state.start,state.end);
  document.querySelector('#optTable thead').innerHTML='<tr><th class="tlabel">Campanha › Conjunto › Anúncio</th><th>Gasto</th><th>Leads</th><th>QLF</th><th>%Qualif</th><th>CPL QLF</th><th>Vendas</th><th>CAC</th><th>CTR</th></tr>';
  let rows='';
  for(const c of tree){ rows+=treeRow(c,0,c.kidsArr.length>0);
    if(expanded.has(c.key)) for(const a of c.kidsArr){ rows+=treeRow(a,1,a.kidsArr.length>0);
      if(expanded.has(a.key)) for(const d of a.kidsArr){ rows+=treeRow(d,2,false); } } }
  document.querySelector('#optTable tbody').innerHTML=rows;
  document.querySelectorAll('#optTable .trow[data-k="1"]').forEach(tr=>tr.onclick=()=>{ const k=tr.dataset.key; if(expanded.has(k)) expanded.delete(k); else expanded.add(k); renderTable(); });
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
// ---- tooltip dos gráficos (hover nas colunas) ----
function chartTip(){ let t=document.getElementById('chartTip');
  if(!t){ t=document.createElement('div'); t.id='chartTip'; t.className='charttip'; t.style.display='none'; document.body.appendChild(t); }
  return t; }
function positionTip(tip,e){ const pad=16, r=tip.getBoundingClientRect();
  let x=e.clientX+pad, y=e.clientY+pad;
  if(x+r.width>window.innerWidth-6) x=e.clientX-r.width-pad;
  if(y+r.height>window.innerHeight-6) y=e.clientY-r.height-pad;
  tip.style.left=Math.max(6,x)+'px'; tip.style.top=Math.max(6,y)+'px'; }
function attachTip(elId,fmt){ const svg=document.querySelector('#'+elId+' svg'); if(!svg) return; const tip=chartTip();
  svg.querySelectorAll('.hz').forEach(z=>{
    z.addEventListener('mouseenter',()=>{ tip.innerHTML=fmt(z.dataset); tip.style.display='block'; });
    z.addEventListener('mousemove',e=>positionTip(tip,e));
    z.addEventListener('mouseleave',()=>{ tip.style.display='none'; });
  });
}
function renderLeadsChart(){
  const data=seriesDaily(state.start,state.end);
  const W=600,H=200,pad={l:34,r:10,t:12,b:24};
  const iw=W-pad.l-pad.r, ih=H-pad.t-pad.b;
  const max=Math.max(1,...data.map(d=>d.leads));
  const n=data.length, gw=iw/Math.max(n,1), bw=Math.min(gw*0.38,14);
  let bars='', xl='', hz='';
  data.forEach((d,i)=>{
    const x=pad.l+i*gw+gw/2;
    const hL=d.leads/max*ih, hQ=d.qlf/max*ih;
    bars+=`<rect x="${x-bw-1}" y="${pad.t+ih-hL}" width="${bw}" height="${hL}" fill="var(--blue)" rx="2"/>`;
    bars+=`<rect x="${x+1}" y="${pad.t+ih-hQ}" width="${bw}" height="${hQ}" fill="var(--navy)" rx="2"/>`;
    hz+=`<rect class="hz" x="${pad.l+i*gw}" y="${pad.t}" width="${gw}" height="${ih}" fill="transparent" data-date="${d.date}" data-leads="${d.leads}" data-qlf="${d.qlf}"/>`;
    if(n<=20 || i%Math.ceil(n/12)===0){ xl+=`<text x="${x}" y="${H-7}" font-size="9" text-anchor="middle" fill="#7b8794">${d.date.slice(8,10)}/${d.date.slice(5,7)}</text>`; }
  });
  let yl='';
  for(let g=0;g<=2;g++){ const v=Math.round(max*g/2); const y=pad.t+ih-(v/max*ih); yl+=`<line x1="${pad.l}" y1="${y}" x2="${W-pad.r}" y2="${y}" stroke="#eef2f6"/><text x="${pad.l-5}" y="${y+3}" font-size="9" text-anchor="end" fill="#7b8794">${v}</text>`; }
  document.getElementById('chartLeads').innerHTML=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${yl}${bars}${xl}${hz}</svg>`;
  attachTip('chartLeads', ds=>{ const lv=+ds.leads, qv=+ds.qlf, tx=safe(qv,lv)*100;
    return `<div class="tt-d">${ds.date.split('-').reverse().join('/')}</div>
      <div class="tt-r"><span class="tdot" style="background:var(--blue)"></span>Leads<b>${int(lv)}</b></div>
      <div class="tt-r"><span class="tdot" style="background:var(--navy)"></span>Qualificados<b>${int(qv)}</b></div>
      <div class="tt-r"><span class="sub">Taxa de qualificação: ${pct(tx)}</span></div>`; });
}
function renderSpendChart(){
  const data=seriesDaily(state.start,state.end);
  const W=600,H=200,pad={l:38,r:38,t:12,b:24};
  const iw=W-pad.l-pad.r, ih=H-pad.t-pad.b;
  const maxS=Math.max(1,...data.map(d=>d.spend));
  const cpl=data.map(d=>safe(d.spend,d.qlf));
  const maxC=Math.max(1,...cpl);
  const n=data.length, gw=iw/Math.max(n,1), bw=Math.min(gw*0.5,16);
  let bars='',xl='',hz='';
  data.forEach((d,i)=>{ const x=pad.l+i*gw+gw/2; const h=d.spend/maxS*ih;
    bars+=`<rect x="${x-bw/2}" y="${pad.t+ih-h}" width="${bw}" height="${h}" fill="var(--blue2)" rx="2" opacity=".85"/>`;
    hz+=`<rect class="hz" x="${pad.l+i*gw}" y="${pad.t}" width="${gw}" height="${ih}" fill="transparent" data-date="${d.date}" data-spend="${d.spend}" data-cpl="${cpl[i]}" data-qlf="${d.qlf}"/>`;
    if(n<=20 || i%Math.ceil(n/12)===0){ xl+=`<text x="${x}" y="${H-7}" font-size="9" text-anchor="middle" fill="#7b8794">${d.date.slice(8,10)}/${d.date.slice(5,7)}</text>`; }
  });
  let line='';
  data.forEach((d,i)=>{ const x=pad.l+i*gw+gw/2; const y=pad.t+ih-(cpl[i]/maxC*ih);
    line+= (i===0?`M${x},${y}`:` L${x},${y}`); });
  const pts=data.map((d,i)=>{const x=pad.l+i*gw+gw/2;const y=pad.t+ih-(cpl[i]/maxC*ih);return `<circle cx="${x}" cy="${y}" r="2.5" fill="var(--yellow)"/>`;}).join('');
  let yl='';
  for(let g=0;g<=2;g++){ const v=maxS*g/2; const y=pad.t+ih-(v/maxS*ih); yl+=`<text x="${pad.l-5}" y="${y+3}" font-size="9" text-anchor="end" fill="#7b8794">${int(v)}</text>`; const vc=maxC*g/2; yl+=`<text x="${W-pad.r+5}" y="${y+3}" font-size="9" text-anchor="start" fill="#7b8794">${int(vc)}</text>`; }
  document.getElementById('chartSpend').innerHTML=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${yl}${bars}<path d="${line}" fill="none" stroke="var(--yellow)" stroke-width="2"/>${pts}${hz}</svg>`;
  attachTip('chartSpend', ds=>`<div class="tt-d">${ds.date.split('-').reverse().join('/')}</div>
      <div class="tt-r"><span class="tdot" style="background:var(--blue2)"></span>Investimento<b>${money(+ds.spend)}</b></div>
      <div class="tt-r"><span class="tdot" style="background:var(--yellow)"></span>CPL QLF<b>${money(+ds.cpl)}</b></div>
      <div class="tt-r"><span class="sub">${int(+ds.qlf)} qualificados no dia</span></div>`);
}

// ===================== objections page =====================
const sumv = o => Object.values(o).reduce((s,v)=>s+v,0);
function objAgg(start,end){
  const order = OBJ.objOrder || [];
  const qlf={}, leads={}, buyers={};
  for(const b of order){ qlf[b]=0; leads[b]=0; buyers[b]=0; }
  for(const r of (OBJ.objLeads||[])){ if(r.date<start||r.date>end) continue; leads[r.bucket]=(leads[r.bucket]||0)+r.total; qlf[r.bucket]=(qlf[r.bucket]||0)+r.qlf; }
  for(const r of (OBJ.objBuyers||[])){ if(r.date<start||r.date>end) continue; buyers[r.bucket]=(buyers[r.bucket]||0)+r.buyers; }
  return {qlf,leads,buyers};
}
function objBars(map,total){
  const ents=Object.entries(map).filter(([k,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  if(!ents.length||total<=0) return '<div class="sub">Sem dados no período selecionado.</div>';
  const maxp=ents[0][1]/total*100;
  return ents.map(([k,v])=>{
    const p=v/total*100;
    return `<div class="objrow"><div class="objlabel" title="${objLabel(k)}">${objLabel(k)}</div>
      <div class="objbar"><div class="objfill" style="width:${(p/maxp*100).toFixed(1)}%;background:${objColor(k)}"></div></div>
      <div class="objval">${pct(p)} <span class="sub">(${int(v)})</span></div></div>`;
  }).join('');
}
function renderObjections(){
  const a=objAgg(state.start,state.end);
  const qN=sumv(a.qlf), bN=sumv(a.buyers);
  document.getElementById('objQlf').innerHTML=objBars(a.qlf,qN);
  document.getElementById('objBuy').innerHTML=objBars(a.buyers,bN);
  document.getElementById('objQlfN').textContent=`(${int(qN)} no período)`;
  document.getElementById('objBuyN').textContent=`(${int(bN)} no período)`;
  document.getElementById('objNote').textContent=
    `Categorizado por palavra-chave a partir da resposta livre "principal desafio". Compradores: ${OBJ.buyersMatched}/${OBJ.buyersTotal} casados com a base de leads por e-mail (só os casados entram aqui). Período: ${state.start.split('-').reverse().join('/')} → ${state.end.split('-').reverse().join('/')}. · Objeções atualizadas: ${OBJ.generatedAtBR||'—'} (diário).`;
  // comparison table
  const rows=(OBJ.objOrder||[]).map(k=>{ const q=a.qlf[k]||0,b=a.buyers[k]||0; const qp=qN?q/qN*100:0,bp=bN?b/bN*100:0;
    return {k,q,b,qp,bp,idx:(qp>0?bp/qp:(bp>0?Infinity:0))}; }).filter(r=>r.q>0||r.b>0).sort((x,y)=>y.bp-x.bp);
  document.querySelector('#objTable thead').innerHTML=
    '<tr><th>Objeção</th><th>Qualificados</th><th>Compradores</th><th>Índice de compra</th></tr>';
  document.querySelector('#objTable tbody').innerHTML=rows.map(r=>{
    let idxCell='—';
    if(isFinite(r.idx)&&r.idx>0){ const col=r.idx>=1.2?'var(--green)':(r.idx<=0.8?'var(--red)':'var(--muted)'); idxCell=`<b style="color:${col}">${r.idx.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}x</b>`; }
    else if(r.idx===Infinity){ idxCell='<b style="color:var(--green)">novo</b>'; }
    return `<tr><td><span class="objdot" style="background:${objColor(r.k)}"></span>${objLabel(r.k)}</td>
      <td>${pct(r.qp)} <span class="sub">(${int(r.q)})</span></td>
      <td>${pct(r.bp)} <span class="sub">(${int(r.b)})</span></td>
      <td>${idxCell}</td></tr>`;
  }).join('');
  renderObjVoices();
}

function renderObjVoices(){
  const box=document.getElementById('objVoices');
  if(!box) return;
  const qs=OBJ.objQuotes||[];
  if(!qs.length){ box.innerHTML='<div class="sub">Sem depoimentos.</div>'; return; }
  box.innerHTML=qs.map((o,i)=>{
    const terms=(o.terms||[]).map(x=>`<span class="termchip">${esc(x.t)} <b>×${x.n}</b></span>`).join('');
    const ex=(o.examples||[]).map(q=>`<li>“${esc(q)}”</li>`).join('');
    return `<details class="voice"${i===0?' open':''}>
      <summary><span class="objdot" style="background:${objColor(o.bucket)}"></span>${objLabel(o.bucket)} <span class="sub">${int(o.total)} qualificadas · ${int(o.distinct)} relatos distintos</span></summary>
      ${terms?`<div class="vblock"><div class="vlbl">Mais citados</div><div class="chips">${terms}</div></div>`:''}
      ${ex?`<div class="vblock"><div class="vlbl">Exemplos (na voz delas)</div><ul class="quotes">${ex}</ul></div>`:''}
    </details>`;
  }).join('');
}

// ===================== insights page =====================
const CAT_LABEL = { produto:'Produto & Posicionamento', objecoes:'Objeções', campanhas:'Campanhas', anuncios:'Anúncios', funil:'Funil' };
const CAT_ORDER = ['funil','campanhas','anuncios','objecoes','produto'];
const pb = k => OBJ_LABELS[k] || k;          // pretty bucket
const sgn = v => (v>=0?'+':'') + (v).toLocaleString('pt-BR',{maximumFractionDigits:1});
function insightTpl(o){
  switch(o.type){
    case 'obj_overindex': return { title:`Objeção "${pb(o.bucket)}" puxa venda`,
      text:`Quem tem essa dor é <b>${pct(o.bp)}</b> dos compradores, mas só <b>${pct(o.qp)}</b> dos qualificados — índice de compra <b>${o.idx}x</b> (base: ${o.bn} compradores).`,
      action:`Faça criativos e copy focados nessa dor: é o público mais propenso a comprar.` };
    case 'obj_underindex': return { title:`"${pb(o.bucket)}" é a maior objeção, mas converte pouco`,
      text:`É a dor nº 1 das qualificadas (<b>${pct(o.qp)}</b>), porém com índice de compra de só <b>${o.idx}x</b> (abaixo da média).`,
      action:`Esse público sente a dor mas compra menos — nutra/eduque antes, ou conecte essa dor à promessa de escala do evento.` };
    case 'obj_top_buyer': return { title:`A dor que mais aparece em quem compra: "${pb(o.bucket)}"`,
      text:`<b>${pct(o.bp)}</b> dos compradores (${o.bn}) declararam essa como principal desafio.`,
      action:`Use essa linguagem na headline da página e no início dos criativos.` };
    case 'product_scale_fit': return { title:`As dores de escala batem com a promessa do evento`,
      text:`Delegação/Escala + Equipe/Pessoas somam <b>${pct(o.pctScale)}</b> das qualificadas — exatamente o que o Cocktail promete destravar. E Delegação/Escala converte <b>${o.idxDeleg}x</b> acima da média.`,
      action:`Reforce na comunicação: o evento resolve o "sair da operação" e o "time que não acompanha o crescimento".` };
    case 'camp_cheap': return { title:`Campanha com qualificado mais barato`,
      text:`<b>${esc(o.campaign)}</b> — CPL QLF <b>${money(o.cplqlf)}</b> com ${int(o.qlf)} qualificados (gasto ${money(o.spend)}), últimos 30 dias.`,
      action:`Escale o orçamento: é onde o lead qualificado sai mais barato.` };
    case 'camp_exp': return { title:`Campanha puxando o custo pra cima`,
      text:`<b>${esc(o.campaign)}</b> está com CPL QLF <b>${money(o.cplqlf)}</b> nos últimos 14 dias — <b>${o.vsavg}×</b> a sua média (${money(o.avg)}), gastando ${money(o.spend)}.`,
      action:`É a que mais encarece seu CPL. Revise criativo/público ou reduza a verba dela e realoque pras campanhas mais baratas.` };
    case 'camp_sales': return { title:`Campanha que mais vende`,
      text:`<b>${esc(o.campaign)}</b> gerou <b>${int(o.sales)} vendas</b> (CAC ${money(o.cac)}) nos últimos 30 dias.`,
      action:`É a que mais converte em venda — proteja e priorize o orçamento.` };
    case 'ad_bestqr': return { title:`Anúncio que mais qualifica`,
      text:`<b>${esc(o.ad)}</b> tem taxa de qualificação de <b>${pct(o.rate)}</b> (${int(o.qlf)} de ${int(o.leads)} leads).`,
      action:`Atrai o público premium certo (>100k). Use como referência para os próximos criativos.` };
    case 'ad_lowqr': return { title:`Anúncio com volume, mas qualifica pouco`,
      text:`<b>${esc(o.ad)}</b> trouxe ${int(o.leads)} leads, mas só <b>${pct(o.rate)}</b> qualificam.`,
      action:`Está atraindo público fora do perfil — ajuste o gancho/segmentação ou pause.` };
    case 'ad_cheap': return { title:`Anúncio com qualificado mais barato`,
      text:`<b>${esc(o.ad)}</b> — CPL QLF <b>${money(o.cplqlf)}</b> (${int(o.qlf)} qualificados).`,
      action:`Bom candidato para receber mais verba.` };
    case 'ad_exp': return { title:`Anúncio caro puxando o custo`,
      text:`<b>${esc(o.ad)}</b> está com CPL QLF <b>${money(o.cplqlf)}</b> nos últimos 14 dias — <b>${o.vsavg}×</b> a média dos anúncios (${money(o.avg)}), gastando ${money(o.spend)}.`,
      action:`Pause ou reduza a verba dele e mande pro anúncio mais barato / que mais qualifica.` };
    case 'funnel_qualrate': return { title:`Taxa de qualificação dos leads`,
      text:`<b>${pct(o.rate)}</b> dos leads são qualificados (${sgn(o.deltaPP)} p.p. vs período anterior, que foi ${pct(o.prevRate)}).`,
      action: o.deltaPP>=0 ? `Tendência positiva — o tráfego está atraindo mais o público certo.` : `Caiu — revise segmentação e criativos recentes.` };
    case 'funnel_cplqlf': { const rising=o.delta7>=8, falling=o.delta7<=-8;
      return { title:`CPL qualificado${rising?' — subindo ⚠️':(falling?' — caindo':' — estável')}`,
      text:`Média de 30 dias: <b>${money(o.cplqlf)}</b>. Nos <b>últimos 7 dias: ${money(o.cpl7)}</b> (vs ${money(o.cplp7)} na semana anterior, <b>${sgn(o.delta7)}%</b>).`,
      action: rising ? `O custo por qualificado subiu na última semana. Antes de escalar: corte/ajuste os anúncios e conjuntos mais caros (abaixo) e reforce os mais baratos.` : (falling ? `Custo caindo — bom momento pra escalar o que está mais barato.` : `Custo estável. Realoque verba dos mais caros pros mais baratos pra baixar ainda mais.`) }; }
    case 'funnel_cac': { const r = o.cac>0 ? o.ticket/o.cac : 0;
      return { title:`CAC vs ticket`,
      text:`CAC médio <b>${money(o.cac)}</b> para um ticket de <b>${money(o.ticket)}</b> (ticket ≈ ${r.toLocaleString('pt-BR',{maximumFractionDigits:1})}x o CAC).`,
      action: r>=3 ? `Margem de aquisição saudável — cada real investido volta com folga já no 1º pagamento.` : `Margem apertada — cuidado ao escalar; foque em baixar o CAC.` }; }
    case 'funnel_convlp': return { title:`Conversão da página (LP → lead)`,
      text:`<b>${pct(o.convlp)}</b> dos cliques que chegam na página viram lead.`,
      action: o.convlp>=8 ? `Boa conversão de página.` : `Abaixo do ideal (~8%+). Teste headline, oferta e topo da página.` };
    default: return { title:o.type, text:'', action:'' };
  }
}
function renderInsights(){
  const body=document.getElementById('insBody');
  document.getElementById('insIntro').textContent =
    `Gerados automaticamente cruzando funil + objeções + micro (campanha/conjunto/anúncio). Base: últimos 30 dias (${(INS.windowStart||'').split('-').reverse().join('/')} → ${(INS.windowEnd||'').split('-').reverse().join('/')}) + histórico de objeções. Análise de: ${INS.generatedAtBR||'—'} · atualiza a cada 3h (junto com o tráfego). A tendência de CPL QLF olha os últimos 7 dias.`;
  document.getElementById('insProduct').innerHTML = `<b>Produto:</b> ${esc(PRODUCT)}`;
  const list = INS.insights || [];
  if(!list.length){ body.innerHTML='<div class="card"><div class="sub">Sem insights ainda — rode o build de insights.</div></div>'; return; }
  let html='';
  for(const cat of CAT_ORDER){
    const items=list.filter(x=>x.cat===cat);
    if(!items.length) continue;
    html+=`<div class="ins-cat"><div class="ins-cat-h">${CAT_LABEL[cat]||cat}</div><div class="ins-cards">`;
    html+=items.map(o=>{ const t=insightTpl(o);
      return `<div class="ins-card ${o.tone}">
        <div class="ins-title">${t.title}</div>
        <div class="ins-text">${t.text}</div>
        <div class="ins-action">→ ${t.action}</div>
      </div>`; }).join('');
    html+='</div></div>';
  }
  body.innerHTML=html;
}

// ===================== funnel health score =====================
function healthBand(s){
  if(s>=75) return {label:'Excelente', color:'#2e9e3f'};
  if(s>=58) return {label:'Saudável', color:'#3ea66d'};
  if(s>=42) return {label:'Atenção', color:'#e9a23b'};
  return {label:'Crítico', color:'#e0483a'};
}
function computeHealth(cur, prev){
  const c=metrics(cur), p=metrics(prev);
  const lin=(v,g,b)=>Math.max(0,Math.min(100,(v-b)/(g-b)*100));
  const comps=[];
  comps.push({label:'CPL Qualificado', score:(cur.qlf>0?lin(c.cplqlf,70,220):0), detail:(cur.qlf>0?money(c.cplqlf):'—'), w:0.25});
  comps.push({label:'CAC', score:(cur.sales>0?lin(c.cac,800,2200):(cur.spend>0?5:50)), detail:(cur.sales>0?money(c.cac):'sem vendas'), w:0.18});
  comps.push({label:'Taxa de qualificação', score:(cur.leads>0?lin(c.txqual,40,10):50), detail:pct(c.txqual), w:0.20});
  comps.push({label:'Conversão da página', score:(cur.lpv>0?lin(c.convlp,10,4):50), detail:pct(c.convlp), w:0.12});
  comps.push({label:'ROAS', score:(cur.spend>0?lin(c.roas,5,1.5):50), detail:(c.roas).toLocaleString('pt-BR',{maximumFractionDigits:2})+'x', w:0.13});
  const qd=c.txqual-p.txqual, cplChg=(p.cplqlf>0?(c.cplqlf-p.cplqlf)/p.cplqlf*100:0);
  let sTrend=50 + Math.max(-25,Math.min(25,qd*4)) + Math.max(-25,Math.min(25,-cplChg*0.4));
  sTrend=Math.max(0,Math.min(100,sTrend));
  comps.push({label:'Tendência (vs período anterior)', score:sTrend, detail:(qd>=0?'+':'')+qd.toFixed(1)+'pp qualif', w:0.12});
  const total = comps.reduce((s,x)=>s+x.score*x.w,0)/comps.reduce((s,x)=>s+x.w,0);
  return {score:Math.round(total), band:healthBand(total), comps};
}
function gaugeSVG(score,color){
  const r=52, C=2*Math.PI*r, arc=score/100*C;
  return `<svg viewBox="0 0 130 130" class="gauge">
    <circle cx="65" cy="65" r="${r}" fill="none" stroke="#e7edf3" stroke-width="13"/>
    <circle cx="65" cy="65" r="${r}" fill="none" stroke="${color}" stroke-width="13" stroke-linecap="round" stroke-dasharray="${arc.toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 65 65)"/>
    <text x="65" y="62" text-anchor="middle" font-size="34" font-weight="800" fill="#1f2933">${score}</text>
    <text x="65" y="84" text-anchor="middle" font-size="12" fill="#7b8794">de 100</text>
  </svg>`;
}
function renderHealth(cur,prev){
  const h=computeHealth(cur,prev);
  const sorted=[...h.comps].sort((a,b)=>b.score-a.score);
  const best=sorted[0], worst=sorted[sorted.length-1];
  const verdict = `Mais forte em <b>${best.label.toLowerCase()}</b>. ` +
    (worst.score<55 ? `Ponto de atenção: <b>${worst.label.toLowerCase()}</b>.` : `Sem gargalos críticos no período.`);
  const bars = h.comps.map(c=>{
    const col = c.score>=70?'var(--green)':(c.score>=45?'var(--yellow)':'var(--red)');
    return `<div class="hcomp">
      <div class="hc-top"><span>${c.label}</span><span class="hc-val">${c.detail}</span></div>
      <div class="hc-bar"><div style="width:${c.score.toFixed(0)}%;background:${col}"></div></div>
    </div>`;
  }).join('');
  const card=document.getElementById('healthCard');
  card.style.borderLeft='6px solid '+h.band.color;
  card.innerHTML = `
    <div class="health-left">
      ${gaugeSVG(h.score,h.band.color)}
      <div class="health-label" style="color:${h.band.color}">${h.band.label}</div>
    </div>
    <div class="health-right">
      <div class="health-title">Saúde geral do funil <span class="sub">· período selecionado</span></div>
      <div class="health-verdict">${verdict}</div>
      <div class="hcomps">${bars}</div>
    </div>`;
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
  renderHealth(cur,prev);
  renderInvest(cur);
  renderFunnel(cur,prev);
  renderTable();
  renderDaily();
  renderSales();
  renderComercial();
  renderLeadsChart();
  renderSpendChart();
  renderObjections();
}

// ===================== comercial (vendas por vendedora, period-aware) =====================
function medalOr(n){ return n===1?'🥇':(n===2?'🥈':(n===3?'🥉':n)); }
function renderComercial(){
  const rows0=arr(D.sellers).filter(r=>r.date>=state.start && r.date<=state.end);
  const map=new Map();
  for(const r of rows0){ let o=map.get(r.seller); if(!o){o={seller:r.seller,sales:0,revenue:0,daysSum:0,daysN:0,offN:0,classN:0};map.set(r.seller,o);}
    o.sales+=r.sales; o.revenue+=r.revenue; o.daysSum+=(r.daysSum||0); o.daysN+=(r.daysN||0); o.offN+=(r.offN||0); o.classN+=(r.classN||0); }
  const all=[...map.values()];
  all.forEach(x=>{ x.avgDays = x.daysN>0 ? x.daysSum/x.daysN : null; x.offPct = x.classN>0 ? x.offN/x.classN*100 : null; });
  const fmtDays = x => x.avgDays==null ? '—' : `${x.avgDays.toLocaleString('pt-BR',{maximumFractionDigits:1})} dias`;
  const totSales=all.reduce((s,x)=>s+x.sales,0), totRev=all.reduce((s,x)=>s+x.revenue,0);
  const totOff=all.reduce((s,x)=>s+x.offN,0), totClass=all.reduce((s,x)=>s+x.classN,0);
  const offPctAll=totClass>0?totOff/totClass*100:0;
  const named=all.filter(x=>x.seller!=='SEM_VENDEDORA').sort((a,b)=> b.sales-a.sales || b.revenue-a.revenue);
  const blank=all.find(x=>x.seller==='SEM_VENDEDORA');
  document.getElementById('comIntro').innerHTML =
    `Vendas por vendedora (coluna "Tracking src" da Kiwify) no período selecionado. ${named.length} vendedora(s) ativa(s). Atualiza a cada 3h.`;
  document.getElementById('comStats').innerHTML =
    statCard(int(totSales),'Vendas no período') +
    statCard(money(totRev),'Receita no período') +
    statCard(money(totSales?totRev/totSales:0),'Ticket médio') +
    statCard(int(named.length),'Vendedoras ativas') +
    statCard(totClass?pct(offPctAll):'—','Fora do perfil (&lt;100k)', totClass?`${int(totOff)} de ${int(totClass)} casadas`:'');
  const med=['🥇','🥈','🥉'], cl=['pod-1','pod-2','pod-3'];
  document.getElementById('comPodium').innerHTML = named.length
    ? named.slice(0,3).map((x,i)=>`<div class="pod ${cl[i]}"><div class="pod-medal">${med[i]}</div>
        <div class="pod-name">${esc(pretty(x.seller))}</div>
        <div class="pod-sales">${int(x.sales)}<span class="statc-u"> vendas</span></div>
        <div class="pod-sub"><b>${pct(totSales?x.sales/totSales*100:0)}</b> do total · ${money(x.revenue)}</div>
        <div class="pod-close">⏱️ fecha em ~<b>${fmtDays(x)}</b></div></div>`).join('')
    : '<div class="sub">Sem vendas no período selecionado.</div>';
  // destaque criativo: quem fecha mais rápido (min. 3 vendas casadas p/ ser significativo)
  const fastest = named.filter(x=>x.daysN>=3).sort((a,b)=>a.avgDays-b.avgDays)[0];
  const list=named.concat(blank?[blank]:[]);
  const maxS=Math.max(1,...named.map(x=>x.sales));
  document.querySelector('#comTable thead').innerHTML =
    '<tr><th>#</th><th class="com-name">Vendedora</th><th>Vendas</th><th>Participação</th><th>Receita</th><th>Ticket médio</th><th>Fechamento médio</th></tr>';
  document.querySelector('#comTable tbody').innerHTML = list.length ? list.map((x,i)=>{
    const isB=x.seller==='SEM_VENDEDORA', share=totSales?x.sales/totSales*100:0, fill=(x.sales/maxS*100).toFixed(1);
    const fast = (!isB && fastest && x.seller===fastest.seller);
    return `<tr class="${isB?'com-blank':''}">
      <td>${isB?'—':medalOr(i+1)}</td>
      <td class="com-name">${esc(pretty(x.seller))}</td>
      <td><b>${int(x.sales)}</b></td>
      <td class="com-part"><span class="com-track"><span class="com-fill" style="width:${fill}%${isB?';background:var(--muted)':''}"></span></span>${pct(share)}</td>
      <td>${money(x.revenue)}</td>
      <td>${money(x.sales?x.revenue/x.sales:0)}</td>
      <td>${fmtDays(x)}${fast?' <span class="fast-badge">⚡ mais rápida</span>':''}</td></tr>`;
  }).join('') : '<tr><td colspan="7" class="sub">Sem vendas no período.</td></tr>';
  const parts=[];
  if(fastest) parts.push(`⚡ <b>Fechamento mais rápido: ${esc(pretty(fastest.seller))}</b> (~${fmtDays(fastest)} entre a lead entrar e comprar).`);
  if(blank) parts.push(`⚠️ <b>${int(blank.sales)} venda(s)</b> sem vendedora marcada no "Tracking src" (${pct(totSales?blank.sales/totSales*100:0)} do período) — vale conferir na Kiwify.`);
  parts.push(`<span class="sub">Fechamento médio = dias entre a lead entrar e a compra; calculado só sobre as vendas casadas com a base de leads por e-mail.</span>`);
  document.getElementById('comNote').innerHTML = parts.join('<br>');
  // qualidade do perfil por vendedora (fatura >=100k dentro do alvo, <100k fora)
  const prof=named.filter(x=>x.classN>0).sort((a,b)=> (b.offPct-a.offPct) || (b.offN-a.offN));
  const worst=prof[0];
  document.getElementById('comProfIntro').innerHTML =
    `Quanto das vendas de cada uma é <b>fora do alvo</b> — compradora que declarou faturar <b>menos de R$ 100 mil</b>. Base: ${int(totClass)} vendas casadas com a lista de leads no período (as demais não dá pra classificar). 🟩 dentro (≥100k) · 🟥 fora (&lt;100k).` +
    (worst && worst.offPct>=30 ? ` <b style="color:var(--red)">Maior desvio: ${esc(pretty(worst.seller))} (${pct(worst.offPct)} fora).</b>` : '');
  document.getElementById('comProfile').innerHTML = prof.length ? prof.map(x=>{
    const inPct=100-x.offPct, col=x.offPct>=40?'var(--red)':(x.offPct>=25?'#e0772f':'var(--green)');
    return `<div class="qrow"><div class="objlabel" title="${esc(pretty(x.seller))}">${esc(pretty(x.seller))}</div>
      <div class="qbar"><span class="qbar-in" style="width:${inPct.toFixed(1)}%"></span><span class="qbar-out" style="width:${x.offPct.toFixed(1)}%"></span></div>
      <div class="qval"><b style="color:${col}">${pct(x.offPct)} fora</b> <span class="sub">(${int(x.offN)}/${int(x.classN)})</span></div></div>`;
  }).join('') : '<div class="sub">Sem base classificável no período.</div>';
}

// ===================== visão diária (tabela por dia, com heatmap) =====================
function heat(v,min,max,mode){
  if(max<=min||v==null) return '';
  let t=(v-min)/(max-min); t=Math.max(0,Math.min(1,t));
  let r,g,b,a;
  if(mode==='cost'){ // baixo=verde, alto=vermelho (via amarelo) — alto custo é ruim
    if(t<0.5){ const u=t/0.5; r=Math.round(46+(233-46)*u); g=Math.round(158+(178-158)*u); b=Math.round(63+(59-63)*u); }
    else { const u=(t-0.5)/0.5; r=Math.round(233+(224-233)*u); g=Math.round(178+(72-178)*u); b=Math.round(59+(58-59)*u); }
    a=(0.16+0.42*Math.abs(t-0.5)*2).toFixed(2); return `background:rgba(${r},${g},${b},${a})`;
  }
  if(mode==='good'){ r=46;g=158;b=63; } else { r=31;g=110;b=180; } // good=verde · vol=azul
  a=(0.08+0.5*t).toFixed(2); return `background:rgba(${r},${g},${b},${a})`;
}
function renderDaily(){
  const rows=seriesDaily(state.start,state.end).slice().reverse().map(d=>({   // mais recente primeiro
    date:d.date, spend:d.spend, leads:d.leads, qlf:d.qlf, txq:safe(d.qlf,d.leads)*100,
    cplqlf:safe(d.spend,d.qlf), sales:d.sales, cpm:safe(d.spend,d.impr)*1000, ctr:safe(d.clicks,d.impr)*100 }));
  const mm=k=>{ const a=rows.map(r=>r[k]); return [Math.min(...a),Math.max(...a)]; };
  const sp=mm('spend'),le=mm('leads'),q=mm('qlf'),tx=mm('txq'),sa=mm('sales'),cpm=mm('cpm'),ctr=mm('ctr');
  document.querySelector('#dailyTable thead').innerHTML=
    '<tr><th>Dia</th><th>Gasto</th><th>Leads</th><th>QLF</th><th>%Qualif</th><th>CPL QLF</th><th>Vendas</th><th>CPM</th><th>CTR</th></tr>';
  document.querySelector('#dailyTable tbody').innerHTML = rows.length ? rows.map(r=>`<tr>
    <td>${r.date.slice(8,10)}/${r.date.slice(5,7)}</td>
    <td style="${heat(r.spend,sp[0],sp[1],'vol')}">${money(r.spend)}</td>
    <td style="${heat(r.leads,le[0],le[1],'vol')}">${int(r.leads)}</td>
    <td style="${heat(r.qlf,q[0],q[1],'vol')}">${int(r.qlf)}</td>
    <td style="${heat(r.txq,tx[0],tx[1],'good')}">${pct(r.txq)}</td>
    <td>${cplPill(r.cplqlf,r.qlf)}</td>
    <td style="${heat(r.sales,sa[0],sa[1],'vol')}">${int(r.sales)}</td>
    <td style="${heat(r.cpm,cpm[0],cpm[1],'cost')}">${money(r.cpm)}</td>
    <td style="${heat(r.ctr,ctr[0],ctr[1],'good')}">${pct(r.ctr)}</td></tr>`).join('')
    : '<tr><td colspan="9" class="sub">Sem dados no período.</td></tr>';
}

// ===================== estudo das compradoras (3 abas) =====================
function arr(x){ return Array.isArray(x)?x:(x?[x]:[]); }
function bars(list,color){
  list=arr(list); if(!list.length) return '<div class="sub">Sem dados.</div>';
  const max=Math.max(...list.map(x=>x.pct))||1;
  return list.map(x=>`<div class="objrow"><div class="objlabel" title="${esc(x.label)}">${esc(x.label)}</div>
    <div class="objbar"><div class="objfill" style="width:${Math.max(3,x.pct/max*100).toFixed(1)}%;background:${color||'var(--blue2)'}"></div></div>
    <div class="objval">${pct(x.pct)} <span class="sub">(${int(x.n)})</span></div></div>`).join('');
}
function statCard(big,label,sub){ return `<div class="statc"><div class="statc-v">${big}</div><div class="statc-l">${label}</div>${sub?`<div class="statc-s">${sub}</div>`:''}</div>`; }

function renderTempo(){
  const T=ESTUDO.tempo||{}; if(!T.n){ return; }
  const tail=(arr(T.buckets).find(x=>x.label==='31+ dias')||{}).pct||0;
  document.getElementById('tempoIntro').innerHTML =
    `Da data em que a lead entrou até a data da compra. Base: ${int(ESTUDO.buyersMatched)} compradoras casadas por e-mail (de ${int(ESTUDO.buyersTotal)} vendas). Atualiza a cada 3h.`;
  document.getElementById('tempoStats').innerHTML =
    statCard(`${int(T.median)}<span class="statc-u"> dias</span>`,'Mediana — metade compra antes disso') +
    statCard(`${int(T.mean)}<span class="statc-u"> dias</span>`,'Média — puxada pela cauda longa') +
    statCard(`${int(T.within3)}%`,'Compram em até 3 dias') +
    statCard(`${int(T.within7)}%`,'Compram em até 7 dias');
  document.getElementById('tempoBars').innerHTML = bars(T.buckets,'var(--blue)');
  document.getElementById('tempoNote').innerHTML =
    `<div class="chart-title">💡 O que fazer com isso</div>
     <div class="ins-text">A decisão é <b>rápida</b>: metade das compradoras fecha em <b>até ${int(T.median)} dias</b> e <b>${int(T.within7)}%</b> em até uma semana. A janela de ouro é os <b>primeiros 7 dias</b> depois que a lead entra.</div>
     <div class="ins-action">→ Concentre follow-up, contato do time e remarketing nos <b>primeiros 3–7 dias</b>. Mas mantenha um fluxo de nutrição longo: <b>${pct(tail)}</b> ainda compram com 31+ dias — sem ele você perde essas.</div>`;
}
function renderPerfil(){
  const P=ESTUDO.perfil||{}; if(!P.fatDist){ return; }
  document.getElementById('perfilIntro').innerHTML =
    `Quem são as ${int(ESTUDO.buyersMatched)} compradoras (cruzando e-mail comprador × base de leads). Só agregados e depoimentos anonimizados — nada de dado pessoal.`;
  document.getElementById('perfilStats').innerHTML =
    statCard(`R$ ${(ESTUDO.fatMedia||0).toLocaleString('pt-BR')}`,'Faturamento médio /mês (estimado)') +
    statCard(money(ESTUDO.ticket),'Ticket médio da compra') +
    statCard(int(ESTUDO.buyersMatched),'Compradoras analisadas');
  document.getElementById('pFat').innerHTML = bars(P.fatDist,'var(--green)');
  document.getElementById('pVoce').innerHTML = bars(P.voce,'var(--blue2)');
  document.getElementById('pIntent').innerHTML = bars(P.intent,'var(--navy)');
  document.getElementById('pEquipe').innerHTML = bars(P.equipe,'var(--blue)');
  document.getElementById('pObjec').innerHTML = bars(arr(P.objec).map(x=>({label:objLabel(x.label),n:x.n,pct:x.pct})),'var(--yellow)');
  const qs=arr(P.quotes);
  document.getElementById('pQuotes').innerHTML = qs.length ? `<ul class="quotes">${qs.map(q=>`<li>“${esc(q)}”</li>`).join('')}</ul>` : '';
}

// ===================== presets & init =====================
function setRange(s,e){ state.start=s<DMIN?DMIN:s; state.end=e>DMAX?DMAX:e; render(); }
function lastN(n){ const e=DMAX; const s=fmtD(addDays(parseD(DMAX),-(n-1))); return [s,e]; }
const PRESETS=[
  ['Hoje',()=>[DMAX,DMAX]],
  ['Ontem',()=>{const d=fmtD(addDays(parseD(DMAX),-1));return [d,d];}],
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
    if(name==='Últimos 30 dias') b.classList.add('active'); // default
    box.appendChild(b);
  });
}
function init(){
  document.getElementById('updated').textContent = 'Atualizado: '+D.generatedAtBR;
  document.getElementById('qualNote').textContent = 'Qualificado = '+D.qualification;
  document.getElementById('taxNote').textContent = 'Gasto inclui imposto (× '+(D.taxMultiplier).toLocaleString('pt-BR',{minimumFractionDigits:4})+')';
  buildPresets();
  const PAGES=['funnel','obj','insights','comercial','tempo','perfil'];
  const NOCTRL=['insights','tempo','perfil']; // abas de base completa (sem seletor de período); comercial usa o seletor
  document.querySelectorAll('.pagebtn').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('.pagebtn').forEach(x=>x.classList.remove('active')); b.classList.add('active');
    const pg=b.dataset.page;
    PAGES.forEach(p=>{ const el=document.getElementById('page'+p.charAt(0).toUpperCase()+p.slice(1)); if(el) el.hidden = p!==pg; });
    document.querySelector('.controls').style.display = NOCTRL.includes(pg) ? 'none' : '';
  });
  document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active')); t.classList.add('active');
    state.level=t.dataset.level; state.sort={key:'qlf',asc:false}; renderTable();
  });
  document.getElementById('applyRange').onclick=()=>{ document.getElementById('presets').querySelectorAll('button').forEach(x=>x.classList.remove('active')); setRange(document.getElementById('dStart').value,document.getElementById('dEnd').value); };
  document.getElementById('goalInput').onchange=e=>{ localStorage.setItem('ccn_goal',e.target.value||15000); render(); };
  const [s,e]=lastN(30); setRange(s,e);
  renderInsights();
  renderTempo(); renderPerfil();
  const hash=location.hash.toLowerCase();
  if(hash.includes('insight')){ document.querySelector('.pagebtn[data-page="insights"]').click(); }
  else if(hash.includes('obj')){ document.querySelector('.pagebtn[data-page="obj"]').click(); }
  else if(hash.includes('tempo')){ document.querySelector('.pagebtn[data-page="tempo"]').click(); }
  else if(hash.includes('perfil')||hash.includes('compradora')){ document.querySelector('.pagebtn[data-page="perfil"]').click(); }
}
init();
