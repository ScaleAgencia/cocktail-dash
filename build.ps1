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
param([ValidateSet('all','traffic','objections','insights','estudo')][string]$Mode='all')
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
$K_REV=HdrLike $kh 'Total com acr*'; $K_SRC=HdrIndex $kh 'Tracking src'   # vendedora (comercial)
# estudo das compradoras (padroes ASCII p/ nao quebrar no PS5.1)
$L_VOCE=HdrLike $lh '*Voc*'                       # [5] "Você é…" (1o header com "Voc")
$L_EQ=HdrLike $lh '*equipe*'                      # [6] tamanho da equipe
$L_FREQ=HdrLike $lh '*poderia estar faturando*'   # [10] frequencia
$L_INTENT=HdrLike $lh '*3.997*'                   # [13] intencao de pagamento (header cita R$ 3.997)

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

# vendas por dia × vendedora (coluna "Tracking src") — aba Comercial (period-aware)
# normaliza caixa do nome (fonte mistura "Michele"/"michele" -> nao dividir a vendedora)
function TitleName($s){ $s=Norm $s; if($s -eq ''){return ''}
  return (($s -split '\s+') | ForEach-Object { if($_.Length -gt 0){ $_.Substring(0,1).ToUpper()+$_.Substring(1).ToLower() } }) -join ' ' }
$sellers=@{}
foreach($r in $kd){ if((Norm $r[$K_STAT]) -ne 'paid'){continue}; $d=BrDate $r[$K_DATE]; if($d -eq ''){continue}
  $sv=TitleName $r[$K_SRC]; if($sv -eq ''){$sv='SEM_VENDEDORA'}
  $key="$d`u$sv"; if(-not $sellers.ContainsKey($key)){ $sellers[$key]=[pscustomobject]@{date=$d;seller=$sv;sales=0;revenue=0.0} }
  $o=$sellers[$key]; $o.sales++; $o.revenue += (MoneyKiwify $r[$K_REV]) }
$sellersArr=@($sellers.Values | Sort-Object date)

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
$w14s=$dt.AddDays(-13).ToString('yyyy-MM-dd')                                                    # janela curta p/ detectar custo caro AGORA
$w7s=$dt.AddDays(-6).ToString('yyyy-MM-dd'); $p7e=$dt.AddDays(-7).ToString('yyyy-MM-dd'); $p7s=$dt.AddDays(-13).ToString('yyyy-MM-dd')  # ult 7d vs 7d ant (tendencia)
function Sdiv($a,$b){ if($b -gt 0){ return $a/$b } else { return 0 } }
function SumRange($s,$e){ $sp=0.0;$im=0;$cl=0;$lp=0;$le=0;$ql=0;$sa=0;$re=0.0
  foreach($r in $dailyArr){ if($r.date -ge $s -and $r.date -le $e){ $sp+=$r.spend;$im+=$r.impr;$cl+=$r.clicks;$lp+=$r.lpv;$le+=$r.leads;$ql+=$r.qlf;$sa+=$r.sales;$re+=$r.revenue } }
  [pscustomobject]@{spend=$sp;impr=$im;clicks=$cl;lpv=$lp;leads=$le;qlf=$ql;sales=$sa;revenue=$re} }
$cur=SumRange $w30s $dmax; $prev=SumRange $p30s $p30e
$cur7=SumRange $w7s $dmax; $prev7=SumRange $p7s $p7e   # tendencia recente do CPL QLF
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
# campanha cara = CPL QLF acima da SUA media (ult 14d), gastando alto -> puxa o custo pra cima
$camp14=@{}
foreach($r in $grainArr){ if($r.date -lt $w14s -or $r.date -gt $dmax){continue}; if($r.campaign -in @('SEM_UTM','NAO_ATRIBUIDO') -or $r.campaign -like '*{*'){continue}
  if(-not $camp14.ContainsKey($r.campaign)){ $camp14[$r.campaign]=[pscustomobject]@{c=$r.campaign;spend=0.0;qlf=0} }
  $o=$camp14[$r.campaign];$o.spend+=$r.spend;$o.qlf+=$r.qlf }
