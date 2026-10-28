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
#    perfil     -> data-perfil.js   (objecoes/compradoras/tempo POR PESSOA, filtravel por data) — tambem sai em all/estudo
#    all        -> os 3 (uso local/manual)
param([ValidateSet('all','traffic','objections','insights','estudo','apice','ascensao','datas','perfil')][string]$Mode='all')
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
# Queries do Meta: planilha NOVA desde 28/10/2026 (a 1S_5PYUz... ficou vazia). Mesma aba/gid e mesmas colunas, historico desde 06/01.
$QUERIES_ID = '1tmPnZIkieT98eiTma7WtTv68jCH8xIp6cWa0oFu0Q2I'; $QUERIES_GID = '1160142252'
$MASTER_ID  = '1WuETdVje43yvMfyQDHO1PObXj_G9G-t6JjG6q987Z4o'
$LEADS_GID  = '603619749'
$KIWIFY_GID = '1987730935'
# Planilha de CONTROLE DE VENDAS manual (Maira) — 1 aba por evento. AGOSTO em diante ela pega
# vendas que a kiwify NAO tem (pagamento manual etc.). Une por e-mail no FUNIL (daily+arvore), sem
# duplicar. ⚠️ A aba "Datas" (vagas por evento) NAO usa isto — continua na kiwify (pedido do cliente).
$VENDAS_ID   = '1NoRHqbeO9fVTacQgADIUvPMfdt0v5HBgtMr8m3v9858'
# As abas de evento (1 por Cocktail) e a data de cada uma sao AUTO-DESCOBERTAS do htmlview logo antes do
# parse (a planilha ganha abas novas toda semana; hardcodar CONGELA eventos futuros). Fallback embutido.
$VENDAS_GIDS_FB = @('0','1144515540','688780550','981750885','1769268662','1189147493','877739094','2029680212','179128172','1136083474','454135515','365567641','992273412')
# CORRECAO MANUAL de evento — quando a coluna G ficou com a data antiga mas o comercial confirmou o evento
# certo (ex.: remanejada e esqueceu de trocar a col G). Sobrepoe a col G p/ estes e-mails. ⚠️ Quando o
# comercial corrigir a col G na planilha, pode remover a linha daqui (fica redundante, nao atrapalha).
$VENDA_EVFIX = @{ }   # vazio: Evellyn corrigiu a col G da kayanedias/frann na planilha (11/09) -> nao precisa mais
$VENDAS_EVDATE_FB = @{ '0'='2026-02-02';'1144515540'='2026-03-05';'688780550'='2026-04-07';'981750885'='2026-05-27';'1769268662'='2026-06-09';'1189147493'='2026-07-14';'877739094'='2026-07-21';'2029680212'='2026-07-30';'179128172'='2026-08-05';'1136083474'='2026-08-25';'454135515'='2026-09-01';'365567641'='2026-09-08';'992273412'='2026-10-14' }
$VENDAS_FROM = '2026-08-01'   # funil: so vendas com DT COMPRA a partir daqui
$TAX = 1.1385
# QUALIFICACAO (regra nova ago/2026 do cliente): DESqualificado = fatura < 100 mil (col H "faturamento mensal")
# OU e CLT (col F "Voce e..."). TUDO ALEM disso e qualificado (default = qualificado, robusto a novas
# opcoes de resposta >=100k que a planilha venha a criar). LOW_FAT = todas as faixas < 100 mil, grafias antiga+nova.
$LOW_FAT = @('Menos de R$ 5 mil','Entre R$ 5 mil e R$ 10 mil','Entre R$ 10 mil e R$ 50 mil','Entre R$ 50 mil e R$ 100 mil','Menos de 100mil')
# ---- FORMS (Lead Form NATIVO do Meta) --------------------------------
# Campanhas com a TAG "forms" (um segmento "| forms" no nome) cruzam com ESTA planilha — export do
# Lead Form, que ja traz campaign_name/adset_name/ad_name iguaizinhos aos das queries (verificado
# byte-a-byte), entao os leads caem no MESMO grain do gasto. As DEMAIS campanhas seguem na planilha
# de leads de sempre (a antiga tem 0 lead "forms", sem risco de dobra). Qualificacao = MESMA regra
# (<100k ou CLT desqualifica), mas aqui a resposta vem como "menos_de_100_mil" (minuscula/underscore).
$FORMS_ID = '1HuURt5bclbK2lUhbnDWvYmlwQowif-gFoVl_HV3Ukws'; $FORMS_GID = '0'
$FORMS_LOW_FAT = @('menos de 100 mil')   # faixas <100k no formato do forms (deaccent + espaco); extensivel

function Get-Sheet($id,$gid,$out){
  $url = "https://docs.google.com/spreadsheets/d/$id/gviz/tq?tqx=out:csv&gid=$gid"
  Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -TimeoutSec 120
  if((Get-Item $out).Length -lt 50){ throw "Download too small: $out" }
}
# export CSV: traz o texto como aparece na celula (a gviz zera texto em coluna tipada como numero/data)
function Get-SheetExport($id,$gid,$out){
  Invoke-WebRequest -Uri "https://docs.google.com/spreadsheets/d/$id/export?format=csv&gid=$gid" -OutFile $out -UseBasicParsing -TimeoutSec 120
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
# qualificado = tem faturamento informado, NAO e CLT, e faturamento NAO esta nas faixas <100k
function IsQual($fat,$voce){ $f=Norm $fat; $v=Norm $voce; if($f -eq ''){return $false}; if($v -eq 'CLT'){return $false}; if($script:LOW_FAT -contains $f){return $false}; return $true }
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
function NameKey($s){ return ((Deaccent (Norm $s)) -replace '\s+',' ').Trim() }   # nome normalizado p/ casar apesar de acento/caixa/typo de e-mail
# ---- FORMS helpers ----
# campanha TEM a tag "forms" quando algum segmento "| ... |" do nome e exatamente "forms"
function IsFormsCamp($name){ foreach($seg in ($name -split '\|')){ if((Deaccent (Norm $seg)) -eq 'forms'){ return $true } }; return $false }
# faturamento do forms normalizado: deaccent + (_/espaco -> 1 espaco) + lower  -> "menos de 100 mil"
function FatNormForms($s){ return (((Deaccent (Norm $s)) -replace '[_\s]+',' ').Trim()) }
# qualificado (forms) = MESMA regra: tem faturamento, NAO e CLT e NAO esta nas faixas <100k
function IsQualForms($fat,$voce){ $f=FatNormForms $fat; $v=Deaccent (Norm $voce)
  if($f -eq ''){ return $false }
  if($v -match 'clt' -or $v -match 'funcionari' -or $v -match 'assalariad'){ return $false }
  if($script:FORMS_LOW_FAT -contains $f){ return $false }
  if($f -match 'menos' -and $f -match '100'){ return $false }   # "menos de 100 mil" (rede de seguranca)
  return $true }
# finder de cabecalho do forms (headers com underscore/acento/"?"): deaccent + (_?-> espaco) + -like
function FHdr($hdr,$pat){ for($i=0;$i -lt $hdr.Count;$i++){ $h=(((Deaccent (Norm $hdr[$i])) -replace '[_\?]+',' ').Trim()); if($h -like $pat){ return $i } }; return -1 }
$OBJ_BUCKETS = @(
  # (out/2026: + palavras das respostas recentes que caiam em "Outros": ganhar mais/ampliar/plato, publico alvo, imposto/tributos, socios, governo...)
  @('Equipe & Pessoas',       @('equipe','pessoa','mao de obra','mao obra','colaborador','funcionario','contrat','lider','recursos humanos','socio','socia','profissionais')),
  @('Delegacao & Escala',     @('deleg','escal','cresc','expand','expans','sair da operac','depend','sozinh','dono faz','centraliz','sobrecarg','estagn','ganhar mais','ampli','avanc','alavanc','plato','prosper','proximo nivel','milhao','milhoes')),
  @('Financeiro & Capital',   @('financ','dinheiro','capital','fluxo de caixa','caixa','lucro','custo','precific','investiment',' giro','endivid','divida','inadimpl','preco','imposto','tribut','contas','ticket','cobrar','margem','juros')),
  @('Vendas & Clientes',      @('vend','client','captac','captar','prospec','fechar','fechament','convert','faturament','faturar','negocia','funil','orcament','comercial')),
  @('Marketing & Divulgacao', @('marketing','divulg','trafego','anunci','publicidad','digital','posicion','branding','rede social','redes sociais','instagram','alcance','visibilidade','seguidor','conteudo','comunica','reconheci','publico','atrair','atracao')),
  @('Gestao & Organizacao',   @('gest','organiz','administr','process','controle','tempo','rotina','planejament','sistema','estrutur')),
  @('Estrategia & Direcao',   @('estrateg','direcionament','direcao','direcion','clareza','conheciment','rumo','visao','perspectiva','descobrir','inova','novo negocio','transicao')),
  @('Mindset & Constancia',   @('medo','consist','constan','discipl','foco','mindset','inseguran','autoconf','procrastin','ansiedad','acredit','autoestima','motiva','coragem','desanim','emocional','ousar','ousad','atitude','paradigma','me encontrar','trava','limitant')),
  @('Concorrencia & Mercado', @('concorr','mercado','crise','economi','sazonal','governo','cenario')),
  @('Produto & Operacao',     @('produt','estoque','operac','qualidade','entrega','logistic','fornecedor','servico','espaco fisico','atendimento','tecnica')),
  @('Sem empresa / Inicio',   @('nao tenho empresa','sem empresa','comecar','comec','abrir empresa','iniciante','ainda nao','nao tenho','clt','salario','emprego','eu mesma'))
)
$OBJ_ORDER = @($OBJ_BUCKETS | ForEach-Object { $_[0] }) + 'Outros'
function Bucket($txt){ $t=Deaccent (Norm $txt); if($t -eq ''){return 'Outros'}
  foreach($b in $OBJ_BUCKETS){ foreach($kw in $b[1]){ if($t.Contains($kw)){ return $b[0] } } }
  return 'Outros' }

Write-Host "Downloading sheets..."
$qCsv=Join-Path $dataDir 'queries.csv'; $lCsv=Join-Path $dataDir 'leads.csv'; $kCsv=Join-Path $dataDir 'kiwify.csv'
$fCsv=Join-Path $dataDir 'forms.csv'
Get-Sheet $QUERIES_ID $QUERIES_GID $qCsv
Get-Sheet $MASTER_ID  $LEADS_GID   $lCsv
Get-Sheet $MASTER_ID  $KIWIFY_GID  $kCsv
Get-Sheet $FORMS_ID   $FORMS_GID   $fCsv

$q = Read-Csv $qCsv;  $qh=$q[0]; $qd=$q[1..($q.Count-1)]
$l = Read-Csv $lCsv;  $lh=$l[0]; $ld=$l[1..($l.Count-1)]
$k = Read-Csv $kCsv;  $kh=$k[0]; $kd=$k[1..($k.Count-1)]
$ff = @(Read-Csv $fCsv); $ffh = $ff[0]; $ffd = @(); if($ff.Count -gt 1){ $ffd = $ff[1..($ff.Count-1)] }   # @() + guarda: aba vazia nao quebra (bug conhecido Read-Csv)

# ---- column indices ------------------------------------------------
$Q_DAY=HdrIndex $qh 'Day'; $Q_CAMP=HdrIndex $qh 'Campaign Name'; $Q_SET=HdrIndex $qh 'Ad Set Name'
$Q_AD=HdrIndex $qh 'Ad Name'; $Q_SPEND=HdrIndex $qh 'Amount Spent'; $Q_IMP=HdrIndex $qh 'Impressions'
$Q_CLK=HdrIndex $qh 'Link Clicks'; $Q_LPV=HdrIndex $qh 'Landing Page Views'

$L_EMAIL=HdrLike $lh '*melhor E-mail*'; $L_FAT=HdrLike $lh '*faturamento mensal*'
$L_DATE=HdrIndex $lh 'Data Formatada'; $L_CAMP=HdrIndex $lh 'utm_campaign'; $L_SET=HdrIndex $lh 'utm_medium'
$L_CONT=HdrIndex $lh 'utm_content'; $L_SRC=HdrIndex $lh 'utm_source'; $L_DESAFIO=HdrLike $lh '*principal desafio*'

$K_STAT=HdrIndex $kh 'Status'; $K_EMAIL=HdrIndex $kh 'Email'; $K_DATE=HdrIndex $kh 'Data Simplificada'
$K_REV=HdrLike $kh 'Total com acr*'; $K_SRC=HdrIndex $kh 'Tracking src'   # vendedora (comercial)
$K_NOME=HdrLike $kh '*Cliente*'; if($K_NOME -lt 0){ $K_NOME=3 }   # nome da compradora na kiwify (p/ casar cancelamento por nome)

# ---- forms (Lead Form): indices por NOME (robusto a reordenacao) com fallback na posicao conhecida ----
$FF_DATE=FHdr $ffh '*created time*'; if($FF_DATE -lt 0){ $FF_DATE=1 }
$FF_CAMP=FHdr $ffh '*campaign name*'; if($FF_CAMP -lt 0){ $FF_CAMP=7 }
$FF_SET =FHdr $ffh '*adset name*';   if($FF_SET  -lt 0){ $FF_SET=5 }
$FF_AD  =FHdr $ffh '*ad name*';      if($FF_AD   -lt 0){ $FF_AD=3 }
$FF_EMAIL=FHdr $ffh '*email*';       if($FF_EMAIL -lt 0){ $FF_EMAIL=23 }
$FF_FAT =FHdr $ffh '*faturamento mensal*'; if($FF_FAT -lt 0){ $FF_FAT=15 }   # "qual e o seu faturamento mensal?" (NAO o total 2025/2026)
$FF_VOCE=FHdr $ffh 'voce e*';        if($FF_VOCE -lt 0){ $FF_VOCE=12 }       # "voce e..." (empresaria/CLT etc.)
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
  $isq = IsQual $r[$L_FAT] $r[$L_VOCE]
  $o=GetDay $d; $o.leads++; if($isq){ $o.qlf++ }
  $ob=GetObjL $d (Bucket $r[$L_DESAFIO]); $ob.total++; if($isq){ $ob.qlf++ } }

