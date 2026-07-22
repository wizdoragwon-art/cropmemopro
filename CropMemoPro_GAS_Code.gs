/*************************************************************************
 * Crop Memo Pro — GAS 백엔드 (시트 = DB, 오프라인 앱의 동기화 수신)
 * 역할: 현장 네이티브 앱이 오프라인에서 쌓은 변경분을 doPost로 받아
 *       구글 시트에 반영(최종저장 우선). 사무실은 시트로 관리/분석/내보내기.
 *
 * ── 배포 방법 ──────────────────────────────────────────────
 * 1) sheets.new 로 새 스프레드시트 → 확장 프로그램 → Apps Script
 * 2) 이 코드를 Code.gs 에 붙여넣기 → 저장
 * 3) 함수 목록에서 setup 실행(최초 1회, 시트/헤더 생성 + 권한 승인)
 * 4) 배포 → 새 배포 → 유형: 웹 앱
 *      - 실행 계정: 나
 *      - 액세스 권한: (팀 내부면) 도메인 사용자 / (앱 전용이면) 나만  → 상황에 맞게
 *    → 웹 앱 URL(.../exec)이 나옴. 이 URL을 안드로이드 앱의 SYNC_URL 에 넣음.
 *
 * ── 앱이 보내는 동기화 규약(POST body, JSON) ─────────────────
 * {
 *   "deviceId": "field-tablet-01",
 *   "token":    "공유비밀키(선택, SYNC_TOKEN 과 일치해야 수신)",
 *   "batch": [
 *     { "table":"project",     "key":"P001",
 *       "data":{"name":"토마토 내병성","crop":"토마토","goal":"","status":"조사중"},
 *       "updatedAt": 1720500000000, "deleted": false },
 *     { "table":"generation",  "key":"P001|G01",
 *       "data":{"projId":"P001","label":"F3","stage":"조사"},
 *       "updatedAt": 1720500000000 },
 *     { "table":"line",        "key":"P001|G01|L001",
 *       "data":{"projId":"P001","genId":"G01","label":"TM24-025","pedigree":"금강/IT12345","zone":"A동",
 *               "row":3,"col":5,"rep":2,"block":"B-3","indivTotal":10,"selected":false},
 *       "updatedAt": 1720500000000 },
 *     { "table":"observation", "key":"P001|G01|L001|5|t_dis",
 *       "data":{"projId":"P001","genId":"G01","lineId":"L001","indiv":5,
 *               "traitId":"t_dis","value":"3"},
 *       "updatedAt": 1720500000000, "deleted": false }
 *   ]
 * }
 * 응답: { "ok":true, "applied":N, "skipped":M, "serverTime":<ms> }
 *   - skipped = 서버에 이미 더 최신(updatedAt) 이 있어 무시된 항목 수(충돌=최종저장 우선)
 *
 * ── 앱이 데이터를 되받는 규약(양방향 동기화) ─────────────────
 *   GET  .../exec?action=pull&since=<ms>[&token=..]
 *     → { ok:true, serverTime, changes:[ {table,key,data,updatedAt,deleted}, ... ] }
 *
 * ── CSV 내보내기(사무실/엑셀) ────────────────────────────────
 *   GET  .../exec?action=csv&gen=<genId>[&shape=long|wide]
 *     → UTF-8 BOM CSV (엑셀에서 바로 열림)
 *************************************************************************/

// ===== 설정 =====
var SYNC_TOKEN = '';   // 공유 비밀키. 비워두면 검사 안 함. 운영 시 반드시 설정 권장.
var SHEETS = {
  project:    ['key','name','crop','goal','status','updatedAt','deleted'],
  generation: ['key','projId','label','stage','updatedAt','deleted'],
  line:       ['key','projId','genId','label','zone','row','col','rep','block','indivTotal','selected','updatedAt','deleted','pedigree'],
  trait:      ['key','genId','name','type','unit','scale','updatedAt','deleted'],
  observation:['key','projId','genId','lineId','indiv','traitId','value','updatedAt','deleted']
};

// ===== 최초 1회: 시트/헤더 생성 =====
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(function(name){
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1,1,1,SHEETS[name].length).setValues([SHEETS[name]]);
      sh.setFrozenRows(1);
    } else {
      // 기존 시트: 새로 추가된 열(예: pedigree) 머리글을 끝에 보강(데이터는 그대로)
      var hdr = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
      if (hdr.length < SHEETS[name].length) {
        sh.getRange(1,1,1,SHEETS[name].length).setValues([SHEETS[name]]);
        sh.setFrozenRows(1);
      }
    }
  });
  // 기본 'Sheet1' 정리(비어 있으면)
  var s1 = ss.getSheetByName('시트1') || ss.getSheetByName('Sheet1');
  if (s1 && ss.getSheets().length > 1 && s1.getLastRow() === 0) ss.deleteSheet(s1);
  return 'setup done';
}

