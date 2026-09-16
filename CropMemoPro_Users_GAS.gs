/*************************************************************************
 * Crop Memo Pro — 사용자 등록 · 상태 관리 (Google Apps Script)
 *
 * 하는 일
 *   1) 앱에서 이메일·사용자명을 보내면 구글 시트 'Users' 탭에 기록하고 ACTIVE(승인)로 둡니다.
 *   2) 앱이 열릴 때 상태를 물어보면 ACTIVE / BLOCKED 를 돌려줍니다.
 *   3) 관리자는 시트에서 D열(상태)만 ACTIVE ↔ BLOCKED 로 바꾸면 됩니다.
 *
 * 설치 순서
 *   1. 브라우저에서 sheets.new 로 새 구글 시트를 만듭니다. (야장 동기화 시트와 별도로 두셔도 되고, 같이 쓰셔도 됩니다)
 *   2. 확장 프로그램 → Apps Script 를 열고, 기본 코드를 지운 뒤 이 파일 내용을 통째로 붙여넣습니다.
 *   3. 위쪽 함수 목록에서 setup 을 골라 ▶ 실행 → 권한 승인. ('Users' 탭이 만들어집니다)
 *   4. 배포 → 새 배포 → 유형 '웹 앱'
 *        - 실행 계정: 나
 *        - 액세스 권한: 모든 사용자        ← 반드시 '모든 사용자'
 *   5. 생성된 /exec 주소를 복사해 앱의 app.js 맨 위 USER_API 에 붙여넣습니다.
 *
 * 시트 구성 (Users 탭)
 *   A 등록일시 | B 이메일 | C 사용자명 | D 상태 | E 기기ID | F 마지막 접속 | G 앱 버전 | H 메모
 *   ※ 차단하려면 D열을 BLOCKED 로 바꾸세요. 되돌리려면 ACTIVE.
 *************************************************************************/

var USERS_SHEET = 'Users';
var USERS_HEAD = ['등록일시', '이메일', '사용자명', '상태', '기기ID', '마지막 접속', '앱 버전', '메모'];
var DEFAULT_STATUS = 'ACTIVE';          // 등록하면 바로 승인. 'BLOCKED' 로 바꾸면 관리자 승인제로 운영됩니다.