# DD/MM/YYYY -> YYYY-MM-DD
function BrDate($s){ $s=Norm $s; if($s -match '^(\d{2})/(\d{2})/(\d{4})'){ return "$($Matches[3])-$($Matches[2])-$($Matches[1])" }; return '' }
# (o loop de vendas kiwify -> daily foi movido p/ DEPOIS da exclusao de cancelados, mais abaixo)

# --- AUTO-DESCOBRIR as abas de evento (nome tipo "14 OUT"/"02 Fev") do htmlview; data pelo nome da aba ---
$mesMap=@{fev='02';mar='03';abr='04';mai='05';jun='06';jul='07';ago='08';set='09';out='10';nov='11';dez='12'}
$VENDAS_GIDS=@(); $VENDAS_EVDATE=@{}
try{
  $wcH=New-Object System.Net.WebClient; $wcH.Encoding=[Text.Encoding]::UTF8
  $htmlV=$wcH.DownloadString("https://docs.google.com/spreadsheets/d/$VENDAS_ID/htmlview")
  foreach($mm in [regex]::Matches($htmlV,'name:\s*"((?:[^"\\]|\\.)*)",[^}]*?gid:\s*"(\d+)"')){
    $nm=$mm.Groups[1].Value; $gid=$mm.Groups[2].Value
    if($nm -match '(?i)^\s*(\d{1,2})\s*(fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)'){
      $VENDAS_GIDS+=$gid; $VENDAS_EVDATE[$gid]=('2026-{0}-{1:d2}' -f $mesMap[$Matches[2].ToLower()],[int]$Matches[1]) } }
}catch{}
$evDiscovered=($VENDAS_GIDS.Count -ge 10)   # so confio no conjunto de datas se veio da descoberta (fallback pode estar desatualizado)
if($VENDAS_GIDS.Count -lt 10){ $VENDAS_GIDS=$VENDAS_GIDS_FB; $VENDAS_EVDATE=$VENDAS_EVDATE_FB }   # fallback se a descoberta falhar
$evTabDates=@{}; foreach($v in $VENDAS_EVDATE.Values){ $evTabDates[$v]=1 }   # datas que TEM aba = eventos que existem

# --- CANCELAMENTOS: quem o comercial MARCOU sai de TUDO (vaga + faturamento + venda), por e-mail E nome ---
# Sinais: (a) linha VERMELHA (fill FF0000) no controle; (b) a aba "cancelado". gviz nao traz cor -> XLSX.
# ⚠️ Cancelamento tem que ser MARCADO (vermelho ou aba "cancelado"), NAO apenas APAGADO — apagar a linha
# fica identico a uma venda kiwify ainda nao lancada, sem como diferenciar. $vendaExclE=e-mails, $vendaExclN=nomes.
$vendaExclE=@{}; $vendaExclN=@{}
try{   # (a) linhas vermelhas (FF0000) via XLSX
  $wcX=New-Object System.Net.WebClient; $xlsx=Join-Path $dataDir 'vendas.xlsx'; $wcX.DownloadFile("https://docs.google.com/spreadsheets/d/$VENDAS_ID/export?format=xlsx",$xlsx)
  $xdir=Join-Path $dataDir 'vendas_x'; if(Test-Path $xdir){Remove-Item $xdir -Recurse -Force}
  Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($xlsx,$xdir)
  $stylesX=[xml](Get-Content "$xdir\xl\styles.xml" -Raw -Encoding UTF8)
  $xfFill=@(); foreach($xf in $stylesX.styleSheet.cellXfs.xf){ $xfFill+=[int]$xf.fillId }
  $redIds=@{}; $fi=0; foreach($f in $stylesX.styleSheet.fills.fill){ $rgb=''; if($f.patternFill.fgColor){$rgb=$f.patternFill.fgColor.rgb}; if($rgb -eq 'FFFF0000'){$redIds[$fi]=1}; $fi++ }
  $ssX=@(); if(Test-Path "$xdir\xl\sharedStrings.xml"){ $sxX=[xml](Get-Content "$xdir\xl\sharedStrings.xml" -Raw -Encoding UTF8); foreach($si in $sxX.sst.si){ $t=''; if($si.t){ if($si.t.'#text'){$t=$si.t.'#text'}else{$t=[string]$si.t} } elseif($si.r){ $t=($si.r|ForEach-Object{[string]$_.t}) -join '' }; $ssX+=$t } }
  if($redIds.Count -gt 0){
    $redXf=@(); for($s=0;$s -lt $xfFill.Count;$s++){ if($redIds.ContainsKey($xfFill[$s])){ $redXf+=$s } }
    $redPat='s="(' + (($redXf) -join '|') + ')"'   # pre-filtro rapido: so parsear abas que TEM celula vermelha
    foreach($shf in (Get-ChildItem "$xdir\xl\worksheets" -Filter 'sheet*.xml')){
      $raw=Get-Content $shf.FullName -Raw -Encoding UTF8
      if($redXf.Count -eq 0 -or $raw -notmatch $redPat){ continue }
      $wsX=[xml]$raw
      foreach($row in $wsX.worksheet.sheetData.row){ $isRed=$false; $em=''
        foreach($c in $row.c){ $s=0; if($c.s){$s=[int]$c.s}; if($redIds.ContainsKey($xfFill[$s])){$isRed=$true}
          $val=''; if($c.t -eq 's'){ if($c.v -ne $null){$val=$ssX[[int]$c.v]} } elseif($c.v -ne $null){$val=[string]$c.v}; if($val -match '@'){$em=($val -replace [char]0x200b,'').Trim().ToLower()} }
        if($isRed -and $em -match '@'){ $vendaExclE[$em]=1 } } } }
}catch{}
try{   # (b) aba "cancelado" (gid 803943340): exclui por e-mail E nome
  $cc=Join-Path $dataDir 'venda_cancel.csv'; Get-Sheet $VENDAS_ID '803943340' $cc
  foreach($row in (Read-Csv $cc)){ $ce='';$cn=''; for($ci=0;$ci -lt $row.Count;$ci++){ $c=(Norm $row[$ci]).ToLower(); if($c -match '@'){ $ce=($c -split '[;,\s]')[0]; if($ci -gt 0){$cn=Norm $row[$ci-1]}; break } }
    if($ce -match '@'){ $vendaExclE[$ce]=1; $ck=NameKey $cn; if($ck -match ' '){ $vendaExclN[$ck]=1 } } }
}catch{}
$vendaRed=$vendaExclE   # compat: o parse manual usa $vendaRed p/ pular
Write-Host ("VENDAS: {0} abas | {1} e-mails + {2} nomes excluidos (vermelho+cancelado)" -f $VENDAS_GIDS.Count,$vendaExclE.Count,$vendaExclN.Count)
# vendas kiwify -> daily (por dia), PULANDO cancelados (por e-mail e nome)
foreach($r in $kd){ if((Norm $r[$K_STAT]) -ne 'paid'){continue}; $em=(Norm $r[$K_EMAIL]).ToLower()
  if($vendaExclE.ContainsKey($em)){continue}; $nk=NameKey $r[$K_NOME]; if($nk -match ' ' -and $vendaExclN.ContainsKey($nk)){continue}
  $d=BrDate $r[$K_DATE]; if($d -eq ''){continue}; $o=GetDay $d; $o.sales++; $o.revenue += (MoneyKiwify $r[$K_REV]) }