$c14=@($camp14.Values); $tcSpend=($c14|Measure-Object spend -Sum).Sum; $tcQlf=($c14|Measure-Object qlf -Sum).Sum
$avgC14=0.0; if($tcQlf -gt 0){ $avgC14=$tcSpend/$tcQlf }
$exp = $c14 | Where-Object { $_.spend -ge 1000 -and $_.qlf -ge 3 -and $avgC14 -gt 0 -and ($_.spend/$_.qlf) -gt ($avgC14*1.3) } | Sort-Object spend -Descending | Select-Object -First 1
if($exp){ $ec=$exp.spend/$exp.qlf; AddIns @{type='camp_exp';cat='campanhas';tone='warn';campaign=$exp.c;cplqlf=[math]::Round($ec,2);spend=[math]::Round($exp.spend,2);avg=[math]::Round($avgC14,2);vsavg=[math]::Round($ec/$avgC14,2)} }
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
# anuncio caro = CPL QLF bem acima da media dos anuncios (ult 14d), gastando alto
$ad14=@{}
foreach($r in $grainArr){ if($r.date -lt $w14s -or $r.date -gt $dmax){continue}; $k=$r.ad; if($k -in @('SEM_UTM','NAO_ATRIBUIDO') -or $k -like '*{*'){continue}
  if(-not $ad14.ContainsKey($k)){ $ad14[$k]=[pscustomobject]@{a=$k;spend=0.0;qlf=0} }
  $o=$ad14[$k];$o.spend+=$r.spend;$o.qlf+=$r.qlf }
$a14=@($ad14.Values); $taSpend=($a14|Measure-Object spend -Sum).Sum; $taQlf=($a14|Measure-Object qlf -Sum).Sum
$avgA14=0.0; if($taQlf -gt 0){ $avgA14=$taSpend/$taQlf }
$adExp=$a14 | Where-Object { $_.spend -ge 600 -and $_.qlf -ge 2 -and $avgA14 -gt 0 -and ($_.spend/$_.qlf) -gt ($avgA14*1.4) } | Sort-Object spend -Descending | Select-Object -First 1
if($adExp){ $ae=$adExp.spend/$adExp.qlf; AddIns @{type='ad_exp';cat='anuncios';tone='warn';ad=$adExp.a;cplqlf=[math]::Round($ae,2);spend=[math]::Round($adExp.spend,2);avg=[math]::Round($avgA14,2);vsavg=[math]::Round($ae/$avgA14,2)} }
# -- funnel macro (30d vs 30d) --
$rate=[math]::Round((Sdiv $cur.qlf $cur.leads)*100,1); $prate=[math]::Round((Sdiv $prev.qlf $prev.leads)*100,1)
$tnQR = if($rate -ge $prate){'good'}else{'warn'}
AddIns @{type='funnel_qualrate';cat='funil';tone=$tnQR;rate=$rate;prevRate=$prate;deltaPP=[math]::Round($rate-$prate,1)}
# CPL QLF: media 30d + tendencia ult 7d vs 7d ant (capta o encarecimento recente que a media de 30d esconde)
$cplq=[math]::Round((Sdiv $cur.spend $cur.qlf),2)
$cpl7=[math]::Round((Sdiv $cur7.spend $cur7.qlf),2)
$cplp7=[math]::Round((Sdiv $prev7.spend $prev7.qlf),2)
$delta7=0.0; if($cplp7 -gt 0){ $delta7=[math]::Round(($cpl7-$cplp7)/$cplp7*100,1) }
$tnCP='info'; if($cur7.qlf -ge 15 -and $delta7 -ge 8){ $tnCP='warn' } elseif($delta7 -le -8){ $tnCP='good' }
AddIns @{type='funnel_cplqlf';cat='funil';tone=$tnCP;cplqlf=$cplq;cpl7=$cpl7;cplp7=$cplp7;delta7=$delta7}
if($cur.sales -gt 0){ AddIns @{type='funnel_cac';cat='funil';tone='info';cac=[math]::Round((Sdiv $cur.spend $cur.sales),2);ticket=[math]::Round((Sdiv $cur.revenue $cur.sales),2)} }
$convlp=[math]::Round((Sdiv $cur.leads $cur.lpv)*100,1)
$tnLP = if($convlp -ge 8){'good'}else{'warn'}
AddIns @{type='funnel_convlp';cat='funil';tone=$tnLP;convlp=$convlp}

