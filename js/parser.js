// ============================================================================
// parser.js — 등기부등본 파서 (M3 + M4)
//
// ES module. 외부 통신 0. 법적 판단(말소기준/인수·소멸/위험도) 문구 없음.
// 설계서 5.2~5.5 + PARSING_NOTES.md 를 기준으로 6절 JSON `{ property, timeline }`
// 을 산출한다. M4: 말소 판정(⑧ markCanceled — 사실 마킹, 법적판단 아님),
// 요약 교차검증(⑨ crossCheckSummary — 경고만), 타임라인 노이즈필터
// (⑩ applyTimelineDisplay — display 플래그, 가산형) 추가.
//
// 역할분리(불변): 구조(컬럼/블록)는 좌표가 결정, 값추출은 정규식이 담당.
// pdf-loader(M2)의 extractPages/groupLines/assignColumns 를 가산형으로 재사용.
// ============================================================================

import {
  extractPages,
  groupLines,
  assignColumns,
} from "./pdf-loader.js";

// ---------------------------------------------------------------------------
// 공용 정규식/헬퍼
// ---------------------------------------------------------------------------

/** 날짜: 2019년 11월 22일 → 캡처 그룹 [_, YYYY, M, D] */
const DATE_RE = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/;

/** 날짜(전역) — 문자열에서 날짜를 모두 제거할 때 사용(법원명에 '일' 혼입 방지) */
const DATE_RE_G = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g;

/** 두 자리 0패딩 */
const pad2 = (n) => String(n).padStart(2, "0");

/** 임의 문자열에서 첫 날짜를 ISO(YYYY-MM-DD)로. 없으면 null. */
function toIsoDate(str) {
  if (typeof str !== "string") return null;
  const m = DATE_RE.exec(str);
  if (!m) return null;
  return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
}

/** 공백 제거(줄바꿈/스페이스 결합용) */
const stripWs = (s) => (typeof s === "string" ? s.replace(/\s+/g, "") : "");

/** 다중 공백 → 단일 공백 + trim */
const collapseWs = (s) =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";

