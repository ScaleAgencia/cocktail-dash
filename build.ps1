# =====================================================================
#  Cocktail Cardi Nigro - Dashboard data engine
#  Fetches 3 Google Sheets (CSV export), cross-references them and
#  writes data.json consumed by the static dashboard (index.html).
#  Runs locally (Windows PowerShell) and in GitHub Actions (pwsh).
#  Does NOT modify any spreadsheet - read only.
# =====================================================================
#  Mode: which output(s) to write (each cadence runs its own mode):
#    traffic    -> data.js          (funil)      cron 3h
#    objections -> data-obj.js      (objecoes)   cron diario
#    insights   -> data-insights.js (insights)   cron semanal
#    all        -> os 3 (uso local/manual)
param([ValidateSet('all','traffic','objections','insights')][string]$Mode='all')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$BR = [Globalization.CultureInfo]::GetCultureInfo('pt-BR')
function M2($v){ return ([double]$v).ToString('N2',$BR) }
function M0($v){ return ([double]$v).ToString('N0',$BR) }
function P1($v){ return ([double]$v).ToString('N1',$BR) + '%' }
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dataDir = Join-Path $root 'data'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

# ---- Sources -------------------------------------------------------
$QUERIES_ID = '1RJC_VqNbRF8Xir_jQQ4KBdA0Bh9u4AUiDQPxr1sPEHU'; $QUERIES_GID = '1160142252'
$MASTER_ID  = '1WuETdVje43yvMfyQDHO1PObXj_G9G-t6JjG6q987Z4o'
$LEADS_GID  = '603619749'
$KIWIFY_GID = '1987730935'
$TAX = 1.1385
$QUAL_MENSAL = @('Entre R$ 100 mil e R$ 200 mil','Acima de 200 mil')

function Get-Sheet($id,$gid,$out){
  $url = "https://docs.google.com/spreadsheets/d/$id/gviz/tq?tqx=out:csv&gid=$gid"
  Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -TimeoutSec 120
  if((Get-Item $out).Length -lt 50){ throw "Download too small: $out" }
}

Add-Type -AssemblyName Microsoft.VisualBasic
function Read-Csv($path){
  $rows = New-Object System.Collections.Generic.List[object]
  $p = New-Object Microsoft.VisualBasic.FileIO.TextFieldParser($path,[System.Text.Encoding]::UTF8)
  $p.TextFieldType='Delimited'; $p.SetDelimiters(','); $p.HasFieldsEnclosedInQuotes=$true
  while(-not $p.EndOfData){ $rows.Add($p.ReadFields()) }
  $p.Close(); return $rows
}
function Norm($s){ if($null -eq $s){return ''}; return ($s -replace [char]0x200b,'').Trim() }
function MoneyBR($s){ $s=Norm $s; if($s -eq ''){return 0.0}; return [double]($s -replace '\.','' -replace ',','.') }
# Kiwify revenue column is mixed: some rows "6201.66" (reais w/ decimal), some "620166" (integer cents)
function MoneyKiwify($s){ $s=Norm $s; if($s -eq ''){return 0.0}
  if($s -match ','){ return [double](($s -replace '\.','') -replace ',','.') }      # BR: 4.997,00
  if($s -match '\.'){ return [double]::Parse($s,[Globalization.CultureInfo]::InvariantCulture) } # US: 4997.00
  $v=[double]$s; if($v -ge 100000){ return $v/100 } else { return $v } }            # bare integer cents -> reais
function ToInt($s){ $s=Norm $s; if($s -eq ''){return 0}; return [int]([double]($s -replace '\.','' -replace ',','.')) }
function AdCode($s){ $s=Norm $s; if($s -match '(AD\d+(_V\d+)?)'){ return $Matches[1] }; return $s }   # preserva versao _V2/_V3 (criativos novos), ignora descritor de formato (_VIDEO_LDE etc.)
# utm que veio com macro do Meta nao resolvida ({{campaign.name}} etc.) = sem rastreio util
function CleanUtm($s){ $s=Norm $s; if($s -match '\{\{|\}\}|\{'){ return '' }; return $s }
function HdrIndex($hdr,$name){ for($i=0;$i -lt $hdr.Count;$i++){ if((Norm $hdr[$i]) -eq $name){ return $i } }; return -1 }
# accent-safe matcher: match on an ASCII fragment so PS5.1 literal-encoding can't break it
function HdrLike($hdr,$pat){ for($i=0;$i -lt $hdr.Count;$i++){ if((Norm $hdr[$i]) -like $pat){ return $i } }; return -1 }