# ===================================================================
#  ESTUDO DAS COMPRADORAS — 3 abas: tempo de compra, perfil, sinal
#  (só agregados/anonimizado; e-mail usado só p/ casar, nunca publicado)
# ===================================================================
$FAT_ORDER=@('Menos de R$ 5 mil','Entre R$ 5 mil e R$ 10 mil','Entre R$ 10 mil e R$ 50 mil','Entre R$ 50 mil e R$ 100 mil','Entre R$ 100 mil e R$ 200 mil','Acima de 200 mil')
$FAT_MID=@{'Menos de R$ 5 mil'=2500;'Entre R$ 5 mil e R$ 10 mil'=7500;'Entre R$ 10 mil e R$ 50 mil'=30000;'Entre R$ 50 mil e R$ 100 mil'=75000;'Entre R$ 100 mil e R$ 200 mil'=150000;'Acima de 200 mil'=300000}
# lead mais ANTIGO por e-mail (primeiro contato) com os campos do estudo
$leadStudy=@{}
foreach($r in $ld){ $e=(Norm $r[$L_EMAIL]).ToLower(); if($e -eq ''){continue}; $d=Norm $r[$L_DATE]; if($d -notmatch '^\d{4}-\d{2}-\d{2}$'){continue}
  if(-not $leadStudy.ContainsKey($e) -or $d -lt $leadStudy[$e].date){
    $leadStudy[$e]=[pscustomobject]@{date=$d;fat=(Norm $r[$L_FAT]);voce=(Norm $r[$L_VOCE]);eq=(Norm $r[$L_EQ]);freq=(Norm $r[$L_FREQ]);intent=(Norm $r[$L_INTENT]);desafio=(Norm $r[$L_DESAFIO])} } }
# compradoras casadas (paid + e-mail casa com lead datado)
$buyers=New-Object System.Collections.Generic.List[object]
foreach($r in $kd){ if((Norm $r[$K_STAT]) -ne 'paid'){continue}; $pr=Norm $r[$K_DATE]; if($pr -notmatch '^\d{2}/\d{2}/\d{4}'){continue}
  $e=(Norm $r[$K_EMAIL]).ToLower(); if($e -eq '' -or -not $leadStudy.ContainsKey($e)){continue}
  $m=$leadStudy[$e]; $pd=[datetime]::ParseExact($pr.Substring(0,10),'dd/MM/yyyy',$null); $lead=[datetime]::ParseExact($m.date,'yyyy-MM-dd',$null)
  $buyers.Add([pscustomobject]@{days=($pd-$lead).Days;fat=$m.fat;voce=$m.voce;eq=$m.eq;freq=$m.freq;intent=$m.intent;desafio=$m.desafio;rev=(MoneyKiwify $r[$K_REV])}) }
$nB=$buyers.Count
function CleanOpt($s){ $s=Norm $s; return ($s -replace '^[-\s]+','') }   # tira "- " do inicio das opcoes
# -- tempo ate compra --
$dpos=@($buyers | Where-Object {$_.days -ge 0} | ForEach-Object {$_.days} | Sort-Object)
$tMean=0.0;$tMed=0;$w3=0;$w7=0; if($dpos.Count){ $tMean=[math]::Round((($dpos|Measure-Object -Average).Average),1); $tMed=$dpos[[int][math]::Floor($dpos.Count/2)]
  $w3=[math]::Round((($dpos|Where-Object{$_ -le 3}).Count/$dpos.Count*100),0); $w7=[math]::Round((($dpos|Where-Object{$_ -le 7}).Count/$dpos.Count*100),0) }