/** 날짜 ISO 문자열 오름차순 비교(null은 뒤로) */
function cmpIsoDate(a, b) {
  if (a && b) return a < b ? -1 : a > b ? 1 : 0;
  if (a) return -1;
  if (b) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// ② 페이지별 라인 평탄화 (페이지번호 보존)
// ---------------------------------------------------------------------------

/**
 * extractPages 결과(PageText[])를 페이지·y 순서로 평탄화한 라인 배열로 만든다.
 * pdf-loader.groupLines 가 페이지 내부를 y 내림차순(위→아래)으로 정렬하므로,
 * 페이지 순서대로 이어붙이면 문서 전체의 읽기 순서가 보존된다.
 *
 * @param {{pageNum:number, items:Array}[]} pages
 * @param {number} [yTolerance=2]
 * @returns {{pageNum:number, y:number, items:Array, text:string}[]}
 */
export function groupAllLines(pages, yTolerance = 2) {
  const all = [];
  if (!Array.isArray(pages)) return all;
  for (const page of pages) {
    if (!page || !Array.isArray(page.items)) continue;
    const lines = groupLines(page.items, yTolerance);
    for (const line of lines) {
      all.push({
        pageNum: page.pageNum,
        y: line.y,
        items: line.items,
        text: line.text,
      });
    }
  }
  return all;
}

// ---------------------------------------------------------------------------
// ④ 노이즈 제거 (PARSING_NOTES 4절)
// ---------------------------------------------------------------------------

/** 한 라인이 폐기 대상 노이즈인지 판정 */
function isNoiseLine(line) {
  const text = line && typeof line.text === "string" ? line.text : "";
  const s = stripWs(text);
  if (!s) return true;

  // 열람용 (세로 분산되어 "열 람 용"으로 묶임)
  if (/^열람용$/.test(s)) return true;
  // 열람일시 : 2026년04월02일 ...
  if (s.includes("열람일시")) return true;
  // 페이지번호 N/9, 1/1 (단독 라인)
  if (/^\d{1,3}\/\d{1,3}$/.test(s)) return true;
  // 반복 헤더 [집합건물]/[건물]/[토지] 시작 (주소는 extractProperty가 raw에서 따로 추출)
  if (/^\[(집합건물|건물|토지)\]/.test(s)) return true;
  // 컬럼 헤더 "순위번호 등 기 목 적 접 수 ..."
  if (s.includes("순위번호") && s.includes("등기목적")) return true;
  // 부동산등기법 제177조의 6 ... 전산이기
  if (s.includes("전산이기") || s.includes("제177조")) return true;
  // 도면편철장
  if (s.includes("도면편철")) return true;
  // 행정구역명칭변경
  if (s.includes("행정구역명칭변경")) return true;
  // 도로명주소
  if (s.includes("도로명주소")) return true;
  // 표제부 면적줄 (㎡)
  if (s.includes("㎡") || s.includes("m²")) return true;

  return false;
}

/**
 * 노이즈 라인을 제거한다(가산형: 원본 배열 불변, 필터된 새 배열 반환).
 * @param {{text:string}[]} lines
 * @returns {Array}
 */
export function dropNoise(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.filter((l) => !isNoiseLine(l));
}

// ---------------------------------------------------------------------------
// ⑤ 섹션 분리 (표제부 / 갑구 / 을구 / 요약)
// ---------------------------------------------------------------------------

/**
 * 경계 라인(【 표 제 부 】/【 갑 구 】/【 을 구 】/주요 등기사항 요약)을 기준으로
 * 라인들을 4개 섹션으로 나눈다. 경계 라인 자체는 어디에도 포함하지 않는다.
 *
 * @param {{text:string}[]} lines
 * @returns {{pyo:Array, gap:Array, eul:Array, summary:Array}}
 */
export function splitSections(lines) {
  const out = { pyo: [], gap: [], eul: [], summary: [] };
  if (!Array.isArray(lines)) return out;

  let cur = null;
  for (const line of lines) {
    const s = stripWs(line && line.text);
    if (s.includes("【표제부】")) {
      cur = "pyo";
      continue;
    }
    if (s.includes("【갑구】")) {
      cur = "gap";
      continue;
    }
    if (s.includes("【을구】")) {
      cur = "eul";
      continue;
    }
    if (s.includes("주요등기사항요약")) {
      cur = "summary";
      continue;
    }
    if (cur) out[cur].push(line);
  }
  return out;
}

// ---------------------------------------------------------------------------
// ⑥ 블록 분리 (순위번호 기준, 페이지경계 재결합)
// ---------------------------------------------------------------------------

/** rank 컬럼 토큰이 순위번호(정수 또는 부기 5-1)인지 검사하고 정규화 */
function parseRankToken(rankCell) {
  const s = stripWs(rankCell);
  if (/^\d{1,3}(-\d{1,3})?$/.test(s)) return s;
  return null;
}

/**
 * @typedef {Object} Item
 * @property {string} gu        - "갑구" | "을구"
 * @property {string} rank      - 순위번호("8","5-1")
 * @property {Array}  lines     - 이 항목에 속한 라인들
 * @property {Array}  cols      - 라인별 assignColumns 결과
 */

/**
 * 순위번호(rank 컬럼) 기준으로 섹션 라인들을 Item[] 로 분리한다.
 * - rank 컬럼에 정수/부기가 등장 = 새 항목 시작.
 * - 다음 rank 전까지 같은 항목. rank 없는 연속 라인(페이지경계로 쪼개진 꼬리)은
 *   직전 항목에 흡수된다(노이즈 제거가 선행되어야 안전).
 *
 * @param {Array} sectionLines
 * @param {string} gu
 * @returns {Item[]}
 */
export function blockify(sectionLines, gu) {
  const items = [];
  if (!Array.isArray(sectionLines)) return items;

  let cur = null;
  for (const line of sectionLines) {
    const cols = assignColumns(line);
    const rank = parseRankToken(cols.rank);
    if (rank) {
      cur = { gu, rank, lines: [], cols: [] };
      items.push(cur);
    }
    if (cur) {
      cur.lines.push(line);
      cur.cols.push(cols);
    }
    // 첫 rank 이전의 떠돌이 라인은 버린다.
  }
  return items;
}

// ---------------------------------------------------------------------------
// ⑦ 필드 추출
// ---------------------------------------------------------------------------

/** Item 의 라인별 컬럼을 컬럼별로 합쳐 하나의 텍스트로 만든다 */
function mergeColumns(item) {
  const acc = { purpose: [], receipt: [], cause: [], party: [] };
  for (const c of item.cols) {
    if (c.purpose) acc.purpose.push(c.purpose);
    if (c.receipt) acc.receipt.push(c.receipt);
    if (c.cause) acc.cause.push(c.cause);
    if (c.party) acc.party.push(c.party);
  }
  return {
    purpose: collapseWs(acc.purpose.join(" ")),
    receipt: collapseWs(acc.receipt.join(" ")),
    cause: collapseWs(acc.cause.join(" ")),
    party: collapseWs(acc.party.join(" ")),
  };
}

/** 금액 종류(우선순위 순). 전세금은 right 카테고리 보조용으로 추가. */
const AMOUNT_KINDS = ["거래가액", "청구금액", "채권최고액", "채권액", "전세금"];

/** 한글 금액 숫자 문자(파서가 받아들이는 문자 집합) */
const KO_AMOUNT_CHARS = "영일이삼사오육칠팔구십백천만억조";

/**
 * 한글 금액 문자열을 정수로 변환한다. 예: "사천팔백만" → 48000000.
 * 입력에 '금'/'원'이 섞여 있어도 허용. 해석 불가 문자가 있으면 null.
 *
 * @param {string} str
 * @returns {number|null}
 */
export function parseKoreanAmount(str) {
  if (typeof str !== "string") return null;
  let s = str.replace(/[\s,]/g, "");
  s = s.replace(/^금/, "").replace(/원정?$/, "");
  if (!s) return null;

  const digit = { 영: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
  const small = { 십: 10, 백: 100, 천: 1000 };
  const big = { 만: 10000, 억: 100000000, 조: 1000000000000 };

  let total = 0; // 확정 누적(억/만 등 큰 단위로 닫힌 값)
  let section = 0; // 현재 큰 단위 블록 내 누적
  let current = 0; // 직전 숫자
  for (const ch of s) {
    if (ch in digit) {
      current = digit[ch];
    } else if (ch in small) {
      section += (current || 1) * small[ch];
      current = 0;
    } else if (ch in big) {
      section += current;
      total += section * big[ch];
      section = 0;
      current = 0;
    } else {
      return null; // 알 수 없는 문자 → 실패
    }
  }
  total += section + current;
  return total > 0 ? total : null;
}

/**
 * 금액(amount/amountKind) 추출.
 * - amountKind 키워드가 있을 때만 금액을 잡는다(추측 금지).
 * - 아라비아 우선, 실패 시 한글 금액 보조. 한글도 실패 시 amount=null + amountRaw 보존.
 *
 * @param {string} haystack - 항목의 컬럼들을 합친 검색 문자열
 * @returns {{amount:number|null, amountKind:string|null, amountRaw:string|null}}
 */
function extractAmount(haystack) {
  const text = collapseWs(haystack);

  // 1) 키워드 앵커 방식(W1 수정): 키워드 바로 뒤의 '금…원'만 채택한다.
  //    한 항목에 '금…원'이 여러 개여도(예: 기준채권 + 채권최고액) 키워드에
  //    묶인 금액을 우선순위(AMOUNT_KINDS) 순으로 확정 → 오추출 방지.
  for (const k of AMOUNT_KINDS) {
    // 아라비아: 채권최고액 금680,000,000원(정) — 숫자와 '원' 사이 공백 허용
    const arK = new RegExp(`${k}\\s*금\\s*([\\d,]+)\\s*원정?`).exec(text);
    if (arK) {
      const amount = parseInt(arK[1].replace(/,/g, ""), 10);
      return { amount, amountKind: k, amountRaw: null };
    }
    // 한글: 채권최고액 금사천팔백만원
    const hgK = new RegExp(`${k}\\s*금\\s*([${KO_AMOUNT_CHARS}]+)\\s*원정?`).exec(text);
    if (hgK) {
      const val = parseKoreanAmount(hgK[1]);
      if (val != null) return { amount: val, amountKind: k, amountRaw: null };
      return { amount: null, amountKind: k, amountRaw: `금${hgK[1]}원` };
    }
  }

  // 2) 폴백: 키워드 앵커가 모두 실패. amountKind는 본문에 등장하는 키워드로 추정.
  let amountKind = null;
  for (const k of AMOUNT_KINDS) {
    if (text.includes(k)) {
      amountKind = k;
      break;
    }
  }
  if (!amountKind) return { amount: null, amountKind: null, amountRaw: null };

  // 아라비아: 금 380,000,000 원(정) — 숫자와 '원' 사이 공백 허용
  const ar = /금\s*([\d,]+)\s*원정?/.exec(text);
  if (ar) {
    const amount = parseInt(ar[1].replace(/,/g, ""), 10);
    return { amount, amountKind, amountRaw: null };
  }

  // 한글: 금사천팔백만원
  const hg = new RegExp(`금\\s*([${KO_AMOUNT_CHARS}]+)\\s*원정?`).exec(text);
  if (hg) {
    const val = parseKoreanAmount(hg[1]);
    if (val != null) return { amount: val, amountKind, amountRaw: null };
    return { amount: null, amountKind, amountRaw: `금${hg[1]}원` };
  }

  return { amount: null, amountKind, amountRaw: null };
}

/**
 * 사건번호: 2024타경80469 / 2022카단123 등.
 * 컬럼별로 따로 검사한다(한 컬럼 안의 개행분할은 mergeColumns가 공백결합 →
 * stripWs로 결합). 컬럼을 이어붙이지 않으므로 다음 컬럼의 연도 숫자가 사건번호
 * 뒤에 들러붙는 오염을 방지한다.
 */
function extractCaseNo(...sources) {
  const re = /(\d{4})(타경|카단|카합|즈단|즈합|타채)(\d[\d-]*\d|\d)/;
  for (const src of sources) {
    if (!src) continue;
    const m = re.exec(stripWs(src));
    if (m) return `${m[1]}${m[2]}${m[3]}`;
  }
  return null;
}

/**
 * 법원: ○○지방법원 (○○지원). 컬럼별로 따로 검사하고, 매칭 전 날짜를 제거해
 * 직전 날짜의 '일'(예: 04일)이 법원명 앞 한글런에 섞이는 것을 막는다.
 */
function extractCourt(...sources) {
  const re = /([가-힣]+지방법원)([가-힣]+지원)?/;
  for (const src of sources) {
    if (!src) continue;
    const cleaned = stripWs(src.replace(DATE_RE_G, " "));
    const m = re.exec(cleaned);
    if (m) return m[2] ? `${m[1]} ${m[2]}` : m[1];
  }
  return null;
}

/** 권리자명: 라벨(소유자/근저당권자/...) 뒤 이름(법인 포함), 숫자 직전까지 */
const PARTY_LABELS = [
  "소유자",
  "공유자",
  "근저당권자",
  "전세권자",
  "지상권자",
  "지역권자",
  "질권자",
  "가등기권자",
  "채권자",
  "권리자",
  "처분청",
];

function extractParty(partyText) {
  const t = collapseWs(partyText);
  for (const label of PARTY_LABELS) {
    const idx = t.indexOf(label);
    if (idx === -1) continue;
    let rest = t.slice(idx + label.length).replace(/^[\s:]+/, "");
    // 공유자/지분 등기: 라벨 뒤 선두에 "지분 2분의 1" 표기가 와서 이름을 가린다.
    // 선두 지분표기를 제거한 뒤 이름을 잡는다(가산형 — 단독명의는 영향 없음).
    rest = rest.replace(/^지분\s*\d+\s*분의\s*\d+\s*/, "");
    // 이름 = 한글/영문/괄호(법인 표기) 런, 등록번호 숫자나 구분기호 직전까지
    const m = /^([가-힣A-Za-z()][가-힣A-Za-z() ]*?)\s*(?=\d|,|\(|$)/.exec(rest);
    if (m) {
      const name = collapseWs(m[1]);
      if (name) return name;
    }
  }
  return null;
}

/**
 * 등기원인 컬럼 끝에 붙는 문서 꼬리 노이즈를 잘라낸다(가산형).
 * 섹션 마지막 항목에서 등기원인(예: 해지) 뒤에 "이 하 여 백"·"관할등기소"·
 * "실선…"·"본 등기사항증명서…"·"증명서/열람" 같은 보일러플레이트가 cause 컬럼에
 * 섞여 들어와 "해지하여백관할등기소…"처럼 오염되는 것을 방지한다.
 * - 등기원인 글자는 보존하고 노이즈 경계 이후만 제거(원문 변형/창작 없음).
 * - 정상 등기원인(매매/설정계약/해지/해제/취하 등)에는 어떤 경계어도 없어 무변경.
 * 입력은 collapseWs 처리된(단일 공백) 문자열을 가정한다.
 */
const CAUSE_NOISE_RE =
  /(이\s*)?하\s*여\s*백|이하여백|관할등기소|실\s*선|본\s*등기|등기사항증명서|증명서|열람|기록사항|\*/;
function stripCauseNoise(t) {
  const m = CAUSE_NOISE_RE.exec(t);
  if (!m) return t;
  return t.slice(0, m.index).trim();
}

/** 등기원인: cause 컬럼에서 꼬리 노이즈와 날짜를 제거한 사유 텍스트 */
function extractCause(causeText) {
  const t = stripCauseNoise(collapseWs(causeText));
  if (!t) return null;
  const reason = stripWs(t.replace(DATE_RE, " "));
  return reason || null;
}

/**
 * Item → 6.2 필드 객체.
 * @param {Item} item
 * @param {string} gu
 * @returns {Object}
 */
export function extractFields(item, gu) {
  const cols = mergeColumns(item);

  const purpose = stripWs(cols.purpose); // 등기목적은 공백 제거 형태로 정규화
  const receiptDate = toIsoDate(cols.receipt);
  const causeDate = toIsoDate(cols.cause);

  const noM = /제\s*([\d,]+)\s*호/.exec(cols.receipt);
  const receiptNo = noM ? noM[1].replace(/,/g, "") : null;

  const haystack = `${cols.purpose} ${cols.receipt} ${cols.cause} ${cols.party}`;
  const { amount, amountKind, amountRaw } = extractAmount(haystack);

  const caseNo = extractCaseNo(cols.party, cols.cause);
  const court = extractCourt(cols.party, cols.cause);
  const party = extractParty(cols.party);
  const cause = extractCause(cols.cause);

  return {
    gu,
    rank: item.rank,
    purpose,
    receiptDate,
    receiptNo,
    cause,
    causeDate,
    party,
    amount,
    amountKind,
    amountRaw,
    court,
    caseNo,
  };
}

// ---------------------------------------------------------------------------
// category 매핑 (설계서 부록 A)
// ---------------------------------------------------------------------------

/**
 * 등기목적 → category. 말소·표시변경 등은 etc.
 * 순서 주의: 가등기/경매/가처분은 '소유권이전' 글자를 포함할 수 있어 ownership보다 먼저 본다.
 *
 * @param {string} purpose
 * @returns {"ownership"|"loan"|"restraint"|"auction"|"right"|"pending"|"etc"}
 */
export function categoryFor(purpose) {
  const p = stripWs(purpose);
  if (!p) return "etc";
  if (p.includes("말소")) return "etc";
  if (p.includes("가등기")) return "pending";
  if (p.includes("경매개시")) return "auction";
  if (/(가압류|압류|가처분|처분금지)/.test(p)) return "restraint";
  if (/(근저당권|저당권|질권)/.test(p)) return "loan";
  if (/(전세권|지상권|지역권|임차권)/.test(p)) return "right";
  if (/소유권(?:이전|보존|일부이전)/.test(p)) return "ownership";
  if (/(?:공유자전원지분전부이전|지분(?:전부|일부)이전)/.test(p)) return "ownership";
  return "etc";
}

// ---------------------------------------------------------------------------
// 표제부 → property
// ---------------------------------------------------------------------------

/**
 * property{address,uid,buildingType,viewedAt,area,landShare} 추출.
 * 주소/열람일시는 매 페이지 반복 헤더(노이즈로 제거됨)에 있으므로 raw(allLines)에서 찾는다.
 * area(전유면적)/landShare(대지권비율)는 ㎡·면적 라인이 dropNoise 로 제거되므로
 * 반드시 raw(allLines)에서 추출한다(가산형 — 기존 4필드 로직 불변).
 *
 * @param {Array} pyoLines  - splitSections 의 표제부 섹션(노이즈 제거 후)
 * @param {Array} allLines  - 노이즈 제거 전 전체 라인(반복 헤더 포함)
 * @returns {{address:string|null, uid:string|null, buildingType:string|null, viewedAt:string|null, area:string|null, landShare:string|null}}
 */
export function extractProperty(pyoLines, allLines) {
  const scan = [];
  if (Array.isArray(allLines)) scan.push(...allLines);
  if (Array.isArray(pyoLines)) scan.push(...pyoLines);

  let address = null;
  let uid = null;
  let buildingType = null;
  let viewedAt = null;

  for (const line of scan) {
    const text = line && typeof line.text === "string" ? line.text : "";
    if (!text) continue;

    // 고유번호 1159-1996-523873
    if (!uid) {
      const m =
        /고유번호\s*(\d{4}-\d{4}-\d{6})/.exec(text) ||
        /(\d{4}-\d{4}-\d{6})/.exec(text);
      if (m) uid = m[1];
    }

    // 건물유형 + 주소: [집합건물] ... / [건물] ... / [토지] ...
    if (!address) {
      const m = /\[(집합건물|건물|토지)\]\s*(.+)$/.exec(text);
      if (m) {
        if (!buildingType) buildingType = m[1];
        address = collapseWs(m[2]);
      }
    }
    // 건물유형 보조: - 집합건물 -
    if (!buildingType) {
      const tm = /-\s*(집합건물|건물|토지)\s*-/.exec(text);
      if (tm) buildingType = tm[1];
    }

    // 열람일시 : 2026년04월02일 01시49분44초 → 2026-04-02 01:49 (초 절삭)
    if (!viewedAt && text.includes("열람")) {
      const vm =
        /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(\d{1,2})시\s*(\d{1,2})분/.exec(
          text
        );
      if (vm) {
        viewedAt = `${vm[1]}-${pad2(vm[2])}-${pad2(vm[3])} ${pad2(vm[4])}:${pad2(
          vm[5]
        )}`;
      }
    }
  }

  // --- 가산: 전유면적(area) / 대지권비율(landShare) ---
  // ㎡·면적 라인은 dropNoise 로 cleaned 에서 제거되므로 raw(allLines)에서만 추출.
  let area = null;
  let landShare = null;
  const rawScan = Array.isArray(allLines) ? allLines : [];

  // 전유면적: 「전유부분의 건물의 표시」 이후의 `제N층 제N호 … ([\d.]+)㎡`.
  //  - 동(棟) 전체 층별 면적(예 "1층 612.12㎡")은 `제N호`가 없어 매칭되지 않음(오추출 방지).
  //  - 페이지/줄 분리 대비: 마커 이후 라인들을 공백제거 결합해 검색.
  for (let i = 0; i < rawScan.length; i++) {
    const t = stripWs(rawScan[i] && rawScan[i].text);
    if (!t.includes("전유부분")) continue;
    let combo = t;
    for (let j = i + 1; j < rawScan.length && j <= i + 15; j++) {
      const nx = stripWs(rawScan[j] && rawScan[j].text);
      if (/대지권/.test(nx)) break; // 다음 섹션(대지권) 진입 시 중단
      combo += nx;
    }
    const am = /제\d+층제\d+호.*?([\d.]+)㎡/.exec(combo);
    if (am) {
      area = `${am[1]}㎡`;
      break;
    }
  }

  // 대지권비율: 「대지권의 표시」의 `소유권대지권 ○분의 △`.
  //  - 페이지/줄 분리로 "150184.6분의" 와 "73.593" 가 떨어질 수 있어 결합 후 매칭.
  for (let i = 0; i < rawScan.length; i++) {
    const t = stripWs(rawScan[i] && rawScan[i].text);
    if (!t.includes("대지권")) continue;
    let combo = t;
    for (let j = i + 1; j < rawScan.length && j <= i + 15; j++) {
      combo += stripWs(rawScan[j] && rawScan[j].text);
    }
    // 분자(分子): 소유권대지권 바로 뒤 [\d.]+ (예 150184.6)
    const nm =
      /소유권대지권([\d.]+)분의/.exec(combo) ||
      /소유권대지권.*?(\d[\d.]*)분의/.exec(combo);
    if (nm) {
      // 분모(分母): "분의" 뒤 텍스트에서 등기원인일자(YYYY년M월D일)와 (전 N)
      //   종전등기 표기를 먼저 제거한 뒤 첫 [\d.]+ 를 채택한다.
      //   실측상 "분의" 직후에 등기원인일자(1996년…)가 끼어들고 분모(73.593)가
      //   그 뒤에 붙으므로(예 "150184.6분의1996년6월19일대지권(전1)73.5931996년…"),
      //   날짜/종전표기를 건너뛰어야 연도(1996)가 아닌 실제 소수지분을 잡는다.
      //   (PARSING_NOTES 0절 "버그주의" 참조)
      const after = combo.slice(nm.index + nm[0].length);
      const denomZone = after
        .replace(DATE_RE_G, " ") // 날짜(연·월·일) 제거
        .replace(/\(전\s*\d+\)/g, " "); // (전 N) 종전등기 표기 제거
      const dm = /([\d.]+)/.exec(denomZone);
      if (dm) {
        landShare = `${nm[1]}분의 ${dm[1]}`;
        break;
      }
    }
  }

  return { address, uid, buildingType, viewedAt, area, landShare };
}

// ---------------------------------------------------------------------------
// ⑧ 말소 판정 (설계서 5.4, PARSING_NOTES 6절)
//
// ※ 사실 마킹일 뿐 — "인수/소멸" 같은 법적 판단이 아니다. canceled=true 는
//    "○번 …등기말소" 라는 별도 등기 항목이 존재한다는 사실만 기록한다.
// ---------------------------------------------------------------------------

/** 말소 항목 목적에서 대상 순위번호를 뽑는 정규식(부기 포함): "13번", "14-1번" */
const CANCEL_TARGET_RE = /(\d{1,3}(?:-\d{1,3})?)번/g;

/**
 * purpose 에 "말소"가 포함된 항목을 찾아, 그 목적 문자열의 모든 `(\d+(?:-\d+)?)번`
 * 숫자를 대상으로 **같은 구(gu)** 의 해당 rank 항목들을 `canceled = true` 로 마킹한다.
 *
 * - 복수대상:  "14번근저당권설정,15번근저당권설정등기말소" → 14,15 둘 다.
 * - 부기대상:  "14-1번질권,15-1번질권등기말소"           → 14-1,15-1 둘 다.
 * - 말소 항목 자체는 마킹 대상에서 제외(자기 자신 보호).
 * - 다른 구(gu)는 영향받지 않는다.
 *
 * 가산형: 입력 배열을 제자리 수정하고 그대로 반환한다(기존 엔트리 필드 보존).
 *
 * @param {Array<{gu:string, rank:string, purpose:string, canceled:boolean}>} items
 * @returns {Array} 같은 배열(canceled 갱신됨)
 */
export function markCanceled(items) {
  if (!Array.isArray(items)) return items;

  for (const cancelItem of items) {
    const purpose =
      cancelItem && typeof cancelItem.purpose === "string" ? cancelItem.purpose : "";
    if (!purpose.includes("말소")) continue;

    // 목적 문자열의 모든 "N번"/"N-M번" 대상 추출
    const targets = new Set();
    CANCEL_TARGET_RE.lastIndex = 0;
    let m;
    while ((m = CANCEL_TARGET_RE.exec(purpose)) !== null) targets.add(m[1]);
    if (targets.size === 0) continue;

    // 말소 항목의 날짜·등기원인(사실 그대로) — 대상에 가산 기록용
    const cDate = cancelItem.receiptDate != null ? cancelItem.receiptDate : null;
    const cCause = cancelItem.cause != null ? cancelItem.cause : null;

    for (const it of items) {
      if (it === cancelItem) continue; // 말소 항목 자체 제외
      if (it.gu !== cancelItem.gu) continue; // 같은 구만
      if (!targets.has(it.rank)) continue;
      it.canceled = true;
      // 복수 말소에 걸리면 최신(receiptDate 큰) 말소 기준으로 갱신.
      // 첫 부착이거나, 이번 말소가 기존 부착보다 더 최신이면 가산 필드를 기록.
      // (날짜 없는 말소는 가장 과거로 취급 — 날짜 있는 말소를 null로 덮지 않음)
      const prevDate = it.canceledDate === undefined ? "" : it.canceledDate || "";
      if (it.canceledDate === undefined || (cDate || "") >= prevDate) {
        it.canceledDate = cDate;
        it.canceledCause = cCause;
      }
    }
  }

  // (가산) 부기 전파: 주번호(N)가 말소되면 그 부기(N-1, N-2…)도 말소로 마킹.
  // 실제 등기부 관행과 동일 — 주등기가 말소되면 부기등기도 함께 취소선 처리되고
  // 요약장(현존)에도 나오지 않는다. (예: 을5 말소 → 을5-1·5-2 변경도 말소)
  for (const main of items) {
    if (!main || main.canceled !== true) continue;
    const rank = String(main.rank || "");
    if (!/^\d+$/.test(rank)) continue; // 전파원은 주번호만
    const prefix = rank + "-";
    for (const sub of items) {
      if (!sub || sub === main) continue;
      if (sub.gu !== main.gu) continue;
      if (!String(sub.rank || "").startsWith(prefix)) continue;
      if (sub.canceled === true) continue; // 이미 개별 말소된 부기는 그대로
      sub.canceled = true;
      sub.canceledDate = main.canceledDate !== undefined ? main.canceledDate : null;
      sub.canceledCause = main.canceledCause !== undefined ? main.canceledCause : null;
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// ⑨ 요약 교차검증 (설계서 5.4 — 경고만, 판정 강제 변경 금지)
// ---------------------------------------------------------------------------

/**
 * "주요 등기사항 요약" 섹션(splitSections 의 summary) 라인들에서 (gu, rank) 쌍을 뽑는다.
 * 요약은 "( 갑구 )" / "( 을구 )" 소제목으로 구를 구분하고, 각 행 맨 앞에 순위번호가 온다.
 *
 * @param {{text:string}[]} summaryLines
 * @returns {{gu:string, rank:string}[]}
 */
export function extractSummaryRanks(summaryLines) {
  const out = [];
  if (!Array.isArray(summaryLines)) return out;

  let gu = null;
  for (const line of summaryLines) {
    // 컬럼 경계(공백)는 유지한다: 부기 "13-1" 뒤 다음 컬럼의 숫자("1번근저당권부질권")가
    // 들러붙어 "13-11"로 오인되는 것을 막기 위해 stripWs 대신 단일공백 정규화.
    const raw = collapseWs(line && line.text);
    if (!raw) continue;
    const s = stripWs(raw);

    // 구 소제목 라인(예: "1.소유지분현황(갑구)", "3.(근)저당권및전세권등(을구)")
    if (s.includes("갑구")) {
      gu = "갑구";
      continue;
    }
    if (s.includes("을구")) {
      gu = "을구";
      continue;
    }

    // 행 맨 앞 순위번호(부기 포함). 컬럼 경계(공백/줄끝)까지만 — "1."(번호표)는
    // 점이 뒤따라 공백경계가 아니므로 제외, 부기 "13-1"은 정확히 끊는다.
    if (!gu) continue;
    const rm = /^(\d{1,3}(?:-\d{1,3})?)(?=\s|$)/.exec(raw);
    if (rm) out.push({ gu, rank: rm[1] });
  }
  return out;
}

/**
 * 요약(현존권리)과 말소 마킹 결과를 교차검증한다. **경고만** 출력하고
 * canceled 판정을 강제로 바꾸지 않는다(설계서 5.4).
 *
 * 경고 케이스:
 *  (A) 요약에 있는데(=현존 기대) canceled=true 로 마킹됨 → 말소판정 의심.
 *  (B) 요약에 없는데(=비현존 기대) 말소 항목도 못 찾아 canceled=false 로 남음
 *      → 판정 보류 의심. (소유권 이전 체인처럼 자연 승계되는 항목/노이즈는 제외하기 위해
 *         권리·제한·경매·가등기 카테고리에 한정해 오경고를 줄인다.)
 *
 * @param {Array<{gu:string, rank:string, canceled:boolean, category:string, purpose:string}>} timeline
 * @param {{gu:string, rank:string}[]} summaryRanks
 * @returns {{conflicts:Array, pending:Array}} 경고 내역(테스트/렌더 참고용)
 */
export function crossCheckSummary(timeline, summaryRanks) {
  const result = { conflicts: [], pending: [] };
  if (!Array.isArray(timeline) || !Array.isArray(summaryRanks)) return result;
  // 요약 섹션 자체가 없으면(추출 0건) 비교 기준이 없으므로 교차검증을 건너뛴다.
  // (B)분기가 모든 권리 항목에 무더기 경고를 내는 것을 방지.
  if (summaryRanks.length === 0) return result;

  const summarySet = new Set(summaryRanks.map((r) => `${r.gu}:${r.rank}`));
  const ENCUMBRANCE = new Set(["loan", "right", "restraint", "auction", "pending"]);

  for (const e of timeline) {
    const key = `${e.gu}:${e.rank}`;
    const isCancelEntry =
      typeof e.purpose === "string" && e.purpose.includes("말소");

    // (A) 요약=현존인데 말소로 마킹됨
    if (summarySet.has(key) && e.canceled) {
      result.conflicts.push(key);
      console.warn(
        `[교차검증] ${key}: 요약(현존)에 있으나 canceled=true 로 마킹됨 — 말소판정 보류 권장`
      );
      continue;
    }

    // (B) 요약에 없고 말소도 못 찾은 권리/제한 항목 → 보류 의심
    if (
      !summarySet.has(key) &&
      !e.canceled &&
      !isCancelEntry &&
      ENCUMBRANCE.has(e.category)
    ) {
      result.pending.push(key);
      console.warn(
        `[교차검증] ${key}: 요약에 없고 말소 항목도 없음 — canceled 판정 보류(현존/말소 불명)`
      );
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// ⑩ 타임라인 노이즈필터 (설계서 5.5) — display 플래그(가산형, 항목 삭제 안 함)
// ---------------------------------------------------------------------------

/** 기본 숨김(노이즈) 등기목적 — 말소 항목 자체 포함 */
const TIMELINE_HIDE_RE =
  /(말소|등기명의인표시변경|행정구역명칭변경|전산이기|도면편철|도로명주소)/;

/**
 * 스토리 표시대상(설계서 5.5):
 *  소유권이전/보존, 근저당권설정/변경, (근)저당권부채권 질권설정, 가압류, 압류, 가처분,
 *  강제·임의경매개시결정, 전세권/지상권 설정, 가등기.
 */
const TIMELINE_SHOW_RE =
  /(소유권(?:이전|보존|일부이전)|지분(?:전부|일부)이전|공유자전원지분전부이전|근저당권(?:설정|변경|이전)|질권|가압류|압류|가처분|경매개시|전세권(?:설정|이전|변경)|지상권설정|지역권설정|임차권|가등기)/;

/** 한 타임라인 엔트리가 기본 표시대상인지 판정 */
function isDisplayEntry(entry) {
  const p = stripWs(entry && entry.purpose);
  if (!p) return false;
  if (TIMELINE_HIDE_RE.test(p)) return false; // 말소/표시변경/전산이기 등은 숨김
  return TIMELINE_SHOW_RE.test(p); // 표시대상 화이트리스트만 노출
}

/**
 * 각 타임라인 엔트리에 `display:boolean` 플래그를 부여한다(가산형 — 삭제하지 않음).
 * - 말소 항목 자체: display=false.
 * - canceled=true 인 표시대상(예: 말소된 가압류): display 유지(꼬리표 노출용).
 *
 * @param {Array<{purpose:string}>} timeline
 * @returns {Array} 같은 배열(display 부여됨)
 */
export function applyTimelineDisplay(timeline) {
  if (!Array.isArray(timeline)) return timeline;
  for (const e of timeline) e.display = isDisplayEntry(e);
  return timeline;
}

// ---------------------------------------------------------------------------
// 통합: parseRegistry
// ---------------------------------------------------------------------------

/**
 * 6.2 필드 → 6절 timeline 엔트리(category 부여, canceled=false 임시).
 */
function buildEntry(fields) {
  return {
    gu: fields.gu,
    rank: fields.rank,
    purpose: fields.purpose,
    category: categoryFor(fields.purpose),
    receiptDate: fields.receiptDate,
    receiptNo: fields.receiptNo,
    cause: fields.cause,
    causeDate: fields.causeDate,
    party: fields.party,
    amount: fields.amount,
    amountKind: fields.amountKind,
    amountRaw: fields.amountRaw,
    court: fields.court,
    caseNo: fields.caseNo,
    canceled: false, // M4에서 말소판정으로 갱신
  };
}

/**
 * PDF → 설계서 6절 JSON `{ property, timeline }`.
 * 말소 판정(M4) 전이므로 canceled 는 전부 false.
 *
 * 입력 다형(가산형 — 후방호환):
 *  - `ArrayBuffer`: 기존 동작 그대로. 내부에서 extractPages 로 1회 추출.
 *  - **이미 추출된 pages 배열**(extractPages 결과 `[{pageNum, items}]`):
 *    재추출 없이 그 pages 로 파싱(중복 PDF 파싱 제거 — 성능 최적화).
 * 반환형 `{property, timeline}` 불변.
 *
 * @param {ArrayBuffer|Array<{pageNum:number, items:Array}>} input
 * @returns {Promise<{property:Object, timeline:Object[]}>}
 */
export async function parseRegistry(input) {
  const pages = Array.isArray(input) ? input : await extractPages(input);
  const rawLines = groupAllLines(pages); // ②
  const cleaned = dropNoise(rawLines); // ④
  const sections = splitSections(cleaned); // ⑤

  const property = extractProperty(sections.pyo, rawLines);

  const gapItems = blockify(sections.gap, "갑구"); // ⑥
  const eulItems = blockify(sections.eul, "을구");

  const timeline = [];
  for (const item of gapItems) timeline.push(buildEntry(extractFields(item, "갑구"))); // ⑦
  for (const item of eulItems) timeline.push(buildEntry(extractFields(item, "을구")));

  markCanceled(timeline); // ⑧ 말소 판정(같은 구·복수대상·부기 — 사실 마킹)

  const summaryRanks = extractSummaryRanks(sections.summary); // ⑨ 요약 현존권리
  crossCheckSummary(timeline, summaryRanks); // 경고만(판정 강제변경 없음)

  applyTimelineDisplay(timeline); // ⑩ 노이즈필터 — display 플래그 부여(가산형)

  // receiptDate 오름차순(날짜 없는 항목은 뒤로) — 안정정렬 유지
  timeline.sort((a, b) => cmpIsoDate(a.receiptDate, b.receiptDate));

  return { property, timeline };
}