# ---- objection categorization (keyword based, ASCII labels prettified in the UI) ----
function Deaccent($s){ if($null -eq $s){return ''}; $s=$s.Normalize([Text.NormalizationForm]::FormD); $sb=New-Object Text.StringBuilder
  foreach($c in $s.ToCharArray()){ if([Globalization.CharUnicodeInfo]::GetUnicodeCategory($c) -ne [Globalization.UnicodeCategory]::NonSpacingMark){ [void]$sb.Append($c) } }
  return $sb.ToString().ToLower() }
$OBJ_BUCKETS = @(
  @('Equipe & Pessoas',       @('equipe','pessoa','mao de obra','colaborador','funcionario','contrat','lider','recursos humanos')),
  @('Delegacao & Escala',     @('deleg','escal','cresc','expand','expans','sair da operac','depend','sozinh','dono faz','centraliz','sobrecarg','estagn')),
  @('Financeiro & Capital',   @('financ','dinheiro','capital','fluxo de caixa','caixa','lucro','custo','precific','investiment',' giro','endivid','divida','inadimpl','preco')),
  @('Vendas & Clientes',      @('vend','client','captac','captar','prospec','fechar','convert','faturament','faturar','negocia','funil','orcament','comercial')),
  @('Marketing & Divulgacao', @('marketing','divulg','trafego','anunci','publicidad','digital','posicion','branding','rede social','redes sociais','instagram','alcance','visibilidade','seguidor','conteudo','comunica','reconheci')),
  @('Gestao & Organizacao',   @('gest','organiz','administr','process','controle','tempo','rotina','planejament','sistema','estrutur')),
  @('Estrategia & Direcao',   @('estrateg','direcionament','direcao','clareza','conheciment','rumo')),
  @('Mindset & Constancia',   @('medo','consist','constan','discipl','foco','mindset','inseguran','autoconf','procrastin','ansiedad','acredit','autoestima','motiva','coragem','desanim')),
  @('Concorrencia & Mercado', @('concorr','mercado','crise','economi','sazonal')),
  @('Produto & Operacao',     @('produt','estoque','operac','qualidade','entrega','logistic','fornecedor','servico')),
  @('Sem empresa / Inicio',   @('nao tenho empresa','sem empresa','comecar','comec','abrir empresa','iniciante','ainda nao','nao tenho','clt','salario','emprego','eu mesma'))
)
$OBJ_ORDER = @($OBJ_BUCKETS | ForEach-Object { $_[0] }) + 'Outros'
function Bucket($txt){ $t=Deaccent (Norm $txt); if($t -eq ''){return 'Outros'}
  foreach($b in $OBJ_BUCKETS){ foreach($kw in $b[1]){ if($t.Contains($kw)){ return $b[0] } } }
  return 'Outros' }

Write-Host "Downloading sheets..."
$qCsv=Join-Path $dataDir 'queries.csv'; $lCsv=Join-Path $dataDir 'leads.csv'; $kCsv=Join-Path $dataDir 'kiwify.csv'
Get-Sheet $QUERIES_ID $QUERIES_GID $qCsv
Get-Sheet $MASTER_ID  $LEADS_GID   $lCsv
Get-Sheet $MASTER_ID  $KIWIFY_GID  $kCsv

$q = Read-Csv $qCsv;  $qh=$q[0]; $qd=$q[1..($q.Count-1)]
$l = Read-Csv $lCsv;  $lh=$l[0]; $ld=$l[1..($l.Count-1)]
$k = Read-Csv $kCsv;  $kh=$k[0]; $kd=$k[1..($k.Count-1)]

# ---- column indices ------------------------------------------------
$Q_DAY=HdrIndex $qh 'Day'; $Q_CAMP=HdrIndex $qh 'Campaign Name'; $Q_SET=HdrIndex $qh 'Ad Set Name'
$Q_AD=HdrIndex $qh 'Ad Name'; $Q_SPEND=HdrIndex $qh 'Amount Spent'; $Q_IMP=HdrIndex $qh 'Impressions'
$Q_CLK=HdrIndex $qh 'Link Clicks'; $Q_LPV=HdrIndex $qh 'Landing Page Views'