$tb=[ordered]@{'Mesmo dia'=0;'1 a 3 dias'=0;'4 a 7 dias'=0;'8 a 14 dias'=0;'15 a 30 dias'=0;'31+ dias'=0}
foreach($d in $dpos){ if($d -le 0){$tb['Mesmo dia']++}elseif($d -le 3){$tb['1 a 3 dias']++}elseif($d -le 7){$tb['4 a 7 dias']++}elseif($d -le 14){$tb['8 a 14 dias']++}elseif($d -le 30){$tb['15 a 30 dias']++}else{$tb['31+ dias']++} }
$tempoBk=@(); foreach($kk in $tb.Keys){ $p=0.0; if($dpos.Count){$p=[math]::Round($tb[$kk]/$dpos.Count*100,1)}; $tempoBk+=[pscustomobject]@{label=$kk;n=$tb[$kk];pct=$p} }
# -- perfil: distribuicoes --
function DistArr($prop,$order){ $h=@{}; foreach($b in $buyers){ $v=CleanOpt $b.$prop; if($v -eq ''){continue}; if(-not $h.ContainsKey($v)){$h[$v]=0}; $h[$v]++ }
  $keys=@(); if($order){ foreach($o in $order){ if($h.ContainsKey($o)){$keys+=$o} } } else { $keys=@($h.GetEnumerator()|Sort-Object Value -Descending|ForEach-Object{$_.Key}) }
  $out=@(); foreach($k in $keys){ $pp=0.0; if($nB){$pp=[math]::Round($h[$k]/$nB*100,1)}; $out+=[pscustomobject]@{label=$k;n=$h[$k];pct=$pp} }; return ,$out }
$fatDist=DistArr 'fat' $FAT_ORDER
$voceDist=DistArr 'voce' $null
$intentDist=DistArr 'intent' $null
$eqDist=DistArr 'eq' @('1','2-7','8-15','16-50','50+')
$fatV=@($buyers | Where-Object {$FAT_MID.ContainsKey($_.fat)} | ForEach-Object {$FAT_MID[$_.fat]})
$fatMedia=0; if($fatV.Count){$fatMedia=[math]::Round(($fatV|Measure-Object -Average).Average,0)}
$ticket=0.0; if($nB){$ticket=[math]::Round((@($buyers|ForEach-Object{$_.rev})|Measure-Object -Sum).Sum/$nB,2)}
# objecoes das compradoras
$objB=@{}; foreach($b in $buyers){ $bk=Bucket $b.desafio; if(-not $objB.ContainsKey($bk)){$objB[$bk]=0}; $objB[$bk]++ }
$objDist=@(); foreach($k in $OBJ_ORDER){ if($objB.ContainsKey($k) -and $objB[$k] -gt 0){ $pp=0.0; if($nB){$pp=[math]::Round($objB[$k]/$nB*100,1)}; $objDist+=[pscustomobject]@{label=$k;n=$objB[$k];pct=$pp} } }
# depoimentos anonimizados das compradoras (campo "principal desafio")
$qc=@(); foreach($b in $buyers){ $t=Norm $b.desafio; if($t.Length -lt 22 -or $t.Length -gt 160){continue}
  if($t -match '@' -or $t -match 'http' -or $t -match '\d{4,}'){continue}
  $col=($t.ToLower() -replace '\s',''); if(($col.ToCharArray()|Select-Object -Unique).Count -le 4){continue}; $qc+=$t }
$quotes=@($qc | Select-Object -Unique | Select-Object -First 12)
$estudo=[pscustomobject]@{
  generatedAt=$nowIso; generatedAtBR=$nowBR; buyersTotal=$paidCount; buyersMatched=$nB; ticket=$ticket; fatMedia=$fatMedia
  tempo=[pscustomobject]@{n=$dpos.Count;mean=$tMean;median=$tMed;within3=$w3;within7=$w7;buckets=@($tempoBk)}
  perfil=[pscustomobject]@{fatDist=@($fatDist);voce=@($voceDist);intent=@($intentDist);equipe=@($eqDist);objec=@($objDist);quotes=@($quotes)}
}

# ---- emit (por modo) ----------------------------------------------
if($Mode -eq 'all' -or $Mode -eq 'estudo'){
  WriteJs 'data-estudo.js' 'DASH_ESTUDO' $estudo
}
if($Mode -eq 'all' -or $Mode -eq 'traffic'){
  WriteJs 'data.js' 'DASH_DATA' ([pscustomobject]@{
    generatedAt=$nowIso; generatedAtBR=$nowBR; taxMultiplier=$TAX
    qualification='Faturamento mensal acima de R$ 100 mil'
    dateMin=$dates[0]; dateMax=$dates[-1]; buyersTotal=$paidCount; buyersMatched=$matchedBuyers
    daily=$dailyArr; grain=$grainArr; sellers=$sellersArr })
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
