// Cocktail Cardi Nigro · Qualificação Comercial — backend (Google Apps Script, publicado como app da web).
//
// Por que existe: a dash é um site estático (GitHub Pages) e não tem onde guardar marcações. Aqui ficam as marcações do
// comercial (planilha privada criada na 1ª execução) e a leitura de nome e e-mail das leads qualificadas.
// Lista aberta para quem tem o link, por decisão do cliente (07/11/2026). Telefone não é enviado.
//   GET  ?a=marks&v=<versão>  marcações: { id: [status, motivo, quem, quando] }
//   POST {a:'list'|'mark', ...}  lista de nome e e-mail, e gravação das marcações
//   GET  ?a=selftest           confere a instalação e devolve só contagens

var MASTER_ID = '1WuETdVje43yvMfyQDHO1PObXj_G9G-t6JjG6q987Z4o', LEADS_GID = '603619749';
var FORMS_ID = '1HuURt5bclbK2lUhbnDWvYmlwQowif-gFoVl_HV3Ukws', FORMS_GID = '0';
var PUBLIC_LIST = 'https://scaleagencia.github.io/cocktail-dash/data-qual.js';
var ID_SALT = 'ccn|';   // igual ao build.ps1 (QualId)
var HEAD = ['ID', 'Data do lead', 'Nome', 'E-mail', 'Telefone', 'Faturamento', 'Campanha', 'Conjunto', 'Anúncio', 'Status', 'Motivo', 'Marcado por', 'Quando'];
var COL = { id: 0, status: 9, motivo: 10, quem: 11, quando: 12 };
var ST_OK = 'Qualificada', ST_NO = 'Não qualificada';
var CHUNK = 80000, MARKS_TTL = 60, MAP_TTL = 21600;

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if ((p.a || 'marks') === 'marks') {
      var cur = marksPayload_();
      return out_(p.v && p.v === cur.v ? { ok: true, v: cur.v, same: true } : { ok: true, v: cur.v, m: cur.m });
    }
    if (p.a === 'selftest') return out_(selftest_());
    return out_({ ok: false, err: 'acao' });
  } catch (err) { return out_({ ok: false, err: msg_(err) }); }
}

function doPost(e) {
  try {
    var b = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (b.a === 'list') { var mp = leadsMap_(!!b.fresh); return out_({ ok: true, at: mp.at, map: mp.map }); }
    if (b.a === 'mark') return out_(mark_(b));
    return out_({ ok: false, err: 'acao' });
  } catch (err) { return out_({ ok: false, err: msg_(err) }); }
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function msg_(err) { return String((err && err.message) || err); }
function props_() { return PropertiesService.getScriptProperties(); }
function cache_() { return CacheService.getScriptCache(); }

// ---- planilha privada: criada na 1ª execução ----
function db_() {
  var id = props_().getProperty('DB_ID');
  if (id) return SpreadsheetApp.openById(id);
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    id = props_().getProperty('DB_ID');
    if (id) return SpreadsheetApp.openById(id);
    var ss = SpreadsheetApp.create('Cocktail · Qualificação Comercial (base da dash)');
    var sh = ss.getSheets()[0]; sh.setName('marcacoes');
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold').setBackground('#0f5ba8').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange(2, COL.status + 1, sh.getMaxRows() - 1, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList([ST_OK, ST_NO], true).setAllowInvalid(true).build());
    props_().setProperty('DB_ID', ss.getId());
    return ss;
  } finally { lock.releaseLock(); }
}
function sheet_() { return db_().getSheetByName('marcacoes'); }

// ---- texto grande no cache (limite de 100 KB por chave) ----
function putBig_(key, text, ttl) {
  var c = cache_(), n = Math.ceil(text.length / CHUNK), all = {};
  for (var i = 0; i < n; i++) all[key + '_' + i] = text.substr(i * CHUNK, CHUNK);
  all[key + '_n'] = String(n);
  c.putAll(all, ttl);
}
function getBig_(key) {
  var c = cache_(), n = parseInt(c.get(key + '_n'), 10);
  if (!(n > 0)) return null;
  var keys = []; for (var i = 0; i < n; i++) keys.push(key + '_' + i);
  var got = c.getAll(keys), s = '';
  for (var j = 0; j < n; j++) { if (got[keys[j]] == null) return null; s += got[keys[j]]; }
  return s;
}