$L_EMAIL=HdrLike $lh '*melhor E-mail*'; $L_FAT=HdrLike $lh '*faturamento mensal*'
$L_DATE=HdrIndex $lh 'Data Formatada'; $L_CAMP=HdrIndex $lh 'utm_campaign'; $L_SET=HdrIndex $lh 'utm_medium'
$L_CONT=HdrIndex $lh 'utm_content'; $L_SRC=HdrIndex $lh 'utm_source'; $L_DESAFIO=HdrLike $lh '*principal desafio*'

$K_STAT=HdrIndex $kh 'Status'; $K_EMAIL=HdrIndex $kh 'Email'; $K_DATE=HdrIndex $kh 'Data Simplificada'
$K_REV=HdrLike $kh 'Total com acr*'

# ===================================================================
#  DAILY (authoritative funnel totals — reproduces the print exactly)
# ===================================================================
$daily=@{}
function GetDay($d){ if(-not $daily.ContainsKey($d)){ $daily[$d]=[pscustomobject]@{date=$d;spend=0.0;impr=0;clicks=0;lpv=0;leads=0;qlf=0;sales=0;revenue=0.0} }; return $daily[$d] }

foreach($r in $qd){ $d=Norm $r[$Q_DAY]; if($d -notmatch '^\d{4}-\d{2}-\d{2}$'){continue}
  $o=GetDay $d; $o.spend += (MoneyBR $r[$Q_SPEND])*$TAX; $o.impr += ToInt $r[$Q_IMP]; $o.clicks += ToInt $r[$Q_CLK]; $o.lpv += ToInt $r[$Q_LPV] }

# objections per day: leads (all) + qualified subset, by objection bucket
$objLeads=@{}
function GetObjL($d,$b){ $key="$d`u$b"; if(-not $objLeads.ContainsKey($key)){ $objLeads[$key]=[pscustomobject]@{date=$d;bucket=$b;total=0;qlf=0} }; return $objLeads[$key] }
foreach($r in $ld){ $d=Norm $r[$L_DATE]; if($d -notmatch '^\d{4}-\d{2}-\d{2}$'){continue}
  $isq = (Norm $r[$L_FAT]) -in $QUAL_MENSAL
  $o=GetDay $d; $o.leads++; if($isq){ $o.qlf++ }
  $ob=GetObjL $d (Bucket $r[$L_DESAFIO]); $ob.total++; if($isq){ $ob.qlf++ } }

# DD/MM/YYYY -> YYYY-MM-DD
function BrDate($s){ $s=Norm $s; if($s -match '^(\d{2})/(\d{2})/(\d{4})'){ return "$($Matches[3])-$($Matches[2])-$($Matches[1])" }; return '' }
foreach($r in $kd){ if((Norm $r[$K_STAT]) -ne 'paid'){continue}; $d=BrDate $r[$K_DATE]; if($d -eq ''){continue}
  $o=GetDay $d; $o.sales++; $o.revenue += (MoneyKiwify $r[$K_REV]) }

# ===================================================================
#  GRAIN (breakdown date|campaign|adset|ad) for optimization tables
# ===================================================================
$grain=@{}
function GetGrain($d,$c,$s,$a){ $key="$d`u$c`u$s`u$a"
  if(-not $grain.ContainsKey($key)){ $grain[$key]=[pscustomobject]@{date=$d;campaign=$c;adset=$s;ad=$a;spend=0.0;impr=0;clicks=0;lpv=0;leads=0;qlf=0;sales=0;revenue=0.0} }
  return $grain[$key] }

foreach($r in $qd){ $d=Norm $r[$Q_DAY]; if($d -notmatch '^\d{4}-\d{2}-\d{2}$'){continue}
  $o=GetGrain $d (Norm $r[$Q_CAMP]) (Norm $r[$Q_SET]) (AdCode $r[$Q_AD])
  $o.spend += (MoneyBR $r[$Q_SPEND])*$TAX; $o.impr += ToInt $r[$Q_IMP]; $o.clicks += ToInt $r[$Q_CLK]; $o.lpv += ToInt $r[$Q_LPV] }