// ===== 진입점 =====
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);            // 동시 쓰기 직렬화
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    if (SYNC_TOKEN && body.token !== SYNC_TOKEN) return json_({ok:false, error:'unauthorized'});

    // ===== 드라이브 저장 (CropMemo / 과제명 / …) =====
    if (body.action === 'driveCsv')  return json_(saveCsvToDrive_(body));
    if (body.action === 'driveFile') return json_(saveFileToDrive_(body));

    var batch = body.batch || [];
    var applied = 0, skipped = 0;
    // 테이블별로 묶어 처리(시트 접근 최소화)
    var byTable = {};
    batch.forEach(function(ch){ (byTable[ch.table] = byTable[ch.table] || []).push(ch); });
    Object.keys(byTable).forEach(function(table){
      var r = upsertRows_(table, byTable[table]);
      applied += r.applied; skipped += r.skipped;
    });
    return json_({ ok:true, applied:applied, skipped:skipped, serverTime: Date.now() });
  } catch (err) {
    return json_({ ok:false, error:String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (SYNC_TOKEN && p.action !== 'csv' && p.token !== SYNC_TOKEN) return json_({ok:false,error:'unauthorized'});
  switch (p.action) {
    case 'ping': return json_({ ok:true, serverTime: Date.now() });
    case 'pull': return json_(pull_(Number(p.since || 0)));
    case 'csv':  return csv_(p.gen, p.shape || 'long');
    default:     return json_({ ok:true, msg:'Crop Memo Pro backend', serverTime: Date.now() });
  }
}

// ===== 핵심: upsert (최종저장 우선) =====
function upsertRows_(table, changes) {
  var cols = SHEETS[table];
  if (!cols) return { applied:0, skipped:0 };
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(table);
  var last = sh.getLastRow();
  var data = last > 1 ? sh.getRange(2,1,last-1,cols.length).getValues() : [];
  var keyIdx = cols.indexOf('key'), upIdx = cols.indexOf('updatedAt');
  var pos = {};                              // key -> 시트 행번호(2-based)
  for (var i=0;i<data.length;i++) pos[String(data[i][keyIdx])] = i+2;

  var applied = 0, skipped = 0, appends = [];
  changes.forEach(function(ch){
    var row = buildRow_(cols, ch);
    var key = String(ch.key);
    var rowNum = pos[key];
    if (rowNum) {
      var existingUp = Number(data[rowNum-2][upIdx] || 0);
      if (Number(ch.updatedAt||0) >= existingUp) {       // 더 최신이면 덮어씀
        sh.getRange(rowNum,1,1,cols.length).setValues([row]);
        applied++;
      } else { skipped++; }                              // 서버가 더 최신 → 무시
    } else {
      appends.push(row);                                 // 신규
      pos[key] = -1;                                      // 같은 배치 내 중복 방지
    }
  });
  if (appends.length) {
    sh.getRange(sh.getLastRow()+1, 1, appends.length, cols.length).setValues(appends);
    applied += appends.length;
  }
  return { applied:applied, skipped:skipped };
}

function buildRow_(cols, ch) {
  var d = ch.data || {};
  return cols.map(function(c){
    if (c === 'key') return ch.key;
    if (c === 'updatedAt') return Number(ch.updatedAt || Date.now());
    if (c === 'deleted') return ch.deleted ? 1 : '';
    var v = d[c];
    return (v === undefined || v === null) ? '' : v;
  });
}

// ===== pull: since 이후 변경분 =====
function pull_(since) {
  var out = [];
  Object.keys(SHEETS).forEach(function(table){
    var cols = SHEETS[table];
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(table);
    var last = sh.getLastRow(); if (last < 2) return;
    var rows = sh.getRange(2,1,last-1,cols.length).getValues();
    var upIdx = cols.indexOf('updatedAt'), keyIdx = cols.indexOf('key'), delIdx = cols.indexOf('deleted');
    rows.forEach(function(r){
      var up = Number(r[upIdx]||0);
      if (up > since) {
        var data = {};
        cols.forEach(function(c,i){ if (c!=='key'&&c!=='updatedAt'&&c!=='deleted') data[c]=r[i]; });
        out.push({ table:table, key:String(r[keyIdx]), data:data, updatedAt:up, deleted: !!r[delIdx] });
      }
    });
  });
  return { ok:true, serverTime: Date.now(), changes: out };
}

// ===== CSV 내보내기 (UTF-8 BOM, 엑셀 호환) =====
function csv_(genId, shape) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var obsCols = SHEETS.observation, lineCols = SHEETS.line;
  var obsSh = ss.getSheetByName('observation'), lineSh = ss.getSheetByName('line');
  var obs = obsSh.getLastRow()>1 ? obsSh.getRange(2,1,obsSh.getLastRow()-1,obsCols.length).getValues() : [];
  var lines = lineSh.getLastRow()>1 ? lineSh.getRange(2,1,lineSh.getLastRow()-1,lineCols.length).getValues() : [];

  // lineId -> {label, rep, indivTotal}
  var lmap = {};
  var lKey=lineCols.indexOf('key'), lLbl=lineCols.indexOf('label'), lRep=lineCols.indexOf('rep'), lGen=lineCols.indexOf('genId'), lPed=lineCols.indexOf('pedigree');
  lines.forEach(function(r){ lmap[String(r[lKey])] = {label:r[lLbl], rep:r[lRep], genId:r[lGen], pedigree:(lPed>=0?r[lPed]:'')}; });

  var oGen=obsCols.indexOf('genId'), oLine=obsCols.indexOf('lineId'), oInd=obsCols.indexOf('indiv'),
      oTr=obsCols.indexOf('traitId'), oVal=obsCols.indexOf('value'), oDel=obsCols.indexOf('deleted'),
      oProj=obsCols.indexOf('projId');

  var rows = [['라벨번호','품종명/Pedigree','세대','반복','개체','형질','값']];
  obs.forEach(function(r){
    if (r[oDel]) return;
    if (genId && String(r[oGen]) !== String(genId)) return;
    var lid = String(r[oLine]); var lk = lmap[lid] || {};
    rows.push([ lk.label || lid, lk.pedigree || '', findGenLabel_(r[oGen]), lk.rep || '', r[oInd], r[oTr], r[oVal] ]);
  });

  var csv = rows.map(function(row){
    return row.map(function(c){ c = (c==null?'':String(c)); return /[",\n]/.test(c) ? '"'+c.replace(/"/g,'""')+'"' : c; }).join(',');
  }).join('\r\n');

  var out = ContentService.createTextOutput('\uFEFF' + csv);  // UTF-8 BOM
  out.setMimeType(ContentService.MimeType.CSV);
  return out;
}

function findGenLabel_(genId) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('generation');
  if (sh.getLastRow()<2) return genId;
  var cols=SHEETS.generation, kIdx=cols.indexOf('key'), lIdx=cols.indexOf('label');
  var data=sh.getRange(2,1,sh.getLastRow()-1,cols.length).getValues();
  for (var i=0;i<data.length;i++) if (String(data[i][kIdx])===String(genId)) return data[i][lIdx];
  return genId;
}

// ===== 응답 유틸 =====

/*************************************************************************
 * 드라이브 저장 — CropMemo / <과제명> / 파일
 *  - 폴더가 없으면 자동 생성
 *  - CSV: 같은 이름 파일이 있으면 내용을 덮어씀(중복 생성 방지)
 *  - 사진/그림: 같은 이름이 있으면 건너뜀
 *************************************************************************/
var DRIVE_ROOT = 'CropMemo';

function folder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function projFolder_(projName) {
  var root = folder_(DriveApp.getRootFolder(), DRIVE_ROOT);
  return folder_(root, sanitizeName_(projName || '무제'));
}
function sanitizeName_(s) {
  return String(s == null ? '' : s).replace(/[\\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || '무제';
}

// CSV 저장 (앱의 'CSV 내보내기'와 동일한 파일명·내용, UTF-8 BOM)
function saveCsvToDrive_(body) {
  var name = sanitizeName_(body.fileName || 'export.csv');
  var csv  = String(body.csv || '');
  if (!csv) return { ok:false, error:'empty csv' };
  var fol  = projFolder_(body.proj);
  var blob = Utilities.newBlob('\uFEFF' + csv, 'text/csv', name);
  var it   = fol.getFilesByName(name), file;
  if (it.hasNext()) { file = it.next(); file.setContent('\uFEFF' + csv); }   // 덮어쓰기
  else              { file = fol.createFile(blob); }
  return { ok:true, id:file.getId(), name:name, folder:fol.getName(), url:file.getUrl() };
}

// 사진·그림 저장 (base64) — 파일명: 과제명_라벨번호_개체번호_형질_촬영일자.jpg
function saveFileToDrive_(body) {
  var name = sanitizeName_(body.fileName || ('img_' + Date.now() + '.jpg'));
  var b64  = String(body.dataB64 || '');
  if (!b64) return { ok:false, error:'empty file' };
  var fol  = projFolder_(body.proj);
  var it   = fol.getFilesByName(name);
  if (it.hasNext()) return { ok:true, skipped:true, name:name };   // 이미 있음
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), body.mime || 'image/jpeg', name);
  var file = fol.createFile(blob);
  return { ok:true, id:file.getId(), name:name, folder:fol.getName(), url:file.getUrl() };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ===== (선택) 로컬 테스트용 =====
function _selftest() {
  setup();
  var e = { postData:{ contents: JSON.stringify({
    deviceId:'test', batch:[
      {table:'line', key:'P1|G1|L1', data:{projId:'P1',genId:'G1',label:'TM24-001',rep:1,indivTotal:10}, updatedAt:Date.now()},
      {table:'observation', key:'P1|G1|L1|1|t_dis', data:{projId:'P1',genId:'G1',lineId:'L1',indiv:1,traitId:'t_dis',value:'3'}, updatedAt:Date.now()}
    ]})}};
  Logger.log(doPost(e).getContent());
}