# ---- VENDAS EXTRAS (planilha de controle Maira) — vendas que a kiwify NAO tem -------------------
# So VALOR>0 = venda de verdade (linhas sem valor = lead em negociacao). DEDUP por e-mail e EXCLUI
# quem ja esta paga na kiwify (garante: NENHUMA venda contada 2x). Monta 1 lista deduplicada
# ($manualExtras) com data-da-compra (DT COMPRA) E data-do-evento (DATA COCKTAIL). Dela deriva:
#   - $extras  = funil (daily/arvore/comercial): so compras a partir de $VENDAS_FROM (agosto+).
#   - a aba Datas usa $manualExtras direto, por DATA COCKTAIL (independe da data da compra).
# Substitui o antigo ajuste manual das 2 fantasmas de 12/08 (agora reais: patricia.bernardon + francatime).
# Parser por CONTEUDO (nao por nome de coluna): as abas antigas variam (sem cabecalho, titulo na 1a
# linha, colunas deslocadas). Detecta por padrao: e-mail = celula com @; valor = celula R$ BR; data do
# EVENTO = celula dd/mm/AAAA (com ano); data da COMPRA = celula dd/mm (sem ano). Linhas de titulo/
# cabecalho caem fora sozinhas (nao tem @ nem valor). Consolida por e-mail entre abas (preenche o que faltar).
$reMoney='^\d{1,3}(\.\d{3})*,\d{2}$'; $reEvDate='^(\d{1,2})/(\d{1,2})/\d{2,4}$'; $reBuyDate='^(\d{1,2})/(\d{1,2})$'
$kiwPaidEmails=@{}; $kiwNames=@{}
foreach($r in $kd){ if((Norm $r[$K_STAT]) -ne 'paid'){continue}; $e=(Norm $r[$K_EMAIL]).ToLower(); if($e -match '@'){ $kiwPaidEmails[$e]=1 }
  $nk=NameKey $r[$K_NOME]; if($nk -match ' '){ $kiwNames[$nk]=1 } }   # nomes p/ pegar a mesma pessoa com e-mail digitado diferente (typo)
$manualByEmail=[ordered]@{}; $manEvByEmail=[ordered]@{}   # manEvByEmail = col G (DATA COCKTAIL) por pessoa, AUTORITATIVO p/ a aba Datas (inclui kiwify remanejadas)
foreach($vg in $VENDAS_GIDS){
  $vc=Join-Path $dataDir "venda_$vg.csv"
  try{ Get-SheetExport $VENDAS_ID $vg $vc }catch{ continue }   # export (NAO gviz): gviz apaga o texto "CONVIDADA" da col F (coluna de valor)
  if(-not (Test-Path $vc)){ continue }
  $vv=Read-Csv $vc; if($vv.Count -lt 1){ continue }
  $tabEv=''; if($VENDAS_EVDATE.ContainsKey($vg)){ $tabEv=$VENDAS_EVDATE[$vg] }
  foreach($row in $vv){
    $e=''; $nome=''; for($ci=0;$ci -lt $row.Count;$ci++){ $c=(Norm $row[$ci]).ToLower(); if($c -match '@'){ $e=($c -split '[;,\s]')[0]; if($ci -gt 0){ $nome=Norm $row[$ci-1] }; break } }
    # CONVIDADA (pedido do cliente 27/10/2026): comercial escreve "CONVIDADA" na col F (VALOR) ou na forma de
    # pagamento. Ocupa VAGA (aba Datas) mas NAO e venda paga -> fora do funil/ROAS/faturamento.
    $isGuest=$false; foreach($cell in $row){ if((Deaccent (Norm $cell)) -match '^convidad[ao]s?$'){ $isGuest=$true; break } }
    if($e -notmatch '@'){   # sem e-mail: so entra se for convidada (ex.: "convidada 1" reservando a vaga); chave = aba + nome
      $nome=''; foreach($cell in $row){ $c=Norm $cell; if($c -match '[A-Za-z]' -and (Deaccent $c) -notmatch '^convidad[ao]s?$'){ $nome=$c; break } }
      if((Deaccent $nome) -match '^convidad'){ $isGuest=$true }
      if(-not $isGuest -or $nome -eq ''){ continue }
      $e='sem-email:'+$vg+':'+(NameKey $nome) }
    $val=0.0; if(-not $isGuest){ foreach($cell in $row){ $c=((Norm $cell) -replace '[R$\s]',''); if($c -match $reMoney){ $val=[double]($c -replace '\.','' -replace ',','.'); break } } }
    if(-not $isGuest -and $val -le 0){ continue }    # sem VALOR = ainda nao e venda
    if($vendaExclE.ContainsKey($e)){ continue }        # cancelado (vermelho/aba cancelado) por e-mail
    $nmc=NameKey $nome; if($nmc -match ' ' -and $vendaExclN.ContainsKey($nmc)){ continue }   # ...ou por nome
    $evk=''; $sel=''; for($ci=0;$ci -lt $row.Count;$ci++){ $c=Norm $row[$ci]; if($c -match $reEvDate){ $evk=('2026-{0:d2}-{1:d2}' -f [int]$Matches[2],[int]$Matches[1]); if($ci+1 -lt $row.Count){ $sel=Norm $row[$ci+1] }; break } }
    if($evk -eq ''){ $evk=$tabEv }                   # fallback: data do evento da propria aba
    elseif($evDiscovered -and $tabEv -ne '' -and -not $evTabDates.ContainsKey($evk)){ $evk=$tabEv }   # col G com data que NAO tem aba (typo, ex. 08/04 na aba 7 Abril; data da compra no lugar do evento) -> evento da propria aba
    $manEvByEmail[$e]=[pscustomobject]@{ev=$evk;val=$val;guest=$isGuest;nome=$nome}   # col G p/ Datas — ULTIMA aba vence (reschedule mais recente)
    if($isGuest){ continue }                         # convidada: so a vaga, nunca venda
    if($kiwPaidEmails.ContainsKey($e)){ continue }   # FUNIL: so nao-kiwify por e-mail
    $nk=NameKey $nome; if($nk -match ' ' -and $kiwNames.ContainsKey($nk)){ continue }   # ...E nao-kiwify por NOME (mesma pessoa c/ e-mail digitado diferente/typo) -> nao duplica a venda no funil/ROAS
    $dtk=''; foreach($cell in $row){ $c=Norm $cell; if($c -match $reBuyDate){ $dtk=('2026-{0:d2}-{1:d2}' -f [int]$Matches[2],[int]$Matches[1]); break } }
    if(-not $manualByEmail.Contains($e)){ $manualByEmail[$e]=[pscustomobject]@{email=$e;valor=$val;dtKey=$dtk;evKey=$evk;seller=$sel} }
    else{ $o=$manualByEmail[$e]; if($o.evKey -eq ''){$o.evKey=$evk}; if($o.dtKey -eq ''){$o.dtKey=$dtk}; if($o.seller -eq ''){$o.seller=$sel} } }   # consolida entre abas
}
# aplica a CORRECAO MANUAL de evento (col G ficou com data antiga; comercial confirmou o certo)
foreach($fe in $VENDA_EVFIX.Keys){ $fk=($fe -replace [char]0x200b,'').Trim().ToLower()
  if($manEvByEmail.Contains($fk)){ $manEvByEmail[$fk].ev=$VENDA_EVFIX[$fe] } else { $manEvByEmail[$fk]=[pscustomobject]@{ev=$VENDA_EVFIX[$fe];val=4997.0} } }
$manualExtras=@($manualByEmail.Values)   # 1 registro por pessoa (fora da kiwify), com evento + compra + vendedora
# funil = so compras com data valida a partir de agosto (mesma regra de antes)
$extras=@()
foreach($m in $manualExtras){ if($m.dtKey -ne '' -and $m.dtKey -ge $VENDAS_FROM){ $extras += [pscustomobject]@{date=$m.dtKey;email=$m.email;valor=$m.valor;seller=$m.seller} } }
foreach($x in $extras){ $o=GetDay $x.date; $o.sales++; $o.revenue += $x.valor }   # entra no daily/funil/ROAS

# vendas por dia × vendedora (coluna "Tracking src") — aba Comercial (period-aware)
# normaliza caixa do nome (fonte mistura "Michele"/"michele" -> nao dividir a vendedora)
function TitleName($s){ $s=Norm $s; if($s -eq ''){return ''}
  return (($s -split '\s+') | ForEach-Object { if($_.Length -gt 0){ $_.Substring(0,1).ToUpper()+$_.Substring(1).ToLower() } }) -join ' ' }
