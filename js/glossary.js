// js/glossary.js — M5 용어집 (2층 모델, ESM)
// 출처(층1 문장): 등기부_쉬운해석기_설계서.md 7절 + 부록A — 문구 변경 금지(단일 출처).
// 출처(층2 사전): 법령용어한영사전(제2판), 법제처 2009 — data/legal-terms.json.
// 절대원칙: 외부통신 0(fetch/http/cdn 없음), 법적판단·평가어 금지, 의미 창작 금지.
//
// 데이터 적재 방식: 정적 ESM import.
//   GitHub Pages/ file:// 정적 환경 + 폭넓은 브라우저 호환을 위해, JSON 그 자체가 아니라
//   동봉된 가산형 래퍼 data/legal-terms.js (`export default {...}`) 를 plain import 한다.
//   (import attributes `with { type: "json" }` 는 구형 Safari/Firefox 호환 우려가 있어 회피.)
//   fetch 는 사용하지 않는다 — 외부통신/file:// CORS 문제 방지.
import legalTerms from '../data/legal-terms.js';

// ───────────────────────────────────────────────────────────────────────────
// 보조 포매터
// ───────────────────────────────────────────────────────────────────────────

/**
 * 금액 포맷: 콤마 + 억/만 보조표기.
 * 예) 680000000 → "680,000,000원 (6억 8,000만원)"
 * n 이 null/undefined 이면 null 반환(호출부에서 amountRaw 처리).
 * @param {number|null|undefined} n
 * @returns {string|null}
 */
export function formatAmount(n) {
  if (n === null || n === undefined || n === '') return null;
  const num = typeof n === 'number' ? n : Number(String(n).replace(/[,\s원]/g, ''));
  if (!Number.isFinite(num)) return null;

  const full = num.toLocaleString('en-US') + '원';

  const abs = Math.abs(num);
  const eok = Math.floor(abs / 100000000);          // 억
  const man = Math.floor((abs % 100000000) / 10000); // 만
  const won = abs % 10000;                           // 원 단위 잔여

  // 만 단위 미만(보조표기가 원문과 같아짐)이면 보조표기 생략
  if (eok === 0 && man === 0) return full;

  const segs = [];
  if (eok > 0) segs.push(eok.toLocaleString('en-US') + '억');
  if (man > 0) segs.push(man.toLocaleString('en-US') + '만');
  if (won > 0) segs.push(won.toLocaleString('en-US'));
  const sign = num < 0 ? '-' : '';
  const boost = sign + segs.join(' ') + '원';

  return `${full} (${boost})`;
}

/**
 * 날짜 포맷: ISO "2019-11-22" → "2019년 11월 22일".
 * 파싱 불가하면 입력 원문을 그대로 반환.
 * @param {string} iso
 * @returns {string}
 */
export function formatDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(iso).trim());
  if (!m) return String(iso);
  const y = m[1];
  const mo = String(Number(m[2])); // 앞자리 0 제거
  const d = String(Number(m[3]));
  return `${y}년 ${mo}월 ${d}일`;
}

// 템플릿용 안전 변수 추출(null/undefined → 빈 문자열, "null" 텍스트 노출 방지)
function vars(item) {
  const it = item || {};
  const amount = formatAmount(it.amount);
  return {
    date: it.receiptDate ? formatDate(it.receiptDate) : '',
    party: it.party != null ? String(it.party) : '',
    amount: amount != null ? amount : '',
    hasAmount: amount != null,
    cause: it.cause != null ? String(it.cause) : '',
    court: it.court != null ? String(it.court) : '',
    caseNo: it.caseNo != null ? String(it.caseNo) : '',
  };
}