// ---- marcações (leitura pública, sem dados pessoais) ----
function marksPayload_() {
  var raw = getBig_('marks');
  if (raw) return JSON.parse(raw);
  var gen = props_().getProperty('gen') || '0', sh = sheet_(), last = sh.getLastRow(), m = {};
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, HEAD.length).getValues();
    for (var i = 0; i < vals.length; i++) {
      var v = vals[i], id = String(v[COL.id]).trim(), st = String(v[COL.status]).trim(), s = st === ST_OK ? 1 : (st === ST_NO ? -1 : 0);
      if (!id || !s) continue;
      var when = v[COL.quando] instanceof Date ? Math.floor(v[COL.quando].getTime() / 1000) : 0;
      m[id] = [s, String(v[COL.motivo] || ''), String(v[COL.quem] || ''), when];
    }
  }
  var json = JSON.stringify(m), d = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, json, Utilities.Charset.UTF_8), hex = '';
  for (var k = 0; k < 6; k++) { var x = (d[k] + 256) % 256; hex += (x < 16 ? '0' : '') + x.toString(16); }
  var p = { v: hex, m: m };
  if ((props_().getProperty('gen') || '0') === gen) {   // alguém gravou no meio da leitura: não guarda
    try { putBig_('marks', JSON.stringify(p), MARKS_TTL); } catch (e) { /* sem cache: lê da planilha na próxima */ }
  }
  return p;
}

// valor que começa com = + - @ viraria fórmula na planilha (nome e e-mail vêm de formulário público)
function cell_(v, max) {
  var s = String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max || 200);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function writeItems_(items, who) {
  var sh = sheet_(), lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return false;
  try {
    var last = sh.getLastRow(), idx = {}, now = new Date();
    if (last >= 2) { var ids = sh.getRange(2, 1, last - 1, 1).getValues(); for (var i = 0; i < ids.length; i++) idx[String(ids[i][0]).trim()] = i + 2; }
    var fresh = [];
    items.forEach(function (it) {
      var s = it.s === 1 ? ST_OK : (it.s === -1 ? ST_NO : '');
      var row = [it.id, cell_(it.d, 10), cell_(it.n), cell_(it.e), cell_(it.t, 40), cell_(it.f), cell_(it.c, 300), cell_(it.ss, 300), cell_(it.ad, 300), s, s === ST_NO ? cell_(it.r, 60) : '', cell_(who, 40), now];
      if (idx[it.id]) sh.getRange(idx[it.id], 1, 1, HEAD.length).setValues([row]);
      else { idx[it.id] = -1; fresh.push(row); }
    });
    if (fresh.length) {
      var start = sh.getLastRow() + 1, faltam = start + fresh.length - 1 - sh.getMaxRows();
      if (faltam > 0) sh.insertRowsAfter(sh.getMaxRows(), faltam + 500);
      sh.getRange(start, 1, fresh.length, HEAD.length).setValues(fresh);
    }
    SpreadsheetApp.flush();
    props_().setProperty('gen', String(now.getTime()));
    cache_().remove('marks_n');
    return true;
  } finally { lock.releaseLock(); }
}

function mark_(b) {
  var byId = {};   // mesma lead 2x no lote: vale a última
  (Array.isArray(b.items) ? b.items : []).slice(0, 200).forEach(function (it) { if (it && /^q[0-9a-f]{12}$/.test(String(it.id)) && (it.s === 1 || it.s === -1 || it.s === 0)) byId[it.id] = it; });
  var items = Object.keys(byId).map(function (k) { return byId[k]; });
  if (!items.length) return { ok: false, err: 'sem itens' };
  var who = String(b.who == null ? '' : b.who).trim();
  if (!who) return { ok: false, err: 'sem nome' };
  db_();   // garante a planilha antes de pegar a trava
  if (!writeItems_(items, who)) return { ok: false, err: 'ocupado' };
  return { ok: true, v: marksPayload_().v };
}