# grafias diferentes da MESMA vendedora (corrige typo na fonte). Extensivel.
# ⚠️ Mayra e Mayara sao pessoas DIFERENTES — nao fundir. "Mayara Leonel" (planilha nova) = "Mayara" (kiwify).
$SELLER_ALIAS=@{ 'Evelyn'='Evellyn'; 'Evelly'='Evellyn'; 'Mayara Leonel'='Mayara' }
# faixas de faturamento (menor -> maior) p/ ver a composicao por vendedora (neutro)
$FAT6=@('Menos de R$ 5 mil','Entre R$ 5 mil e R$ 10 mil','Entre R$ 10 mil e R$ 50 mil','Entre R$ 50 mil e R$ 100 mil','Entre R$ 100 mil e R$ 200 mil','Acima de 200 mil')
# primeiro contato (data + faturamento) por e-mail — p/ tempo de fechamento e perfil por vendedora
$leadFirst=@{}
foreach($r in $ld){ $e=(Norm $r[$L_EMAIL]).ToLower(); if($e -eq ''){continue}; $d=Norm $r[$L_DATE]; if($d -notmatch '^\d{4}-\d{2}-\d{2}$'){continue}
  if(-not $leadFirst.ContainsKey($e) -or $d -lt $leadFirst[$e].date){ $leadFirst[$e]=[pscustomobject]@{date=$d;fat=(Norm $r[$L_FAT])} } }
$sellers=@{}
foreach($r in $kd){ if((Norm $r[$K_STAT]) -ne 'paid'){continue}
  $em=(Norm $r[$K_EMAIL]).ToLower(); if($vendaExclE.ContainsKey($em)){continue}; $nk=NameKey $r[$K_NOME]; if($nk -match ' ' -and $vendaExclN.ContainsKey($nk)){continue}   # cancelado sai
  $d=BrDate $r[$K_DATE]; if($d -eq ''){continue}
  $sv=TitleName $r[$K_SRC]; if($SELLER_ALIAS.ContainsKey($sv)){ $sv=$SELLER_ALIAS[$sv] }; if($sv -eq ''){$sv='SEM_VENDEDORA'}
  $key="$d`u$sv"; if(-not $sellers.ContainsKey($key)){ $sellers[$key]=[pscustomobject]@{date=$d;seller=$sv;sales=0;revenue=0.0;daysSum=0;daysN=0;fat=@(0,0,0,0,0,0)} }
  $o=$sellers[$key]; $o.sales++; $o.revenue += (MoneyKiwify $r[$K_REV])
  $e=(Norm $r[$K_EMAIL]).ToLower()
  if($e -ne '' -and $leadFirst.ContainsKey($e)){ $lf=$leadFirst[$e]
    $l0=[datetime]::ParseExact($lf.date,'yyyy-MM-dd',$null); $p0=[datetime]::ParseExact($d,'yyyy-MM-dd',$null); $dd=($p0-$l0).Days
    if($dd -ge 0){ $o.daysSum += $dd; $o.daysN++ }
    $fi=$FAT6.IndexOf($lf.fat); if($fi -ge 0){ $o.fat[$fi]++ } } }   # fat = compradoras por faixa de faturamento
# vendas EXTRAS (planilha nova) no Comercial — usa a coluna VENDEDOR, mesma normalizacao de nome
foreach($x in $extras){ $sv=TitleName $x.seller; if($SELLER_ALIAS.ContainsKey($sv)){ $sv=$SELLER_ALIAS[$sv] }; if($sv -eq ''){$sv='SEM_VENDEDORA'}
  $key="$($x.date)`u$sv"; if(-not $sellers.ContainsKey($key)){ $sellers[$key]=[pscustomobject]@{date=$x.date;seller=$sv;sales=0;revenue=0.0;daysSum=0;daysN=0;fat=@(0,0,0,0,0,0)} }
  $o=$sellers[$key]; $o.sales++; $o.revenue += $x.valor
  if($leadFirst.ContainsKey($x.email)){ $lf=$leadFirst[$x.email]
    $l0=[datetime]::ParseExact($lf.date,'yyyy-MM-dd',$null); $p0=[datetime]::ParseExact($x.date,'yyyy-MM-dd',$null); $dd=($p0-$l0).Days
    if($dd -ge 0){ $o.daysSum += $dd; $o.daysN++ }
    $fi=$FAT6.IndexOf($lf.fat); if($fi -ge 0){ $o.fat[$fi]++ } } }
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
  $o=GetGrain $d $c $s $a; $o.leads++; if(IsQual $r[$L_FAT] $r[$L_VOCE]){ $o.qlf++ } }

# ---- LEADS DO FORMS (campanhas com a tag "forms") --------------------------------
# Planilha separada (Lead Form nativo). Como campaign_name/adset_name/ad_name sao iguais aos das
# queries, os leads caem no MESMO grain do gasto. Alimenta: diario (funil geral), grain (arvore) e
# leadByEmail (atribuicao de venda por e-mail). Objecoes/estudo NAO usam (planilha sem "desafio").
$formsLeads=0; $formsQlf=0; $formsFatSeen=@{}
foreach($r in $ffd){
  $cn=Norm $r[$FF_CAMP]; if($cn -eq '' -or -not (IsFormsCamp $cn)){ continue }   # so campanhas com a tag forms
  $d=''; $ct=Norm $r[$FF_DATE]; if($ct -match '(\d{4})-(\d{2})-(\d{2})'){ $d=$Matches[0].Substring(0,10) }
  if($d -eq ''){ continue }
  $isq = IsQualForms $r[$FF_FAT] $r[$FF_VOCE]
  $fk=FatNormForms $r[$FF_FAT]; if($fk -ne ''){ if(-not $formsFatSeen.ContainsKey($fk)){ $formsFatSeen[$fk]=0 }; $formsFatSeen[$fk]++ }
  $gc=$cn; $gs=Norm $r[$FF_SET]; $ga=AdCode $r[$FF_AD]      # chaves identicas as das queries
  $o=GetDay $d; $o.leads++; if($isq){ $o.qlf++ }            # funil geral (gasto do forms ja esta no diario)
  $og=GetGrain $d $gc $gs $ga; $og.leads++; if($isq){ $og.qlf++ }   # arvore (mesma celula do gasto)
  $em=(Norm $r[$FF_EMAIL]).ToLower(); if($em -match '@'){ $leadByEmail[$em]=[pscustomobject]@{campaign=$gc;adset=$gs;ad=$ga;bucket='Outros'} }  # atribuicao de venda
  $formsLeads++; if($isq){ $formsQlf++ }
}

# buyer objections per purchase day (only matched buyers have a known desafio)
$objBuyers=@{}
function GetObjB($d,$b){ $key="$d`u$b"; if(-not $objBuyers.ContainsKey($key)){ $objBuyers[$key]=[pscustomobject]@{date=$d;bucket=$b;buyers=0} }; return $objBuyers[$key] }
foreach($r in $kd){ if((Norm $r[$K_STAT]) -ne 'paid'){continue}; $d=BrDate $r[$K_DATE]; if($d -eq ''){continue}
  $e=(Norm $r[$K_EMAIL]).ToLower(); $rev=MoneyKiwify $r[$K_REV]
  if($vendaExclE.ContainsKey($e)){continue}; $nk=NameKey $r[$K_NOME]; if($nk -match ' ' -and $vendaExclN.ContainsKey($nk)){continue}   # cancelado sai da arvore
  if($e -ne '' -and $leadByEmail.ContainsKey($e)){ $m=$leadByEmail[$e]
    $c=if($m.campaign){$m.campaign}else{'NAO_ATRIBUIDO'}; $s=if($m.adset){$m.adset}else{'NAO_ATRIBUIDO'}; $a=if($m.ad){$m.ad}else{'NAO_ATRIBUIDO'}
    $o=GetGrain $d $c $s $a
    $obk=GetObjB $d $m.bucket; $obk.buyers++ } else { $o=GetGrain $d 'NAO_ATRIBUIDO' 'NAO_ATRIBUIDO' 'NAO_ATRIBUIDO' }
  $o.sales++; $o.revenue += $rev }

# vendas EXTRAS na arvore: atribui por e-mail se a compradora veio do trafego, senao NAO_ATRIBUIDO
foreach($x in $extras){ $e=$x.email
  if($leadByEmail.ContainsKey($e)){ $m=$leadByEmail[$e]
    $c=if($m.campaign){$m.campaign}else{'NAO_ATRIBUIDO'}; $s=if($m.adset){$m.adset}else{'NAO_ATRIBUIDO'}; $a=if($m.ad){$m.ad}else{'NAO_ATRIBUIDO'}
    $o=GetGrain $x.date $c $s $a
    $obk=GetObjB $x.date $m.bucket; $obk.buyers++ } else { $o=GetGrain $x.date 'NAO_ATRIBUIDO' 'NAO_ATRIBUIDO' 'NAO_ATRIBUIDO' }
  $o.sales++; $o.revenue += $x.valor }