// ───────────────────────────────────────────────────────────────────────────
// 층1 — 등기목적별 템플릿 (설계서 7.1~7.14 문장 그대로)
// 순서 = 매칭 우선순위(구체적 → 일반적). purpose.includes(key) 로 부분일치.
// ───────────────────────────────────────────────────────────────────────────
const GLOSSARY = [
  // 7.13 가등기 — 소유권이전청구권가등기 등이 '소유권이전'으로 오인되지 않도록 먼저 검사
  {
    keys: ['가등기'], category: 'pending', color: 'purple', icon: 'ti-clock',
    basic: (v) => `${v.date}, ${v.party} 명의의 (소유권이전청구권) 가등기가 되었습니다.`,
    easy: (v) => `${v.date}에 ${v.party}이 '나중에 이 집을 내 앞으로 옮길 수 있게' 미리 자리를 찜해뒀어요(가등기). 아직 진짜 이전은 아니에요.`,
  },
  // (가산) 소유권일부이전 / 지분(전부·일부)이전 / 공유자전원지분전부이전 — '지분/일부' 뉘앙스 전용. 일반 소유권이전보다 먼저.
  {
    keys: ['소유권일부이전', '지분', '공유자전원지분'], category: 'ownership', color: 'blue', icon: 'ti-home',
    basic: (v) => `${v.date}, ` + (v.cause ? `'${v.cause}'을 원인으로 ` : '') + `소유권(지분)이 ` + (v.party ? `${v.party} 님에게 ` : '') + `이전되었습니다.` + (v.hasAmount ? ` 거래가액은 ${v.amount}입니다.` : ''),
    easy: (v) => `${v.date}에 ` + (v.party ? `이 집의 (지분) 주인이 ${v.party} 님으로 바뀌었어요.` : `이 집의 (지분) 주인이 바뀌었어요.`) + (v.hasAmount ? ` 이때 거래된 값은 ${v.amount}이에요.` : ''),
  },
  // 7.1 소유권이전
  {
    keys: ['소유권이전'], category: 'ownership', color: 'blue', icon: 'ti-home',
    basic: (v) => `${v.date}, '${v.cause}'을 원인으로 소유권이 ${v.party} 님에게 이전되었습니다.` + (v.hasAmount ? ` 거래가액은 ${v.amount}입니다.` : ''),
    easy: (v) => `${v.date}에 ` + (v.party ? `집주인이 ${v.party} 님으로 바뀌었어요.` : `집주인이 바뀌었어요.`) + ` ('소유권이전' = 집주인이 바뀌었다는 뜻이에요.)` + (v.hasAmount ? ` 이때 거래된 값은 ${v.amount}이에요.` : ''),
  },
  // 7.2 소유권보존
  {
    keys: ['소유권보존'], category: 'ownership', color: 'blue', icon: 'ti-home',
    basic: (v) => `${v.date}, ${v.party} 님 명의로 소유권보존등기가 되었습니다.`,
    easy: (v) => `${v.date}에 이 집의 첫 주인(${v.party} 님)이 등기부에 처음 기록됐어요. 집의 '출생신고' 같은 거예요.`,
  },
  // 7.5 (근)저당권부채권 질권설정 — '질권'은 근저당권보다 먼저 검사
  {
    keys: ['질권'], category: 'loan', color: 'amber', icon: 'ti-cash',
    basic: (v) => `${v.date}, ` + (v.hasAmount ? `채권액 ${v.amount}의 ` : '') + `근저당권부채권 질권이 설정되었습니다. 질권자는 ${v.party}입니다.`,
    // 사실형(2026-07): 등기부는 설정 사실만 기록 — 해석("빚이 얽혔다") 대신 기재값만.
    easy: (v) => `${v.date}에 이 근저당권의 채권에 질권이 설정되었어요.` + (v.party ? ` 질권자는 ${v.party}이에요.` : '') + (v.hasAmount ? ` 채권액은 ${v.amount}이에요.` : ''),
  },
  // 7.4 근저당권변경
  {
    keys: ['근저당권변경'], category: 'loan', color: 'amber', icon: 'ti-building-bank',
    basic: (v) => `${v.date}, 근저당권 내용이 변경되었습니다.` + (v.hasAmount ? ` 채권최고액이 ${v.amount}으로 변경되었습니다.` : ''),
    // 사실형(2026-07): "대출 약속" 같은 단정 표현 제거 — 변경 사실 + 기재값만.
    easy: (v) => `${v.date}에 근저당권 내용이 변경되었어요.` + (v.hasAmount ? ` 채권최고액이 ${v.amount}으로 바뀌었어요.` : ''),
  },
  // (가산) 근저당권이전 / 근저당권일부이전 — 새 채권최고액이 없으므로 금액 문구 없음. 일반 '근저당권' 설정보다 먼저.
  {
    keys: ['근저당권이전', '근저당권일부이전'], category: 'loan', color: 'amber', icon: 'ti-building-bank',
    basic: (v) => `${v.date}, 근저당권이 ` + (v.party ? `${v.party}에게 ` : '') + `이전되었습니다.`,
    // 사실형(2026-07): "돈 빌려준" 단정 제거 — 이전 사실만. 괄호 풀이는 사전적 설명이라 허용.
    easy: (v) => `${v.date}에 근저당권이 ` + (v.party ? `${v.party}에게 ` : '') + `이전되었어요(근저당권자가 바뀌었어요).`,
  },
  // 7.3 근저당권설정 (그 외 '근저당권' 일반도 설정 문장으로)
  {
    keys: ['근저당권설정', '근저당권'], category: 'loan', color: 'amber', icon: 'ti-building-bank',
    basic: (v) => `${v.date}, ` + (v.hasAmount ? `채권최고액 ${v.amount}의 ` : '') + `근저당권이 설정되었습니다. 근저당권자는 ${v.party}입니다.`,
    // 사용자 확정(2026-07): 사실형으로 — "설정되었어요". "돈을 빌렸어요" 같은 단정 표현 금지(등기부는 설정 사실만 기록). 괄호 풀이도 제거.
    easy: (v) => `${v.date}에 이 집에 근저당권이 설정되었어요.` + (v.party ? ` 근저당권자는 ${v.party}이에요.` : '') + (v.hasAmount ? ` 채권최고액은 ${v.amount}이에요.` : ''),
  },
  // 7.9 강제경매개시결정
  {
    keys: ['강제경매'], category: 'auction', color: 'darkred', icon: 'ti-gavel',
    basic: (v) => `${v.date}, ${v.court}의 강제경매개시결정(${v.caseNo})이 등기되었습니다. 채권자는 ${v.party}입니다.`,
    // 사실형(2026-07): 인용식 비유 제거 — 등기 사실만.
    easy: (v) => `${v.date}에 법원의 강제경매개시결정이 등기되었어요.` + (v.party ? ` 채권자는 ${v.party}이에요.` : ''),
  },
  // 7.10 임의경매개시결정
  {
    keys: ['임의경매'], category: 'auction', color: 'darkred', icon: 'ti-gavel',
    basic: (v) => `${v.date}, ${v.court}의 임의경매개시결정(${v.caseNo})이 등기되었습니다. 채권자는 ${v.party}입니다.`,
    // 사실형(2026-07): 인용식 비유 제거 — 등기 사실만.
    easy: (v) => `${v.date}에 법원의 임의경매개시결정이 등기되었어요.` + (v.party ? ` 채권자는 ${v.party}이에요.` : ''),
  },
  // 7.6 가압류 — '압류'보다 먼저 검사
  {
    keys: ['가압류'], category: 'restraint', color: 'red', icon: 'ti-lock',
    basic: (v) => `${v.date}, ${v.court}의 결정(${v.caseNo})으로 가압류가 등기되었습니다. ` + (v.hasAmount ? `청구금액은 ${v.amount}, ` : '') + `채권자는 ${v.party}입니다.`,
    // 사실형(2026-07): 인용식 비유 제거 — 등기 사실 + 기재값만.
    easy: (v) => `${v.date}에 법원 결정으로 가압류가 등기되었어요.` + (v.hasAmount ? ` 청구금액은 ${v.amount}` + (v.party ? `, 채권자는 ${v.party}이에요.` : `이에요.`) : (v.party ? ` 채권자는 ${v.party}이에요.` : '')),
  },
  // 7.7 압류
  {
    keys: ['압류'], category: 'restraint', color: 'red', icon: 'ti-lock',
    basic: (v) => `${v.date}, ${v.party}에 의해 압류가 등기되었습니다.`,
    // 사실형(2026-07): 인용식 비유 제거 — 등기 사실만.
    easy: (v) => `${v.date}에 ` + (v.party ? `${v.party}에 의해 ` : '') + `압류가 등기되었어요.`,
  },
  // 7.8 가처분 (처분금지가처분 포함)
  {
    keys: ['가처분'], category: 'restraint', color: 'red', icon: 'ti-lock',
    basic: (v) => `${v.date}, ${v.court}의 결정(${v.caseNo})으로 처분금지가처분이 등기되었습니다. 권리자는 ${v.party}입니다.`,
    // 사실형(2026-07): 인용식 비유 제거 — 등기 사실만.
    easy: (v) => `${v.date}에 법원 결정으로 처분금지가처분이 등기되었어요.` + (v.party ? ` 권리자는 ${v.party}이에요.` : ''),
  },
  // (가산) 전세권이전 / 전세권일부이전 — 금액 없음. 일반 '전세권' 설정보다 먼저.
  {
    keys: ['전세권이전', '전세권일부이전'], category: 'right', color: 'teal', icon: 'ti-key',
    basic: (v) => `${v.date}, 전세권이 ` + (v.party ? `${v.party}에게 ` : '') + `이전되었습니다.`,
    easy: (v) => `${v.date}에 전세권이 다른 사람` + (v.party ? `(${v.party})` : '') + `에게 넘어갔어요.`,
  },
  // (가산) 전세권변경 — 금액 없음. 일반 '전세권' 설정보다 먼저.
  {
    keys: ['전세권변경'], category: 'right', color: 'teal', icon: 'ti-key',
    basic: (v) => `${v.date}, 전세권 내용이 변경되었습니다.`,
    easy: (v) => `${v.date}에 전세권 내용이 바뀌었어요.`,
  },
  // (가산) 지역권설정 — 금액 없음.
  {
    keys: ['지역권'], category: 'right', color: 'teal', icon: 'ti-key',
    basic: (v) => `${v.date}, 지역권이 설정되었습니다.` + (v.party ? ` 지역권자는 ${v.party}입니다.` : ''),
    easy: (v) => `${v.date}에 이웃 땅을 위해 이 땅을 일부 쓰게 하는 권리(지역권)가 생겼어요.`,
  },
  // (가산) 임차권설정 / 주택임차권 — 보증금(amount)은 있을 때만 표기, 없으면 금액문구 생략.
  {
    keys: ['임차권'], category: 'right', color: 'teal', icon: 'ti-key',
    basic: (v) => `${v.date}, ` + (v.party ? `${v.party} 명의의 ` : '') + `(주택)임차권이 등기되었습니다.` + (v.hasAmount ? ` 보증금은 ${v.amount}입니다.` : ''),
    easy: (v) => `${v.date}에 ` + (v.party ? `${v.party}이 ` : '') + `이 집에 세 들어 살 권리(임차권)를 등기로 남겼어요.` + (v.hasAmount ? ` 보증금은 ${v.amount}이에요.` : ''),
  },
  // 7.11 전세권설정
  {
    keys: ['전세권'], category: 'right', color: 'teal', icon: 'ti-key',
    basic: (v) => `${v.date}, ` + (v.hasAmount ? `전세금 ${v.amount}의 ` : '') + `전세권이 설정되었습니다. 전세권자는 ${v.party}입니다.`,
    // 사실형(2026-07): "걸고 살 권리" 비유 제거 — 설정 사실 + 기재값만.
    easy: (v) => `${v.date}에 ` + (v.hasAmount ? `전세금 ${v.amount}의 ` : '') + `전세권이 설정되었어요.` + (v.party ? ` 전세권자는 ${v.party}이에요.` : ''),
  },
  // (가산) 지상권이전 / 지상권일부이전 — 금액 없음. 일반 '지상권' 설정보다 먼저.
  {
    keys: ['지상권이전', '지상권일부이전'], category: 'right', color: 'teal', icon: 'ti-key',
    basic: (v) => `${v.date}, 지상권이 ` + (v.party ? `${v.party}에게 ` : '') + `이전되었습니다.`,
    easy: (v) => `${v.date}에 지상권이 다른 사람` + (v.party ? `(${v.party})` : '') + `에게 넘어갔어요.`,
  },
  // 7.12 지상권설정
  {
    keys: ['지상권'], category: 'right', color: 'teal', icon: 'ti-key',
    basic: (v) => `${v.date}, 지상권이 설정되었습니다. 지상권자는 ${v.party}입니다.`,
    easy: (v) => `${v.date}에 ${v.party}이 이 땅 위에 건물 등을 둘 수 있는 권리(지상권)를 가졌어요.`,
  },
  // 7.14 등기명의인표시변경 (기본 숨김)
  {
    keys: ['등기명의인표시변경', '등기명의인표시'], category: 'etc', color: 'gray', icon: 'ti-user',
    basic: (v) => `${v.date}, 소유자의 주소(표시) 변경이 등기되었습니다.`,
    easy: (v) => `${v.date}에 주인의 주소 같은 표시 내용만 바뀌었어요. 권리에는 영향 없어요.`,
  },
];

