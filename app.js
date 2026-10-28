'use strict';
// ===================== Cocktail Cardi Nigro dashboard =====================
const D = window.DASH_DATA;
const OBJ = window.DASH_OBJ || {};
const INS = window.DASH_INSIGHTS || {};
const APICE = window.DASH_APICE || {};   // vendas do Ápice (planilha VENDAS MASTERMIND, só Ativas) -> caixa, recorrente, ROAS com Ápice
const PF = window.DASH_PERFIL || {};   // por pessoa (leads qualificadas + compras) -> Objeções/Compradoras/Tempo filtráveis por data
const ASC = window.DASH_ASC || {};
const DATAS = window.DASH_DATAS || {};
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
const objColor = k => OBJ_COLORS[Math.max(0,(PF.buckets||OBJ.objOrder||[]).indexOf(k)) % OBJ_COLORS.length];

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
// Leads do Forms (campanha com a tag "forms" = formulário nativo do Meta) não passam pela página:
// a conversão de página usa só os leads da página (leads − leads do Forms) ÷ page views.
const isFormsCamp = c => String(c).split('|').some(s=>s.trim().normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()==='forms');
const FORMS_LD = new Map(); for(const r of D.grain){ if(r.leads && isFormsCamp(r.campaign)) FORMS_LD.set(r.date,(FORMS_LD.get(r.date)||0)+r.leads); }
function sumDaily(start,end){
  const o={spend:0,impr:0,clicks:0,lpv:0,leads:0,qlf:0,sales:0,revenue:0,fleads:0};
  for(const r of D.daily){ if(r.date>=start && r.date<=end){ for(const k in o) o[k]+=r[k]||0; o.fleads+=FORMS_LD.get(r.date)||0; } }
  return o;
}
function metrics(a){
  return {
    spend:a.spend, impr:a.impr, clicks:a.clicks, lpv:a.lpv, leads:a.leads, qlf:a.qlf, sales:a.sales, revenue:a.revenue,
    cpm:safe(a.spend,a.impr)*1000, cpc:safe(a.spend,a.clicks), ctr:safe(a.clicks,a.impr)*100,
    cpv:safe(a.spend,a.lpv), cr:safe(a.lpv,a.clicks)*100, convlp:safe(a.leads-(a.fleads||0),a.lpv)*100,
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
function deltaNeutral(cur,prev){
  if(prev===0||prev==null) return '';
  const ch=(cur-prev)/prev*100; const arr = ch>0?'▲':(ch<0?'▼':'—');
  return `<span class="delta flat">${arr} ${Math.abs(ch).toFixed(1)}%</span>`;
}
const fmtRoas = v => (v==null?0:v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'x';
// ---- bloco receita (investimento · receita · ROAS) ----
function renderReceita(cur,prev){
  const c=metrics(cur), p=metrics(prev);
  document.getElementById('revInv').textContent = money(c.spend);
  document.getElementById('revRec').textContent = money(c.revenue);
  const roasEl=document.getElementById('revRoas'); roasEl.textContent = fmtRoas(c.roas);
  const col = c.roas>=3?'var(--green)':(c.roas>=1?'var(--yellow)':'var(--red)');
  roasEl.style.color = col; document.getElementById('revRoasCard').style.borderTopColor = col;
  document.getElementById('revInvD').innerHTML = deltaNeutral(c.spend,p.spend);
  document.getElementById('revRecD').innerHTML = deltaHTML(c.revenue,p.revenue);
  document.getElementById('revRoasD').innerHTML = deltaHTML(c.roas,p.roas);
  // ROAS com Ápice = (receita do Cocktail + VALOR total das vendas do Ápice com data do coquetel no período) ÷ investimento
  const len=dayspan(state.start,state.end), pe=fmtD(addDays(parseD(state.start),-1)), ps=fmtD(addDays(parseD(pe),-(len-1)));
  const apC=apSold(state.start,state.end), apP=apSold(ps,pe);
  const roasAp=safe(c.revenue+apC.v,c.spend), roasApP=safe(p.revenue+apP.v,p.spend);
  const apEl=document.getElementById('revApRoas'); apEl.textContent=fmtRoas(roasAp);
  document.getElementById('revApSub').innerHTML = apC.n
    ? `Cocktail <b>${money(c.revenue)}</b> + Ápice <b>${money(apC.v)}</b> <span class="sub">(${int(apC.n)} ${apC.n===1?'venda':'vendas'})</span>`
    : `<span class="sub">Nenhuma venda do Ápice no período — igual ao ROAS do Cocktail</span>`;
  document.getElementById('revApD').innerHTML = deltaHTML(roasAp,roasApP);
  const inPct = c.revenue>0 ? Math.min(c.spend/c.revenue*100,100) : 0;
  document.getElementById('revFoot').innerHTML =
    `<div class="rev-bar"><div class="rev-bar-inv" style="width:${inPct.toFixed(1)}%"></div></div>
     <div class="rev-bar-lbl">Cada <b>R$ 1,00</b> investido virou <b style="color:${col}">${money(c.roas)}</b> de receita <span class="sub">· ${money(c.spend)} → ${money(c.revenue)} no período · variações vs. período anterior</span></div>`;
  // ---- META: investir 100k → voltar 328k (ROAS 3,28x) — period-aware ----
  const METAR=3.28;
  const metaRev=c.spend*METAR, hit=c.revenue>=metaRev, gap=metaRev-c.revenue;
  const prog=metaRev>0?Math.min(c.revenue/metaRev*100,100):0;
  const mc=hit?'var(--green)':'var(--red)';
  document.getElementById('revMeta').className='rev-meta '+(hit?'ok':'below');
  document.getElementById('revMeta').innerHTML =
    `<div class="rev-meta-head">
       <span class="rev-meta-tag">🎯 Meta — cada <b>R$ 100 mil</b> investido deve voltar <b>R$ 328 mil</b> <span class="sub">(ROAS 3,28x)</span></span>
       <span class="rev-meta-badge" style="background:${hit?'#e7f6ec':'#fdeeec'};color:${mc}">${hit?'✅ Dentro da meta':'⚠️ Abaixo da meta'}</span>
     </div>
     <div class="rev-meta-bar"><div class="rev-meta-fill" style="width:${prog.toFixed(1)}%;background:${mc}"></div><span class="rev-meta-goal">meta ${money(metaRev)}</span></div>
     <div class="rev-meta-lbl">Você está em <b style="color:${col}">${fmtRoas(c.roas)}</b> ${hit
        ? `— <b style="color:var(--green)">${money(c.revenue-metaRev)}</b> acima da meta de receita. 🎉`
        : `— faltam <b style="color:var(--red)">${money(gap)}</b> de receita pra bater a meta (ou baixar o gasto).`}</div>`;
}

// ===================== Ápice: caixa, receita recorrente e ROAS com Ápice =====================
// Regra do cliente: a ENTRADA (sinal) entra no dia do coquetel; o resto, (valor − entrada) ÷ qtd de parcelas, entra
// todo dia 1 a partir do mês seguinte. Só mulheres com situação "Ativa". "Hoje" é o dia real (o cronograma é fixo).
const AP_SALES = arr(APICE.sales).filter(s=>s && s.v>0);
const AP_EV = [];   // eventos de caixa {d, k:'s' entrada | 'p' parcela, v}
for(const s of AP_SALES){ if(!s.d) continue; const [y,m]=s.d.split('-').map(Number);
  if(s.s>0) AP_EV.push({d:s.d,k:'s',v:s.s});
  for(let i=1;i<=(s.n||0);i++) AP_EV.push({d:fmtD(new Date(y,m-1+i,1)),k:'p',v:s.p}); }
const AP_TODAY = fmtD(new Date());
const MES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const MES_F = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const monthRange = off => { const t=parseD(AP_TODAY); return [fmtD(new Date(t.getFullYear(),t.getMonth()+off,1)), fmtD(new Date(t.getFullYear(),t.getMonth()+off+1,0))]; };
const monthName = (s,short) => { const d=parseD(s); return short ? `${MES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}` : `${MES_F[d.getMonth()]} de ${d.getFullYear()}`; };
function apCash(a,b){ const o={s:0,p:0,nS:0,nP:0,t:0}; for(const e of AP_EV){ if(e.d<a||e.d>b) continue; if(e.k==='s'){o.s+=e.v;o.nS++;} else {o.p+=e.v;o.nP++;} } o.t=o.s+o.p; return o; }
function apSold(a,b){ let n=0,v=0; for(const s of AP_SALES){ if(s.d && s.d>=a && s.d<=b){ n++; v+=s.v; } } return {n,v}; }
const moneyK = v => v>=1e6 ? `R$ ${(v/1e6).toLocaleString('pt-BR',{maximumFractionDigits:2})} mi` : (v>=1e3 ? `R$ ${int(v/1e3)} mil` : money(v));

// Funil: quanto entrou de caixa do Ápice este mês + previsão do próximo + no período selecionado
function renderApCash(){
  const el=document.getElementById('apCash'); if(!el) return;
  if(!AP_SALES.length){ el.innerHTML=''; return; }
  const [m0]=monthRange(0), [n0,n1]=monthRange(1);
  const now=apCash(m0,AP_TODAY), nxt=apCash(n0,n1), per=apCash(state.start,state.end), sold=apSold(state.start,state.end);
  const D2=v=>v.split('-').reverse().join('/');
  el.innerHTML=`
    <div class="apc-head"><span class="apc-crown">👑</span><div><div class="apc-title">Caixa do Ápice</div>
      <div class="apc-sub">entrada no dia do coquetel + parcelas todo dia 1 · só vendas ativas da planilha do Ápice</div></div></div>
    <div class="apc-grid">
      <div class="apc-tile apc-now">
        <div class="apc-k">Entrou este mês <span>· ${monthName(m0)}</span></div>
        <div class="apc-v">${money(now.t)}</div>
        <div class="apc-d">parcelas do dia ${D2(m0)}: <b>${money(now.p)}</b> <span class="sub">(${int(now.nP)})</span><br>entradas de vendas do mês: <b>${money(now.s)}</b> <span class="sub">(${int(now.nS)})</span></div>
      </div>
      <div class="apc-tile apc-next">
        <div class="apc-k">Previsão próximo mês <span>· ${monthName(n0)}</span></div>
        <div class="apc-v">${money(nxt.t)}</div>
        <div class="apc-d"><b>${int(nxt.nP)}</b> parcelas caem no dia ${D2(n0)}<br><span class="sub">não inclui entradas de vendas novas que ainda vão acontecer</span></div>
      </div>
      <div class="apc-tile">
        <div class="apc-k">No período selecionado <span>· ${D2(state.start)} → ${D2(state.end)}</span></div>
        <div class="apc-v">${money(per.t)}</div>
        <div class="apc-d">parcelas <b>${money(per.p)}</b> + entradas <b>${money(per.s)}</b><br>vendido no período: <b>${money(sold.v)}</b> <span class="sub">(${int(sold.n)} ${sold.n===1?'venda':'vendas'})</span></div>
      </div>
    </div>`;
}

// aba Ápice: receita recorrente (parcelas do mês) + caixa total + gráfico mês a mês + vendas por Cocktail + avisos da planilha
function apSaleState(s){   // por venda: parcelas já pagas até hoje, recebido, a receber, parcela no mês atual, último mês
  if(!s.d) return null;
  const [y,m]=s.d.split('-').map(Number), [c0,c1]=monthRange(0); let paid=0, now=0, last=s.d;
  for(let i=1;i<=(s.n||0);i++){ const dd=fmtD(new Date(y,m-1+i,1)); if(dd<=AP_TODAY) paid++; if(dd>=c0&&dd<=c1) now+=s.p; last=dd; }
  const sinalPaid = s.d<=AP_TODAY ? s.s : 0;
  return {paid, rec:sinalPaid+paid*s.p, rest:(s.v-sinalPaid-paid*s.p), now, last, active:paid<(s.n||0)};
}
// período da aba Ápice: segue o seletor; se começa no 1º dia da dash ("Tudo"), abre pra trás (vendas de 2025) e
// inclui as vendas sem data (indicação) — que não dá pra pôr em nenhum período específico
function apRange(){ const all=state.start<=DMIN; return {a:all?'0000-01-01':state.start, b:state.end, all}; }
function apSalesIn(r){ return AP_SALES.filter(s=> s.d ? (s.d>=r.a && s.d<=r.b) : r.all); }
function renderApiceFin(){
  const hero=document.getElementById('apFin'); if(!hero) return;
  const r=apRange(), D2=v=>v.split('-').reverse().join('/');
  const perLbl = r.all ? `tudo (desde a 1ª venda, ${AP_SALES.filter(s=>s.d).map(s=>s.d).sort()[0]?D2(AP_SALES.filter(s=>s.d).map(s=>s.d).sort()[0]):'—'}) até ${D2(r.b)}` : `${D2(r.a)} → ${D2(r.b)}`;
  document.getElementById('apFinIntro').innerHTML =
    `Vendas do Ápice da planilha <b>VENDAS MASTERMIND</b> (${int(APICE.ativas||0)} ativas${APICE.inativas?`, ${int(APICE.inativas)} inativas fora`:''}), no período <b>${perLbl}</b>. Regra de caixa: a <b>entrada</b> entra no dia do coquetel e o resto vira <b>parcelas iguais todo dia 1</b>, a partir do mês seguinte. Em <b>Tudo</b> entram também as vendas de 2025 e as sem data. Dados de ${APICE.generatedAtBR||'—'} (atualiza a cada 3h).`;
  if(!AP_SALES.length){ hero.innerHTML='<div class="card"><div class="sub">Sem vendas do Ápice na planilha.</div></div>'; return; }
  const [m0,m1]=monthRange(0), [n0,n1]=monthRange(1);
  const per=apCash(r.a,r.b), sales=apSalesIn(r), mrr=apCash(m0,m1), nxt=apCash(n0,n1);
  const vendP=sales.reduce((t,s)=>t+s.v,0), nD=sales.filter(s=>!s.d).length;
  let rec=0, rest=0, active=0; for(const s of AP_SALES){ const st=apSaleState(s); if(!st) continue; rec+=st.rec; rest+=st.rest; if(st.active) active++; }
  hero.innerHTML=`
    <div class="aph-main">
      <div class="aph-tag">💰 Caixa do Ápice no período</div>
      <div class="aph-v">${money(per.t)}</div>
      <div class="aph-s">parcelas <b>${money(per.p)}</b> <span class="aph-op">(${int(per.nP)})</span> + entradas <b>${money(per.s)}</b> <span class="aph-op">(${int(per.nS)})</span></div>
      <div class="aph-next">🔁 Receita recorrente hoje: <b>${money(mrr.p)}/mês</b> <span>(${int(mrr.nP)} mulheres pagando em ${monthName(m0)})</span></div>
    </div>
    <div class="aph-tiles">
      <div class="aph-t"><div class="aph-tk"><i class="aph-chip">período</i>Vendido</div><div class="aph-tv">${money(vendP)}</div><div class="aph-ts">${int(sales.length)} ${sales.length===1?'venda':'vendas'}${sales.length?` · ticket médio ${money(vendP/sales.length)}`:''}${nD?` · ${int(nD)} sem data`:''}</div></div>
      <div class="aph-t"><div class="aph-tk"><i class="aph-chip">período</i>Entradas</div><div class="aph-tv">${money(per.s)}</div><div class="aph-ts">pagas no dia do coquetel</div></div>
      <div class="aph-t"><div class="aph-tk"><i class="aph-chip">período</i>Parcelas</div><div class="aph-tv">${money(per.p)}</div><div class="aph-ts">${int(per.nP)} pagamentos no dia 1</div></div>
      <div class="aph-t aph-g"><div class="aph-tk"><i class="aph-chip g">geral</i>Previsão · ${monthName(n0,true)}</div><div class="aph-tv">${money(nxt.t)}</div><div class="aph-ts">${int(nxt.nP)} parcelas já contratadas</div></div>
      <div class="aph-t aph-g"><div class="aph-tk"><i class="aph-chip g">geral</i>Já recebido</div><div class="aph-tv">${money(rec)}</div><div class="aph-ts">entradas + parcelas até hoje</div></div>
      <div class="aph-t aph-g"><div class="aph-tk"><i class="aph-chip g">geral</i>A receber</div><div class="aph-tv">${money(rest)}</div><div class="aph-ts">${int(active)} contratos ainda pagando</div></div>
    </div>`;
  renderApChart();
  // vendas por Cocktail (data do coquetel) — só as do período
  const g=new Map();
  for(const s of sales){ const k=s.d||('~'+(s.t||'sem data')); let o=g.get(k); if(!o){ o={k,d:s.d,t:s.t,n:0,v:0,rec:0,rest:0,now:0,last:'',noDate:!s.d}; g.set(k,o); }
    o.n++; o.v+=s.v; const st=apSaleState(s); if(st){ o.rec+=st.rec; o.rest+=st.rest; o.now+=st.now; if(st.last>o.last) o.last=st.last; } }
  const rows=[...g.values()].sort((a,b)=>(a.noDate?1:0)-(b.noDate?1:0) || (b.d||'').localeCompare(a.d||''));
  document.getElementById('apCohortNote').textContent = `Cada linha é um Cocktail em que houve venda do Ápice no período (${perLbl}): quanto foi vendido, quanto já entrou de caixa até hoje, quanto ainda vai entrar e quanto pinga por mês agora.`;
  document.querySelector('#apCohort thead').innerHTML= rows.length ? '<tr><th class="pf-name">Cocktail (venda)</th><th>Vendas</th><th>Vendido</th><th>Já entrou</th><th>A receber</th><th>Parcela/mês agora</th><th>Última parcela</th></tr>' : '';
  document.querySelector('#apCohort tbody').innerHTML= rows.length ? rows.map(o=>{
    const pr=o.v>0?Math.min(100,o.rec/o.v*100):0;
    return `<tr><td class="pf-name">${o.noDate?`<span class="ap-nodate">sem data</span> <span class="sub">${esc(o.t)}</span>`:`🍸 ${o.d.split('-').reverse().join('/')}`}</td>
      <td data-l="Vendas">${int(o.n)}</td><td data-l="Vendido">${money(o.v)}</td>
      <td data-l="Já entrou">${o.noDate?'<span class="sub">—</span>':`<div class="pshare"><span class="pshare-bar"><i style="width:${pr.toFixed(1)}%;background:#c58b14"></i></span><b>${money(o.rec)}</b></div>`}</td>
      <td data-l="A receber">${o.noDate?'<span class="sub">—</span>':money(o.rest)}</td>
      <td data-l="Parcela/mês agora">${o.now>0?`<b class="ap-now">${money(o.now)}</b>`:'<span class="sub">—</span>'}</td>
      <td data-l="Última parcela">${o.last?monthName(o.last,true):'<span class="sub">—</span>'}</td></tr>`;
  }).join('') : '<tr><td class="sub" style="text-align:left">Nenhuma venda do Ápice no período selecionado.</td></tr>';
  renderApIssues();
}
// gráfico de barras empilhadas (parcelas + entradas) por mês; meses futuros = previsão. Desenhado na largura real.
function renderApChart(){
  const el=document.getElementById('apChart'); if(!el) return;
  if(!AP_EV.length){ el.innerHTML='<div class="sub">Sem vendas com data.</div>'; return; }
  const ds=AP_EV.map(e=>e.d).sort(), f=parseD(ds[0]), l=parseD(ds[ds.length-1]), base=f.getFullYear()*12+f.getMonth();
  const nM=(l.getFullYear()*12+l.getMonth())-base+1, M=[];
  for(let i=0;i<nM;i++){ const d=new Date(f.getFullYear(),f.getMonth()+i,1); M.push({k:fmtD(d),s:0,p:0,nS:0,nP:0}); }
  for(const e of AP_EV){ const d=parseD(e.d), o=M[d.getFullYear()*12+d.getMonth()-base]; if(e.k==='s'){o.s+=e.v;o.nS++;} else {o.p+=e.v;o.nP++;} }
  const t=parseD(AP_TODAY), cur=t.getFullYear()*12+t.getMonth()-base;
  const W=Math.max(320,el.clientWidth||900), H=W<560?230:270, pad={l:W<560?44:58,r:10,t:26,b:28}, iw=W-pad.l-pad.r, ih=H-pad.t-pad.b;
  const max=Math.max(1,...M.map(o=>o.s+o.p)), step=Math.pow(10,Math.floor(Math.log10(max))), top=Math.ceil(max/step)*step;
  const gw=iw/nM, bw=Math.max(3,Math.min(gw*0.68,30)), y=v=>pad.t+ih-v/top*ih;
  let grid='',bars='',xl='',hz='';
  for(let g=0;g<=4;g++){ const v=top*g/4, yy=y(v); grid+=`<line x1="${pad.l}" x2="${W-pad.r}" y1="${yy}" y2="${yy}" stroke="#e8edf2"/><text x="${pad.l-6}" y="${yy+3.5}" font-size="10.5" text-anchor="end" fill="#7b8794">${g?moneyK(v):'0'}</text>`; }
  const every=Math.ceil(nM/(W<560?6:13));
  // meses que tocam o período selecionado (fora de "Tudo") ganham uma faixa azul clara
  const rg=apRange(); let band='';
  if(!rg.all){ const i0=M.findIndex(o=>{ const e=fmtD(new Date(parseD(o.k).getFullYear(),parseD(o.k).getMonth()+1,0)); return e>=rg.a; });
    let i1=-1; M.forEach((o,i)=>{ if(o.k<=rg.b) i1=i; });
    if(i0>=0 && i1>=i0) band=`<rect x="${pad.l+i0*gw}" y="${pad.t-14}" width="${(i1-i0+1)*gw}" height="${ih+14}" rx="6" fill="#2f7fd1" opacity=".08"/><text x="${pad.l+(i0+(i1-i0+1)/2)*gw}" y="${pad.t-4}" font-size="10" font-weight="700" text-anchor="middle" fill="#2f7fd1">período</text>`; }
  bars+=band;
  M.forEach((o,i)=>{ const x=pad.l+i*gw+(gw-bw)/2, fut=i>cur, isCur=i===cur, op=fut?0.42:1;
    const hp=o.p/top*ih, hs=o.s/top*ih, yp=pad.t+ih-hp, ys=yp-hs;
    if(o.p>0) bars+=`<rect x="${x}" y="${yp}" width="${bw}" height="${Math.max(hp,1)}" rx="2" fill="#e0ad3c" opacity="${op}"/>`;
    if(o.s>0) bars+=`<rect x="${x}" y="${ys}" width="${bw}" height="${Math.max(hs-1.5,1)}" rx="2" fill="#8a5a00" opacity="${op}"/>`;
    if(fut && (o.p+o.s)>0) bars+=`<rect x="${x}" y="${ys}" width="${bw}" height="${hp+hs}" rx="2" fill="none" stroke="#c58b14" stroke-dasharray="3 2" stroke-width="1"/>`;
    if(isCur){ bars+=`<rect x="${pad.l+i*gw}" y="${pad.t}" width="${gw}" height="${ih}" fill="#f3c55a" opacity=".13"/><text x="${x+bw/2}" y="${Math.min(ys,pad.t+ih)-6}" font-size="10.5" font-weight="800" text-anchor="middle" fill="#8a5a00">${moneyK(o.s+o.p)}</text>`; }
    if((i%every===0 && Math.abs(i-cur)>Math.max(1,Math.ceil(every/2))) || isCur){ xl+=`<text x="${x+bw/2}" y="${H-9}" font-size="10.5" text-anchor="middle" fill="${isCur?'#8a5a00':'#7b8794'}" font-weight="${isCur?800:400}">${isCur?'hoje · ':''}${monthName(o.k,true)}</text>`; }
    hz+=`<rect class="hz" x="${pad.l+i*gw}" y="${pad.t}" width="${gw}" height="${ih}" fill="transparent" data-k="${o.k}" data-s="${o.s}" data-p="${o.p}" data-ns="${o.nS}" data-np="${o.nP}" data-f="${fut?1:0}"/>`;
  });
  el.innerHTML=`<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Caixa do Ápice por mês">${grid}${bars}${xl}${hz}</svg>`;
  attachTip('apChart', d=>`<div class="tt-d">${monthName(d.k)}${+d.f?' · <span style="color:#c58b14">previsão</span>':''}</div>
    <div class="tt-r"><span class="tdot" style="background:#e0ad3c"></span>Parcelas (dia 1)<b>${money(+d.p)}</b></div>
    <div class="tt-r"><span class="sub">${int(+d.np)} mulheres pagando</span></div>
    <div class="tt-r"><span class="tdot" style="background:#8a5a00"></span>Entradas<b>${money(+d.s)}</b></div>
    <div class="tt-r"><span class="sub">${int(+d.ns)} vendas no mês</span></div>
    <div class="tt-r" style="border-top:1px solid #e3e8ee;margin-top:4px;padding-top:4px">Total do mês<b>${money(+d.s + +d.p)}</b></div>`);
}
// avisos da planilha (linha = número da linha na planilha) — o que foi assumido p/ não travar o cálculo
function renderApIssues(){
  const el=document.getElementById('apIssues'); if(!el) return;
  const msgs=arr(APICE.issues).map(i=>{ const L=`<b>Linha ${i.l}</b>`;
    switch(i.k){
      case 'nodate': return `${L}: a data do coquetel está como “${esc(i.x)}”. A venda conta no total vendido, mas fica fora do caixa mês a mês e do ROAS por período (sem data não dá pra saber quando a entrada e as parcelas caem).`;
      case 'vparctxt': return `${L}: “Valor Parcela” tem uma observação (“${esc(i.x)}”). Usei (Valor − Sinal) ÷ Qntd = <b>${money(i.b)}</b>/mês.`;
      case 'vparc': return `${L}: “Valor Parcela” (${money(i.a)}) não fecha com (Valor − Sinal) ÷ Qntd (<b>${money(i.b)}</b>). Usei ${money(i.b)}, que bate com o VALOR total.`;
      case 'novalor': return `${L}: VALOR vazio ou inválido (“${esc(i.x)}”) — venda fora do financeiro.`;
      case 'sinaltxt': return `${L}: SINAL inválido (“${esc(i.x)}”) — considerei R$ 0 de entrada.`;
      case 'sinalmaior': return `${L}: SINAL (${money(i.a)}) maior que o VALOR (${money(i.b)}) — considerei tudo como entrada.`;
      case 'noqtd': return `${L}: falta a “Qntd Parcela” (“${esc(i.x)}”) — os ${money(i.b)} restantes ficaram fora do caixa.`;
      default: return `${L}: ${esc(i.k)}`; } });
  el.hidden=!msgs.length;
  el.innerHTML = msgs.length ? `<div class="chart-title">🔎 Pontos pra conferir na planilha do Ápice</div>
    <div class="micro-note">Nada aqui trava a dash — é só o que eu precisei assumir. Corrigindo na planilha, a dash acompanha na próxima atualização.</div>
    <ul class="ap-iss">${msgs.map(m=>`<li>${m}</li>`).join('')}</ul>` : '';
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
function nodeM(){ return {spend:0,impr:0,clicks:0,lpv:0,leads:0,qlf:0,sales:0,revenue:0,fleads:0}; }
function addM(o,r){ o.spend+=r.spend;o.impr+=r.impr;o.clicks+=r.clicks;o.lpv+=r.lpv;o.leads+=r.leads;o.qlf+=r.qlf;o.sales+=r.sales;o.revenue+=r.revenue;
  if(r.leads && isFormsCamp(r.campaign)) o.fleads+=r.leads; }
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
  const m=node.m;
  const cpm=safe(m.spend,m.impr)*1000, ctr=safe(m.clicks,m.impr)*100, cpc=safe(m.spend,m.clicks);
  const pageLeads=m.leads-m.fleads, connect=safe(m.lpv,m.clicks)*100, convlp=safe(pageLeads,m.lpv)*100, cpl=safe(m.spend,m.leads);
  const showConv = m.lpv>0 && !(m.fleads>0 && pageLeads<=0);   // campanha só de Forms não tem conversão de página
  const txq=safe(m.qlf,m.leads)*100, cplqlf=safe(m.spend,m.qlf), txv=safe(m.sales,m.qlf)*100;
  const cac=safe(m.spend,m.sales), roas=safe(m.revenue,m.spend), ticket=safe(m.revenue,m.sales);
  const car = hasKids ? `<span class="caret">${expanded.has(node.key)?'▾':'▸'}</span>` : '<span class="caret0"></span>';
  return `<tr class="trow lvl${level}" data-key="${esc(node.key)}" data-k="${hasKids?1:0}">
    <td class="tlabel" style="padding-left:${8+level*22}px" title="${esc(node.label)}">${car}${esc(node.label)}</td>
    <td>${money(m.spend)}</td>
    <td>${int(m.impr)}</td>
    <td>${m.impr>0?money(cpm):'—'}</td>
    <td>${m.impr>0?pct(ctr):'—'}</td>
    <td>${int(m.clicks)}</td>
    <td>${m.clicks>0?money(cpc):'—'}</td>
    <td>${m.clicks>0?pct(connect):'—'}</td>
    <td>${int(m.lpv)}</td>
    <td>${showConv?pct(convlp):'—'}</td>
    <td>${int(m.leads)}</td>
    <td>${m.leads>0?money(cpl):'—'}</td>
    <td>${m.leads>0?pct(txq):'—'}</td>
    <td>${int(m.qlf)}</td>
    <td>${cplPill(cplqlf,m.qlf)}</td>
    <td>${m.qlf>0?pct(txv):'—'}</td>
    <td>${int(m.sales)}</td>
    <td>${m.sales>0?money(cac):'—'}</td>
    <td>${money(m.revenue)}</td>
    <td>${m.spend>0?fmtRoas(roas):'—'}</td>
    <td>${m.sales>0?money(ticket):'—'}</td></tr>`;
}
function cplPill(v,qlf){
  if(qlf<=0) return '<span class="pill" style="background:#aab4bf">—</span>';
  const col = v<=90?'var(--green)':(v<=TARGET_CPL_QLF?'var(--yellow)':'var(--red)');
  return `<span class="pill" style="background:${col}">${money(v)}</span>`;
}
function renderTable(){
  const tree=buildTree(state.start,state.end);
  document.querySelector('#optTable thead').innerHTML='<tr><th class="tlabel">Campanha › Conjunto › Anúncio</th><th>Gasto</th><th>Impressões</th><th>CPM</th><th>CTR</th><th>Cliques</th><th>CPC</th><th>Connect</th><th>Page Views</th><th>Conv. LP</th><th>Leads</th><th>CPL</th><th>% Qualif</th><th>QLF</th><th>CPL QLF</th><th>Conv. Venda</th><th>Vendas</th><th>CAC</th><th>Receita</th><th>ROAS</th><th>Ticket</th></tr>';
  let rows='';
  for(const c of tree){ rows+=treeRow(c,0,c.kidsArr.length>0);
    if(expanded.has(c.key)) for(const a of c.kidsArr){ rows+=treeRow(a,1,a.kidsArr.length>0);
      if(expanded.has(a.key)) for(const d of a.kidsArr){ rows+=treeRow(d,2,false); } } }
  document.querySelector('#optTable tbody').innerHTML=rows;
  document.querySelectorAll('#optTable .trow[data-k="1"]').forEach(tr=>tr.onclick=()=>{ const k=tr.dataset.key; if(expanded.has(k)) expanded.delete(k); else expanded.add(k); renderTable(); });
}

// ---- otimização por criativo (aba Funil): cada anúncio somado em todas as campanhas do período ----
// Ranking por vendas / CPL QLF / verba / ROAS, pódios, mapa (vendas × CPL QLF, bolha = verba) e tabela com diagnóstico.
// Diagnóstico usa o CPL QLF médio da CONTA no período (verba total ÷ qualificadas totais) como régua.
const CR = { sort:'sales', camp:'', min:300, open:new Set() };   // open = criativos abertos (quebra por campanha)
let CR_ROWS = [];
const CR_SKIP = new Set(['SEM_UTM','NAO_ATRIBUIDO','xxxxx','']);
const CR_MINQ = 3;   // ranking de CPL QLF só vale com pelo menos 3 qualificadas
const crSeg = c => { const p=String(c).split('|').map(s=>s.trim()).filter(Boolean); return p.length?p[p.length-1]:String(c); };
const crCampLabel = c => { const dt=(String(c).match(/(\d{2})\/(\d{2})\/\d{4}/)||[]); return pretty(crSeg(c))+(dt[1]?` · ${dt[1]}/${dt[2]}`:''); };
const crShort = s => { const t=pretty(s).replace(/^AD_?/i,'').replace(/_/g,' ').replace(/\s+/g,' ').trim(); return t.length>26?t.slice(0,25)+'…':t; };
const CR_DIAG = {
  champ:{l:'⭐ Campeão', c:'var(--green)', d:'vende e o CPL QLF está abaixo da média'},
  pricey:{l:'💰 Vende, mas caro', c:'#d9822b', d:'traz venda, mas a qualificada sai acima da média'},
  cheap:{l:'🧪 Barato, sem venda', c:'var(--blue2)', d:'qualificada barata, ainda sem venda no período'},
  review:{l:'✂️ Revisar', c:'var(--red)', d:'caro e sem venda no período'},
  old:{l:'🕰️ Leads antigos', c:'#7b8794', d:'vendas de leads de antes do período; pouca ou nenhuma verba agora'}
};
function crData(){
  const map=new Map(), camps=new Map(); let all={spend:0,qlf:0}, unS=0, unR=0;
  for(const r of D.grain){ if(r.date<state.start||r.date>state.end) continue;
    all.spend+=r.spend; all.qlf+=r.qlf;
    if(CR_SKIP.has(r.ad) || r.campaign==='NAO_ATRIBUIDO' || r.campaign==='SEM_UTM'){ unS+=r.sales; unR+=r.revenue; continue; }
    camps.set(r.campaign,(camps.get(r.campaign)||0)+r.spend);
    if(CR.camp && r.campaign!==CR.camp) continue;
    let o=map.get(r.ad); if(!o){ o={ad:r.ad,m:nodeM(),camps:new Map(),by:new Map()}; map.set(r.ad,o); }
    addM(o.m,r); o.camps.set(r.campaign,(o.camps.get(r.campaign)||0)+r.spend);
    let bc=o.by.get(r.campaign); if(!bc){ bc=nodeM(); o.by.set(r.campaign,bc); } addM(bc,r);   // mesmo criativo, campanha a campanha
  }
  const avg=safe(all.spend,all.qlf);
  const list=[...map.values()].filter(o=>o.m.spend>=CR.min || o.m.sales>0).map(o=>{ const m=o.m;
    const cs=[...o.camps.entries()].sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
    const cplq=m.qlf>0?m.spend/m.qlf:null, roas=safe(m.revenue,m.spend);
    let dg; if(m.sales>0 && m.spend<Math.max(CR.min,1)) dg='old';   // só aparece pela venda: verba abaixo do mínimo no período
    else if(m.sales>0) dg=(cplq!=null && cplq<=avg)?'champ':'pricey';
    else dg=(cplq!=null && cplq<=avg)?'cheap':'review';
    const by=[...o.by.entries()].sort((a,b)=>b[1].spend-a[1].spend || b[1].sales-a[1].sales);
    return {ad:o.ad,m,cs,by,cplq,roas,cac:safe(m.spend,m.sales),txq:safe(m.qlf,m.leads)*100,dg}; });
  return {list,avg,unS,unR,camps};
}
function crSort(list){
  const by={
    sales:(a,b)=>b.m.sales-a.m.sales || b.m.revenue-a.m.revenue || (a.cplq??1e9)-(b.cplq??1e9),
    cplq:(a,b)=>{ const ra=a.m.qlf>=CR_MINQ?0:(a.m.qlf>0?1:2), rb=b.m.qlf>=CR_MINQ?0:(b.m.qlf>0?1:2); return ra-rb || (a.cplq??1e9)-(b.cplq??1e9) || b.m.sales-a.m.sales; },
    spend:(a,b)=>b.m.spend-a.m.spend,
    roas:(a,b)=>(a.dg==='old')-(b.dg==='old') || (b.m.spend>0)-(a.m.spend>0) || b.roas-a.roas || b.m.sales-a.m.sales   // ROAS de verba quase zero não lidera
  };
  return list.slice().sort(by[CR.sort]||by.sales);
}
function crPill(v,qlf,avg){
  if(!qlf || v==null) return '<span class="pill" style="background:#aab4bf">—</span>';
  const col = v<=avg*0.8?'var(--green)':(v<=avg*1.2?'var(--yellow)':'var(--red)');
  return `<span class="pill" style="background:${col}">${money(v)}</span>`;
}
function crCampChips(cs){
  if(!cs.length) return '';
  const more=cs.length-1, rest=cs.slice(1).map(crCampLabel).join(' · ');
  return `<span class="cr-chip" title="${esc(pretty(cs[0]))}">${esc(crCampLabel(cs[0]))}</span>${more?`<span class="cr-chip cr-more" title="${esc(rest)} · clique para ver por campanha">+${more} ${more===1?'campanha':'campanhas'} ▾</span>`:''}`;
}
function renderCreatives(){
  const card=document.getElementById('crCard'); if(!card) return;
  const sel=document.getElementById('crCamp');
  const {list,avg,unS,unR,camps}=crData();
  // campanhas com verba no período (mantém a escolhida mesmo se sumir do período)
  const opts=[...camps.entries()].filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).map(([c])=>c);
  if(CR.camp && !opts.includes(CR.camp)) opts.unshift(CR.camp);
  sel.innerHTML='<option value="">Todas</option>'+opts.map(c=>`<option value="${esc(c)}"${c===CR.camp?' selected':''}>${esc(crCampLabel(c))}</option>`).join('');
  document.querySelectorAll('#crSort button').forEach(b=>b.classList.toggle('on',b.dataset.s===CR.sort));
  const rows=crSort(list);

  // ---- pódios ----
  const med=['🥇','🥈','🥉'];
  const topSales=list.filter(x=>x.m.sales>0).sort((a,b)=>b.m.sales-a.m.sales||b.m.revenue-a.m.revenue).slice(0,3);
  let qMin=5, topCpl=list.filter(x=>x.m.qlf>=qMin && x.m.spend>0).sort((a,b)=>a.cplq-b.cplq).slice(0,3);
  if(topCpl.length<3){ qMin=CR_MINQ; topCpl=list.filter(x=>x.m.qlf>=qMin && x.m.spend>0).sort((a,b)=>a.cplq-b.cplq).slice(0,3); }
  const pod=(title,sub,items,big,small,cls)=>`<div class="cr-pod ${cls}">
      <div class="cr-pod-h"><b>${title}</b><span>${sub}</span></div>
      ${items.length?items.map((x,i)=>`<div class="cr-pod-row" title="${esc(pretty(x.ad))} · clique para ver por campanha" data-ad="${esc(x.ad)}">
        <span class="cr-medal">${med[i]}</span>
        <div class="cr-pod-name"><div>${esc(pretty(x.ad))}</div><div class="cr-pod-camps">${crCampChips(x.cs)}</div></div>
        <div class="cr-pod-num"><b>${big(x)}</b><span>${small(x)}</span></div></div>`).join('')
        : '<div class="cr-empty">Nenhum criativo nesse critério no período.</div>'}
    </div>`;
  document.getElementById('crPodiums').innerHTML =
    pod('🏆 Mais vendas','compradoras que vieram do anúncio',topSales,x=>`${int(x.m.sales)} ${x.m.sales===1?'venda':'vendas'}`,x=>`${money(x.m.revenue)} · CPL QLF ${x.cplq!=null?money(x.cplq):'—'}`,'p-sales') +
    pod('💎 Menor CPL qualificado',`com pelo menos ${qMin} qualificadas · média da conta ${money(avg)}`,topCpl,x=>money(x.cplq),x=>`${int(x.m.qlf)} qualificadas · ${int(x.m.sales)} ${x.m.sales===1?'venda':'vendas'}`,'p-cpl');

  // ---- mapa: x = CPL QLF (escala log), y = vendas, bolha = verba ----
  const box=document.getElementById('crMap');
  const pts=list.filter(x=>x.cplq!=null && x.m.spend>0);
  if(!pts.length){ box.innerHTML='<div class="cr-empty">Sem criativos com qualificadas e verba no período.</div>'; }
  else{
    const W=Math.max(340,box.clientWidth||900), H=320, pad={l:46,r:18,t:22,b:40}, iw=W-pad.l-pad.r, ih=H-pad.t-pad.b;
    const xs=pts.map(x=>x.cplq).concat([avg]).filter(v=>v>0);
    const lx0=Math.log(Math.min(...xs)*0.8), lx1=Math.log(Math.max(...xs)*1.25);
    const X=v=>pad.l+(Math.log(v)-lx0)/(lx1-lx0||1)*iw;
    const yb=pad.t+ih-22, yt=pad.t+20;   // faixas de cima/baixo reservadas p/ os rótulos dos quadrantes
    const ymax=Math.max(1,...pts.map(x=>x.m.sales)), Y=v=>yb-(v+0.5)/(ymax+1)*(yb-yt);
    const smax=Math.max(...pts.map(x=>x.m.spend)), R=v=>5+17*Math.sqrt(v/smax);
    let g='';
    for(const t of [10,25,50,100,200,400,800,1600,3200,6400]){ const lt=Math.log(t); if(lt<lx0||lt>lx1) continue; const x=X(t);
      g+=`<line x1="${x}" y1="${pad.t}" x2="${x}" y2="${pad.t+ih}" stroke="#eef2f6"/><text x="${x}" y="${H-22}" font-size="10" text-anchor="middle" fill="#7b8794">R$ ${int(t)}</text>`; }
    const ystep=Math.max(1,Math.ceil(ymax/5));
    for(let v=0;v<=ymax;v+=ystep){ const y=Y(v); g+=`<line x1="${pad.l}" y1="${y}" x2="${W-pad.r}" y2="${y}" stroke="#eef2f6"/><text x="${pad.l-8}" y="${y+3}" font-size="10" text-anchor="end" fill="#7b8794">${v}</text>`; }
    const ax=X(avg), ySplit=Y(0.5);
    const quad=`<rect x="${pad.l}" y="${pad.t}" width="${Math.max(0,ax-pad.l)}" height="${Math.max(0,ySplit-pad.t)}" fill="rgba(46,158,63,.07)"/>
      <rect x="${ax}" y="${pad.t}" width="${Math.max(0,pad.l+iw-ax)}" height="${Math.max(0,ySplit-pad.t)}" fill="rgba(217,130,43,.07)"/>
      <rect x="${pad.l}" y="${ySplit}" width="${Math.max(0,ax-pad.l)}" height="${Math.max(0,pad.t+ih-ySplit)}" fill="rgba(47,127,209,.06)"/>
      <rect x="${ax}" y="${ySplit}" width="${Math.max(0,pad.l+iw-ax)}" height="${Math.max(0,pad.t+ih-ySplit)}" fill="rgba(224,72,58,.06)"/>
      <line x1="${ax}" y1="${pad.t}" x2="${ax}" y2="${pad.t+ih}" stroke="#41505e" stroke-dasharray="4 4" stroke-width="1.2"/>
      <line x1="${pad.l}" y1="${ySplit}" x2="${pad.l+iw}" y2="${ySplit}" stroke="#c9d3dd" stroke-dasharray="2 4"/>
      <text x="${pad.l+8}" y="${pad.t+14}" font-size="11" font-weight="800" fill="#2e9e3f">⭐ Campeões · escalar</text>
      <text x="${pad.l+iw-8}" y="${pad.t+14}" font-size="11" font-weight="800" fill="#c06d1f" text-anchor="end">💰 Vendem, mas caros · otimizar</text>
      <text x="${pad.l+8}" y="${pad.t+ih-8}" font-size="11" font-weight="800" fill="#2f7fd1">🧪 Baratos, sem venda · dar tempo</text>
      <text x="${pad.l+iw-8}" y="${pad.t+ih-8}" font-size="11" font-weight="800" fill="#d4544a" text-anchor="end">✂️ Caros e sem venda · revisar</text>
      <text x="${ax}" y="${pad.t-7}" font-size="10" font-weight="700" fill="#41505e" text-anchor="middle">média ${money(avg)}</text>
      <text x="${pad.l+iw/2}" y="${H-6}" font-size="10.5" text-anchor="middle" fill="#41505e" font-weight="700">CPL qualificado (escala log) → mais caro</text>
      <text x="12" y="${pad.t+ih/2}" font-size="10.5" fill="#41505e" font-weight="700" transform="rotate(-90 12 ${pad.t+ih/2})" text-anchor="middle">vendas</text>`;
    const ord=pts.slice().sort((a,b)=>b.m.spend-a.m.spend);   // grandes atrás, pequenas na frente
    const labelSet=new Set(pts.slice().sort((a,b)=>b.m.sales-a.m.sales||b.m.spend-a.m.spend).slice(0,6).map(x=>x.ad));
    let dots='', labs='';
    ord.forEach(x=>{ const cx=X(x.cplq), cy=Y(x.m.sales), r=R(x.m.spend), col=CR_DIAG[x.dg].c, i=pts.indexOf(x);
      dots+=`<circle class="hz cr-dot" cx="${cx}" cy="${cy}" r="${r}" fill="${col}" fill-opacity=".55" stroke="${col}" stroke-width="1.5" data-i="${i}"/>`;
      if(labelSet.has(x.ad)){ const right=cx<pad.l+iw*0.7; labs+=`<text x="${right?cx+r+4:cx-r-4}" y="${cy+3.5}" font-size="10.5" font-weight="700" fill="#1f2933" text-anchor="${right?'start':'end'}" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(crShort(x.ad))}</text>`; } });
    box.innerHTML=`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Mapa dos criativos: vendas por CPL qualificado">${g}${quad}${dots}${labs}</svg>`;
    attachTip('crMap', ds=>{ const x=pts[+ds.i], dg=CR_DIAG[x.dg];
      return `<div class="tt-d">${esc(pretty(x.ad))}</div>
        <div class="tt-r"><span class="sub">${esc(x.cs.map(crCampLabel).join(' · '))}</span></div>
        <div class="tt-r">Verba<b>${money(x.m.spend)}</b></div>
        <div class="tt-r">Qualificadas<b>${int(x.m.qlf)}</b></div>
        <div class="tt-r">CPL qualificado<b>${money(x.cplq)}</b></div>
        <div class="tt-r">Vendas<b>${int(x.m.sales)}</b></div>
        <div class="tt-r">ROAS<b>${fmtRoas(x.roas)}</b></div>
        <div class="tt-r"><span class="tdot" style="background:${dg.c}"></span>${dg.l}</div>`; });
  }

  // ---- tabela ----
  const maxS=Math.max(1,...rows.map(x=>x.m.sales));
  const sortCol={sales:'Vendas',cplq:'CPL QLF',spend:'Verba',roas:'ROAS'}[CR.sort];
  const th=(l,k)=>`<th class="${l===sortCol?'sorted':''}"${k?` data-s="${k}"`:''}>${l}</th>`;
  document.querySelector('#crTable thead').innerHTML=`<tr><th class="cr-rk">#</th><th class="cr-name">Criativo · campanha</th>${th('Verba','spend')}${th('Leads')}${th('Qualificadas')}${th('% Qualif')}${th('CPL QLF','cplq')}${th('Vendas','sales')}${th('Receita')}${th('ROAS','roas')}${th('CAC')}<th class="cr-dg">Diagnóstico</th></tr>`;
  CR_ROWS=rows;
  // linha por campanha (quando o criativo está aberto): mesmas colunas, mesma régua de CPL QLF
  const subRows=x=>{ const tot=x.m.spend;
    return `<tr class="cr-subhead"><td></td><td colspan="11">📂 <b>${x.by.length} ${x.by.length===1?'campanha':'campanhas'}</b> em que este criativo rodou no período · ordenadas por verba</td></tr>` +
      x.by.map(([camp,m])=>{ const cq=m.qlf>0?m.spend/m.qlf:null;
        return `<tr class="cr-sub">
          <td></td>
          <td class="cr-name"><div class="cr-subcamp"><span class="cr-chip">${esc(crCampLabel(camp))}</span></div><div class="cr-full" title="${esc(pretty(camp))}">${esc(pretty(camp))}</div></td>
          <td>${money(m.spend)}</td>
          <td>${int(m.leads)}</td>
          <td>${int(m.qlf)}</td>
          <td>${m.leads>0?pct(safe(m.qlf,m.leads)*100):'—'}</td>
          <td>${crPill(cq,m.qlf,avg)}</td>
          <td><b>${int(m.sales)}</b></td>
          <td>${money(m.revenue)}</td>
          <td>${m.spend>0?fmtRoas(safe(m.revenue,m.spend)):'—'}</td>
          <td>${m.sales>0&&m.spend>0?money(safe(m.spend,m.sales)):'—'}</td>
          <td class="cr-dg"><span class="cr-share">${tot>0?`${pct(safe(m.spend,tot)*100)} da verba`:'sem verba no período'}</span></td></tr>`; }).join(''); };
  document.querySelector('#crTable tbody').innerHTML = rows.length ? rows.map((x,i)=>{ const m=x.m, dg=CR_DIAG[x.dg];
    const few = CR.sort==='cplq' && m.qlf>0 && m.qlf<CR_MINQ, isOpen=CR.open.has(x.ad);
    return `<tr class="cr-row${i<3?' cr-top':''}${isOpen?' cr-open':''}" data-i="${i}" title="Clique para ${isOpen?'fechar':'ver'} a quebra por campanha">
      <td class="cr-rk">${i<3?med[i]:i+1}</td>
      <td class="cr-name"><div class="cr-ad"><span class="caret">${isOpen?'▾':'▸'}</span>${esc(pretty(x.ad))}</div><div class="cr-camps">${crCampChips(x.cs)}</div></td>
      <td>${money(m.spend)}</td>
      <td>${int(m.leads)}</td>
      <td>${int(m.qlf)}</td>
      <td>${m.leads>0?pct(x.txq):'—'}</td>
      <td>${crPill(x.cplq,m.qlf,avg)}${few?'<div class="cr-few">poucos dados</div>':''}</td>
      <td class="cr-sales"><div class="cr-sbar"><i style="width:${(m.sales/maxS*60).toFixed(1)}px"></i><b>${int(m.sales)}</b></div></td>
      <td>${money(m.revenue)}</td>
      <td>${m.spend>0?fmtRoas(x.roas):'—'}</td>
      <td>${m.sales>0&&m.spend>0?money(x.cac):'—'}</td>
      <td class="cr-dg"><span class="cr-tag" style="color:${dg.c};border-color:${dg.c}" title="${esc(dg.d)}">${dg.l}</span></td></tr>` + (isOpen?subRows(x):''); }).join('')
    : '<tr><td colspan="12" class="cr-empty">Nenhum criativo com esse filtro no período.</td></tr>';
  document.querySelectorAll('#crTable thead th[data-s]').forEach(t=>t.onclick=()=>{ CR.sort=t.dataset.s; renderCreatives(); });
  document.querySelectorAll('#crTable tbody tr.cr-row').forEach(tr=>tr.onclick=()=>{ const x=CR_ROWS[+tr.dataset.i]; if(!x) return;
    if(CR.open.has(x.ad)) CR.open.delete(x.ad); else CR.open.add(x.ad); renderCreatives(); });
  // pódio: clicar abre o criativo na tabela já com a quebra por campanha
  document.querySelectorAll('#crPodiums .cr-pod-row').forEach(el=>el.onclick=()=>{ const ad=el.dataset.ad; CR.open.add(ad); renderCreatives();
    const i=CR_ROWS.findIndex(x=>x.ad===ad), tr=document.querySelector(`#crTable tbody tr.cr-row[data-i="${i}"]`);
    if(tr){ const sc=tr.closest('.table-scroll'); if(sc) sc.scrollTop=tr.offsetTop-40; tr.closest('.cr-card').querySelector('.cr-scroll').scrollIntoView({behavior:'smooth',block:'nearest'}); } });
  document.getElementById('crNote').innerHTML =
    `${int(rows.length)} criativos${CR.camp?` na campanha <b>${esc(crCampLabel(CR.camp))}</b>`:''} · CPL QLF médio da conta no período: <b>${money(avg)}</b> (verde = 20% abaixo da média ou mais, vermelho = 20% acima)` +
    (unS?` · <b>${int(unS)} ${unS===1?'venda':'vendas'}</b> (${money(unR)}) do período não têm criativo identificado e ficam fora desta visão`:'') +
    ` · criativos com verba abaixo do mínimo só aparecem se tiverem venda.`;
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
    <td title="${esc(r.label)}">${r.label}</td><td>${int(r.sales)}</td><td>${money(r.revenue)}</td>
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

// ===================== perfil por pessoa: Objeções · Compradoras · Tempo (TUDO pelo período) =====================
// data-perfil.js traz 1 linha por lead QUALIFICADA (data do lead) e 1 por COMPRA (data da compra), com a resposta de
// cada pergunta do Typeform. Aqui agrega pelo seletor de datas. O build manda o texto cru das opções; rótulo,
// ordem e junção das grafias antiga/nova do Typeform vivem aqui (PQ_DEF).
const nkey = s => String(s==null?'':s).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const cap1 = s => { s=String(s==null?'':s).trim(); return s ? s.charAt(0).toUpperCase()+s.slice(1) : s; };
const PQ_DEF = {
  fat:{label:'Faturamento mensal',icon:'💰',color:'var(--green)',
    map:{'menos de r$ 5 mil':'Menos de R$ 5 mil','entre r$ 5 mil e r$ 10 mil':'R$ 5 a 10 mil','entre r$ 10 mil e r$ 50 mil':'R$ 10 a 50 mil','entre r$ 50 mil e r$ 100 mil':'R$ 50 a 100 mil',
      'menos de 100mil':'Menos de R$ 100 mil','entre r$ 100 mil e r$ 200 mil':'R$ 100 a 200 mil','de 100k a 300k':'R$ 100 a 300 mil','acima de 200 mil':'Acima de R$ 200 mil',
      'de 300k a 500k':'R$ 300 a 500 mil','de 500k a 1m':'R$ 500 mil a 1 mi','acima de 1m':'Acima de R$ 1 mi'},
    order:['Menos de R$ 5 mil','R$ 5 a 10 mil','R$ 10 a 50 mil','R$ 50 a 100 mil','Menos de R$ 100 mil','R$ 100 a 200 mil','R$ 100 a 300 mil','Acima de R$ 200 mil','R$ 300 a 500 mil','R$ 500 mil a 1 mi','Acima de R$ 1 mi'],
    mid:{'Menos de R$ 5 mil':2500,'R$ 5 a 10 mil':7500,'R$ 10 a 50 mil':30000,'R$ 50 a 100 mil':75000,'Menos de R$ 100 mil':50000,'R$ 100 a 200 mil':150000,'R$ 100 a 300 mil':200000,'Acima de R$ 200 mil':300000,'R$ 300 a 500 mil':400000,'R$ 500 mil a 1 mi':750000,'Acima de R$ 1 mi':1200000}},
  voce:{label:'Perfil profissional',icon:'👩‍💼',color:'var(--blue2)'},
  eq:{label:'Tamanho da equipe',icon:'👥',color:'var(--blue)',
    map:{'1':'Só ela','05':'Até 5 pessoas','2-7':'2 a 7 pessoas','de 06 a 20':'6 a 20 pessoas','8-15':'8 a 15 pessoas','16-50':'16 a 50 pessoas','de 21 a 50':'21 a 50 pessoas','50+':'Mais de 50','acima de 50':'Mais de 50'},
    order:['Só ela','Até 5 pessoas','2 a 7 pessoas','6 a 20 pessoas','8 a 15 pessoas','16 a 50 pessoas','21 a 50 pessoas','Mais de 50']},
  margem:{label:'Margem de lucro',icon:'📈',color:'#2e9e3f',isNew:true,order:['Até 10%','De 11% a 30%','Acima de 30%']},
  civil:{label:'Estado civil',icon:'💍',color:'#9b59b6',isNew:true},
  filhos:{label:'Filhos',icon:'👶',color:'#e0772f',isNew:true,
    map:{'nao':'Sem filhos','1':'1 filho(a)','2':'2 filhos','3+':'3 ou mais','sim':'Tem filhos (não disse quantos)'},
    order:['Sem filhos','1 filho(a)','2 filhos','3 ou mais','Tem filhos (não disse quantos)']},
  fe:{label:'Fé / religião',icon:'🙏',color:'#1769b4',isNew:true,map:{'tenho fe, mas nao sigo uma religiao especifica':'Tem fé, sem religião específica'}},
  intent:{label:'Intenção de pagamento',icon:'💳',color:'var(--navy)',
    map:{'pronta para investir a vista (pix ou cartao)':'À vista (Pix ou cartão)','prefiro parcelar em ate 12x no cartao':'Parcelar em até 12x','tenho duvidas financeiras, preciso conversar':'Dúvida financeira, quer conversar'},
    order:['À vista (Pix ou cartão)','Parcelar em até 12x','Dúvida financeira, quer conversar']},
  freq:{label:'Sente que poderia faturar mais',icon:'🔁',color:'#4aa3e8',map:{'as vezes':'Às vezes','acho que nao':'Acho que não'},
    order:['Sempre','Quase sempre','Frequentemente','Às vezes','Acho que não','Nunca']},
  pres:{label:'Pode ir presencial em Barueri/SP',icon:'📍',color:'#7b8794',
    map:{'sim, consigo me programar':'Sim, consegue ir','talvez (preciso ajustar minha agenda)':'Talvez (ajustar agenda)','nao':'Não'},order:['Sim, consegue ir','Talvez (ajustar agenda)','Não']},
  busca:{label:'O que busca construir',icon:'🌱',color:'#e9a23b',isNew:true,multi:true,
    map:{network:'Network e conexões',cresc:'Crescer e faturar mais',estrut:'Estrutura e gestão',posic:'Posicionamento e autoridade',estrat:'Estratégia e clareza',
      aprend:'Conhecimento e aprendizado',mente:'Mentalidade e confiança',legado:'Legado, família e liberdade',financ:'Finanças e patrimônio',outro:'Outros temas'},
    hide:['Outros temas']}
};
// perguntas na ordem do arquivo; cada opção crua -> rótulo (grafias que significam o mesmo viram 1 rótulo)
const PQS = arr(PF.q).map(q=>{
  const def=PQ_DEF[q.k]||{label:q.k,icon:'•'}; const labels=[], map=[];
  arr(q.o).forEach((raw,i)=>{ const L=(def.map&&def.map[nkey(raw)])||cap1(raw); let li=labels.indexOf(L); if(li<0){ labels.push(L); li=labels.length-1; } map[i]=li; });
  return {k:q.k, def, multi:!!q.multi, labels, map};
});
// L=[dia, objeção, resp…, texto]   B=[dia compra, dia 1º contato, objeção, valor, virou Ápice 0/1, pessoa, resp…, texto]
// A=[dia da venda do Ápice (-99999 = sem data), objeção, qualificada 0/1, comprou Cocktail 0/1, resp…, texto]
const PNQ=PQS.length, PL_OFF=2, PB_OFF=6, PA_OFF=4, PL_T=PL_OFF+PNQ, PB_T=PB_OFF+PNQ, PA_T=PA_OFF+PNQ;
const PBK = arr(PF.buckets);
const PF_D0 = PF.d0 ? parseD(PF.d0) : null;
const pfIdx = s => Math.round((parseD(s)-PF_D0)/86400000);
function pfRows(list,start,end){ if(!PF_D0) return []; const a=pfIdx(start), b=pfIdx(end); return arr(list).filter(r=>r[0]>=a && r[0]<=b); }
function pfDist(rows,off){
  const res=PQS.map(q=>({n:0,c:new Array(q.labels.length).fill(0)}));
  for(const r of rows){ for(let i=0;i<PNQ;i++){ const v=r[off+i]; if(v==null||v<0) continue; const q=PQS[i], o=res[i]; o.n++;
    if(q.multi){ for(let b=0;b<q.labels.length;b++) if(v&(1<<b)) o.c[b]++; } else o.c[q.map[v]]++; } }
  return res;
}
function pfList(qi,d){   // distribuição de uma pergunta -> [{label,n,pct}] na ordem natural das opções
  const q=PQS[qi], o=d[qi]; if(!o.n) return [];
  const hide=q.def.hide||[], ord=q.def.order;
  const list=q.labels.map((L,li)=>({label:L,n:o.c[li],pct:o.c[li]/o.n*100})).filter(x=>x.n>0 && !hide.includes(x.label));
  if(ord) list.sort((a,b)=>{ const ia=ord.indexOf(a.label), ib=ord.indexOf(b.label); return (ia<0?999:ia)-(ib<0?999:ib) || b.n-a.n; });
  else list.sort((a,b)=>b.n-a.n);
  return list;
}
// "o que têm em comum": respostas mais frequentes no grupo, priorizando as que fogem da média do período
// (traço que quase todo mundo tem — ex.: 90% empresárias — não diferencia e fica de fora)
function pfTraits(rows,off,base,max){
  if(rows.length<5) return null;
  const g=pfDist(rows,off), cand=[];
  PQS.forEach((q,i)=>{ const go=g[i], bo=base[i]; if(go.n<5) return; const hide=q.def.hide||[];
    q.labels.forEach((L,li)=>{ if(hide.includes(L)) return; const n=go.c[li]; if(n<3) return;
      const s=n/go.n, bs=bo.n?bo.c[li]/bo.n:0, lift=bs>0?s/bs:1;
      if(s<0.25 || lift<0.95) return;          // pouco comum no grupo, ou abaixo da média: não é "em comum"
      if(bs>=0.7 && lift<1.1) return;
      cand.push({q,i,L,s,bs,lift,score:s*Math.pow(Math.min(lift,3),2)}); }); });   // o que mais foge da média vem primeiro
  cand.sort((a,b)=>b.score-a.score);
  const seen=new Set(), pick=[];
  for(const x of cand){ if(seen.has(x.i)) continue; seen.add(x.i); pick.push(x); if(pick.length>=(max||4)) break; }
  return pick;
}
const fx1 = v => v.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});
function traitChip(x,who){
  const up=x.lift>=1.2;
  const tip=`${x.q.def.label}: ${pct(x.s*100)} ${who} (média do período: ${pct(x.bs*100)})`;
  return `<span class="trait${up?' up':''}" title="${esc(tip)}"><span class="tr-ic">${x.q.def.icon}</span>${esc(x.L)} <b>${Math.round(x.s*100)}%</b>${up?`<i>↑ ${fx1(x.lift)}x</i>`:''}</span>`;
}
function traitsCell(t,who){
  if(!t) return '<span class="sub">amostra pequena (menos de 5 pessoas)</span>';
  if(!t.length) return '<span class="sub">nenhum traço se destaca da média</span>';
  return `<div class="traits">${t.map(x=>traitChip(x,who)).join('')}</div>`;
}
function shareCell(p,n,color){
  return `<div class="pshare"><span class="pshare-bar"><i style="width:${Math.min(100,p).toFixed(1)}%;background:${color}"></i></span><b>${pct(p)}</b><span class="sub">(${int(n)})</span></div>`;
}
// raio-x: TODAS as perguntas do grupo, top 3 respostas, com a marca da média do período
function raioX(rows,off,base,baseLbl){
  const g=pfDist(rows,off);
  const cards=PQS.map((q,i)=>{ const go=g[i]; if(go.n<3) return '';
    const top=pfList(i,g).sort((a,b)=>b.n-a.n).slice(0,3);
    const lines=top.map(x=>{ const li=q.labels.indexOf(x.label), bs=base[i].n?base[i].c[li]/base[i].n*100:0;
      return `<div class="rx-line"><div class="rx-lbl" title="${esc(x.label)}">${esc(x.label)}</div>
        <div class="rx-bar"><div class="rx-fill" style="width:${Math.min(100,x.pct).toFixed(1)}%;background:${q.def.color||'var(--blue2)'}"></div><div class="rx-avg" style="left:${Math.min(100,bs).toFixed(1)}%" title="média ${baseLbl}: ${pct(bs)}"></div></div>
        <div class="rx-v">${Math.round(x.pct)}%</div></div>`; }).join('');
    return `<div class="rx-card"><div class="rx-h">${q.def.icon} ${esc(q.def.label)} <span class="sub">${int(go.n)} resp.</span></div>${lines}</div>`;
  }).join('');
  return `<div class="rx-legend"><span class="rx-key"><i class="rx-k-fill"></i>quem tem essa objeção</span><span class="rx-key"><i class="rx-k-avg"></i>média ${baseLbl}</span></div><div class="rx-grid">${cards||'<div class="sub">Sem respostas suficientes.</div>'}</div>`;
}
function bucketCount(rows,col){ const c=new Array(PBK.length).fill(0); for(const r of rows){ if(r[col]>=0) c[r[col]]++; } return c; }
// linhas abertas (raio-x) por tabela+público; o clique acha o conjunto e o render certos na hora (a mesma
// tabela de Objeções troca de público)
const pfOpen = { qlf:new Set(), buy:new Set(), pbuy:new Set(), apice:new Set() };
function bindToggle(tbodySel,set,rerender){
  const tb=document.querySelector(tbodySel); if(!tb) return; tb._pfSet=set; tb._pfRender=rerender;
  if(tb.dataset.bound) return; tb.dataset.bound='1';
  tb.addEventListener('click',e=>{ const tr=e.target.closest('tr.pf-row'); if(!tr) return; const k=tr.dataset.k, s=tb._pfSet; s.has(k)?s.delete(k):s.add(k); tb._pfRender(); });
}
// públicos: de onde vêm as respostas e a coluna da objeção/texto em cada linha
const AUD = {
  qlf:  {off:PL_OFF, tcol:PL_T, bcol:1, who:'qualificadas', base:'das qualificadas do período'},
  buy:  {off:PB_OFF, tcol:PB_T, bcol:2, who:'compradoras', base:'das compradoras do período', apice:true},
  apice:{off:PA_OFF, tcol:PA_T, bcol:1, who:'participantes do Ápice', base:'das participantes do Ápice do período'}
};
const apSize = rows => { const ppl=new Set(), ap=new Set(); for(const r of rows){ ppl.add(r[5]); if(r[4]===1) ap.add(r[5]); } return {ppl:ppl.size, ap:ap.size}; };
// tabela: % de cada objeção + (compradoras: quantas viraram Ápice) + o que elas têm em comum; raio-x ao clicar
function audObjTable(tableSel,cfg,rows,openSet,rerender){
  const thead=document.querySelector(tableSel+' thead'), tbody=document.querySelector(tableSel+' tbody'), n=rows.length;
  if(!n){ thead.innerHTML=''; tbody.innerHTML=`<tr><td class="sub" style="text-align:left">Nenhuma ${cfg.who.replace(/s( |$)/,'$1')} no período selecionado.</td></tr>`; bindToggle(tableSel+' tbody',openSet,rerender); return; }
  const base=pfDist(rows,cfg.off), cnt=bucketCount(rows,cfg.bcol), ncol=cfg.apice?4:3;
  thead.innerHTML=`<tr><th class="pf-name">Objeção (principal desafio)</th><th>% das ${cfg.who}</th>${cfg.apice?'<th>Viraram Ápice 👑</th>':''}<th class="pf-traits">O que elas têm em comum</th></tr>`;
  const list=PBK.map((k,i)=>({k,i,c:cnt[i],p:cnt[i]/n*100})).filter(r=>r.c>0).sort((a,b)=>b.c-a.c);
  tbody.innerHTML=list.map(r=>{
    const grp=rows.filter(x=>x[cfg.bcol]===r.i), open=openSet.has(String(r.i));
    let apCell='';
    if(cfg.apice){ const s=apSize(grp);
      apCell=`<td data-l="Viraram Ápice">${s.ap?`<span class="ap-badge">👑 ${int(s.ap)}</span> <span class="sub">${pct(s.ap/s.ppl*100)} delas</span>`:'<span class="sub">0</span>'}</td>`; }
    const tr=`<tr class="pf-row${open?' open':''}" data-k="${r.i}"><td class="pf-name"><span class="pf-caret">▸</span><span class="objdot" style="background:${objColor(r.k)}"></span>${objLabel(r.k)}</td>
      <td data-l="% das ${cfg.who}">${shareCell(r.p,r.c,objColor(r.k))}</td>${apCell}
      <td class="pf-traits" data-l="O que elas têm em comum">${traitsCell(pfTraits(grp,cfg.off,base,4),'delas')}</td></tr>`;
    return open ? tr+`<tr class="rx-row"><td colspan="${ncol}">${raioX(grp,cfg.off,base,cfg.base)}</td></tr>` : tr;
  }).join('');
  bindToggle(tableSel+' tbody',openSet,rerender);
}
// estudo do perfil: todas as perguntas do Typeform (as novas existem desde 23/08 -> mostra quantas responderam)
function audGrid(el,cfg,rows,d){
  const n=rows.length; if(!el) return;
  if(!n){ el.innerHTML=''; return; }
  d=d||pfDist(rows,cfg.off);
  el.innerHTML=PQS.map((q,i)=>{ const o=d[i], list=pfList(i,d);
    const cov=(q.def.isNew||o.n<n) ? `<div class="q-cov">${int(o.n)} de ${int(n)} ${cfg.who} responderam${q.def.isNew?' (pergunta nova no Typeform)':''}${q.multi?' · uma resposta pode citar mais de um tema':''}</div>` : '';
    return `<div class="card"><div class="chart-title">${q.def.icon} ${esc(q.def.label)}${q.def.isNew?'<span class="q-new">novo</span>':''}</div>${cov}<div class="objlist">${list.length?bars(list,q.def.color):'<div class="sub">Sem respostas.</div>'}</div></div>`;
  }).join('');
}
// "micro" das objeções: o que o público escreveu (repetições + exemplos), por objeção
function audVoices(el,cfg,rows){
  if(!el) return;
  const T=arr(PF.T), byB=PBK.map(()=>new Map());
  for(const r of rows){ const t=r[cfg.tcol]; if(t==null||t<0) continue; const m=byB[r[cfg.bcol]]; m.set(t,(m.get(t)||0)+1); }
  const blocks=[];
  PBK.forEach((k,i)=>{ const m=byB[i]; if(!m.size) return; let total=0; m.forEach(v=>{ total+=v; });
    const terms=[...m.entries()].filter(e=>e[1]>=2).sort((a,b)=>b[1]-a[1]).slice(0,14);
    const ex=[...m.keys()].map(t=>T[t]).filter(s=>s && s.length>=25).sort((a,b)=>b.length-a.length).slice(0,8);
    blocks.push({k,total,distinct:m.size,terms,ex}); });
  blocks.sort((a,b)=>b.total-a.total);
  if(!blocks.length){ el.innerHTML=`<div class="sub">Sem relatos de ${cfg.who} no período selecionado.</div>`; return; }
  el.innerHTML=blocks.map((o,i)=>{
    const terms=o.terms.map(([t,n])=>`<span class="termchip">${esc(T[t])} <b>×${n}</b></span>`).join('');
    const ex=o.ex.map(q=>`<li>“${esc(q)}”</li>`).join('');
    return `<details class="voice"${i===0?' open':''}>
      <summary><span class="objdot" style="background:${objColor(o.k)}"></span>${objLabel(o.k)} <span class="sub">${int(o.total)} ${cfg.who} · ${int(o.distinct)} relatos distintos</span></summary>
      ${terms?`<div class="vblock"><div class="vlbl">Mais citados</div><div class="chips">${terms}</div></div>`:''}
      ${ex?`<div class="vblock"><div class="vlbl">Exemplos (na voz delas)</div><ul class="quotes">${ex}</ul></div>`:''}
    </details>`;
  }).join('');
}
// depoimentos (frases completas, sem repetir); sortCol = coluna de data p/ mais recentes primeiro
const quoteOk = s => s && s.length>=22 && new Set(s.toLowerCase().replace(/\s/g,'')).size>4;
function audQuotes(el,rows,tcol,sortCol,max){
  if(!el) return;
  const T=arr(PF.T), seen=new Set(), qs=[];
  const list=sortCol==null?rows:rows.slice().sort((a,b)=>b[sortCol]-a[sortCol]);
  for(const r of list){ const t=r[tcol]; if(t==null||t<0||seen.has(t)||!quoteOk(T[t])) continue; seen.add(t); qs.push(T[t]); if(qs.length>=(max||12)) break; }
  el.innerHTML = qs.length ? `<ul class="quotes">${qs.map(q=>`<li>“${esc(q)}”</li>`).join('')}</ul>` : '<div class="sub">Sem depoimentos.</div>';
}

// ===================== objections page (escolhe o público: qualificadas OU compradoras) =====================
function renderObjections(){
  const aud=(state.objAud==='buy')?'buy':'qlf', cfg=AUD[aud];
  const L=pfRows(PF.L,state.start,state.end), B=pfRows(PF.B,state.start,state.end), rows=aud==='buy'?B:L;
  const vendas=sumDaily(state.start,state.end).sales, per=`${state.start.split('-').reverse().join('/')} → ${state.end.split('-').reverse().join('/')}`;
  document.getElementById('audQlfN').textContent=int(L.length);
  document.getElementById('audBuyN').textContent=int(B.length);
  document.querySelectorAll('#objAud button').forEach(b=>{ const on=b.dataset.aud===aud; b.classList.toggle('active',on); b.setAttribute('aria-selected',on?'true':'false'); });
  document.getElementById('objNote').innerHTML = aud==='buy'
    ? `Mostrando <b>só as compradoras</b> do período (${per}): <b>${int(B.length)}</b> compras casadas por e-mail com o Typeform, de ${int(vendas)} vendas. Objeção = categoria por palavra-chave da resposta livre "principal desafio". Dados de ${PF.generatedAtBR||'—'} (atualiza a cada 3h).`
    : `Mostrando <b>só as leads qualificadas</b> que entraram no período (${per}): <b>${int(L.length)}</b> qualificadas (fatura a partir de R$ 100 mil e não é CLT). Objeção = categoria por palavra-chave da resposta livre "principal desafio". Dados de ${PF.generatedAtBR||'—'} (atualiza a cada 3h).`;
  document.getElementById('objTblTitle').textContent=`🧬 Objeções das ${cfg.who}: quanto pesa cada uma e o que elas têm em comum`;
  document.getElementById('objHelp').innerHTML=`<b>O que elas têm em comum</b> = as respostas do Typeform que mais aparecem entre as ${cfg.who} com aquela objeção. <span class="trait up" style="font-size:11px;padding:1px 7px"><i>↑ 1,4x</i></span> = acima da média das ${cfg.who} do período.${cfg.apice?' <b>Viraram Ápice</b> = quantas dessas compradoras estão na planilha de participantes do Ápice.':''} <b>Clique numa linha</b> para abrir o raio-x com todas as perguntas.`;
  audObjTable('#objTable',cfg,rows,pfOpen[aud],renderObjections);
  document.getElementById('objGridTitle').textContent=`📋 Estudo do perfil das ${cfg.who} do período`;
  document.getElementById('objGridNote').textContent=`Todas as perguntas do Typeform, só das ${cfg.who} (${int(rows.length)}). As marcadas como novo só existem desde 23/08.`;
  audGrid(document.getElementById('objGrid'),cfg,rows);
  document.getElementById('objVoiceTitle').textContent=`O que as ${cfg.who} relatam — na voz delas`;
  document.getElementById('objVoiceNote').textContent=`Respostas reais do campo "principal desafio" das ${cfg.who} do período (anonimizado — sem nome/e-mail/telefone). Clique numa objeção para expandir.`;
  audVoices(document.getElementById('objVoices'),cfg,rows);
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

// ===================== CONSOLIDADO (aba principal: Cocktail + Ápice num lugar só) =====================
// Topo = vagas por Cocktail (cada taça = 1 vaga; dourada = comprou o Ápice; contorno = convidada) + resumo.
// Embaixo = report: competência, lotação por evento, perfil de faturamento, vendas/dia, funil e gráfico por dia.
// Tudo segue o seletor de período. Eventos: data do Cocktail dentro do período; se o período vai até hoje,
// entram também os próximos Cocktails (abertos), porque as vagas deles já estão sendo vendidas.
const CX = { view:'d', cols:7, seller:'', withToday:true, metric:'spend', brk:'none' };
const CX_TODAY = AP_TODAY;
const WD = ['dom','seg','ter','qua','qui','sex','sáb'];
const cxDM = s => `${s.slice(8,10)}/${s.slice(5,7)}`;
const cxDMes = s => { const d=parseD(s); return `${d.getDate()} ${MES[d.getMonth()]}`; };
const m0 = v => 'R$ '+nf0.format(Math.round(v||0));
const n1 = v => (v||0).toLocaleString('pt-BR',{maximumFractionDigits:1});
const CX_AP = (()=>{ const m=new Map(); for(const s of AP_SALES){ if(!s.d) continue; const o=m.get(s.d)||{n:0,v:0}; o.n++; o.v+=s.v; m.set(s.d,o); } return m; })();
function cxEvents(){ const open=state.end>=DMAX;
  return arr(DATAS.events).filter(e=>e.dateKey>=state.start && (open || e.dateKey<=state.end)).slice().sort((a,b)=>a.dateKey<b.dateKey?-1:1); }
function bizDays(a,b){ let n=0; for(let d=addDays(parseD(a),1), e=parseD(b); d<=e; d=addDays(d,1)){ const w=d.getDay(); if(w>0 && w<6) n++; } return n; }   // dias úteis depois de a até b
const CX_GLASS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><symbol id="cxGlass" viewBox="0 0 16 18"><path d="M1.2 1.2h13.6L8 9.6z"/><rect x="7.2" y="9.4" width="1.6" height="5.6" rx=".5"/><rect x="3.8" y="15" width="8.4" height="1.8" rx=".9"/></symbol></defs></svg>';
const cxG = k => `<svg class="cx-g ${k}" viewBox="0 0 16 18" aria-hidden="true"><use href="#cxGlass"/></svg>`;

// agregado de um intervalo (com vendedora: vendas/receita só dela)
function cxAgg(a,b,seller){ const s=sumDaily(a,b), ap=apSold(a,b); let sales=s.sales, rev=s.revenue;
  if(seller){ sales=0; rev=0; for(const r of arr(D.sellers)){ if(r.seller===seller && r.date>=a && r.date<=b){ sales+=r.sales; rev+=r.revenue; } } }
  return {spend:s.spend,leads:s.leads,qlf:s.qlf,sales,rev,apn:ap.n,apv:ap.v,days:Math.max(1,dayspan(a,b))}; }
// métricas (add = somável; den = denominador da razão -> "—" quando zero; sel = muda com a vendedora; noSel = sem sentido com vendedora)
const CX_M = [
  {k:'spend', l:'Investimento', f:m0, add:true, dir:0},
  {k:'leads', l:'Leads', f:int, add:true, dir:1},
  {k:'qlf', l:'Leads qualificadas', f:int, add:true, dir:1},
  {k:'txq', l:'% qualificadas', f:pct, v:o=>safe(o.qlf,o.leads)*100, den:o=>o.leads, dir:1},
  {k:'cpl', l:'CPL', f:m0, v:o=>safe(o.spend,o.leads), den:o=>o.leads, dir:-1},
  {k:'cplq', l:'CPL qualificado', f:m0, v:o=>safe(o.spend,o.qlf), den:o=>o.qlf, dir:-1},
  {k:'sales', l:'Vendas do Cocktail', f:int, add:true, dir:1, sel:true},
  {k:'rev', l:'Receita do Cocktail', f:m0, add:true, dir:1, sel:true},
  {k:'ticket', l:'Ticket médio', f:m0, v:o=>safe(o.rev,o.sales), den:o=>o.sales, dir:0, sel:true},
  {k:'cac', l:'CAC (custo por venda)', f:m0, v:o=>safe(o.spend,o.sales), den:o=>o.sales, dir:-1, noSel:true},
  {k:'roas', l:'ROAS do Cocktail', f:fmtRoas, v:o=>safe(o.rev,o.spend), den:o=>o.spend, dir:1, noSel:true},
  {k:'l2v', l:'Lead → venda', f:pct, v:o=>safe(o.sales,o.leads)*100, den:o=>o.leads, dir:1, noSel:true},
  {k:'q2v', l:'Qualificada → venda', f:pct, v:o=>safe(o.sales,o.qlf)*100, den:o=>o.qlf, dir:1, noSel:true},
  {k:'apn', l:'Vendas do Ápice', f:int, add:true, dir:1, ap:true},
  {k:'apv', l:'Receita do Ápice', f:m0, add:true, dir:1, ap:true},
  {k:'roasap', l:'ROAS com Ápice', f:fmtRoas, v:o=>safe(o.rev+o.apv,o.spend), den:o=>o.spend, dir:1, noSel:true},
];
const cxM = k => CX_M.find(m=>m.k===k);
const cxVal = (m,o) => m.v ? m.v(o) : o[m.k];
const cxCrown = m => (m.ap||m.k==='roasap') ? '👑 ' : '';
function cxFmt(m,o,seller){ if(seller && m.noSel) return '—'; if(m.den && !m.den(o)) return '—'; return m.f(cxVal(m,o)); }
function cxPerDay(m,o,seller){ if(seller && m.noSel) return '—'; if(!m.add) return cxFmt(m,o,seller); const v=o[m.k]/o.days; return m.f===int ? n1(v) : m.f(v); }

function renderConsolidado(){
  renderCxHero(); renderCxComp(); renderCxLot(); renderCxFat(); renderCxSales(); renderCxFun(); renderCxDay();
}

// ---- topo: pessoas por Cocktail ----
function renderCxHero(){
  const el=document.getElementById('cxHero'); if(!el) return;
  const evs=cxEvents(), meta=DATAS.meta||30;
  let seats=0,conv=0,rev=0,apN=0,apV=0,donePaid=0,doneAp=0;
  for(const e of evs){ const c=e.conv||0, a=CX_AP.get(e.dateKey)||{n:0,v:0};
    seats+=e.vendas; conv+=c; rev+=e.revenue; apN+=a.n; apV+=a.v;
    if(e.dateKey<CX_TODAY){ donePaid+=e.vendas-c; doneAp+=a.n; } }
  const paid=seats-conv, cur=sumDaily(state.start,state.end);
  const nextEv=evs.find(e=>e.dateKey>=CX_TODAY);
  const range=evs.length ? `${evs.length} ${evs.length===1?'Cocktail':'Cocktails'} · ${cxDM(evs[0].dateKey)} → ${cxDM(evs[evs.length-1].dateKey)}${state.end>=DMAX&&nextEv?' · inclui os próximos':''}` : 'Nenhum Cocktail com data no período';
  const cols=evs.map(e=>{ const c=e.conv||0, p=e.vendas-c, a=CX_AP.get(e.dateKey)||{n:0,v:0}, ak=Math.min(a.n,p);
    const cells=[]; for(let i=0;i<p-ak;i++) cells.push('p'); for(let i=0;i<ak;i++) cells.push('a'); for(let i=0;i<c;i++) cells.push('c');
    while(cells.length<meta) cells.push('e');
    const st=e.dateKey<CX_TODAY?['realizado','']:(e.dateKey===CX_TODAY?['hoje','hoje']:['aberto','']);
    const tip=`${e.ev}: ${e.vendas} de ${meta} vagas · ${p} pagas${c?` · ${c} convidada${c>1?'s':''}`:''} · Cocktail ${money(e.revenue)}${a.n?` · ${a.n} compraram o Ápice (${money(a.v)})`:''}`;
    return `<div class="cx-ev${nextEv&&e.dateKey===nextEv.dateKey?' cx-next':''}" title="${esc(tip)}">
      <div class="cx-ev-n">${int(e.vendas)}${a.n?`<span class="cx-ev-ap">👑+${int(a.n)}</span>`:''}</div>
      <div class="cx-seats">${cells.map(cxG).join('')}</div>
      <div class="cx-ev-rev">${moneyK(e.revenue)}</div>
      <div class="cx-ev-dt">${cxDMes(e.dateKey)}</div>
      <div class="cx-ev-st ${st[1]}">${st[0]}</div></div>`; }).join('');
  el.innerHTML = CX_GLASS + `
  <div class="cx-left">
    <div class="cx-brand"><b>Cocktail</b> Cardi Nigro <span>+ Ápice</span></div>
    <div class="cx-big">${int(seats)} <span>pessoas</span></div>
    <div class="cx-lead"><b>${int(paid)}</b> vendas pagas e <b>${moneyK(rev+apV)}</b> em Cocktail + Ápice</div>
    <div class="cx-when">${range}</div>
    <div class="cx-rows">
      <div class="cx-row"><div class="cx-ico">${cxG('p')}</div><div><div class="cx-name">Cocktail</div><div class="cx-sub">vendas pagas · ${moneyK(rev)}</div></div><div class="cx-num">${int(paid)}<small>pessoas</small></div></div>
      <div class="cx-row"><div class="cx-ico">${cxG('c')}</div><div><div class="cx-name">Convidadas</div><div class="cx-sub">ocupam vaga, sem pagamento</div></div><div class="cx-num">${int(conv)}<small>pessoas</small></div></div>
      <div class="cx-div"></div>
      <div class="cx-row"><div class="cx-ico">${cxG('a')}</div><div><div class="cx-name">Upsell para o Ápice</div><div class="cx-sub">${moneyK(apV)} em vendas do Ápice</div></div><div class="cx-num">${int(apN)}<small>pessoas</small></div></div>
    </div>
    <div class="cx-foot"><b>${pct(safe(cur.sales,cur.leads)*100)}</b> dos ${int(cur.leads)} leads do período viraram venda${donePaid?`<br><b>${pct(safe(doneAp,donePaid)*100)}</b> das pagantes dos Cocktails já realizados compraram o Ápice`:''}</div>
  </div>
  <div class="cx-right">
    <div class="cx-top">
      <div class="cx-legend-h"><span>${cxG('p')} Vaga paga</span><span>${cxG('a')} Comprou o Ápice</span><span>${cxG('c')} Convidada</span><span>${cxG('e')} Vaga livre</span></div>
      <div class="cx-upd">⏱ ${esc(D.generatedAtBR)} · atualiza a cada 3h</div>
    </div>
    <div class="cx-pict">${cols || '<div class="cx-empty">Nenhum Cocktail com data no período selecionado.</div>'}</div>
  </div>`;
}

// ---- competência: últimos 7 dias do período + total ----
function renderCxComp(){
  const el=document.getElementById('cxComp'); if(!el) return;
  const days=[]; for(let i=6;i>=0;i--){ const d=fmtD(addDays(parseD(state.end),-i)); if(d>=state.start) days.push(d); }
  const cols=days.map(d=>({d,o:cxAgg(d,d)})), tot=cxAgg(state.start,state.end);
  const ms=['spend','leads','qlf','cplq','sales','rev','roas','apn','roasap'].map(cxM);
  el.innerHTML=`<thead><tr class="cx-band"><th></th><th colspan="${cols.length}">Últimos ${cols.length} dias do período</th><th colspan="2" class="cx-tot">Período</th></tr>
    <tr><th>Métrica</th>${cols.map(c=>`<th class="${c.d===CX_TODAY?'cx-today':''}">${cxDM(c.d)}<small>${c.d===CX_TODAY?'hoje':WD[parseD(c.d).getDay()]}</small></th>`).join('')}
    <th class="cx-tot">Total<small>${cxDM(state.start)} → ${cxDM(state.end)}</small></th><th class="cx-tot">Média/dia<small>${int(tot.days)} dias</small></th></tr></thead>
    <tbody>${ms.map(m=>`<tr class="${m.ap?'cx-aprow':''}"><td>${cxCrown(m)}${m.l}</td>${cols.map(c=>`<td>${cxFmt(m,c.o)}</td>`).join('')}<td class="cx-tot">${cxFmt(m,tot)}</td><td class="cx-tot">${cxPerDay(m,tot)}</td></tr>`).join('')}</tbody>`;
}

// ---- lotação por evento ----
function renderCxLot(){
  const el=document.getElementById('cxLot'); if(!el) return;
  const evs=cxEvents(), meta=DATAS.meta||30;
  if(!evs.length){ el.innerHTML='<tbody><tr><td class="cx-empty">Nenhum Cocktail com data no período selecionado.</td></tr></tbody>'; return; }
  const X=evs.map(e=>{ const c=e.conv||0, a=CX_AP.get(e.dateKey)||{n:0,v:0}, falta=Math.max(0,meta-e.vendas);
    const st=e.dateKey<CX_TODAY?'done':(e.dateKey===CX_TODAY?'today':'open');
    return {e,c,p:e.vendas-c,a,falta,st,bd:st==='open'?bizDays(CX_TODAY,e.dateKey):0}; });
  const T=X.reduce((t,x)=>{ t.occ+=x.e.vendas; t.p+=x.p; t.c+=x.c; t.falta+=x.falta; t.rev+=x.e.revenue; if(x.st==='done'){ t.apn+=x.a.n; t.apv+=x.a.v; } return t; },{occ:0,p:0,c:0,falta:0,rev:0,apn:0,apv:0});
  const cap=meta*X.length;
  const chip=x=>x.st==='done'?'<span class="cx-chip ok">realizado</span>':(x.st==='today'?'<span class="cx-chip today">hoje</span>':'<span class="cx-chip open">aberto</span>');
  const occ=(n,c)=>{ const p=safe(n,c)*100, col=p>=100?'var(--green)':(p>=66?'#e0913a':'var(--blue2)'); return `<div class="cx-occ"><span>${pct(p)}</span><i><b style="width:${Math.min(p,100).toFixed(1)}%;background:${col}"></b></i></div>`; };
  const ritmo=x=>x.falta===0?'<span class="cx-ok">lotado ✅</span>':(x.st==='done'?'—':(x.st==='today'?`${int(x.falta)} hoje`:(x.bd>0?`${n1(x.falta/x.bd)}/dia`:'—')));
  const row=(lbl,f,tot,cls)=>`<tr class="${cls||''}"><td>${lbl}</td>${X.map(x=>`<td>${f(x)}</td>`).join('')}<td class="cx-tot">${tot}</td></tr>`;
  el.innerHTML=`<thead><tr class="cx-band"><th></th><th colspan="${X.length}">Cocktails no período</th><th class="cx-tot">Total</th></tr>
    <tr><th>Evento</th>${X.map(x=>`<th class="${x.st==='today'?'cx-today':''}">${cxDM(x.e.dateKey)}<small>${WD[parseD(x.e.dateKey).getDay()]}</small></th>`).join('')}<th class="cx-tot">${X.length} ${X.length===1?'evento':'eventos'}</th></tr></thead><tbody>
    ${row('Status',chip,'')}
    ${row('Capacidade',()=>int(meta),int(cap))}
    ${row('<b>Vagas ocupadas</b>',x=>`<b>${int(x.e.vendas)}</b>`,`<b>${int(T.occ)}</b>`)}
    ${row('pagas',x=>int(x.p),int(T.p),'cx-subrow')}
    ${row('convidadas',x=>x.c?int(x.c):'—',T.c?int(T.c):'—','cx-subrow')}
    ${row('Ocupação',x=>occ(x.e.vendas,meta),occ(T.occ,cap))}
    ${row('Faltam',x=>x.falta?int(x.falta):'<span class="cx-ok">0</span>',int(T.falta))}
    ${row('Dias úteis até o evento',x=>x.st==='open'?int(x.bd):(x.st==='today'?'hoje':'—'),'')}
    ${row('Ritmo para lotar <span class="sub">(vagas/dia útil)</span>',ritmo,'')}
    ${row('Receita do Cocktail',x=>m0(x.e.revenue),m0(T.rev))}
    ${row('👑 Upsell Ápice',x=>x.st==='done'?(x.a.n?`<b class="cx-gold">${int(x.a.n)}</b> · ${moneyK(x.a.v)}`:'0'):'—',T.apn?`<b class="cx-gold">${int(T.apn)}</b> · ${moneyK(T.apv)}`:'0','cx-aprow')}
  </tbody>`;
}

// ---- perfil de faturamento das compradoras (pagas) por evento ----
const CX_FAT=[['lt100','Abaixo de R$ 100 mil'],['f100','R$ 100 a 300 mil'],['f200old','Acima de R$ 200 mil','opção antiga do formulário'],['f300','R$ 300 a 500 mil'],['f500','R$ 500 mil a 1 milhão'],['f1m','R$ 1 milhão ou mais'],['none','Sem formulário','compradora sem resposta de faturamento']];
function renderCxFat(){
  const el=document.getElementById('cxFat'); if(!el) return;
  const evs=cxEvents().filter(e=>e.fat && Object.keys(e.fat).length);
  if(!evs.length){ el.innerHTML='<tbody><tr><td class="cx-empty">Sem compradoras com data de Cocktail no período.</td></tr></tbody>'; return; }
  const n=(e,k)=>(e.fat&&e.fat[k])||0, tot=e=>CX_FAT.reduce((s,f)=>s+n(e,f[0]),0);
  const rows=CX_FAT.filter(f=>evs.some(e=>n(e,f[0])>0));
  const T={}; for(const f of rows) T[f[0]]=evs.reduce((s,e)=>s+n(e,f[0]),0); const TT=evs.reduce((s,e)=>s+tot(e),0);
  const cell=(v,t,cls)=>{ if(!v) return `<td class="cx-heat ${cls||''}">—</td>`; const p=safe(v,t); return `<td class="cx-heat ${cls||''}" style="background:rgba(15,91,168,${(0.06+p*0.55).toFixed(3)});${p>=0.45?'color:#fff;':''}">${int(v)} <small>· ${Math.round(p*100)}%</small></td>`; };
  el.innerHTML=`<thead><tr class="cx-band"><th></th><th colspan="${evs.length}">Compradoras por Cocktail</th><th class="cx-tot">Total</th></tr>
    <tr><th>Faturamento mensal</th>${evs.map(e=>`<th>${cxDM(e.dateKey)}<small>${WD[parseD(e.dateKey).getDay()]}</small></th>`).join('')}<th class="cx-tot">${evs.length} ${evs.length===1?'evento':'eventos'}</th></tr></thead>
    <tbody>${rows.map(f=>`<tr><td>${f[1]}${f[2]?`<small class="cx-note">${f[2]}</small>`:''}</td>${evs.map(e=>cell(n(e,f[0]),tot(e))).join('')}${cell(T[f[0]],TT,'cx-tot')}</tr>`).join('')}
    <tr class="cx-sumrow"><td>Total de compradoras</td>${evs.map(e=>`<td>${int(tot(e))}</td>`).join('')}<td class="cx-tot">${int(TT)}</td></tr></tbody>`;
}

// ---- gráfico: vendas por dia (Cocktail + Ápice empilhado) ----
function renderCxSales(){
  const el=document.getElementById('cxSales'); if(!el) return;
  const data=seriesDaily(state.start,state.end);
  const W=Math.max(320,el.clientWidth||1000), H=230, pad={l:30,r:8,t:20,b:26}, iw=W-pad.l-pad.r, ih=H-pad.t-pad.b;
  const rows=data.map(d=>({d:d.date,s:d.sales,r:d.revenue,a:(CX_AP.get(d.date)||{n:0,v:0})}));
  const max=Math.max(1,...rows.map(x=>x.s+x.a.n)), n=rows.length, gw=iw/Math.max(n,1), bw=Math.max(2,Math.min(gw*0.66,28));
  let g='', bars='', lab='', xl='', hz='';
  for(let k=0;k<=2;k++){ const v=Math.round(max*k/2), y=pad.t+ih-v/max*ih; g+=`<line x1="${pad.l}" y1="${y}" x2="${W-pad.r}" y2="${y}" stroke="#eef2f6"/><text x="${pad.l-6}" y="${y+3}" font-size="10" text-anchor="end" fill="#7b8794">${v}</text>`; }
  rows.forEach((x,i)=>{ const cx=pad.l+i*gw+gw/2, hs=x.s/max*ih, ha=x.a.n/max*ih, y0=pad.t+ih, gap=(hs>0&&ha>0)?2:0;
    if(hs>0) bars+=`<rect x="${cx-bw/2}" y="${y0-hs}" width="${bw}" height="${hs}" rx="3" fill="var(--navy)"/>`;
    if(ha>0) bars+=`<rect x="${cx-bw/2}" y="${y0-hs-ha-gap}" width="${bw}" height="${ha}" rx="3" fill="#e9b03b"/>`;
    const t=x.s+x.a.n; if(t>0 && n<=62) lab+=`<text x="${cx}" y="${y0-hs-ha-gap-5}" font-size="10.5" font-weight="700" text-anchor="middle" fill="#41505e">${t}</text>`;
    if(n<=16 || i%Math.ceil(n/14)===0) xl+=`<text x="${cx}" y="${H-8}" font-size="10" text-anchor="middle" fill="#7b8794">${cxDM(x.d)}</text>`;
    hz+=`<rect class="hz" x="${pad.l+i*gw}" y="${pad.t}" width="${gw}" height="${ih}" fill="transparent" data-d="${x.d}" data-s="${x.s}" data-r="${x.r}" data-an="${x.a.n}" data-av="${x.a.v}"/>`; });
  el.innerHTML=`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${g}${bars}${lab}${xl}${hz}</svg>`;
  attachTip('cxSales', ds=>`<div class="tt-d">${ds.d.split('-').reverse().join('/')} · ${WD[parseD(ds.d).getDay()]}</div>
    <div class="tt-r"><span class="tdot" style="background:var(--navy)"></span>Vendas do Cocktail<b>${int(+ds.s)}</b></div>
    <div class="tt-r"><span class="sub">receita ${money(+ds.r)}</span></div>
    ${+ds.an?`<div class="tt-r"><span class="tdot" style="background:#e9b03b"></span>Vendas do Ápice<b>${int(+ds.an)}</b></div><div class="tt-r"><span class="sub">${money(+ds.av)}</span></div>`:''}`);
}

// ---- funil por dia/semana/mês (com vendedora) ----
function cxBuckets(){
  let end=state.end; if(!CX.withToday && end>=CX_TODAY) end=fmtD(addDays(parseD(CX_TODAY),-1));
  const out=[]; if(end<state.start) return {b:out,end};
  if(CX.view==='d'){ for(let i=0;i<CX.cols;i++){ const d=fmtD(addDays(parseD(end),-i)); if(d<state.start) break; out.unshift({a:d,b:d,lbl:cxDM(d),sub:d===CX_TODAY?'hoje':WD[parseD(d).getDay()]}); } }
  else if(CX.view==='w'){ let e=parseD(end); for(let i=0;i<CX.cols;i++){ const s=addDays(e,-((e.getDay()+6)%7)); let a=fmtD(s); const b=fmtD(e); if(b<state.start) break; if(a<state.start) a=state.start; out.unshift({a,b,lbl:`${cxDM(a)}–${cxDM(b)}`,sub:`${dayspan(a,b)} dias`}); e=addDays(s,-1); } }
  else { let e=parseD(end); for(let i=0;i<CX.cols;i++){ const s=new Date(e.getFullYear(),e.getMonth(),1); let a=fmtD(s); const b=fmtD(e); if(b<state.start) break; if(a<state.start) a=state.start; out.unshift({a,b,lbl:monthName(a,true),sub:`${dayspan(a,b)} dias`}); e=addDays(s,-1); } }
  return {b:out,end};
}
function renderCxFun(){
  const el=document.getElementById('cxFun'); if(!el) return;
  const sel=document.getElementById('cxSeller');
  if(sel && sel.options.length<=1){ const tot=new Map(); for(const r of arr(D.sellers)){ tot.set(r.seller,(tot.get(r.seller)||0)+r.sales); }
    [...tot.entries()].sort((a,b)=>b[1]-a[1]).forEach(([s])=>{ const o=document.createElement('option'); o.value=s; o.textContent=pretty(s); sel.appendChild(o); }); }
  const {b:B,end}=cxBuckets(), sl=CX.seller;
  if(!B.length){ el.innerHTML='<tbody><tr><td class="cx-empty">Sem dias no período com esse filtro.</td></tr></tbody>'; document.getElementById('cxFunNote').innerHTML=''; return; }
  const cols=B.map(x=>({...x,o:cxAgg(x.a,x.b,sl)})), tot=cxAgg(state.start,end,sl), last=cols[cols.length-1];
  const unit=CX.view==='d'?'último dia':(CX.view==='w'?'última semana':'último mês');
  const nc=cols.length, span=CX.view==='d'?(nc===1?'Último dia':`Últimos ${nc} dias`):(CX.view==='w'?(nc===1?'Última semana':`Últimas ${nc} semanas`):(nc===1?'Último mês':`Últimos ${nc} meses`));
  const vs=m=>{ if(sl && m.noSel) return '—'; if(m.den && (!m.den(last.o) || !m.den(tot))) return '—';
    const a=m.add?last.o[m.k]/last.o.days:cxVal(m,last.o), b=m.add?tot[m.k]/tot.days:cxVal(m,tot); if(!b) return '—';
    const ch=(a-b)/b*100, cls=(Math.abs(ch)<0.5||m.dir===0)?'flat':((ch>0)===(m.dir>0)?'up':'down');
    return `<span class="cx-vs ${cls}">${ch>0?'+':''}${Math.round(ch)}%</span>`; };
  el.innerHTML=`<thead><tr class="cx-band"><th></th><th colspan="${cols.length}">${span}${sl?` · vendedora: ${esc(pretty(sl))}`:''}</th><th class="cx-vsh"></th><th colspan="2" class="cx-tot">Período</th></tr>
    <tr><th>Métrica <small>clique p/ ver o gráfico</small></th>${cols.map(c=>`<th class="${c.b===CX_TODAY&&CX.view==='d'?'cx-today':''}">${c.lbl}<small>${c.sub}</small></th>`).join('')}
    <th class="cx-vsh">vs. período<small>${unit}</small></th><th class="cx-tot">Total<small>${cxDM(state.start)} → ${cxDM(end)}</small></th><th class="cx-tot">Média/dia<small>${int(tot.days)} dias</small></th></tr></thead>
    <tbody>${CX_M.map(m=>`<tr data-k="${m.k}" class="${CX.metric===m.k?'sel':''} ${m.ap?'cx-aprow':''}"><td>${cxCrown(m)}${m.l}</td>${cols.map(c=>`<td>${cxFmt(m,c.o,sl)}</td>`).join('')}<td class="cx-vsh">${vs(m)}</td><td class="cx-tot">${cxFmt(m,tot,sl)}</td><td class="cx-tot">${cxPerDay(m,tot,sl)}</td></tr>`).join('')}</tbody>`;
  el.querySelectorAll('tbody tr').forEach(tr=>tr.onclick=()=>{ CX.metric=tr.dataset.k; el.querySelectorAll('tbody tr').forEach(x=>x.classList.toggle('sel',x===tr)); renderCxDay();
    const c=document.getElementById('cxDayCard'); if(c && c.getBoundingClientRect().top>window.innerHeight-120) c.scrollIntoView({behavior:'smooth',block:'center'}); });
  document.getElementById('cxFunNote').innerHTML = sl
    ? `Com vendedora selecionada, só <b>vendas, receita e ticket</b> mudam — investimento, leads e Ápice continuam da conta toda; ROAS, CAC e conversões ficam "—".`
    : `Clique numa linha para ver a métrica dia a dia no gráfico abaixo. "vs. período" compara o ${unit} com a média do período${CX.withToday?' (hoje ainda está rodando — desmarque "Com o dia de hoje" para comparar dias fechados)':''}.`;
}

// ---- gráfico: a métrica escolhida no funil, por dia (com quebra por campanha/conjunto/criativo) ----
const CX_BRK_COL=['#0f5ba8','#4aa3e8','#e9a23b','#2e9e3f','#9b59b6','#b0bac4'];
const CX_GRAIN_K={spend:'spend',leads:'leads',qlf:'qlf',sales:'sales',rev:'revenue'};
function cxGroupLabel(r,brk){ if(brk==='camp'){ const p=String(r.campaign).split('|').map(s=>s.trim()).filter(Boolean); return pretty(p.length?p[p.length-1]:r.campaign); } return pretty(brk==='set'?r.adset:r.ad); }
function renderCxDay(){
  const el=document.getElementById('cxDay'); if(!el) return;
  const m=cxM(CX.metric)||CX_M[0], sl=CX.seller, gk=CX_GRAIN_K[m.k];
  const canBrk=!!gk && !(sl && m.sel), brk=canBrk?CX.brk:'none';
  document.getElementById('cxDayTitle').innerHTML=`${cxCrown(m)}${m.l} por dia${sl&&m.sel?` <span class="sub">· ${esc(pretty(sl))}</span>`:''}`;
  document.querySelectorAll('#cxBrk button').forEach(b=>{ b.disabled=!canBrk && b.dataset.b!=='none'; b.classList.toggle('on',b.dataset.b===brk); });
  const days=seriesDaily(state.start,state.end).map(r=>r.date);
  const W=Math.max(320,el.clientWidth||1000), H=250, pad={l:58,r:10,t:22,b:26}, iw=W-pad.l-pad.r, ih=H-pad.t-pad.b;
  let series=[], groups=[];
  if(brk==='none'){
    series=days.map(d=>{ const o=cxAgg(d,d,sl); const blank=(sl&&m.noSel)||(m.den&&!m.den(o)); return {d,parts:[blank?0:cxVal(m,o)],blank}; });
  } else {
    const tot=new Map(), byDay=new Map();
    for(const r of D.grain){ if(r.date<state.start||r.date>state.end) continue; const v=r[gk]||0; if(!v) continue;
      const g=cxGroupLabel(r,brk); tot.set(g,(tot.get(g)||0)+v); let dm=byDay.get(r.date); if(!dm){ dm=new Map(); byDay.set(r.date,dm); } dm.set(g,(dm.get(g)||0)+v); }
    const top=[...tot.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(x=>x[0]);
    groups=top.concat(tot.size>top.length?['Outros']:[]);
    series=days.map(d=>{ const dm=byDay.get(d)||new Map(); const parts=groups.map(()=>0);
      for(const [g,v] of dm){ const i=top.indexOf(g); parts[i>=0?i:groups.length-1]+=v; } return {d,parts}; });
  }
  const totals=series.map(s=>s.parts.reduce((a,b)=>a+b,0)), max=Math.max(0,...totals)||1, n=series.length, gw=iw/Math.max(n,1), bw=Math.max(2,Math.min(gw*0.66,30));
  const fmtAx=v=>m.f===m0?(v>=1000?`R$ ${n1(v/1000)}k`:`R$ ${int(v)}`):(m.f===pct?`${n1(v)}%`:(m.f===fmtRoas?`${n1(v)}x`:n1(v)));
  let g=''; for(let k=0;k<=3;k++){ const v=max*k/3, y=pad.t+ih-v/max*ih; g+=`<line x1="${pad.l}" y1="${y}" x2="${W-pad.r}" y2="${y}" stroke="#eef2f6"/><text x="${pad.l-6}" y="${y+3}" font-size="10" text-anchor="end" fill="#7b8794">${fmtAx(v)}</text>`; }
  const one=(m.ap||m.k==='roasap')?'#e9b03b':'var(--navy)';
  let bars='', lab='', xl='', hz='';
  series.forEach((s,i)=>{ const cx=pad.l+i*gw+gw/2; let y=pad.t+ih;
    s.parts.forEach((v,j)=>{ if(v<=0) return; const h=v/max*ih; y-=h; bars+=`<rect x="${cx-bw/2}" y="${y}" width="${bw}" height="${Math.max(h-(j?1:0),0.5)}" rx="${groups.length?1.5:3}" fill="${groups.length?CX_BRK_COL[j]:one}"/>`; });
    if(n<=24 && totals[i]>0) lab+=`<text x="${cx}" y="${y-5}" font-size="10" font-weight="700" text-anchor="middle" fill="#41505e">${fmtAx(totals[i])}</text>`;
    if(n<=16 || i%Math.ceil(n/14)===0) xl+=`<text x="${cx}" y="${H-8}" font-size="10" text-anchor="middle" fill="#7b8794">${cxDM(s.d)}</text>`;
    hz+=`<rect class="hz" x="${pad.l+i*gw}" y="${pad.t}" width="${gw}" height="${ih}" fill="transparent" data-i="${i}"/>`; });
  el.innerHTML=`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${g}${bars}${lab}${xl}${hz}</svg>`;
  attachTip('cxDay', ds=>{ const s=series[+ds.i], t=totals[+ds.i];
    return `<div class="tt-d">${s.d.split('-').reverse().join('/')} · ${WD[parseD(s.d).getDay()]}</div>
      <div class="tt-r"><span class="tdot" style="background:${groups.length?'#7b8794':one}"></span>${esc(m.l)}<b>${s.blank?'—':m.f(t)}</b></div>
      ${groups.map((gname,j)=>s.parts[j]>0?`<div class="tt-r"><span class="tdot" style="background:${CX_BRK_COL[j]}"></span>${esc(gname.length>38?gname.slice(0,37)+'…':gname)}<b>${m.f(s.parts[j])}</b></div>`:'').join('')}`; });
  document.getElementById('cxDayLegend').innerHTML = groups.length
    ? groups.map((gname,j)=>`<span title="${esc(gname)}"><i style="background:${CX_BRK_COL[j]}"></i>${esc(gname.length>42?gname.slice(0,41)+'…':gname)}</span>`).join('')
    : (canBrk?'':`<span class="sub">${gk?'Com vendedora selecionada não há quebra por campanha (a venda não tem anúncio da vendedora).':'A quebra por campanha, conjunto ou criativo vale para investimento, leads, qualificadas, vendas e receita.'}</span>`);
}
function cxRedrawCharts(){ const pg=document.getElementById('pageConsolidado'); if(pg && !pg.hidden){ try{ renderCxSales(); renderCxDay(); }catch(err){ console.error('Consolidado:',err); } } }

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
  try{ renderConsolidado(); }catch(err){ console.error('Consolidado:',err); }   // aba nova nunca derruba as outras
  renderHealth(cur,prev);
  renderReceita(cur,prev);
  renderApCash();
  renderInvest(cur);
  renderFunnel(cur,prev);
  renderTable();
  try{ renderCreatives(); }catch(err){ console.error('Criativos:',err); }
  renderDaily();
  renderSales();
  renderComercial();
  renderBestAds();
  renderAscensao();
  renderLeadsChart();
  renderSpendChart();
  renderObjections();
  renderTempo();
  renderPerfil();
  renderApiceFin();
  renderApice();
}

// ===================== comercial (vendas por vendedora, period-aware) =====================
function medalOr(n){ return n===1?'🥇':(n===2?'🥈':(n===3?'🥉':n)); }
function renderComercial(){
  const rows0=arr(D.sellers).filter(r=>r.date>=state.start && r.date<=state.end);
  const map=new Map();
  for(const r of rows0){ let o=map.get(r.seller); if(!o){o={seller:r.seller,sales:0,revenue:0,daysSum:0,daysN:0,fat:[0,0,0,0,0,0]};map.set(r.seller,o);}
    o.sales+=r.sales; o.revenue+=r.revenue; o.daysSum+=(r.daysSum||0); o.daysN+=(r.daysN||0);
    const rf=arr(r.fat); for(let i=0;i<6;i++) o.fat[i]+=(rf[i]||0); }
  const all=[...map.values()];
  all.forEach(x=>{ x.avgDays = x.daysN>0 ? x.daysSum/x.daysN : null; });
  const fmtDays = x => x.avgDays==null ? '—' : `${x.avgDays.toLocaleString('pt-BR',{maximumFractionDigits:1})} dias`;
  const totSales=all.reduce((s,x)=>s+x.sales,0), totRev=all.reduce((s,x)=>s+x.revenue,0);
  const named=all.filter(x=>x.seller!=='SEM_VENDEDORA').sort((a,b)=> b.sales-a.sales || b.revenue-a.revenue);
  const blank=all.find(x=>x.seller==='SEM_VENDEDORA');
  document.getElementById('comIntro').innerHTML =
    `Vendas por vendedora (coluna "Tracking src" da Kiwify) no período selecionado. ${named.length} vendedora(s) ativa(s). Atualiza a cada 3h.`;
  document.getElementById('comStats').innerHTML =
    statCard(int(totSales),'Vendas no período') +
    statCard(money(totRev),'Receita no período') +
    statCard(money(totSales?totRev/totSales:0),'Ticket médio') +
    statCard(int(named.length),'Vendedoras ativas');
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
  // faturamento das compradoras por vendedora (neutro — só visualizar a composição)
  const fatRows=named.map(x=>({seller:x.seller,fat:x.fat,tot:x.fat.reduce((s,v)=>s+v,0)})).filter(x=>x.tot>0).sort((a,b)=>b.tot-a.tot);
  const baseTot=fatRows.reduce((s,x)=>s+x.tot,0);
  document.getElementById('comProfIntro').innerHTML =
    `Faixa de faturamento declarado das compradoras de cada vendedora — só pra visualizar a composição. Base: ${int(baseTot)} vendas casadas com a lista de leads no período (as que não casam não têm faturamento pra mostrar).`;
  const legend=FAT_LABELS.map((l,i)=>`<span class="fatleg"><span class="fatsw" style="background:${FAT_COLORS[i]}"></span>${l}</span>`).join('');
  document.getElementById('comProfile').innerHTML = `<div class="fatlegend">${legend}</div>` + (fatRows.length ? fatRows.map(x=>{
    const segs=x.fat.map((c,i)=> c>0 ? `<span class="fatseg" style="width:${(c/x.tot*100).toFixed(1)}%;background:${FAT_COLORS[i]}" title="${FAT_LABELS[i]}: ${c}"></span>` : '').join('');
    return `<div class="qrow"><div class="objlabel" title="${esc(pretty(x.seller))}">${esc(pretty(x.seller))}</div>
      <div class="fatbar">${segs}</div>
      <div class="qval"><b>${int(x.tot)}</b> <span class="sub">vendas</span></div></div>`;
  }).join('') : '<div class="sub">Sem base no período.</div>');
}

// ===================== melhores anúncios (period-aware, bem simples p/ o comercial) =====================
function renderBestAds(){
  const map=new Map();
  for(const r of D.grain){ if(r.date<state.start||r.date>state.end) continue;
    if(!r.ad || r.ad==='SEM_UTM' || r.ad==='NAO_ATRIBUIDO') continue;   // só criativos identificáveis
    let o=map.get(r.ad); if(!o){o={ad:r.ad,label:pretty(r.ad),sales:0,qlf:0,leads:0,revenue:0};map.set(r.ad,o);}
    o.sales+=r.sales; o.qlf+=r.qlf; o.leads+=r.leads; o.revenue+=r.revenue; }
  let list=[...map.values()].filter(o=>o.sales>0||o.qlf>0);
  // pontos: cada VENDA vale 10, cada LEAD QUALIFICADA vale 1 — simples e transparente
  list.forEach(o=>o.pts=o.sales*10+o.qlf);
  list.sort((a,b)=> b.pts-a.pts || b.sales-a.sales || b.qlf-a.qlf);
  const top=list.slice(0,8);
  const per=`${state.start.split('-').reverse().join('/')} → ${state.end.split('-').reverse().join('/')}`;
  document.getElementById('bestadsIntro').innerHTML =
    `Os anúncios que mais trouxeram <b>vendas</b> e <b>leads qualificadas</b> no período <b>${per}</b>. Ordem por pontos: cada <b>venda = 10 pontos</b> · cada <b>lead qualificada = 1 ponto</b>. Troque a data lá em cima que o ranking muda junto. <span class="sub">O espaço do link fica reservado embaixo de cada card — a gente conecta depois.</span>`;
  const grid=document.getElementById('bestadsGrid');
  if(top.length===0){ grid.innerHTML='<div class="micro-note" style="padding:18px">Nenhuma venda ou lead qualificada com anúncio identificado neste período.</div>'; return; }
  const maxPts=top[0].pts||1;
  grid.innerHTML = top.map((o,i)=>{
    const medal = i===0?'🥇':(i===1?'🥈':(i===2?'🥉':'#'+(i+1)));
    const w=Math.max(6,o.pts/maxPts*100);
    return `<div class="ba-card${i<3?' ba-top ba-top'+(i+1):''}">
      <div class="ba-rank">${medal}</div>
      <div class="ba-name" title="${esc(o.label)}">${esc(o.label)}</div>
      <div class="ba-stats">
        <div class="ba-stat"><span class="ba-num">${int(o.sales)}</span><span class="ba-lbl">${o.sales===1?'venda':'vendas'}</span></div>
        <div class="ba-stat"><span class="ba-num ba-q">${int(o.qlf)}</span><span class="ba-lbl">leads qualificadas</span></div>
      </div>
      <div class="ba-bar"><div class="ba-fill" style="width:${w.toFixed(0)}%"></div></div>
      <div class="ba-pts">⭐ ${int(o.pts)} pontos</div>
      <div class="ba-link"><span class="ba-link-soon">🔗 link do anúncio — em breve</span></div>
    </div>`;
  }).join('');
}

// ===================== ascensão (escada de valor Tráfego → Cocktail → Ápice) =====================
function renderAscensao(){
  if(!ASC.ascDaily){ return; }
  const s=state.start, e=state.end, ticket=ASC.apiceTicket||150000;
  let spend=0,cSales=0,cRev=0,asc=0;
  for(const r of D.daily){ if(r.date<s||r.date>e) continue; spend+=r.spend; cSales+=r.sales; cRev+=r.revenue; }
  let ascRev=0;   // valor REAL de cada participante (VALOR da planilha do Ápice); dado antigo sem "val" cai no ticket
  for(const r of arr(ASC.ascDaily)){ if(r.date<s||r.date>e) continue; asc+=(r.asc||0); ascRev+=(r.val!=null?r.val:(r.asc||0)*ticket); }
  const cacC=cSales>0?spend/cSales:0, taxa=cSales>0?asc/cSales*100:0, cacA=asc>0?spend/asc:0;
  const roasC=spend>0?cRev/spend:0, roasEco=spend>0?(cRev+ascRev)/spend:0;
  const D2=v=>v.split('-').reverse().join('/');
  document.getElementById('ascIntro').innerHTML =
    `A escada de valor do ecossistema no período (${D2(s)} → ${D2(e)}): tráfego → venda do Cocktail → ascensão pro Ápice (valor real de cada venda; ticket médio de <b>${money(ticket)}</b>). ${int(ASC.ascTotal)} de ${int(ASC.totalApice)} participantes ativas do Ápice são rastreáveis como compradoras do Cocktail.`;
  // hero: faturamento total (Cocktail + Ápice) + salto de ROAS
  const total=cRev+ascRev;
  const pC=total>0?cRev/total*100:0, pA=total>0?ascRev/total*100:0;
  document.getElementById('ascHero').innerHTML =
    `<div class="asc-hero-grid">
       <div>
         <div class="asc-htag">Faturamento total do ecossistema</div>
         <div class="asc-total">${money(total)}</div>
         <div class="asc-sub">Cocktail <b>${money(cRev)}</b> + Ápice <b>${money(ascRev)}</b> — sobre <b>${money(spend)}</b> de tráfego</div>
       </div>
       <div class="asc-roasbox">
         <div class="asc-roas dim"><span class="asc-roas-v">${fmtRoas(roasC)}</span><span class="asc-roas-l">ROAS só Cocktail</span></div>
         <div class="asc-plus">→</div>
         <div class="asc-roas hot"><span class="asc-roas-v">${fmtRoas(roasEco)}</span><span class="asc-roas-l">ROAS com Ápice rastreado</span></div>
       </div>
     </div>
     <div class="asc-splitbar"><span class="asc-seg cock" style="width:${pC.toFixed(1)}%"></span><span class="asc-seg apic" style="width:${pA.toFixed(1)}%"></span></div>
     <div class="asc-splitlbl"><span><i class="sw cock"></i>Cocktail — ${pct(pC)} do faturamento</span><span><i class="sw apic"></i>Ápice — ${pct(pA)} do faturamento</span></div>`;
  // stats
  document.getElementById('ascStats').innerHTML =
    statCard(asc>0?money(cacC):'—','CAC Cocktail','tráfego por venda') +
    statCard(cSales>0?pct(taxa):'—','Taxa de ascensão','viram Ápice') +
    statCard(asc>0?money(cacA):'—','CAC Ápice','tráfego por ascensão') +
    statCard(spend>0?fmtRoas(roasEco):'—','ROAS ecossistema','com Ápice');
  // Ápice completo (referência: todas as participantes, acumulado — não filtra por data)
  const totAp=ASC.totalApice||0, fatAp=ASC.totalValor!=null?ASC.totalValor:totAp*ticket;
  document.getElementById('ascFull').innerHTML =
    `<div class="asc-full-tag">👑 Ápice completo — todas as participantes <span class="sub">(acumulado · não filtra por data)</span></div>
     <div class="asc-full-nums">
       <div class="asc-full-item"><div class="asc-full-v">${int(totAp)}</div><div class="asc-full-l">participantes no Ápice</div></div>
       <div class="asc-full-sep"></div>
       <div class="asc-full-item"><div class="asc-full-v">${money(fatAp)}</div><div class="asc-full-l">vendido no total (soma do VALOR na planilha)</div></div>
     </div>
     <div class="sub asc-full-note">Total real do Ápice — só ${int(ASC.ascTotal)} são rastreáveis ao tráfego (usadas no cálculo acima); as outras ${int(totAp-(ASC.ascTotal||0))} entraram por fora.</div>`;
  // escada (3 degraus)
  const stepH=[70,120,180]; // alturas crescentes
  const steps=[
    {c:'st-traf',ic:'💸',t:'Tráfego',v:money(spend),s:'investido (c/ imposto)'},
    {c:'st-cock',ic:'🍸',t:'Cocktail',v:money(cRev),s:`${int(cSales)} vendas · CAC ${money(cacC)}`},
    {c:'st-apic',ic:'👑',t:'Ápice',v:money(ascRev),s:`${int(asc)} ascensões · CAC ${asc>0?money(cacA):'—'}`}
  ];
  document.getElementById('ascLadder').innerHTML = steps.map((x,i)=>
    `<div class="stepwrap"><div class="step ${x.c}" style="min-height:${stepH[i]}px">
       <div class="step-ic">${x.ic}</div><div class="step-t">${x.t}</div>
       <div class="step-v">${x.v}</div><div class="step-s">${x.s}</div></div></div>` +
    (i<2?`<div class="step-conn">${i===0?`1 venda a cada<br><b>${money(cacC)}</b>`:`<b>${pct(taxa)}</b><br>sobem ↑`}</div>`:'')
  ).join('');
  // nota + metodologia honesta
  const notInB=(ASC.totalApice||0)-(ASC.ascTotal||0);
  document.getElementById('ascNote').innerHTML =
    `<div class="chart-title">💡 O que isso quer dizer</div>
     <div class="ins-text">Você paga em média <b>${money(cacC)}</b> pra trazer um comprador do Cocktail. <b>${pct(taxa)}</b> deles sobem pro Ápice — e cada Ápice vale em média <b>${money(ticket)}</b>. Então o custo real pra conquistar um cliente de Ápice é só <b>${asc>0?money(cacA):'—'}</b>.</div>
     <div class="ins-action">→ É por isso que o ROAS pula de <b>${fmtRoas(roasC)}</b> pra <b>${fmtRoas(roasEco)}</b> quando você olha o ecossistema inteiro, não só o Cocktail.</div>
     <div class="asc-method">
       <b>Como é calculado — leia com atenção:</b>
       <div>• <b>Gasto</b> = todo o tráfego Meta (com imposto). <b>Vendas e receita do Cocktail</b> = <b>TODAS</b> as vendas do período (tráfego <u>+ orgânico</u>) — é um ROAS <i>blended</i> (receita total ÷ gasto total), não só o que veio de anúncio.</div>
       <div>• <b>Ascensões</b> = só as <b>${int(ASC.ascTotal)} de ${int(ASC.totalApice)}</b> participantes do Ápice que dá pra <b>rastrear</b> como compradoras do Cocktail na Kiwify (por e-mail/nome), datadas pela compra do Cocktail. As outras <b>${int(notInB)}</b> entraram por fora (indicação/VIP) e não dá pra atribuir ao tráfego.</div>
       <div>• Logo, é um <b>piso conservador</b>: se as ${int(ASC.totalApice)} fossem contadas, a receita do Ápice seria <b>${money(fatAp)}</b> (acumulado) e o ROAS real seria ainda maior. 👉 o número aqui <b>subestima</b>, não superestima.</div>
       <div>• O <b>"ROAS com Ápice" do topo do Funil</b> é outra conta: soma <b>todas</b> as vendas do Ápice pela data do coquetel. Aqui entram só as rastreadas, datadas pela compra do Cocktail.</div>
     </div>`;
}

const FAT_LABELS=['Menos de 5 mil','5–10 mil','10–50 mil','50–100 mil','100–200 mil','Acima de 200 mil'];
const FAT_COLORS=['#dbe9f6','#b3d1ea','#84b4dd','#5695ce','#2f6fb0','#1a4a86']; // claro→escuro = menor→maior faturamento (neutro, sem juízo)

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
  // ordem pedida pelo cliente (28/10): Investimento, CPM, CPC, Connect Rate, Conversão de página, Leads, CPL, QLF, CPL QLF, % QLF
  // (+ Vendas e CTR no fim). Connect = LPV ÷ cliques; Conversão de página = leads ÷ LPV (padrão da agência p/ Meta).
  const rows=seriesDaily(state.start,state.end).slice().reverse().map(d=>({   // mais recente primeiro
    date:d.date, spend:d.spend, leads:d.leads, qlf:d.qlf, sales:d.sales, impr:d.impr, clicks:d.clicks, lpv:d.lpv,
    cpm:safe(d.spend,d.impr)*1000, cpc:safe(d.spend,d.clicks), connect:safe(d.lpv,d.clicks)*100, convlp:safe(d.leads-(FORMS_LD.get(d.date)||0),d.lpv)*100,
    cpl:safe(d.spend,d.leads), cplqlf:safe(d.spend,d.qlf), txq:safe(d.qlf,d.leads)*100, ctr:safe(d.clicks,d.impr)*100 }));
  const mm=(k,ok)=>{ const a=rows.filter(r=>!ok||ok(r)).map(r=>r[k]); return a.length?[Math.min(...a),Math.max(...a)]:[0,0]; };
  const sp=mm('spend'),cpm=mm('cpm',r=>r.impr>0),cpc=mm('cpc',r=>r.clicks>0),con=mm('connect',r=>r.clicks>0),clp=mm('convlp',r=>r.lpv>0),
    le=mm('leads'),cpl=mm('cpl',r=>r.leads>0),q=mm('qlf'),tx=mm('txq',r=>r.leads>0),sa=mm('sales'),ctr=mm('ctr',r=>r.impr>0);
  const cell=(ok,v,rng,mode,fmt)=>ok?`<td style="${heat(v,rng[0],rng[1],mode)}">${fmt(v)}</td>`:'<td>—</td>';
  document.querySelector('#dailyTable thead').innerHTML=
    '<tr><th>Dia</th><th>Investimento</th><th>CPM</th><th>CPC</th><th>Connect Rate</th><th>Conv. de página</th><th>Leads</th><th>CPL</th><th>QLF</th><th>CPL QLF</th><th>% QLF</th><th>Vendas</th><th>CTR</th></tr>';
  document.querySelector('#dailyTable tbody').innerHTML = rows.length ? rows.map(r=>`<tr>
    <td>${r.date.slice(8,10)}/${r.date.slice(5,7)}</td>
    <td style="${heat(r.spend,sp[0],sp[1],'vol')}">${money(r.spend)}</td>
    ${cell(r.impr>0,r.cpm,cpm,'cost',money)}
    ${cell(r.clicks>0,r.cpc,cpc,'cost',money)}
    ${cell(r.clicks>0,r.connect,con,'good',pct)}
    ${cell(r.lpv>0,r.convlp,clp,'good',pct)}
    <td style="${heat(r.leads,le[0],le[1],'vol')}">${int(r.leads)}</td>
    ${cell(r.leads>0,r.cpl,cpl,'cost',money)}
    <td style="${heat(r.qlf,q[0],q[1],'vol')}">${int(r.qlf)}</td>
    <td>${cplPill(r.cplqlf,r.qlf)}</td>
    ${cell(r.leads>0,r.txq,tx,'good',pct)}
    <td style="${heat(r.sales,sa[0],sa[1],'vol')}">${int(r.sales)}</td>
    ${cell(r.impr>0,r.ctr,ctr,'good',pct)}</tr>`).join('')
    : '<tr><td colspan="13" class="sub">Sem dados no período.</td></tr>';
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

// tempo até a compra das compras DO PERÍODO (dia da compra − 1º contato da lead)
function tempoStats(B){
  const ds=B.map(r=>r[0]-r[1]).filter(x=>x>=0).sort((a,b)=>a-b), n=ds.length;
  if(!n) return {n:0};
  const lbl=['Mesmo dia','1 a 3 dias','4 a 7 dias','8 a 14 dias','15 a 30 dias','31+ dias'], c=[0,0,0,0,0,0];
  for(const d of ds){ c[d<=0?0:d<=3?1:d<=7?2:d<=14?3:d<=30?4:5]++; }
  return { n, median:ds[Math.floor(n/2)], mean:ds.reduce((s,x)=>s+x,0)/n,
    within3:Math.round(ds.filter(x=>x<=3).length/n*100), within7:Math.round(ds.filter(x=>x<=7).length/n*100),
    buckets:lbl.map((l,i)=>({label:l,n:c[i],pct:c[i]/n*100})) };
}
function renderTempo(){
  const B=pfRows(PF.B,state.start,state.end), T=tempoStats(B), vendas=sumDaily(state.start,state.end).sales;
  document.getElementById('tempoIntro').innerHTML =
    `Da data em que a lead entrou até a data da compra, para as compras do período (${state.start.split('-').reverse().join('/')} → ${state.end.split('-').reverse().join('/')}). Base: ${int(T.n)} compradoras casadas por e-mail com o Typeform (de ${int(vendas)} vendas no período). Atualiza a cada 3h.`;
  if(!T.n){
    document.getElementById('tempoStats').innerHTML='';
    document.getElementById('tempoBars').innerHTML='<div class="sub">Nenhuma compra casada com o Typeform no período selecionado.</div>';
    document.getElementById('tempoNote').innerHTML=''; return;
  }
  const tail=(arr(T.buckets).find(x=>x.label==='31+ dias')||{}).pct||0;
  document.getElementById('tempoStats').innerHTML =
    statCard(`${int(T.median)}<span class="statc-u"> dias</span>`,'Mediana — metade compra antes disso') +
    statCard(`${int(T.mean)}<span class="statc-u"> dias</span>`,'Média — puxada pela cauda longa') +
    statCard(`${int(T.within3)}%`,'Compram em até 3 dias') +
    statCard(`${int(T.within7)}%`,'Compram em até 7 dias');
  document.getElementById('tempoBars').innerHTML = bars(T.buckets,'var(--blue)');
  document.getElementById('tempoNote').innerHTML =
    `<div class="chart-title">💡 O que fazer com isso</div>
     <div class="ins-text">${T.median<=7?'A decisão é <b>rápida</b>':'Neste período a decisão está <b>mais lenta</b>'}: metade das compradoras fecha em <b>até ${int(T.median)} dias</b> e <b>${int(T.within7)}%</b> em até uma semana. A janela de ouro é os <b>primeiros 7 dias</b> depois que a lead entra.</div>
     <div class="ins-action">→ Concentre follow-up, contato do time e remarketing nos <b>primeiros 3–7 dias</b>. Mas mantenha um fluxo de nutrição longo: <b>${pct(tail)}</b> ainda compram com 31+ dias — sem ele você perde essas.</div>`;
}
function renderPerfil(){
  const B=pfRows(PF.B,state.start,state.end), n=B.length, vendas=sumDaily(state.start,state.end).sales;
  const per=`${state.start.split('-').reverse().join('/')} → ${state.end.split('-').reverse().join('/')}`;
  document.getElementById('perfilIntro').innerHTML =
    `Quem são as compradoras do período (${per}): cada compra cruzada por e-mail com as respostas do Typeform. <b>${int(n)} de ${int(vendas)}</b> vendas casadas (as demais não têm Typeform com o mesmo e-mail). Só agregados e depoimentos anonimizados — nada de dado pessoal. Dados de ${PF.generatedAtBR||'—'} (atualiza a cada 3h).`;
  const grid=document.getElementById('pGrid'), tb=document.querySelector('#pObjTable tbody');
  if(!n){
    document.getElementById('perfilStats').innerHTML='';
    document.querySelector('#pObjTable thead').innerHTML='';
    tb.innerHTML='<tr><td class="sub" style="text-align:left">Nenhuma compra casada com o Typeform no período selecionado.</td></tr>';
    grid.innerHTML=''; document.getElementById('pQuotes').innerHTML=''; return;
  }
  const d=pfDist(B,PB_OFF), T=tempoStats(B), ticket=B.reduce((s,r)=>s+(r[3]||0),0)/n, fat=fatEstimate(d), ap=apSize(B);
  document.getElementById('perfilStats').innerHTML =
    statCard(int(n),'Compradoras analisadas',`de ${int(vendas)} vendas no período`) +
    statCard(money(ticket),'Ticket médio da compra') +
    statCard(fat?`R$ ${int(fat)}`:'—','Faturamento médio /mês (estimado)','pelo meio de cada faixa') +
    statCard(T.n?`${int(T.median)}<span class="statc-u"> dias</span>`:'—','Mediana até comprar','do 1º contato à compra') +
    statCard(`👑 ${int(ap.ap)}`,'Viraram Ápice',`${pct(ap.ppl?ap.ap/ap.ppl*100:0)} das ${int(ap.ppl)} compradoras do período`);
  // % de cada objeção entre as compradoras + quantas viraram Ápice + o que elas têm em comum (raio-x ao clicar)
  audObjTable('#pObjTable',AUD.buy,B,pfOpen.pbuy,renderPerfil);
  audGrid(grid,AUD.buy,B,d);
  audQuotes(document.getElementById('pQuotes'),B,PB_T,0,12);   // mais recentes primeiro
}
// faturamento médio /mês estimado pelo meio de cada faixa
function fatEstimate(d){ const fi=PQS.findIndex(q=>q.k==='fat'); let s=0, n=0;
  if(fi>=0){ PQS[fi].labels.forEach((L,li)=>{ const m=PQ_DEF.fat.mid[L]; if(m){ s+=m*d[fi].c[li]; n+=d[fi].c[li]; } }); }
  return n ? s/n : 0; }
// Ápice: participantes (planilha, amarelas fora) casadas com o Typeform — mesma visão de perfil das compradoras, sem data
function renderApice(){   // perfil das participantes do Ápice cuja VENDA (data do coquetel) cai no período
  const M=PF.apice||{}, rg=apRange(), a=rg.all?-Infinity:pfIdx(rg.a), b=pfIdx(rg.b);
  const A=arr(PF.A).filter(r=> r[0]===-99999 ? rg.all : (r[0]>=a && r[0]<=b)), n=A.length, total=apSalesIn(rg).length;
  document.getElementById('apiceIntro').innerHTML =
    `Participantes <b>ativas</b> do Ápice com venda no período (${int(total)} vendas${M.inativas?`; ${int(M.inativas)} inativas ficam fora`:''}), cruzadas com as respostas do Typeform — por e-mail e, se não achar, pelo nome. Só agregados e depoimentos anonimizados.`;
  if(!n){ document.getElementById('apiceStats').innerHTML=''; document.getElementById('apiceNote').innerHTML=`<div class="ins-text">${total?`Nenhuma das ${int(total)} participantes do período foi encontrada na base de leads.`:'Nenhuma venda do Ápice no período selecionado.'}</div>`;
    audObjTable('#aObjTable',AUD.apice,A,pfOpen.apice,renderApice); audGrid(document.getElementById('aGrid'),AUD.apice,A); audQuotes(document.getElementById('aQuotes'),A,PA_T,null,16); return; }
  const d=pfDist(A,PA_OFF), fat=fatEstimate(d), qlf=A.filter(r=>r[2]===1).length, ck=A.filter(r=>r[3]===1).length;
  document.getElementById('apiceStats').innerHTML =
    statCard(int(total),'Vendas do Ápice no período') +
    statCard(int(n),'Encontradas na base de leads',`${pct(total?n/total*100:0)} das participantes do período`) +
    statCard(int(qlf),'Qualificadas (≥100k)',`${pct(qlf/n*100)} das encontradas`) +
    statCard(fat?`R$ ${int(fat)}`:'—','Faturamento médio /mês (estimado)','pelo meio de cada faixa') +
    statCard(int(ck),'Também compraram o Cocktail',`${pct(ck/n*100)} das encontradas`);
  document.getElementById('apiceNote').innerHTML =
    `<div class="ins-text">📌 <b>${int(n)} de ${int(total)}</b> participantes do período foram encontradas na base de leads (o perfil abaixo é sobre essas). As outras <b>${int(Math.max(0,total-n))}</b> não estão na base com o mesmo e-mail/nome — provavelmente entraram por outro caminho (indicação, convite direto, VIP).</div>`;
  audObjTable('#aObjTable',AUD.apice,A,pfOpen.apice,renderApice);
  audGrid(document.getElementById('aGrid'),AUD.apice,A,d);
  audQuotes(document.getElementById('aQuotes'),A,PA_T,0,16);   // vendas mais recentes primeiro
}

// ===================== datas (preenchimento de cada Cocktail) =====================
function evCard(e,meta,cac,today){
  const pctF=e.vendas/meta*100, falta=Math.max(0,meta-e.vendas);
  const full=e.vendas>=meta, past=(today && e.dateKey && e.dateKey<today);
  const col=full?'var(--green)':(pctF>=66?'#e0913a':'var(--blue2)');
  let badge,bcol;
  if(full){ badge='✅ Lotado'; bcol='var(--green)'; }
  else if(past){ badge=`Encerrado · ${int(e.vendas)}/${meta}`; bcol='var(--muted)'; }
  else { badge=`faltam ${int(falta)}`; bcol='#d9822b'; }
  const conv=e.conv||0, inv=(e.vendas-conv)*cac;   // convidada ocupa vaga mas nao custou trafego nem pagou
  const convNote=conv?`<div class="ev-conv">inclui ${int(conv)} convidada${conv>1?'s':''} (sem pagamento)</div>`:'';
  return `<div class="ev-card${full?' ev-full':''}">
    <div class="ev-top"><span class="ev-name">${esc(e.ev)}</span><span class="ev-badge" style="color:${bcol};border-color:${bcol}">${badge}</span></div>
    <div class="ev-count"><b>${int(e.vendas)}</b><span> / ${meta} vagas</span></div>${convNote}
    <div class="ev-prog"><div class="ev-fill" style="width:${Math.min(pctF,100).toFixed(1)}%;background:${col}"></div></div>
    <div class="ev-foot"><div class="ev-kv"><span class="ev-k">Investido em tráfego</span><span class="ev-v">~${money(inv)}</span></div><div class="ev-kv ev-kv-r"><span class="ev-k">Faturou em Cocktail</span><span class="ev-v" style="color:var(--green)">${money(e.revenue)}</span></div></div>
  </div>`;
}
function renderDatas(){
  const evs=arr(DATAS.events); if(!evs.length){ return; }
  const meta=DATAS.meta||30, today=DATAS.today||'';
  let spendAll=0,salesAll=0; for(const r of arr(D.daily)){ spendAll+=r.spend; salesAll+=r.sales; }
  const cac=salesAll>0?spendAll/salesAll:0;
  const totVagas=evs.length*meta, totVendas=evs.reduce((s,e)=>s+e.vendas,0), lot=evs.filter(e=>e.vendas>=meta).length;
  document.getElementById('datasIntro').innerHTML =
    `Vagas de cada Cocktail pela data do evento (coluna G da planilha do comercial). Convidadas ocupam vaga, mas não contam como venda paga. Cada evento precisa de <b>${meta} vagas</b> preenchidas. Atualiza a cada 3h.`;
  document.getElementById('datasStats').innerHTML =
    statCard(int(evs.length),'Eventos (datas)') +
    statCard(`${int(totVendas)}<span class="statc-u"> / ${int(totVagas)}</span>`,'Vagas preenchidas', pct(totVagas?totVendas/totVagas*100:0)+' do total') +
    statCard(int(lot),`Eventos lotados (${meta}/${meta})`) +
    statCard(money(cac),'Investimento médio por venda');
  const up=evs.filter(e=>!(today && e.dateKey && e.dateKey<today)).slice().sort((a,b)=>a.dateKey<b.dateKey?-1:1);
  const past=evs.filter(e=> today && e.dateKey && e.dateKey<today).slice().sort((a,b)=>a.dateKey>b.dateKey?-1:1);
  document.getElementById('datasUpcoming').innerHTML = up.length? up.map(e=>evCard(e,meta,cac,today)).join('') : '<div class="sub">Nenhum evento futuro no momento.</div>';
  document.getElementById('datasPast').innerHTML = past.length? past.map(e=>evCard(e,meta,cac,today)).join('') : '<div class="sub">Nenhum evento encerrado.</div>';
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
  const PAGES=['consolidado','funnel','sd','datas','obj','insights','comercial','bestads','tempo','perfil','apice','ascensao'];
  const NOCTRL=['insights','datas']; // abas de base completa (sem seletor de período); consolidado, obj, tempo, perfil, apice, comercial, bestads, sd e ascensao usam o seletor
  document.querySelectorAll('.pagebtn').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('.pagebtn').forEach(x=>x.classList.remove('active')); b.classList.add('active');
    const pg=b.dataset.page;
    PAGES.forEach(p=>{ const el=document.getElementById('page'+p.charAt(0).toUpperCase()+p.slice(1)); if(el) el.hidden = p!==pg; });
    document.querySelector('.controls').style.display = NOCTRL.includes(pg) ? 'none' : '';
    if(pg==='apice') renderApChart();   // o gráfico mede a largura real -> desenha quando a aba aparece
    if(pg==='consolidado') cxRedrawCharts();
    if(pg==='funnel') renderCreatives();   // o mapa dos criativos mede a largura real
  });
  let apRz=0; window.addEventListener('resize',()=>{ clearTimeout(apRz); apRz=setTimeout(()=>{ const pg=document.getElementById('pageApice'); if(pg && !pg.hidden) renderApChart(); cxRedrawCharts(); const pf=document.getElementById('pageFunnel'); if(pf && !pf.hidden) renderCreatives(); },150); });
  // Otimização por criativo: ordenação, campanha e gasto mínimo
  document.querySelectorAll('#crSort button').forEach(b=>b.onclick=()=>{ CR.sort=b.dataset.s; renderCreatives(); });
  document.getElementById('crCamp').onchange=e=>{ CR.camp=e.target.value; renderCreatives(); };
  document.getElementById('crMin').onchange=e=>{ CR.min=+e.target.value||0; renderCreatives(); };
  // Consolidado: controles do funil e do gráfico por dia
  const cxRe=()=>{ renderCxFun(); renderCxDay(); };
  document.getElementById('cxView').onchange=e=>{ CX.view=e.target.value; cxRe(); };
  document.getElementById('cxCols').onchange=e=>{ CX.cols=Math.max(2,Math.min(14,parseInt(e.target.value,10)||7)); e.target.value=CX.cols; cxRe(); };
  document.getElementById('cxSeller').onchange=e=>{ CX.seller=e.target.value; cxRe(); };
  document.getElementById('cxToday').onchange=e=>{ CX.withToday=e.target.checked; cxRe(); };
  document.querySelectorAll('#cxBrk button').forEach(b=>b.onclick=()=>{ if(b.disabled) return; CX.brk=b.dataset.b; renderCxDay(); });
  document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active')); t.classList.add('active');
    state.level=t.dataset.level; state.sort={key:'qlf',asc:false}; renderTable();
  });
  document.querySelectorAll('#objAud button').forEach(b=>b.onclick=()=>{ state.objAud=b.dataset.aud; renderObjections(); });   // Objeções: qualificadas OU compradoras
  document.getElementById('applyRange').onclick=()=>{ document.getElementById('presets').querySelectorAll('button').forEach(x=>x.classList.remove('active')); setRange(document.getElementById('dStart').value,document.getElementById('dEnd').value); };
  document.getElementById('goalInput').onchange=e=>{ localStorage.setItem('ccn_goal',e.target.value||15000); render(); };
  const [s,e]=lastN(30); setRange(s,e);
  renderInsights();
  renderDatas();
  const hash=location.hash.toLowerCase();
  if(hash.includes('funil')||hash.includes('funnel')){ document.querySelector('.pagebtn[data-page="funnel"]').click(); }
  else if(hash.includes('insight')){ document.querySelector('.pagebtn[data-page="insights"]').click(); }
  else if(hash.includes('obj')){ document.querySelector('.pagebtn[data-page="obj"]').click(); }
  else if(hash.includes('tempo')){ document.querySelector('.pagebtn[data-page="tempo"]').click(); }
  else if(hash.includes('perfil')||hash.includes('compradora')){ document.querySelector('.pagebtn[data-page="perfil"]').click(); }
  else if(hash.includes('apice')||hash.includes('ápice')){ document.querySelector('.pagebtn[data-page="apice"]').click(); }
  else if(hash.includes('ascens')){ document.querySelector('.pagebtn[data-page="ascensao"]').click(); }
  else if(hash.includes('datas')){ document.querySelector('.pagebtn[data-page="datas"]').click(); }
  else if(hash.includes('bestads')||hash.includes('melhores')||hash.includes('anuncio')){ document.querySelector('.pagebtn[data-page="bestads"]').click(); }
  else if(hash.includes('saude')||hash==='#sd'){ document.querySelector('.pagebtn[data-page="sd"]').click(); }
}
init();