# lead email -> utm (for sales attribution); keep most recent lead per email
$leadByEmail=@{}
foreach($r in $ld){ $e=(Norm $r[$L_EMAIL]).ToLower(); if($e -eq ''){continue}
  $leadByEmail[$e]=[pscustomobject]@{campaign=(CleanUtm $r[$L_CAMP]);adset=(CleanUtm $r[$L_SET]);ad=(AdCode (CleanUtm $r[$L_CONT]));bucket=(Bucket $r[$L_DESAFIO])} }

foreach($r in $ld){ $d=Norm $r[$L_DATE]; if($d -notmatch '^\d{4}-\d{2}-\d{2}$'){continue}
  $c=CleanUtm $r[$L_CAMP]; if($c -eq ''){$c='SEM_UTM'}
  $s=CleanUtm $r[$L_SET];  if($s -eq ''){$s='SEM_UTM'}
  $a=AdCode (CleanUtm $r[$L_CONT]); if($a -eq ''){$a='SEM_UTM'}
  $o=GetGrain $d $c $s $a; $o.leads++; if((Norm $r[$L_FAT]) -in $QUAL_MENSAL){ $o.qlf++ } }

# buyer objections per purchase day (only matched buyers have a known desafio)
$objBuyers=@{}
function GetObjB($d,$b){ $key="$d`u$b"; if(-not $objBuyers.ContainsKey($key)){ $objBuyers[$key]=[pscustomobject]@{date=$d;bucket=$b;buyers=0} }; return $objBuyers[$key] }
foreach($r in $kd){ if((Norm $r[$K_STAT]) -ne 'paid'){continue}; $d=BrDate $r[$K_DATE]; if($d -eq ''){continue}
  $e=(Norm $r[$K_EMAIL]).ToLower(); $rev=MoneyKiwify $r[$K_REV]
  if($e -ne '' -and $leadByEmail.ContainsKey($e)){ $m=$leadByEmail[$e]
    $c=if($m.campaign){$m.campaign}else{'NAO_ATRIBUIDO'}; $s=if($m.adset){$m.adset}else{'NAO_ATRIBUIDO'}; $a=if($m.ad){$m.ad}else{'NAO_ATRIBUIDO'}
    $o=GetGrain $d $c $s $a
    $obk=GetObjB $d $m.bucket; $obk.buyers++ } else { $o=GetGrain $d 'NAO_ATRIBUIDO' 'NAO_ATRIBUIDO' 'NAO_ATRIBUIDO' }
  $o.sales++; $o.revenue += $rev }

# ===================================================================
#  VERBATIMS — o que as QUALIFICADAS relatam, por objecao (base completa)
# ===================================================================
$qVerb=@{}   # bucket -> hashtable(texto -> contagem)
foreach($r in $ld){
  if((Norm $r[$L_FAT]) -notin $QUAL_MENSAL){ continue }
  $t = Norm $r[$L_DESAFIO]
  if($t.Length -lt 3 -or $t.Length -gt 160){ continue }
  if($t -match '@' -or $t -match 'http' -or $t -match '\d{4,}'){ continue }     # sem PII (email/telefone/cpf)
  $collapsed = ($t.ToLower() -replace '\s','')
  if(($collapsed.ToCharArray() | Select-Object -Unique).Count -le 1){ continue } # aaaa / .... / xxxx
  $b = Bucket $r[$L_DESAFIO]
  if(-not $qVerb.ContainsKey($b)){ $qVerb[$b]=@{} }
  if($qVerb[$b].ContainsKey($t)){ $qVerb[$b][$t]++ } else { $qVerb[$b][$t]=1 }
}
$objQuotes = foreach($b in $OBJ_ORDER){
  if(-not $qVerb.ContainsKey($b)){ continue }
  $h=$qVerb[$b]
  $terms = $h.GetEnumerator() | Where-Object { $_.Value -ge 2 } | Sort-Object Value -Descending | Select-Object -First 14 | ForEach-Object { [pscustomobject]@{ t=$_.Key; n=$_.Value } }
  $examples = $h.Keys | Where-Object { $_.Length -ge 25 } | Sort-Object { $_.Length } -Descending | Select-Object -First 8
  [pscustomobject]@{ bucket=$b; total=(($h.Values | Measure-Object -Sum).Sum); distinct=$h.Count; terms=@($terms); examples=@($examples) }
}