// 미정의 purpose 안전기본값 (설계서 7절 말미 — 임의해석 금지)
const SAFE_DEFAULT = { category: 'etc', color: 'gray', icon: 'ti-user' };

/**
 * 층1 조회: 등기목적(purpose) 부분일치로 7.1~7.14 매핑.
 * @param {string} purpose
 * @returns {{category:string, icon:string, color:string,
 *            basic:(item:object)=>string, easy:(item:object)=>string}}
 */
export function getGlossary(purpose) {
  const p = purpose == null ? '' : String(purpose);
  const hit = GLOSSARY.find((g) => g.keys.some((k) => p.includes(k)));

  if (hit) {
    return {
      category: hit.category,
      icon: hit.icon,
      color: hit.color,
      basic: (item) => hit.basic(vars(item)),
      easy: (item) => hit.easy(vars(item)),
    };
  }

  // 미정의: basic = purpose 원문, easy = 안전 기본 문장
  return {
    category: SAFE_DEFAULT.category,
    icon: SAFE_DEFAULT.icon,
    color: SAFE_DEFAULT.color,
    basic: () => p,
    easy: () => `이 항목은 '${p}' 등기예요.`,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// 층2 — 단어 뜻풀이 (법령용어한영사전 조회). 의미 창작 금지: 사전 원문만.
// ───────────────────────────────────────────────────────────────────────────

const INSUFFICIENT_MSG = '자료불충분 — 법령용어한영사전(제2판) 미수록';

function toEnglishString(english) {
  if (Array.isArray(english)) return english.join(' / ');
  return english == null ? '' : String(english);
}

/**
 * 층2 조회: 표제어(word)를 사전에서 찾는다.
 * 있으면 첫 exact entry(term===word) 우선, 없으면 첫 entry 사용.
 * 없으면 자료불충분(insufficient) 반환 — 절대 의미를 지어내지 않는다.
 * @param {string} word
 * @returns {{found:true, term:string, hanja:string, english:string, source:string,
 *            exactFound:boolean, examples?:Array}
 *          |{found:false, insufficient:true, message:string}}
 */
export function lookupTerm(word) {
  const rec = word == null ? null : legalTerms[word];
  if (!rec || !Array.isArray(rec.entries) || rec.entries.length === 0) {
    return { found: false, insufficient: true, message: INSUFFICIENT_MSG };
  }

  const exact = rec.entries.find((e) => e.term === word) || rec.entries[0];
  const result = {
    found: true,
    term: exact.term,
    hanja: exact.hanja,
    english: toEnglishString(exact.english),
    source: exact.source || rec.source || '법령용어한영사전(제2판), 법제처 2009',
    exactFound: rec.exactFound === true,
  };
  if (Array.isArray(exact.examples) && exact.examples.length > 0) {
    result.examples = exact.examples;
  }
  return result;
}

// ───────────────────────────────────────────────────────────────────────────
// (가산 2026-07) 용어 해설 — 쉽게 보기 하단 "이 등기부에 나온 용어 해설" 칸용.
// 층1과 같은 빌드타임 템플릿(사용자 확정 문구) — 사전식 일반 설명만, 평가어·법적판단 없음.
// 파싱된 등기부에 실제로 나온 용어만 표시(collectTermExplains).
// ───────────────────────────────────────────────────────────────────────────

/** 받침 유무에 따라 '이란/란' 조사 선택. 한글이 아니면 '이란'. */
function iranJosa(word) {
  const w = String(word || '');
  const ch = w.charCodeAt(w.length - 1);
  if (ch < 0xac00 || ch > 0xd7a3) return '이란';
  return (ch - 0xac00) % 28 === 0 ? '란' : '이란';
}

// 순서 = 표시 순서. keys: purpose 부분일치. strip: 오매칭 방지용 사전 제거 패턴
// (예: '가압류' 안의 '압류', 가등기의 '소유권이전청구권' 안의 '소유권이전').
const TERM_EXPLAIN = [
  { keys: ['근저당권'], term: '근저당권', text: '돈을 빌려준 사람(주로 은행)이 못 받을 때를 대비해 이 부동산을 담보로 잡아 두는 권리예요. \'채권최고액\'은 이 담보로 받을 수 있는 금액의 최대 한도예요.' },
  { keys: ['질권'], term: '질권', text: '돈 받을 권리(채권)를 담보로 잡는 권리예요. \'근저당권부채권 질권설정\'은 근저당권자가 가진 채권을 다른 사람(질권자)이 다시 담보로 잡았다는 뜻이에요.' },
  { keys: ['전세권'], term: '전세권', text: '전세금을 주고 이 부동산을 정해진 기간 동안 사용할 수 있는 권리를 등기부에 올린 거예요.' },
  { keys: ['임차권'], term: '임차권', text: '세 들어 사는 사람(임차인)의 권리를 등기부에 올린 거예요.' },
  { keys: ['가압류'], term: '가압류', text: '재판이 끝나기 전에 재산을 팔거나 숨기지 못하게, 채권자의 신청으로 법원이 임시로 묶어 두는 조치예요.' },
  { keys: ['압류'], strip: /가압류/g, term: '압류', text: '밀린 세금이나 빚 때문에, 국가기관 등이 이 재산을 마음대로 처분하지 못하게 묶어 두는 조치예요.' },
  { keys: ['가처분'], term: '가처분', text: '이 부동산을 두고 다툼이 있을 때, 판결이 나기 전까지 팔거나 넘기지 못하게 법원이 임시로 막아 두는 조치예요.' },
  { keys: ['강제경매'], term: '강제경매', text: '법원 판결 등을 근거로 채권자가 신청해, 법원이 이 부동산을 경매에 부치는 절차예요.' },
  { keys: ['임의경매'], term: '임의경매', text: '근저당권 같은 담보권을 가진 채권자가 신청해, 법원이 이 부동산을 경매에 부치는 절차예요.' },
  { keys: ['가등기'], term: '가등기', text: '나중에 소유권 등을 넘겨받을 순서를 미리 확보해 두는 예비 등기예요.' },
  { keys: ['소유권이전'], strip: /소유권이전청구권/g, term: '소유권이전', text: '부동산의 주인이 바뀌었다는 등기예요. 매매·상속·증여 등이 원인이 돼요.' },
  { keys: ['소유권보존'], term: '소유권보존', text: '새로 지어진 건물 등이 등기부에 처음으로 기록되는 등기예요.' },
  { keys: ['지상권'], term: '지상권', text: '남의 땅 위에 건물이나 나무 등을 세워 쓸 수 있는 권리예요.' },
  { keys: ['지역권'], term: '지역권', text: '이웃 땅의 편의를 위해 이 땅의 일부를 이용할 수 있게 하는 권리예요.' },
];

// '말소'는 purpose 가 아니라 canceled 플래그로 판단하는 특수 항목.
const CANCELED_EXPLAIN = {
  term: '말소',
  text: '등기가 지워져 효력을 잃었다는 표시예요. 이 프로그램에서는 빨간 줄로 표시해요.',
};

/**
 * 파싱된 타임라인에 실제로 나온 용어의 해설 목록을 만든다.
 * @param {Array} timeline - registryData.timeline
 * @returns {Array<{term:string, label:string, text:string}>} 없으면 빈 배열
 */
export function collectTermExplains(timeline) {
  const items = (Array.isArray(timeline) ? timeline : []).filter(
    (it) => it && it.display !== false
  );
  const out = [];
  for (const t of TERM_EXPLAIN) {
    const hit = items.some((it) => {
      let p = it.purpose == null ? '' : String(it.purpose);
      if (t.strip) p = p.replace(t.strip, '');
      return t.keys.some((k) => p.includes(k));
    });
    if (hit) out.push({ term: t.term, label: `${t.term}${iranJosa(t.term)}?`, text: t.text });
  }
  if (items.some((it) => it.canceled === true)) {
    const c = CANCELED_EXPLAIN;
    out.push({ term: c.term, label: `${c.term}${iranJosa(c.term)}?`, text: c.text });
  }
  return out;
}