# ===================================================================
#  VERBATIMS — o que as QUALIFICADAS relatam, por objecao (base completa)
# ===================================================================
$qVerb=@{}   # bucket -> hashtable(texto -> contagem)
foreach($r in $ld){
  if(-not (IsQual $r[$L_FAT] $r[$L_VOCE])){ continue }
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
# conversao de pagina = leads DA PAGINA / page views: tira os leads do Forms (formulario nativo do Meta, nao passa pela pagina)
$formsLe30=0; foreach($g in $grain.Values){ if($g.date -ge $w30s -and $g.date -le $dmax -and (IsFormsCamp $g.campaign)){ $formsLe30+=$g.leads } }
$convlp=[math]::Round((Sdiv ($cur.leads-$formsLe30) $cur.lpv)*100,1)
$tnLP = if($convlp -ge 8){'good'}else{'warn'}
AddIns @{type='funnel_convlp';cat='funil';tone=$tnLP;convlp=$convlp}

# ===================================================================
#  ESTUDO DAS COMPRADORAS — 3 abas: tempo de compra, perfil, sinal
#  (só agregados/anonimizado; e-mail usado só p/ casar, nunca publicado)
# ===================================================================
# inclui as opcoes NOVAS do Typeform (~22/08: "Menos de 100mil", "De 100k a 300k"...) — sem elas as compradoras recentes sumiam da distribuicao
$FAT_ORDER=@('Menos de R$ 5 mil','Entre R$ 5 mil e R$ 10 mil','Entre R$ 10 mil e R$ 50 mil','Entre R$ 50 mil e R$ 100 mil','Menos de 100mil','Entre R$ 100 mil e R$ 200 mil','De 100k a 300k','Acima de 200 mil','De 300k a 500k','De 500k a 1M','Acima de 1M')
$FAT_MID=@{'Menos de R$ 5 mil'=2500;'Entre R$ 5 mil e R$ 10 mil'=7500;'Entre R$ 10 mil e R$ 50 mil'=30000;'Entre R$ 50 mil e R$ 100 mil'=75000;'Menos de 100mil'=50000;'Entre R$ 100 mil e R$ 200 mil'=150000;'De 100k a 300k'=200000;'Acima de 200 mil'=300000;'De 300k a 500k'=400000;'De 500k a 1M'=750000;'Acima de 1M'=1200000}
$EQ_ORDER=@('1','05','2-7','De 06 a 20','8-15','16-50','De 21 a 50','50+','Acima de 50')
# lead mais ANTIGO por e-mail (primeiro contato) com os campos do estudo
$leadStudy=@{}
foreach($r in $ld){ $e=(Norm $r[$L_EMAIL]).ToLower(); if($e -eq ''){continue}; $d=Norm $r[$L_DATE]; if($d -notmatch '^\d{4}-\d{2}-\d{2}$'){continue}
  if(-not $leadStudy.ContainsKey($e) -or $d -lt $leadStudy[$e].date){
    $leadStudy[$e]=[pscustomobject]@{date=$d;fat=(Norm $r[$L_FAT]);voce=(Norm $r[$L_VOCE]);eq=(Norm $r[$L_EQ]);freq=(Norm $r[$L_FREQ]);intent=(Norm $r[$L_INTENT]);desafio=(Norm $r[$L_DESAFIO])} } }
# compradoras casadas (paid + e-mail casa com lead datado)
$buyers=New-Object System.Collections.Generic.List[object]
foreach($r in $kd){ if((Norm $r[$K_STAT]) -ne 'paid'){continue}; $pr=Norm $r[$K_DATE]; if($pr -notmatch '^\d{2}/\d{2}/\d{4}'){continue}
  $e=(Norm $r[$K_EMAIL]).ToLower(); if($e -eq '' -or -not $leadStudy.ContainsKey($e)){continue}
  if($vendaExclE.ContainsKey($e)){continue}; $nkc=NameKey $r[$K_NOME]; if($nkc -match ' ' -and $vendaExclN.ContainsKey($nkc)){continue}   # cancelado fora do perfil
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
$eqDist=DistArr 'eq' $EQ_ORDER
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

# ===================================================================
#  APICE — planilha de VENDAS do Apice ("VENDAS MASTERMIND", out/2026). Fonte UNICA de tudo do Apice:
#  participantes (perfil, Ascensao, "Viraram Apice") + financeiro (ROAS com Apice, caixa, receita recorrente).
#  Colunas achadas por NOME: NOME, EMAIL, SITUACAO (Ativa/Inativa -> Inativa fica FORA de tudo, pedido do
#  cliente), DATA COQUETEL (= dia da venda; a ENTRADA/SINAL e paga nesse dia), VALOR (ticket total), SINAL,
#  Qntd Parcela (NAO inclui a entrada). Parcela = (VALOR - SINAL) / Qntd, paga todo dia 1 a partir do MES
#  SEGUINTE a venda (regra do cliente, 21/10/2026). A coluna "Valor Parcela" so e conferida (vira aviso).
#  ⚠️ Le o EXPORT CSV, NAO o gviz: o gviz APAGA texto em coluna de data/numero (ex.: "nao comprou cocktail
#  (indicacao)" na data; observacoes de pagamento na "Valor Parcela"). 1a linha = titulo; cabecalho = a
#  linha com EMAIL + SITUACAO. A planilha antiga (19Ee8..., linhas amarelas) foi aposentada.
# ===================================================================
$apList=@(); $apSales=@(); $apIssues=@(); $apInativas=0; $apAtivas=0
function MoneyA($s){ $c=((Norm $s) -replace '[R$\s]',''); if($c -match '^\d{1,3}(\.\d{3})+(,\d+)?$' -or $c -match '^\d+(,\d+)?$'){ return [double]($c -replace '\.','' -replace ',','.') }; return $null }
function ApIssue($l,$k,$x,$a,$b){ $script:apIssues += [pscustomobject]@{l=$l;k=$k;x=[string]$x;a=[math]::Round([double]$a,2);b=[math]::Round([double]$b,2)} }   # mesmo formato em todos (JSON 5.1)
if($Mode -eq 'all' -or $Mode -eq 'apice' -or $Mode -eq 'ascensao' -or $Mode -eq 'estudo' -or $Mode -eq 'perfil'){
  $APICE_ID='1bclGSGY51UvnFwY2zrRgwwrEXJL2Dgu8sb6OStGWNUE'; $APICE_GID='1900437058'
  $aCsv=Join-Path $dataDir 'apice.csv'
  (New-Object System.Net.WebClient).DownloadFile("https://docs.google.com/spreadsheets/d/$APICE_ID/export?format=csv&gid=$APICE_GID",$aCsv)
  $aRows=@(Read-Csv $aCsv)
  $aHi=-1; for($i=0;$i -lt [Math]::Min(8,$aRows.Count);$i++){ $jn=Deaccent (($aRows[$i]) -join '|'); if($jn -match 'email' -and $jn -match 'situa'){ $aHi=$i; break } }
  if($aHi -lt 0){ Write-Host 'APICE: !!! cabecalho (EMAIL + SITUACAO) NAO encontrado na planilha -> Apice vazio neste build' }
  else{
    $ah=$aRows[$aHi]
    function AH($pat){ for($k=0;$k -lt $script:ah.Count;$k++){ $h=((Deaccent (Norm $script:ah[$k])) -replace '\s+',' ').Trim(); if($h -like $pat){ return $k } }; return -1 }
    function ACell($r,$c){ if($c -lt 0 -or $c -ge $r.Count){ return '' }; return (Norm $r[$c]) }
    $A_NOME=AH '*nome*'; $A_EMAIL=AH '*email*'; $A_SIT=AH '*situa*'; $A_DATA=AH '*coquetel*'; if($A_DATA -lt 0){ $A_DATA=AH 'data*' }
    $A_VALOR=AH 'valor'; $A_SINAL=AH '*sinal*'; if($A_SINAL -lt 0){ $A_SINAL=AH '*entrada*' }
    $A_QTD=AH '*qntd*'; if($A_QTD -lt 0){ $A_QTD=AH '*qtd*' }; if($A_QTD -lt 0){ $A_QTD=AH '*quantidade*' }
    $A_VPARC=AH 'valor parcela*'
    for($i=$aHi+1;$i -lt $aRows.Count;$i++){ $r=$aRows[$i]; $ln=$i+1   # numero da linha NA PLANILHA (1 = titulo)
      $em=(ACell $r $A_EMAIL).ToLower(); $nm=ACell $r $A_NOME
      if($em -eq '' -and $nm -eq ''){ continue }                                   # linha vazia
      if((Deaccent (ACell $r $A_SIT)) -match 'inativ'){ $apInativas++; continue }  # Inativa = desconsiderar
      $apAtivas++
      $vTxt=ACell $r $A_VALOR; $v=MoneyA $vTxt; $sTxt=ACell $r $A_SINAL; $s=MoneyA $sTxt
      $qTxt=ACell $r $A_QTD; $q=0; if($qTxt -match '^\d+$'){ $q=[int]$qTxt }
      $dTxt=ACell $r $A_DATA; $dt=''; if($dTxt -match '^(\d{1,2})/(\d{1,2})/(\d{4})'){ $dt=('{0}-{1:d2}-{2:d2}' -f $Matches[3],[int]$Matches[2],[int]$Matches[1]) }
      $key=NameKey $nm
      if($em -match '@' -or $key -match ' '){ $apList+=[pscustomobject]@{email=$(if($em -match '@'){$em}else{''});key=$key;valor=$(if($null -ne $v){$v}else{0.0});d=$dt} }   # d = data da venda (filtro de periodo da aba Apice)
      if($null -eq $v){ ApIssue $ln 'novalor' $vTxt 0 0; continue }               # sem VALOR: fora do financeiro
      if($null -eq $s){ if($sTxt -ne ''){ ApIssue $ln 'sinaltxt' $sTxt 0 0 }; $s=0.0 }
      if($s -gt $v){ ApIssue $ln 'sinalmaior' '' $s $v; $s=$v }
      $rest=$v-$s; $p=0.0; $n=0
      if($rest -gt 0.5){ if($q -gt 0){ $p=$rest/$q; $n=$q } else { ApIssue $ln 'noqtd' $qTxt 0 $rest } }
      $vpTxt=ACell $r $A_VPARC
      if($vpTxt -ne '' -and $n -gt 0){ $vp=MoneyA $vpTxt
        if($null -eq $vp){ ApIssue $ln 'vparctxt' $vpTxt 0 $p } elseif([math]::Abs($vp-$p) -gt 1){ ApIssue $ln 'vparc' '' $vp $p } }
      if($dt -eq ''){ ApIssue $ln 'nodate' $dTxt 0 0 }
      $apSales+=[pscustomobject]@{d=$dt;t=$(if($dt -eq ''){$dTxt}else{''});v=[math]::Round($v,2);s=[math]::Round($s,2);n=$n;p=[math]::Round($p,2)} }
  }
  Write-Host ("APICE: {0} ativas ({1} inativas fora) | {2} vendas no financeiro, {3} sem data | vendido R$ {4} | {5} avisos p/ conferir" -f $apAtivas,$apInativas,$apSales.Count,@($apSales | Where-Object { $_.d -eq '' }).Count,(M0 (($apSales | Measure-Object v -Sum).Sum)),$apIssues.Count)
}

# ===================================================================
#  PERFIL POR PESSOA (data-perfil.js) -> abas Objecoes, Compradoras e Tempo de compra
#  1 linha por lead QUALIFICADA (data do lead) e 1 por COMPRA (data da compra), com a resposta de
#  CADA pergunta do Typeform como indice de opcao. O front agrega pelo PERIODO do seletor (antes era
#  base completa, sem filtro de data). Perguntas novas (estado civil, filhos, margem, fe, o que busca
#  construir — desde 23/08) entram aqui. Rotulos com acento ficam no app.js (este arquivo nao tem BOM:
#  literal nao-ASCII quebra no PS5.1); aqui so o texto cru da planilha + chaves ASCII.
#  SEM PII: nome/e-mail/telefone/@/"Parceiro" (a resposta e o NOME do parceiro) nao saem.
# ===================================================================
if($Mode -eq 'all' -or $Mode -eq 'estudo' -or $Mode -eq 'perfil'){   # NAO no modo objections: o workflow diario so commita data-obj.js (arquivo extra sujo quebraria o pull --rebase)
$pSw=[Diagnostics.Stopwatch]::StartNew()
$L_CIVIL=HdrLike $lh '*Estado civil*'; $L_FILHOS=HdrLike $lh 'Filhos*'; $L_MARGEM=HdrLike $lh '*Margem de lucro*'
$L_FE=HdrLike $lh 'F*Religi*'; $L_BUSCA=HdrLike $lh '*busca construir*'; $L_PRES=HdrLike $lh '*presencialmente*'
$PQ=@('fat','voce','eq','margem','civil','filhos','fe','intent','freq','pres','busca')
$PCOL=@{fat=$L_FAT;voce=$L_VOCE;eq=$L_EQ;margem=$L_MARGEM;civil=$L_CIVIL;filhos=$L_FILHOS;fe=$L_FE;intent=$L_INTENT;freq=$L_FREQ;pres=$L_PRES;busca=$L_BUSCA}
# "O que busca construir" (texto livre) -> temas por palavra-chave, MULTI (bitmask: uma resposta pode citar varios)
$BUSCA_B=@(
  @('network', @('network','conex','relacionament','parceri','troca','trocar','contato','comunidade','ambiente','ambiencia','mulheres','pessoas')),
  @('cresc',   @('cresc','escal','expan','alavanc','faturament','faturar','ampli','multiplic','estourar','vend','lucr','resultado','dobrar','clientes')),
  @('estrut',  @('estrutur','gest','organiz','process','equipe','lider','operacional','deleg','sistema','consolid','profissionaliz','sustentav','solid')),
  @('posic',   @('posicion','autoridade','referencia','marca','imagem','reconhec','visibil','case','influenc','destaque')),
  @('estrat',  @('estrateg','clareza','visao','direcion','plano','proximo passo','metodo','caminho','planejament','rumo')),
  @('aprend',  @('aprend','conhecim','desenvolv','aperfei','capacit','evolu','experienc','mentoria','estudo','ensina')),
  @('mente',   @('mente','mentalidade','confian','crenc','medo','empoder','coragem','destrav','desbloq','blind','autoestima','seguranca','disciplin','foco','motiva')),
  @('legado',  @('legado','familia','filho','qualidade de vida','liberdade','tempo','mudanca de vida','sonho','independ','proposito','impacto','historia','felicidade','paz')),
  @('financ',  @('financ','patrimon','dinheiro','caixa','riqueza','investiment','rentab','renda'))
)
$BUSCA_RX=@(); foreach($b in $BUSCA_B){ $BUSCA_RX += [regex]('\b(' + (($b[1] | ForEach-Object { [regex]::Escape($_) }) -join '|') + ')') }   # \b = inicio de palavra ("paz" nao casa "capaz")
$BUSCA_OUT=$BUSCA_B.Count   # bit "outro": respondeu algo sem tema reconhecido
function BuscaMask($raw){ $t=Deaccent (Norm $raw); if(($t -replace '[^a-z]','').Length -lt 3){ return -1 }
  $m=0; for($i=0;$i -lt $script:BUSCA_RX.Count;$i++){ if($script:BUSCA_RX[$i].IsMatch($t)){ $m = $m -bor (1 -shl $i) } }
  if($m -eq 0){ $m = 1 -shl $script:BUSCA_OUT }; return $m }
# "Filhos" (texto livre: "Sim, 2", "nao", "uma filha"...) -> nao / 1 / 2 / 3+ / sim (tem, sem dizer quantos)
function FilhosKey($raw){ $t=((Deaccent (Norm $raw)) -replace '[^a-z0-9 ]',' ' -replace '\s+',' ').Trim(); if($t -eq ''){ return '' }
  $n=-1
  if($t -match '\b(\d{1,2})\b'){ $n=[int]$Matches[1] }
  elseif($t -match '\b(um|uma)\b'){ $n=1 } elseif($t -match '\b(dois|duas)\b'){ $n=2 } elseif($t -match '\b(tres|quatro|cinco|seis)\b'){ $n=3 }
  if($n -eq 0){ return 'nao' }
  if($n -ge 1 -and $n -le 15){ if($n -ge 3){ return '3+' }; return [string]$n }
  if($t -match '^(nao|n|no|nenhum|nenhuma|zero)\b' -or $t -match '^ainda nao'){ return 'nao' }
  if($t -match '^(sim|s|si|tenho)\b' -or $t -match 'filh'){ return 'sim' }
  return '' }
# resposta crua -> indice da opcao (cache por texto cru; opcoes novas entram sozinhas no fim da lista)
$PQOPT=@{}; $PQRAW=@{}; $PQCACHE=@{}
foreach($qk in $PQ){ $PQOPT[$qk]=@{}; $PQRAW[$qk]=New-Object System.Collections.Generic.List[string]; $PQCACHE[$qk]=@{} }
function PAns($qk,$raw){ $raw=Norm $raw; if($raw -eq ''){ return -1 }
  $cache=$script:PQCACHE[$qk]; if($cache.ContainsKey($raw)){ return $cache[$raw] }
  if($qk -eq 'busca'){ $v=BuscaMask $raw }
  else{
    if($qk -eq 'filhos'){ $k=FilhosKey $raw; $disp=$k } else { $disp=CleanOpt $raw; $k=((Deaccent $disp) -replace '\s+',' ').Trim() }
    if($k -eq ''){ $v=-1 } else { $h=$script:PQOPT[$qk]; if(-not $h.ContainsKey($k)){ $h[$k]=$script:PQRAW[$qk].Count; $script:PQRAW[$qk].Add($disp) }; $v=$h[$k] } }
  $cache[$raw]=$v; return $v }
function PAnswers($r){ $a=New-Object int[] $script:PQ.Count
  for($i=0;$i -lt $script:PQ.Count;$i++){ $c=$script:PCOL[$script:PQ[$i]]; if($c -lt 0 -or $c -ge $r.Count){ $a[$i]=-1 } else { $a[$i]=PAns $script:PQ[$i] $r[$c] } }
  return ,$a }
# textos livres ("principal desafio"): dicionario unico, mesmo filtro anti-PII dos verbatims
$PTXT=New-Object System.Collections.Generic.List[string]; $PTIDX=@{}
function PTxt($t,$min,$minUniq){ if($t.Length -lt $min -or $t.Length -gt 160){ return -1 }
  if($t -match '@' -or $t -match 'http' -or $t -match '\d{4,}'){ return -1 }
  $cx=($t.ToLower() -replace '\s',''); if(([System.Collections.Generic.HashSet[char]]::new([char[]]$cx.ToCharArray())).Count -le $minUniq){ return -1 }
  if($script:PTIDX.ContainsKey($t)){ return $script:PTIDX[$t] }; $i=$script:PTXT.Count; $script:PTXT.Add($t); $script:PTIDX[$t]=$i; return $i }
$PBIDX=@{}; for($i=0;$i -lt $OBJ_ORDER.Count;$i++){ $PBIDX[$OBJ_ORDER[$i]]=$i }
$PDAY=@{}
function PDay($d){ if(-not $script:PDAY.ContainsKey($d)){ $script:PDAY[$d]=([datetime]::ParseExact($d,'yyyy-MM-dd',$null) - $script:P_D0).Days }; return $script:PDAY[$d] }

# typeform por e-mail (todas as linhas datadas) + leads qualificadas
$pByEmail=@{}; $pLeadRows=New-Object System.Collections.Generic.List[object]
foreach($r in $ld){ $d=Norm $r[$L_DATE]; if($d -notmatch '^\d{4}-\d{2}-\d{2}$'){continue}
  $e=(Norm $r[$L_EMAIL]).ToLower()
  if($e -ne ''){ if(-not $pByEmail.ContainsKey($e)){ $pByEmail[$e]=New-Object System.Collections.Generic.List[object] }; $pByEmail[$e].Add($r) }
  if(IsQual $r[$L_FAT] $r[$L_VOCE]){ $pLeadRows.Add($r) } }
# perfil de UMA pessoa (todas as linhas dela no typeform): ultima resposta ate $cut ('' = sem corte, senao a
# mais antiga); 1o contato = resposta mais antiga. Pergunta em branco na linha escolhida (ex.: as novas so
# existem desde 23/08) -> pega de outra linha da mesma pessoa.
function PPick($rs,$cut){ $first=$null; $pick=$null; $fd=''; $pd=''
  foreach($x in $rs){ $xd=Norm $x[$script:L_DATE]
    if($null -eq $first -or $xd -lt $fd){ $first=$x; $fd=$xd }
    if(($cut -eq '' -or $xd -le $cut) -and ($null -eq $pick -or $xd -ge $pd)){ $pick=$x; $pd=$xd } }
  if($null -eq $pick){ $pick=$first }
  $a=PAnswers $pick
  for($i=0;$i -lt $a.Count;$i++){ if($a[$i] -ge 0){continue}; $c=$script:PCOL[$script:PQ[$i]]; if($c -lt 0){continue}
    foreach($x in $rs){ if($c -ge $x.Count){continue}; $v=PAns $script:PQ[$i] $x[$c]; if($v -ge 0){ $a[$i]=$v } } }
  $des=Norm $pick[$script:L_DESAFIO]; if($des -eq ''){ foreach($x in $rs){ $t=Norm $x[$script:L_DESAFIO]; if($t -ne ''){ $des=$t } } }
  return [pscustomobject]@{a=$a;des=$des;first=$fd;pick=$pick} }
# participantes do Apice: e-mail OU nome igual ao da compradora (mesma regra da Ascensao)
$apE=@{}; $apN=@{}; foreach($w in $apList){ if($w.email -ne ''){ $apE[$w.email]=1 }; if($w.key -match ' '){ $apN[$w.key]=1 } }
# compras (kiwify paga + extras do controle manual; cancelada fora) casadas com o typeform por e-mail.
# pid = id anonimo da pessoa (conta "quantas viraram Apice" por PESSOA, mesmo com 2 compras).
$pBuy=New-Object System.Collections.Generic.List[object]; $pPid=@{}
function PBuyer($e,$d,$rev,$nk){ if($e -eq '' -or -not $script:pByEmail.ContainsKey($e)){ return }
  $p=PPick $script:pByEmail[$e] $d
  $ap=0; if($script:apE.ContainsKey($e) -or ($nk -match ' ' -and $script:apN.ContainsKey($nk))){ $ap=1 }
  if(-not $script:pPid.ContainsKey($e)){ $script:pPid[$e]=$script:pPid.Count }
  $script:pBuy.Add([pscustomobject]@{d=$d;first=$p.first;b=(Bucket $p.des);rev=$rev;ap=$ap;pid=$script:pPid[$e];a=$p.a;des=$p.des}) }
foreach($r in $kd){ if((Norm $r[$K_STAT]) -ne 'paid'){continue}; $d=BrDate $r[$K_DATE]; if($d -eq ''){continue}
  $e=(Norm $r[$K_EMAIL]).ToLower(); if($vendaExclE.ContainsKey($e)){continue}; $nk=NameKey $r[$K_NOME]; if($nk -match ' ' -and $vendaExclN.ContainsKey($nk)){continue}
  PBuyer $e $d (MoneyKiwify $r[$K_REV]) $nk }
foreach($x in $extras){ PBuyer $x.email $x.date $x.valor '' }

# perfil das participantes do APICE (sem data: e uma lista). Casa com o typeform por e-mail; senao por NOME
# unico na base (mesma regra da aba Apice). ck = tambem comprou o Cocktail (kiwify paga, cancelada fora).
$ldName=@{}; foreach($r in $ld){ $full=NameKey (($r[0])+' '+($r[1])); if($full -match ' '){ if(-not $ldName.ContainsKey($full)){ $ldName[$full]=New-Object System.Collections.Generic.List[object] }; $ldName[$full].Add($r) } }
$kE=@{}; $kN=@{}
foreach($r in $kd){ if((Norm $r[$K_STAT]) -ne 'paid'){continue}; $e=(Norm $r[$K_EMAIL]).ToLower(); if($vendaExclE.ContainsKey($e)){continue}
  $nk=NameKey $r[$K_NOME]; if($nk -match ' ' -and $vendaExclN.ContainsKey($nk)){continue}; if($e -ne ''){ $kE[$e]=1 }; if($nk -match ' '){ $kN[$nk]=1 } }
$pApRows=New-Object System.Collections.Generic.List[object]; $apMatchE=0; $apMatchN=0
foreach($w in $apList){ $rs=$null
  if($w.email -ne '' -and $pByEmail.ContainsKey($w.email)){ $rs=$pByEmail[$w.email]; $apMatchE++ }
  elseif($w.key -match ' ' -and $ldName.ContainsKey($w.key) -and $ldName[$w.key].Count -eq 1){ $one=$ldName[$w.key][0]; $oe=(Norm $one[$L_EMAIL]).ToLower()
    if($oe -ne '' -and $pByEmail.ContainsKey($oe)){ $rs=$pByEmail[$oe] } elseif((Norm $one[$L_DATE]) -match '^\d{4}-\d{2}-\d{2}$'){ $rs=New-Object System.Collections.Generic.List[object]; $rs.Add($one) }
    if($null -ne $rs){ $apMatchN++ } }
  if($null -eq $rs){ continue }
  $p=PPick $rs ''
  $isq=0; if(IsQual $p.pick[$L_FAT] $p.pick[$L_VOCE]){ $isq=1 }
  $ck=0; if($kE.ContainsKey($w.email) -or ($w.key -match ' ' -and $kN.ContainsKey($w.key))){ $ck=1 }
  $pApRows.Add([pscustomobject]@{d=$w.d;b=(Bucket $p.des);q=$isq;ck=$ck;a=$p.a;des=$p.des}) }

# dia 0 = data mais antiga usada; datas viram inteiros (arquivo menor)
$P_D0s='9999-12-31'
foreach($r in $pLeadRows){ $x=Norm $r[$L_DATE]; if($x -lt $P_D0s){ $P_D0s=$x } }
foreach($b in $pBuy){ if($b.d -lt $P_D0s){ $P_D0s=$b.d }; if($b.first -lt $P_D0s){ $P_D0s=$b.first } }
$P_D0=[datetime]::ParseExact($P_D0s,'yyyy-MM-dd',$null)
$pL=New-Object System.Collections.Generic.List[string]
foreach($r in $pLeadRows){
  $a=PAnswers $r; $t=PTxt (Norm $r[$L_DESAFIO]) 3 1
  $pL.Add('[' + (PDay (Norm $r[$L_DATE])) + ',' + $PBIDX[(Bucket $r[$L_DESAFIO])] + ',' + ($a -join ',') + ',' + $t + ']') }
$pB=New-Object System.Collections.Generic.List[string]   # [dia compra, dia 1o contato, objecao, valor, virou Apice 0/1, pid, resp..., texto]
foreach($b in $pBuy){ $t=PTxt $b.des 3 1
  $pB.Add('[' + (PDay $b.d) + ',' + (PDay $b.first) + ',' + $PBIDX[$b.b] + ',' + [math]::Round($b.rev,0) + ',' + $b.ap + ',' + $b.pid + ',' + ($b.a -join ',') + ',' + $t + ']') }
$pA=New-Object System.Collections.Generic.List[string]   # [dia da venda do Apice (-99999 = sem data), objecao, qualificada 0/1, comprou Cocktail 0/1, resp..., texto]
foreach($x in $pApRows){ $t=PTxt $x.des 3 1
  $dA=-99999; if($x.d -match '^\d{4}-\d{2}-\d{2}$'){ $dA=PDay $x.d }   # 2025 vira negativo (d0 e 2026) — ok
  $pA.Add('[' + $dA + ',' + $PBIDX[$x.b] + ',' + $x.q + ',' + $x.ck + ',' + ($x.a -join ',') + ',' + $t + ']') }
$qDefs=@(); foreach($qk in $PQ){   # ⚠️ nome != $PQ (variavel do PS e case-insensitive: $pQ seria a MESMA)
  if($qk -eq 'busca'){ $o=@($BUSCA_B | ForEach-Object { $_[0] }) + 'outro' } else { $o=@($PQRAW[$qk].ToArray()) }
  $qDefs += [pscustomobject]@{k=$qk;multi=($qk -eq 'busca');col=($PCOL[$qk] -ge 0);o=[object[]]$o} }
$perfilJson='{"generatedAt":"'+$nowIso+'","generatedAtBR":"'+$nowBR+'","d0":"'+$P_D0s+'"' +
  ',"buckets":' + (ConvertTo-Json -InputObject ([object[]]$OBJ_ORDER) -Compress) +
  ',"q":' + (ConvertTo-Json -InputObject ([object[]]$qDefs) -Depth 4 -Compress) +
  ',"L":[' + ($pL -join ',') + '],"B":[' + ($pB -join ',') + '],"A":[' + ($pA -join ',') + ']' +
  ',"apice":{"total":' + $apAtivas + ',"inativas":' + $apInativas + ',"matchedEmail":' + $apMatchE + ',"matchedName":' + $apMatchN + '}' +
  ',"T":' + (ConvertTo-Json -InputObject ([object[]]$PTXT.ToArray()) -Compress) + '}'
[IO.File]::WriteAllText((Join-Path $root 'data-perfil.js'), ("window.DASH_PERFIL="+$perfilJson+";"), [System.Text.UTF8Encoding]::new($false))
Write-Host ("PERFIL: {0} qualificadas | {1} compras casadas c/ typeform ({2} de Apice) | Apice {3}/{4} c/ perfil (email={5} nome={6}) | {7} textos | d0={8} | cols novas: civil={9} filhos={10} margem={11} fe={12} busca={13} pres={14} | {15}s" -f $pLeadRows.Count,$pBuy.Count,@($pBuy | Where-Object { $_.ap -eq 1 }).Count,$pApRows.Count,$apList.Count,$apMatchE,$apMatchN,$PTXT.Count,$P_D0s,$L_CIVIL,$L_FILHOS,$L_MARGEM,$L_FE,$L_BUSCA,$L_PRES,[int]$pSw.Elapsed.TotalSeconds)
}

# ===================================================================
#  APICE (financeiro) + ASCENSAO — tudo da planilha VENDAS MASTERMIND (secao "APICE" acima)
#  data-apice.js = vendas ativas {d=dia do coquetel (venda+entrada), t=texto se nao for data, v=ticket total,
#  s=entrada/sinal, n=qtd parcelas, p=valor da parcela} + avisos p/ conferir na planilha. O FRONT monta o
#  cronograma (entrada no dia + parcela todo dia 1 a partir do mes seguinte) -> "hoje" e sempre o real.
#  O perfil das participantes vem do data-perfil.js (linhas A).
# ===================================================================
if($Mode -eq 'all' -or $Mode -eq 'apice' -or $Mode -eq 'ascensao'){
  $apTotVal=0.0; foreach($x in $apSales){ $apTotVal += $x.v }
  $apice=[pscustomobject]@{ generatedAt=$nowIso; generatedAtBR=$nowBR; ativas=$apAtivas; inativas=$apInativas
    sales=@($apSales); issues=@($apIssues) }
  if($Mode -eq 'all' -or $Mode -eq 'apice'){ WriteJs 'data-apice.js' 'DASH_APICE' $apice }

  # --- ASCENSAO: escada de valor Trafego -> Cocktail -> Apice. Valor REAL de cada participante (VALOR da planilha) ---
  $kByE=@{}; $kByN=@{}  # compradoras do Cocktail (kiwify paid): email/nome(Cliente) -> data da compra
  foreach($r in $kd){ if((Norm $r[$K_STAT]) -ne 'paid'){continue}; $d=BrDate $r[$K_DATE]; if($d -eq ''){continue}
    $e=(Norm $r[$K_EMAIL]).ToLower(); if($vendaExclE.ContainsKey($e)){continue}; $nm=NameKey $r[$K_NOME]; if($nm -match ' ' -and $vendaExclN.ContainsKey($nm)){continue}   # cancelado nao ascende
    if($e -ne '' -and -not $kByE.ContainsKey($e)){$kByE[$e]=$d}
    if($nm -match ' ' -and -not $kByN.ContainsKey($nm)){$kByN[$nm]=$d} }
  $ascDaily=@{}; $ascE=0; $ascN=0
  foreach($w in $apList){ $d=$null
    if($w.email -ne '' -and $kByE.ContainsKey($w.email)){$d=$kByE[$w.email];$ascE++}
    elseif($w.key -match ' ' -and $kByN.ContainsKey($w.key)){$d=$kByN[$w.key];$ascN++}
    if($d){ if(-not $ascDaily.ContainsKey($d)){ $ascDaily[$d]=[pscustomobject]@{date=$d;asc=0;val=0.0} }; $ascDaily[$d].asc++; $ascDaily[$d].val += $w.valor } }
  $ascArr=@($ascDaily.Values | Sort-Object date | ForEach-Object { [pscustomobject]@{date=$_.date;asc=$_.asc;val=[math]::Round($_.val,2)} })
  $apTicket=0; if($apSales.Count){ $apTicket=[math]::Round($apTotVal/$apSales.Count,2) }
  $asc=[pscustomobject]@{ generatedAt=$nowIso; generatedAtBR=$nowBR; apiceTicket=$apTicket; totalValor=[math]::Round($apTotVal,2)
    totalApice=$apAtivas; ascTotal=($ascE+$ascN); ascByEmail=$ascE; ascByName=$ascN; ascDaily=$ascArr }
  if($Mode -eq 'all' -or $Mode -eq 'ascensao'){ WriteJs 'data-ascensao.js' 'DASH_ASC' $asc }
  Write-Host ("ASCENSAO: {0} rastreadas (email={1} nome={2}) de {3} ativas no Apice | ticket medio R$ {4}" -f ($ascE+$ascN),$ascE,$ascN,$apAtivas,(M0 $apTicket))
}

# ===================================================================
#  DATAS — preenchimento de cada Cocktail por data (coluna "Oferta")
#  cada evento = 30 vagas. Agrupa vendas paid por data do evento.
# ===================================================================
if($Mode -eq 'all' -or $Mode -eq 'datas'){
  $K_OFERTA=HdrIndex $kh 'Oferta'
  # Atribuicao por PESSOA (1 pessoa = 1 vaga): a coluna G "DATA COCKTAIL" do controle manual VENCE
  # (pedido do cliente; resolve remanejamento — quem a kiwify marca num evento antigo mas o comercial
  # moveu de data). A kiwify (Oferta) preenche SO quem NAO esta no controle manual. Vermelhas ja foram
  # excluidas do manEvByEmail; excluo tambem da kiwify aqui.
  # ⚠️ VAGAS = SÓ o controle do COMERCIAL (planilha manual), pela coluna G "DATA COCKTAIL", tirando as
  # vermelhas. Decisão do cliente (11/09): as meninas preenchem as vagas certinho, então a aba Datas
  # espelha o controle delas — NÃO adiciona vendas que só estão na kiwify (essas contam no funil/ROAS,
  # mas só viram "vaga" quando o comercial lançar). Evita divergência com a contagem do time.
  $personEv=[ordered]@{}
  foreach($e in $manEvByEmail.Keys){ $m=$manEvByEmail[$e]; if($m.ev -eq ''){continue}; $personEv[$e]=[pscustomobject]@{dk=$m.ev;rev=$m.val;guest=[bool]$m.guest;nome=[string]$m.nome} }
  # faixa de faturamento de cada COMPRADORA (aba Consolidado: "Perfil de faturamento das compradoras" por evento).
  # Ultima resposta do Typeform; quem nao tem, a do Forms. Chaves ASCII (rotulos ficam no app.js). Convidada fica fora.
  function FatKey($s){ $f=((Deaccent (Norm $s)) -replace '[_\s]+',' ').Trim(); if($f -eq ''){ return '' }
    if($f -match 'menos'){ return 'lt100' }
    if($f -match '^entre r\$ ?(5|10|50) mil'){ return 'lt100' }
    if($f -match '100 ?(k|mil) a 300' -or $f -match 'entre r\$ ?100 mil e r\$ ?200'){ return 'f100' }
    if($f -match '300 ?(k|mil) a 500'){ return 'f300' }
    if($f -match '500 ?(k|mil) a 1'){ return 'f500' }
    if($f -match 'acima de 1 ?(m|milhao)'){ return 'f1m' }
    if($f -match 'acima de 200'){ return 'f200old' }   # opcao antiga do Typeform (ate ago/26)
    return '' }
  $fatByEmail=@{}; $fatDt=@{}
  foreach($r in $ld){ $e=(Norm $r[$L_EMAIL]).ToLower(); if($e -notmatch '@'){continue}; $k=FatKey $r[$L_FAT]; if($k -eq ''){continue}; $d=Norm $r[$L_DATE]
    if(-not $fatByEmail.ContainsKey($e) -or $d -ge $fatDt[$e]){ $fatByEmail[$e]=$k; $fatDt[$e]=$d } }
  foreach($r in $ffd){ $e=(Norm $r[$FF_EMAIL]).ToLower(); if($e -notmatch '@' -or $fatByEmail.ContainsKey($e)){continue}; $k=FatKey $r[$FF_FAT]; if($k -ne ''){ $fatByEmail[$e]=$k } }
  # 2a tentativa pelo NOME (o comercial as vezes lanca outro e-mail): 1o + ultimo nome; so vale se esse nome
  # aponta p/ UM unico e-mail na base de leads (homonimas ficam de fora). Tira o "(M)" que o comercial poe no nome.
  # E os nomes do meio do nome mais curto tem que estar no mais longo ("Debora Mussel Grandi de Medeiros" NAO casa
  # com "Debora Melo de Medeiros"; "Mariana Menezes" casa com "Mariana Rocha Menezes").
  function NameKey2($s){ $w=@(((NameKey ($s -replace '\([^)]*\)','')) -split ' ') | Where-Object { $_ -ne '' }); if($w.Count -lt 2){ return '' }; return $w[0]+' '+$w[$w.Count-1] }
  function NameToks($s){ $t=@{}; foreach($w in ((NameKey ($s -replace '\([^)]*\)','')) -split ' ')){ if($w -ne '' -and $w -notmatch '^(de|da|do|das|dos|e)$'){ $t[$w]=1 } }; return $t }
  function TokSubset($a,$b){ if($a.Count -le $b.Count){ $sm=$a; $lg=$b } else { $sm=$b; $lg=$a }; foreach($k in $sm.Keys){ if(-not $lg.ContainsKey($k)){ return $false } }; return $true }
  $fatByName=@{}; $fatNmDt=@{}; $fatNmTok=@{}; $nmEmails=@{}
  foreach($r in $ld){ $k=FatKey $r[$L_FAT]; if($k -eq ''){continue}; $full=(Norm $r[0])+' '+(Norm $r[1]); $nk=NameKey2 $full; if($nk -eq ''){continue}
    if(-not $nmEmails.ContainsKey($nk)){ $nmEmails[$nk]=@{} }; $nmEmails[$nk][(Norm $r[$L_EMAIL]).ToLower()]=1
    $d=Norm $r[$L_DATE]; if(-not $fatByName.ContainsKey($nk) -or $d -ge $fatNmDt[$nk]){ $fatByName[$nk]=$k; $fatNmDt[$nk]=$d; $fatNmTok[$nk]=NameToks $full } }
  $fatNameHits=0
  $evMap=@{}
  foreach($e in $personEv.Keys){ $p=$personEv[$e]; $dk=$p.dk
    if(-not $evMap.ContainsKey($dk)){ $lbl="Evento $dk"; try{ $lbl='Evento '+([datetime]::ParseExact($dk,'yyyy-MM-dd',$null)).ToString('dd/MM') }catch{}; $evMap[$dk]=[pscustomobject]@{ev=$lbl;dateKey=$dk;vendas=0;conv=0;revenue=0.0;fat=[ordered]@{}} }
    $o=$evMap[$dk]; $o.vendas++; if($p.guest){ $o.conv++ } else { $fk=$fatByEmail[$e]; if(-not $fk){ $nk=NameKey2 $p.nome; if($nk -ne '' -and $fatByName.ContainsKey($nk) -and $nmEmails[$nk].Count -eq 1 -and (TokSubset (NameToks $p.nome) $fatNmTok[$nk])){ $fk=$fatByName[$nk]; $fatNameHits++ } }; if(-not $fk){ $fk='none' }; if($o.fat.Contains($fk)){ $o.fat[$fk]++ } else { $o.fat[$fk]=1 } }; $o.revenue += $p.rev }   # vendas = VAGAS ocupadas (inclui convidadas, que entram com R$ 0)
  $evArr=@()
  foreach($e in $evMap.Values){ $evArr+=[pscustomobject]@{ev=$e.ev;dateKey=$e.dateKey;vendas=$e.vendas;conv=$e.conv;revenue=[math]::Round($e.revenue,2);fat=$e.fat} }
  $evArr=@($evArr | Sort-Object dateKey)
  $datas=[pscustomobject]@{ generatedAt=$nowIso; generatedAtBR=$nowBR; meta=30; today=$dmax; events=$evArr }
  WriteJs 'data-datas.js' 'DASH_DATAS' $datas
  Write-Host ("DATAS: {0} eventos | faixa de faturamento: {1} compradoras por e-mail + {2} pelo nome" -f $evArr.Count,@($personEv.Keys | Where-Object { $fatByEmail.ContainsKey($_) }).Count,$fatNameHits)
}

# ---- emit (por modo) ----------------------------------------------
if($Mode -eq 'all' -or $Mode -eq 'estudo'){
  WriteJs 'data-estudo.js' 'DASH_ESTUDO' $estudo
}
if($Mode -eq 'all' -or $Mode -eq 'traffic'){
  WriteJs 'data.js' 'DASH_DATA' ([pscustomobject]@{
    generatedAt=$nowIso; generatedAtBR=$nowBR; taxMultiplier=$TAX
    qualification='Faturamento mensal a partir de R$ 100 mil (exceto CLT)'
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
Write-Host ("FORMS: {0} leads ({1} qualif) de campanhas tag-forms | faturamentos vistos: {2}" -f $formsLeads,$formsQlf,(($formsFatSeen.GetEnumerator()|Sort-Object Name|ForEach-Object{ "$($_.Name)=$($_.Value)" }) -join '; '))
Write-Host ("OK mode={0}  days={1}  grain={2}  insights={3}  buyers={4}/{5}" -f $Mode,$dailyArr.Count,$grainArr.Count,$ins.Count,$matchedBuyers,$paidCount)