// ---- nome e e-mail das leads qualificadas ----
function idOf_(email) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, ID_SALT + email, Utilities.Charset.UTF_8), h = '';
  for (var i = 0; i < 6; i++) { var x = (b[i] + 256) % 256; h += (x < 16 ? '0' : '') + x.toString(16); }
  return 'q' + h;
}
function norm_(s) { return String(s == null ? '' : s).replace(/​/g, '').trim(); }
function csv_(text) {   // RFC 4180 (Utilities.parseCsv falha com aspas e quebras de linha dentro da célula)
  var rows = [], row = [], cur = '', q = false, i = 0, n = text.length, c;
  while (i < n) {
    c = text.charAt(i);
    if (q) {
      if (c === '"') { if (text.charAt(i + 1) === '"') { cur += '"'; i += 2; continue; } q = false; i++; continue; }
      cur += c; i++; continue;
    }
    if (c === '"') { q = true; i++; continue; }
    if (c === ',') { row.push(cur); cur = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
function gviz_(id, gid, tq) {
  var url = 'https://docs.google.com/spreadsheets/d/' + id + '/gviz/tq?tqx=out:csv&gid=' + gid + (tq ? '&tq=' + encodeURIComponent(tq) : '');
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('planilha ' + id.slice(0, 6) + ' respondeu ' + res.getResponseCode());
  return csv_(res.getContentText('UTF-8'));
}
function letter_(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; }
// lê só as colunas pedidas, achadas pelo NOME do cabeçalho (a planilha pode mudar a ordem)
function readCols_(id, gid, tests) {
  var head = gviz_(id, gid, 'limit 1')[0] || [], pos = [];
  tests.forEach(function (t) {
    var found = -1;
    for (var i = 0; i < head.length; i++) { if (t.test(norm_(head[i]))) { found = i; break; } }
    pos.push(found);
  });
  var use = pos.filter(function (p) { return p >= 0; });
  var data = gviz_(id, gid, 'select ' + use.map(letter_).join(','));
  return { pos: pos, slot: pos.map(function (p) { return use.indexOf(p); }), rows: data.slice(1) };
}
function leadsMap_(fresh) {
  if (!fresh) { var raw = getBig_('map2'); if (raw) return JSON.parse(raw); }
  var pub = UrlFetchApp.fetch(PUBLIC_LIST + '?t=' + Date.now(), { muteHttpExceptions: true });
  if (pub.getResponseCode() !== 200) throw new Error('lista pública respondeu ' + pub.getResponseCode());
  var want = {}, re = /"(q[0-9a-f]{12})"/g, hit, txt = pub.getContentText('UTF-8');
  while ((hit = re.exec(txt))) want[hit[1]] = 1;
  var map = {};
  var L = readCols_(MASTER_ID, LEADS_GID, [/^nome$/i, /^sobrenome$/i, /melhor e-?mail/i]);
  if (L.pos[2] < 0) throw new Error('coluna de e-mail não encontrada nos leads');
  L.rows.forEach(function (r) {
    var em = norm_(r[L.slot[2]]).toLowerCase(); if (em.indexOf('@') < 0) return;
    var id = idOf_(em); if (!want[id]) return;
    var nm = norm_(L.slot[0] >= 0 ? r[L.slot[0]] : '') + ' ' + norm_(L.slot[1] >= 0 ? r[L.slot[1]] : '');
    map[id] = [nm.trim(), em];
  });
  var F = readCols_(FORMS_ID, FORMS_GID, [/^nome_?\s?completo$/i, /^e-?mail$/i]);
  if (F.pos[1] >= 0) F.rows.forEach(function (r) {
    var em = norm_(r[F.slot[1]]).toLowerCase(); if (em.indexOf('@') < 0) return;
    var id = idOf_(em); if (!want[id] || map[id]) return;
    map[id] = [norm_(F.slot[0] >= 0 ? r[F.slot[0]] : ''), em];
  });
  var obj = { at: Date.now(), map: map, want: Object.keys(want).length };
  try { putBig_('map2', JSON.stringify(obj), MAP_TTL); } catch (e) { /* sem cache: remonta na próxima */ }
  return obj;
}

// ---- conferência da instalação: só contagens, nada pessoal, no máximo 1 vez por minuto ----
function selftest_() {
  var c = cache_();
  if (c.get('st')) return { ok: false, err: 'aguarde 1 minuto' };
  c.put('st', '1', 60);
  var t0 = Date.now(), mp = leadsMap_(true), found = Object.keys(mp.map).length, sh = sheet_(), idT = 'q000000000000';
  var wrote = writeItems_([{ id: idT, s: 1, n: 'autoteste', e: '', d: '', t: '', f: '', c: '', ss: '', ad: '' }], 'autoteste');
  var seen = !!marksPayload_().m[idT], removed = false, lock = LockService.getScriptLock();
  if (lock.tryLock(25000)) {
    try {
      var tf = sh.getRange('A:A').createTextFinder(idT).matchEntireCell(true).findNext();
      if (tf) { sh.deleteRow(tf.getRow()); removed = true; }
      SpreadsheetApp.flush(); props_().setProperty('gen', String(Date.now())); c.remove('marks_n');
    } finally { lock.releaseLock(); }
  }
  return { ok: true, listaPublica: mp.want, encontrados: found, faltando: mp.want - found, gravou: wrote, leuDeVolta: seen, limpou: removed, ms: Date.now() - t0 };
}