/** 최초 1회 실행 — 시트와 머리글을 만듭니다 */
function setup() {
  var sh = sheet_();
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, USERS_HEAD.length).setValues([USERS_HEAD]).setFontWeight('bold');
  sh.setColumnWidth(1, 150); sh.setColumnWidth(2, 220); sh.setColumnWidth(3, 110);
  sh.setColumnWidth(4, 90);  sh.setColumnWidth(5, 110); sh.setColumnWidth(6, 150);
  // D열(상태)에 ACTIVE / BLOCKED 드롭다운
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(['ACTIVE', 'BLOCKED'], true).setAllowInvalid(false).build();
  sh.getRange(2, 4, sh.getMaxRows() - 1, 1).setDataValidation(rule);
  // 차단된 줄은 붉게 보이도록
  var rng = sh.getRange(2, 1, sh.getMaxRows() - 1, USERS_HEAD.length);
  var cf = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$D2="BLOCKED"').setBackground('#FBE9E7').setRanges([rng]).build();
  sh.setConditionalFormatRules([cf]);
  return 'setup done · Users 탭 준비 완료';
}

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(USERS_SHEET) || ss.insertSheet(USERS_SHEET);
}
function norm_(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** 이메일로 줄 찾기 — 없으면 null */
function findRow_(sh, email) {
  var last = sh.getLastRow();
  if (last < 2) return null;
  var vals = sh.getRange(2, 2, last - 1, 1).getValues();      // B열(이메일)
  for (var i = 0; i < vals.length; i++) {
    if (norm_(vals[i][0]) === norm_(email)) return i + 2;
  }
  return null;
}

/** 앱 → 서버 (등록 · 상태 조회) */
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var body = {};
    try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
    var action = String(body.action || '').toLowerCase();
    var email = String(body.email || '').trim();
    if (!email) return json_({ ok: false, error: 'no-email' });

    var sh = sheet_(), row = findRow_(sh, email), now = new Date();

    if (action === 'register') {
      var name = String(body.name || '').trim();
      if (row) {
        // 이미 등록된 이메일 — 이름·접속 정보만 갱신하고 지금 상태를 돌려준다
        if (name) sh.getRange(row, 3).setValue(name);
        sh.getRange(row, 5).setValue(String(body.deviceId || ''));
        sh.getRange(row, 6).setValue(now);
        sh.getRange(row, 7).setValue(String(body.app || ''));
        var st = String(sh.getRange(row, 4).getValue() || DEFAULT_STATUS).toUpperCase();
        if (st !== 'ACTIVE' && st !== 'BLOCKED') { st = DEFAULT_STATUS; sh.getRange(row, 4).setValue(st); }
        return json_({ ok: true, status: st, existed: true });
      }
      sh.appendRow([now, email, name, DEFAULT_STATUS, String(body.deviceId || ''), now, String(body.app || ''), '']);
      return json_({ ok: true, status: DEFAULT_STATUS, existed: false });
    }

    if (action === 'status') {
      if (!row) {
        // 시트에서 지워진 사용자 — 다시 등록해 두고 승인으로 본다
        sh.appendRow([now, email, String(body.name || ''), DEFAULT_STATUS, String(body.deviceId || ''), now, String(body.app || ''), '자동 재등록']);
        return json_({ ok: true, status: DEFAULT_STATUS, restored: true });
      }
      sh.getRange(row, 6).setValue(now);                       // 마지막 접속
      if (body.app) sh.getRange(row, 7).setValue(String(body.app));
      var st2 = String(sh.getRange(row, 4).getValue() || DEFAULT_STATUS).toUpperCase();
      if (st2 !== 'ACTIVE' && st2 !== 'BLOCKED') st2 = DEFAULT_STATUS;
      return json_({ ok: true, status: st2, name: String(sh.getRange(row, 3).getValue() || '') });
    }

    return json_({ ok: false, error: 'unknown-action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** 브라우저에서 주소를 열었을 때 — 연결 확인용 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (String(p.action || '') === 'status' && p.email) {
    var sh = sheet_(), row = findRow_(sh, p.email);
    if (!row) return json_({ ok: true, status: 'NONE' });
    return json_({ ok: true, status: String(sh.getRange(row, 4).getValue() || DEFAULT_STATUS).toUpperCase() });
  }
  var n = Math.max(0, sheet_().getLastRow() - 1);
  return json_({ ok: true, msg: 'Crop Memo Pro 사용자 관리', users: n, serverTime: Date.now() });
}

/*************************************************************************
 * 관리자용 — 시트 메뉴에서 바로 차단/해제
 *************************************************************************/
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Crop Memo Pro')
    .addItem('선택한 사용자 차단 (BLOCKED)', 'blockSelected')
    .addItem('선택한 사용자 승인 (ACTIVE)', 'activateSelected')
    .addToUi();
}
function setSelected_(status) {
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== USERS_SHEET) { SpreadsheetApp.getUi().alert('Users 탭에서 사용해 주세요.'); return; }
  var rng = sh.getActiveRange(), r0 = Math.max(2, rng.getRow()), n = rng.getNumRows();
  if (r0 + n - 1 > sh.getLastRow()) n = sh.getLastRow() - r0 + 1;
  if (n < 1) return;
  var vals = []; for (var i = 0; i < n; i++) vals.push([status]);
  sh.getRange(r0, 4, n, 1).setValues(vals);
  SpreadsheetApp.getActive().toast(n + '명 → ' + status);
}
function blockSelected() { setSelected_('BLOCKED'); }
function activateSelected() { setSelected_('ACTIVE'); }