# ---- shared arrays --------------------------------------------------
$dailyArr  = $daily.Values  | Sort-Object date
$grainArr  = $grain.Values  | Where-Object { $_.leads -gt 0 -or $_.spend -gt 0 -or $_.sales -gt 0 } | Sort-Object date
$dates = $dailyArr.date | Sort-Object
$paidCount = ($kd | Where-Object { (Norm $_[$K_STAT]) -eq 'paid' }).Count
$matchedBuyers = 0
foreach($r in $kd){ if((Norm $r[$K_STAT]) -ne 'paid'){continue}; $e=(Norm $r[$K_EMAIL]).ToLower(); if($e -ne '' -and $leadByEmail.ContainsKey($e)){ $matchedBuyers++ } }
$nowIso = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$nowBR  = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'E. South America Standard Time').ToString('dd/MM/yyyy HH:mm')
$utf8 = [System.Text.UTF8Encoding]::new($false)
function WriteJs($file,$var,$obj){ $j=$obj|ConvertTo-Json -Depth 9 -Compress; [IO.File]::WriteAllText((Join-Path $root $file), ("window.$var="+$j+";"), $utf8) }

# ===================================================================
#  INSIGHTS ENGINE — emite DADOS estruturados (prosa PT-BR fica no app.js)
# ===================================================================
$dmax=$dates[-1]; $dt=[datetime]::ParseExact($dmax,'yyyy-MM-dd',$null)
$w30s=$dt.AddDays(-29).ToString('yyyy-MM-dd'); $p30e=$dt.AddDays(-30).ToString('yyyy-MM-dd'); $p30s=$dt.AddDays(-59).ToString('yyyy-MM-dd')
function Sdiv($a,$b){ if($b -gt 0){ return $a/$b } else { return 0 } }
function SumRange($s,$e){ $sp=0.0;$im=0;$cl=0;$lp=0;$le=0;$ql=0;$sa=0;$re=0.0
  foreach($r in $dailyArr){ if($r.date -ge $s -and $r.date -le $e){ $sp+=$r.spend;$im+=$r.impr;$cl+=$r.clicks;$lp+=$r.lpv;$le+=$r.leads;$ql+=$r.qlf;$sa+=$r.sales;$re+=$r.revenue } }
  [pscustomobject]@{spend=$sp;impr=$im;clicks=$cl;lpv=$lp;leads=$le;qlf=$ql;sales=$sa;revenue=$re} }
$cur=SumRange $w30s $dmax; $prev=SumRange $p30s $p30e
# objection totals (base completa)
$Qb=@{}; $Bb=@{}; foreach($b in $OBJ_ORDER){ $Qb[$b]=0;$Bb[$b]=0 }
foreach($r in $objLeads.Values){ $Qb[$r.bucket]=$Qb[$r.bucket]+$r.qlf }
foreach($r in $objBuyers.Values){ $Bb[$r.bucket]=$Bb[$r.bucket]+$r.buyers }
$totQ=0; foreach($v in $Qb.Values){$totQ+=$v}; $totB=0; foreach($v in $Bb.Values){$totB+=$v}
$ins=New-Object System.Collections.Generic.List[object]
function AddIns($o){ $ins.Add([pscustomobject]$o) }
# -- objections --
$idxList=@()
foreach($b in $OBJ_ORDER){ if($b -eq 'Outros'){continue}
  if($Bb[$b] -ge 3 -and $Qb[$b] -gt 0 -and $totB -gt 0 -and $totQ -gt 0){
    $qp=$Qb[$b]/$totQ*100; $bp=$Bb[$b]/$totB*100
    $idxList += [pscustomobject]@{b=$b;qp=$qp;bp=$bp;idx=($bp/$qp);bn=$Bb[$b];qn=$Qb[$b]} } }
foreach($x in ($idxList | Where-Object { $_.idx -ge 1.3 -and $_.bn -ge 4 } | Sort-Object idx -Descending | Select-Object -First 3)){
  AddIns @{type='obj_overindex';cat='objecoes';tone='good';bucket=$x.b;idx=[math]::Round($x.idx,2);bp=[math]::Round($x.bp,1);qp=[math]::Round($x.qp,1);bn=$x.bn} }
$bigQ = $idxList | Sort-Object qp -Descending | Select-Object -First 1
if($bigQ -and $bigQ.idx -le 0.85){ AddIns @{type='obj_underindex';cat='objecoes';tone='warn';bucket=$bigQ.b;qp=[math]::Round($bigQ.qp,1);idx=[math]::Round($bigQ.idx,2)} }
$topB = $idxList | Sort-Object bp -Descending | Select-Object -First 1
if($topB){ AddIns @{type='obj_top_buyer';cat='objecoes';tone='info';bucket=$topB.b;bp=[math]::Round($topB.bp,1);bn=$topB.bn} }
# -- product fit (escala/destravar) --
if($totQ -gt 0){
  $scaleQ=$Qb['Delegacao & Escala']+$Qb['Equipe & Pessoas']; $pctScale=[math]::Round($scaleQ/$totQ*100,1)
  $idxDeleg = if($Qb['Delegacao & Escala'] -gt 0 -and $totB -gt 0){ [math]::Round((($Bb['Delegacao & Escala']/$totB)/($Qb['Delegacao & Escala']/$totQ)),2) } else { 0 }
  AddIns @{type='product_scale_fit';cat='produto';tone='good';pctScale=$pctScale;idxDeleg=$idxDeleg} }
# -- campaigns (ultimos 30d) --
$campW=@{}
foreach($r in $grainArr){ if($r.date -lt $w30s -or $r.date -gt $dmax){continue}; if($r.campaign -in @('SEM_UTM','NAO_ATRIBUIDO') -or $r.campaign -like '*{*'){continue}
  if(-not $campW.ContainsKey($r.campaign)){ $campW[$r.campaign]=[pscustomobject]@{c=$r.campaign;spend=0.0;leads=0;qlf=0;sales=0} }
  $o=$campW[$r.campaign];$o.spend+=$r.spend;$o.leads+=$r.leads;$o.qlf+=$r.qlf;$o.sales+=$r.sales }
$campArr=@($campW.Values)
$cheap = $campArr | Where-Object { $_.qlf -ge 10 -and $_.spend -gt 0 } | Sort-Object { $_.spend/$_.qlf } | Select-Object -First 1
if($cheap){ AddIns @{type='camp_cheap';cat='campanhas';tone='good';campaign=$cheap.c;cplqlf=[math]::Round($cheap.spend/$cheap.qlf,2);qlf=$cheap.qlf;spend=[math]::Round($cheap.spend,2)} }
$exp = $campArr | Where-Object { $_.qlf -ge 1 -and $_.spend -ge 500 -and ($_.spend/$_.qlf) -gt 150 } | Sort-Object { $_.spend/$_.qlf } -Descending | Select-Object -First 1
if($exp){ AddIns @{type='camp_exp';cat='campanhas';tone='warn';campaign=$exp.c;cplqlf=[math]::Round($exp.spend/$exp.qlf,2);spend=[math]::Round($exp.spend,2)} }
$bestS = $campArr | Where-Object { $_.sales -ge 2 } | Sort-Object sales -Descending | Select-Object -First 1
if($bestS){ AddIns @{type='camp_sales';cat='campanhas';tone='good';campaign=$bestS.c;sales=$bestS.sales;cac=[math]::Round((Sdiv $bestS.spend $bestS.sales),2)} }
# -- ads (ultimos 30d) --
$adW=@{}
foreach($r in $grainArr){ if($r.date -lt $w30s -or $r.date -gt $dmax){continue}; $k=$r.ad; if($k -in @('SEM_UTM','NAO_ATRIBUIDO') -or $k -like '*{*'){continue}
  if(-not $adW.ContainsKey($k)){ $adW[$k]=[pscustomobject]@{a=$k;spend=0.0;leads=0;qlf=0;sales=0} }
  $o=$adW[$k];$o.spend+=$r.spend;$o.leads+=$r.leads;$o.qlf+=$r.qlf;$o.sales+=$r.sales }
$adArr=@($adW.Values)
$adLeadsTot=($adArr|Measure-Object leads -Sum).Sum; $adQlfTot=($adArr|Measure-Object qlf -Sum).Sum
$avgRate = if($adLeadsTot -gt 0){ $adQlfTot/$adLeadsTot } else { 0 }
$bestQR = $adArr | Where-Object { $_.leads -ge 20 } | Sort-Object { $_.qlf/$_.leads } -Descending | Select-Object -First 1
if($bestQR){ AddIns @{type='ad_bestqr';cat='anuncios';tone='good';ad=$bestQR.a;rate=[math]::Round($bestQR.qlf/$bestQR.leads*100,1);leads=$bestQR.leads;qlf=$bestQR.qlf} }
$lowQR = $adArr | Where-Object { $_.leads -ge 30 -and ($_.qlf/$_.leads) -lt ($avgRate*0.5) } | Sort-Object leads -Descending | Select-Object -First 1
if($lowQR){ AddIns @{type='ad_lowqr';cat='anuncios';tone='warn';ad=$lowQR.a;rate=[math]::Round($lowQR.qlf/$lowQR.leads*100,1);leads=$lowQR.leads} }
$cheapAd = $adArr | Where-Object { $_.qlf -ge 5 -and $_.spend -gt 0 } | Sort-Object { $_.spend/$_.qlf } | Select-Object -First 1
if($cheapAd){ AddIns @{type='ad_cheap';cat='anuncios';tone='good';ad=$cheapAd.a;cplqlf=[math]::Round($cheapAd.spend/$cheapAd.qlf,2);qlf=$cheapAd.qlf} }
# -- funnel macro (30d vs 30d) --
$rate=[math]::Round((Sdiv $cur.qlf $cur.leads)*100,1); $prate=[math]::Round((Sdiv $prev.qlf $prev.leads)*100,1)
$tnQR = if($rate -ge $prate){'good'}else{'warn'}
AddIns @{type='funnel_qualrate';cat='funil';tone=$tnQR;rate=$rate;prevRate=$prate;deltaPP=[math]::Round($rate-$prate,1)}
$cplq=[math]::Round((Sdiv $cur.spend $cur.qlf),2)
$tnCP = if($cplq -le 150){'good'}else{'warn'}
AddIns @{type='funnel_cplqlf';cat='funil';tone=$tnCP;cplqlf=$cplq;target=150}
if($cur.sales -gt 0){ AddIns @{type='funnel_cac';cat='funil';tone='info';cac=[math]::Round((Sdiv $cur.spend $cur.sales),2);ticket=[math]::Round((Sdiv $cur.revenue $cur.sales),2)} }
$convlp=[math]::Round((Sdiv $cur.leads $cur.lpv)*100,1)
$tnLP = if($convlp -ge 8){'good'}else{'warn'}
AddIns @{type='funnel_convlp';cat='funil';tone=$tnLP;convlp=$convlp}

# ---- emit (por modo) ----------------------------------------------
if($Mode -eq 'all' -or $Mode -eq 'traffic'){
  WriteJs 'data.js' 'DASH_DATA' ([pscustomobject]@{
    generatedAt=$nowIso; generatedAtBR=$nowBR; taxMultiplier=$TAX
    qualification='Faturamento mensal acima de R$ 100 mil'
    dateMin=$dates[0]; dateMax=$dates[-1]; buyersTotal=$paidCount; buyersMatched=$matchedBuyers
    daily=$dailyArr; grain=$grainArr })
}
if($Mode -eq 'all' -or $Mode -eq 'objections'){
  WriteJs 'data-obj.js' 'DASH_OBJ' ([pscustomobject]@{
    generatedAt=$nowIso; generatedAtBR=$nowBR; buyersTotal=$paidCount; buyersMatched=$matchedBuyers
    objOrder=$OBJ_ORDER; objLeads=($objLeads.Values|Sort-Object date); objBuyers=($objBuyers.Values|Sort-Object date); objQuotes=@($objQuotes) })
}
if($Mode -eq 'all' -or $Mode -eq 'insights'){
  # serializa item a item (evita bug do ConvertTo-Json 5.1 com array heterogeneo) e monta o array na mao
  $parts=@(); foreach($it in $ins){ $parts += ($it | ConvertTo-Json -Depth 4 -Compress) }
  $insJson = '{"generatedAt":"'+$nowIso+'","generatedAtBR":"'+$nowBR+'","windowStart":"'+$w30s+'","windowEnd":"'+$dmax+'","qlfTotal":'+([int]$totQ)+',"buyersMatched":'+([int]$matchedBuyers)+',"insights":['+($parts -join ',')+']}'
  [IO.File]::WriteAllText((Join-Path $root 'data-insights.js'), ("window.DASH_INSIGHTS="+$insJson+";"), $utf8)
}
Write-Host ("OK mode={0}  days={1}  grain={2}  insights={3}  buyers={4}/{5}" -f $Mode,$dailyArr.Count,$grainArr.Count,$ins.Count,$matchedBuyers,$paidCount)
