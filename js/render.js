// ============================================================================
// render.js — M6 기본 모드 렌더 (설계서 8.1 / 부록 A / 설계내역 6.4)
//
// ES module. 외부 통신 0. 법적 판단·평가어(위험/안전/유리/불리/인수/소멸/추천/
// 말소기준) 금지 — 사실 + 사전 풀이까지만. 이모지 금지(아이콘은 인라인 SVG).
//
// export function renderBasic(registryData, container):
//   registryData = parser.parseRegistry() 결과 { property, timeline }.
//   container 안에 표제부 헤더 + 시간순 타임라인 카드를 그린다(가산형 — 신규 파일,
//   glossary/parser 시그니처 불변).
// ============================================================================

import { getGlossary, formatAmount, formatDate, lookupTerm } from "./glossary.js";
import { mascotSvg } from "./mascot.js";

// ---------------------------------------------------------------------------
// 운영자 설정 — 3층 CTA 링크(설계서 5-5).
//   url 이 빈 문자열이면 그 줄 자체를 렌더하지 않는다(빈 링크 금지).
//   둘 다 비어 있으면 CTA 블록 전체를 생략한다.
// ---------------------------------------------------------------------------
const CTA = { consultUrl: "", lessonUrl: "" };

// ---------------------------------------------------------------------------
// 소형 DOM 헬퍼
// ---------------------------------------------------------------------------

/** createElement + className + textContent 한 번에. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null && text !== "") node.textContent = text;
  return node;
}

/** 값이 비면 "자료불충분"으로 대체(창작 금지). */
function displayValue(v) {
  if (v == null) return "자료불충분";
  const s = String(v).trim();
  return s === "" ? "자료불충분" : s;
}

// ---------------------------------------------------------------------------
// 부록 A — category → 인라인 SVG 아이콘
//   외부 아이콘 폰트(Tabler) 대신 동봉 인라인 SVG 사용(외부 통신 0, 이모지 금지).
//   24x24 viewBox, currentColor stroke — 색은 CSS(.cat-* { color/--cat })가 결정.
// ---------------------------------------------------------------------------
const ICON_PATHS = {
  // ti-home
  ownership:
    '<path d="M5 12l-2 0 9-9 9 9-2 0"/><path d="M5 12v7a1 1 0 0 0 1 1h3v-5h4v5h3a1 1 0 0 0 1-1v-7"/>',
  // ti-building-bank
  loan:
    '<path d="M3 21l18 0"/><path d="M3 10l18 0"/><path d="M5 6l7-3 7 3"/><path d="M4 10l0 11"/><path d="M20 10l0 11"/><path d="M8 14l0 3"/><path d="M12 14l0 3"/><path d="M16 14l0 3"/>',
  // ti-lock
  restraint:
    '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  // ti-gavel
  auction:
    '<path d="M13 10l7.383 7.418c.823 .82 .823 2.148 0 2.967a2.11 2.11 0 0 1 -2.976 0l-7.407 -7.385"/><path d="M6 9l4 4"/><path d="M13 10l-4 -4"/><path d="M3 21l6 0"/>',
  // ti-key
  right:
    '<circle cx="8" cy="15" r="4"/><path d="M10.85 12.15L19 4"/><path d="M18 5l2 2"/><path d="M15 8l2 2"/>',
  // ti-clock
  pending:
    '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  // ti-user
  etc:
    '<circle cx="12" cy="7" r="4"/><path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/>',
};

/**
 * 색/아이콘용 category 결정. 파서가 부여한 item.category 를 우선(의미 정합),
 * 없으면 glossary category 로 폴백. 부록 A 7종 외 값은 etc 로 폴백(깨지지 않게).
 * @param {object} item       - timeline 엔트리(item.category)
 * @param {object} glossary   - getGlossary 결과(glossary.category)
 * @returns {string} ICON_PATHS/CSS 가 아는 category
 */
function resolveCategory(item, glossary) {
  const cat = (item && item.category) || (glossary && glossary.category);
  return Object.prototype.hasOwnProperty.call(ICON_PATHS, cat) ? cat : "etc";
}

/** category용 인라인 SVG 아이콘 span 생성. */
function iconEl(category) {
  const span = el("span", "tl-icon");
  span.setAttribute("aria-hidden", "true");
  const paths = ICON_PATHS[category] || ICON_PATHS.etc;
  span.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round">' +
    paths +
    "</svg>";
  return span;
}

// ---------------------------------------------------------------------------
// 말소(취소) 표현 — 시인성 규칙(설계서 4절): 화면의 유일한 대비.
//   유효 = 진한 글씨(장식 없음) / 말소 = 흐린 회색 + 취소선 + 회색 "말소 · 날짜" 칩.
//   판단색(빨강·주황) 금지 — 취소선·칩 모두 조용한 회색(사실의 시각적 번역일 뿐).
//   canceledDate/canceledCause 는 파서가 부착하는 가산 필드(없을 수 있음 → 안전 처리).
// ---------------------------------------------------------------------------

/**
 * 말소 라벨 텍스트(전체형 — 중학생 모드 꼬리표용).
 * "말소 · {날짜} · {원인}" — 없는 부분은 안전 생략.
 * @param {object} item
 * @returns {string}
 */
function canceledLabelText(item) {
  const parts = ["말소"];
  const date = formatDate(item && item.canceledDate);
  if (date) parts.push(date);
  if (hasVal(item && item.canceledCause)) parts.push(String(item.canceledCause).trim());
  return parts.join(" · ");
}

/**
 * ISO 날짜 → "YY.MM.DD" 축약(설계서 5-4 칩 형식). 형식 밖이면 formatDate 폴백.
 * @param {string} iso
 * @returns {string}
 */
function shortDate(iso) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(iso == null ? "" : iso).trim());
  if (!m) return formatDate(iso);
  const p2 = (n) => String(n).padStart(2, "0");
  return `${m[1].slice(2)}.${p2(m[2])}.${p2(m[3])}`;
}

/**
 * 회색 말소 칩 텍스트 — "말소 · YY.MM.DD"(날짜 없으면 "말소"만).
 * @param {object} item
 * @returns {string}
 */
function chipDeadText(item) {
  const d = shortDate(item && item.canceledDate);
  return d ? `말소 · ${d}` : "말소";
}

// ---------------------------------------------------------------------------
// 층2 — purpose 핵심 법률용어 추출 후 사전 조회
//   구체적 개념 → 일반 개념 순으로 사전 표제어를 부분일치로 찾는다.
//   매칭된 표제어를 lookupTerm 으로 조회(found → 한자+영문, 미수록 → 자료불충분).
// ---------------------------------------------------------------------------
const TERM_CANDIDATES = [
  "근저당권설정",
  "근저당권",
  "처분금지가처분",
  "경매개시결정",
  "강제경매",
  "가등기",
  "소유권이전",
  "소유권보존",
  "저당권",
  "질권",
  "가압류",
  "가처분",
  "압류",
  "전세권",
  "지상권",
  "지역권",
  "소유권",
  "대지권",
  "매매",
  "증여",
  "상속",
  "말소",
  "변경",
  "설정",
  "해지",
];

/**
 * purpose 에서 핵심 법률용어를 골라 사전 조회 결과를 반환.
 * @param {string} purpose
 * @returns {{found:boolean, term:string, hanja?:string, english?:string}}
 */
function lookupPurposeTerm(purpose) {
  const p = purpose == null ? "" : String(purpose);
  let key = TERM_CANDIDATES.find((c) => p.includes(c));
  // 후보 미발견 시 purpose 원문으로 한 번 더 시도(정확 일치 가능성).
  const word = key || p;
  const res = lookupTerm(word);
  if (res && res.found) {
    return { found: true, term: res.term, hanja: res.hanja, english: res.english };
  }
  return { found: false, term: word };
}

// ---------------------------------------------------------------------------
// 1층 — 교육 블록 "등기부등본 3분 이해" (설계서 5-1)
//   네이티브 <details open> — JS·라이브러리 불필요(설계서 7절).
//   아이콘은 작은 인라인 SVG 책(이모지 금지 — 절대원칙).
// ---------------------------------------------------------------------------

/** 작은 인라인 SVG 책 아이콘(장식 → aria-hidden). */
function bookIconEl() {
  const span = el("span", "edu-icon");
  span.setAttribute("aria-hidden", "true");
  span.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round">' +
    '<path d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0"/>' +
    '<path d="M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0"/>' +
    '<path d="M3 6l0 13"/><path d="M12 6l0 13"/><path d="M21 6l0 13"/>' +
    "</svg>";
  return span;
}

/** 교육 카드 3장 — 설계서 9절 복붙 문구 그대로(사실 설명, 판단 없음). */
const EDU_CARDS = [
  {
    tag: "tag-title",
    name: "표제부",
    head: "무엇인가",
    body: "소재지 · 면적 · 구조. 이 부동산의 기본 신원입니다.",
  },
  {
    tag: "tag-gap",
    name: "갑구",
    head: "누구 것인가",
    body: "소유자, 그리고 소유권을 흔드는 일(압류 · 가압류 · 경매).",
  },
  {
    tag: "tag-eul",
    name: "을구",
    head: "빚이 얼마인가",
    body: "근저당권 · 전세권 등. 이 집이 담보로 진 부담입니다.",
  },
];

/** 1층 교육 블록 — <details class="edu" open> + 카드 3개. 결과 맨 앞 1회. */
function buildEduBlock() {
  const details = el("details", "edu");
  details.open = true;

  const summary = el("summary");
  summary.appendChild(bookIconEl());
  summary.appendChild(document.createTextNode(" 등기부등본 3분 이해"));
  details.appendChild(summary);

  const cards = el("div", "edu-cards");
  for (const c of EDU_CARDS) {
    const card = el("div", "edu-card");
    const h = el("div", "edu-h");
    h.appendChild(el("span", `tag ${c.tag}`, c.name));
    h.appendChild(el("b", null, c.head));
    card.appendChild(h);
    card.appendChild(el("p", null, c.body));
    cards.appendChild(card);
  }
  details.appendChild(cards);
  return details;
}

// ---------------------------------------------------------------------------
// 2층 ① — 표제부 블록 (설계서 5-3)
//   propertyType(파서 제공 예정: "collective"|"single"|"land") 우선,
//   없으면 buildingType("집합건물"|"건물"|"토지")으로 추정.
//   null 필드·블록은 아예 그리지 않는다(빈 칸 노출 금지 — 설계서 3절).
// ---------------------------------------------------------------------------

/** propertyType 결정 — 파서 값 우선, 없으면 buildingType 으로 추정. */
function resolvePropertyType(p) {
  const t = p && p.propertyType;
  if (t === "collective" || t === "single" || t === "land") return t;
  const bt = p && hasVal(p.buildingType) ? String(p.buildingType) : "";
  if (bt.includes("집합")) return "collective";
  if (bt.includes("토지")) return "land";
  return "single";
}

/** 전유부분 건물번호 — 파서 필드(unitNo) 우선, 없으면 주소의 "제N층 제N호"에서 추출. */
function extractUnitNo(p) {
  if (p && hasVal(p.unitNo)) return String(p.unitNo).trim();
  const addr = p && hasVal(p.address) ? String(p.address) : "";
  const m = /제\s*\d+\s*층\s*제?\s*[\d-]+호/.exec(addr);
  return m ? m[0].replace(/\s+/g, " ") : null;
}

/** fact-row 1줄(라벨 + 값). 값이 없으면 null → 행 자체 생략. */
function factRow(label, value) {
  if (!hasVal(value)) return null;
  const row = el("div", "fact-row");
  row.appendChild(el("span", null, label));
  row.appendChild(el("b", null, String(value).trim()));
  return row;
}

/**
 * property → 표제부 블록(.reg-block). 표시할 사실이 하나도 없으면 null(블록 생략).
 * @param {object} property
 * @returns {(HTMLElement|null)}
 */
function buildPropertyHeader(property) {
  const p = property || {};
  const type = resolvePropertyType(p);

  const rows = [];
  const push = (r) => {
    if (r) rows.push(r);
  };

  push(factRow("소재지", p.address));
  push(factRow("구조", p.structure)); // 파서 제공 시에만(없으면 생략)
  push(factRow("면적", p.area));

  // 집합건물일 때만 전유부분/대지권 블록 추가(설계서 3절 — null 이면 아예 미출력)
  if (type === "collective") {
    const unitNo = extractUnitNo(p);
    if (unitNo) {
      rows.push(el("div", "fact-sub", "전유부분"));
      push(factRow("건물번호", unitNo));
    }
    if (hasVal(p.landShare)) {
      rows.push(el("div", "fact-sub", "대지권"));
      push(factRow("대지권 비율", p.landShare));
    }
  }

  push(factRow("고유번호", p.uid));
  push(factRow("열람일시", p.viewedAt));

  if (rows.length === 0) return null;

  const wrap = el("section", "reg-block reg-block-pyo");
  wrap.setAttribute("aria-label", "표제부");
  const label = el("div", "reg-label");
  label.appendChild(el("span", "tag tag-title", "표제부"));
  label.appendChild(
    document.createTextNode(type === "land" ? " 토지의 표시" : " 부동산의 표시")
  );
  wrap.appendChild(label);
  for (const r of rows) wrap.appendChild(r);
  return wrap;
}

// ---------------------------------------------------------------------------
// 통합본 안내 (갑구+을구 통합) — 중립 안내(평가·법적판단 없음)
// ---------------------------------------------------------------------------

/** 결과가 갑구+을구 통합본임을 알리는 안내 박스(읽기 방법 안내, 중립). */
function buildIntegratedNotice() {
  return el(
    "p",
    "integrated-notice",
    "이 타임라인은 갑구(소유권)와 을구(소유권 외 권리)를 시간순으로 합친 통합본입니다. " +
      "둘을 따로 보지 않고 통합해서 흐름을 보면 권리관계를 놓치지 않고 파악하는 데 도움이 됩니다."
  );
}

// ---------------------------------------------------------------------------
// 타임라인 카드
// ---------------------------------------------------------------------------

/** 금액/사건번호/법원 칩들을 만들어 컨테이너에 붙인다. */
function buildChips(item) {
  const chips = el("div", "tl-chips");
  let count = 0;

  // 금액 칩: formatAmount(amount) 우선, 실패 시 amountRaw(원문).
  const amountText = formatAmount(item.amount) || item.amountRaw || null;
  if (amountText) {
    const label = item.amountKind ? `${item.amountKind} ` : "";
    chips.appendChild(el("span", "tl-chip tl-chip-amount", `${label}${amountText}`));
    count++;
  }

  if (item.caseNo) {
    chips.appendChild(el("span", "tl-chip", `사건번호 ${item.caseNo}`));
    count++;
  }

  if (item.court) {
    chips.appendChild(el("span", "tl-chip", item.court));
    count++;
  }

  return count > 0 ? chips : null;
}

/**
 * 타임라인 엔트리 1개 → 카드(.tl-item). (통합본 뷰 전용)
 * 좌측 색 점/띠는 카테고리 의미색 대신 구 분류색(갑구=파랑, 을구=보라)만 사용
 * — 판단 암시색(빨강/주황)을 화면에서 제거. 말소는 회색 흐림 + 회색 취소선 +
 * 회색 "말소 · 날짜" 칩(설계서 4절 — 화면의 유일한 대비).
 * @param {object} item  - timeline 엔트리
 * @returns {HTMLElement}
 */
function buildTimelineItem(item) {
  const g = getGlossary(item.purpose);
  const category = resolveCategory(item, g);
  const canceled = item.canceled === true;
  const guClass =
    item.gu === "갑구" ? " gu-gap" : item.gu === "을구" ? " gu-eul" : "";

  // 말소 항목: wrap 에 is-canceled 추가. 색(--cat 회색화)·형태(취소선·흐림)는 CSS 담당.
  const wrap = el(
    "article",
    `tl-item cat-${category}${guClass}${canceled ? " is-canceled" : ""}`
  );

  // ── 좌측: 날짜 + 구 분류색 점 ─────────────
  const dateBox = el("div", "tl-date");
  dateBox.appendChild(el("span", "tl-dot", null));
  dateBox.appendChild(el("time", "tl-date-text", formatDate(item.receiptDate)));
  wrap.appendChild(dateBox);

  // ── 우측: 카드 ─────────────────────────────────────
  const card = el("div", "tl-card");

  // 헤더: 구 배지 + 순위번호 + 아이콘 + purpose 원문
  const cardHead = el("div", "tl-card-head");
  if (item.gu) cardHead.appendChild(el("span", "tl-badge", item.gu));
  if (item.rank) cardHead.appendChild(el("span", "tl-rank", `순위 ${item.rank}`));
  cardHead.appendChild(iconEl(category));
  cardHead.appendChild(el("span", "tl-purpose", item.purpose || ""));
  // 회색 말소 칩("말소 · YY.MM.DD") — 취소선은 제목 span(.tl-purpose)에만.
  if (canceled) cardHead.appendChild(el("span", "chip-dead", chipDeadText(item)));
  card.appendChild(cardHead);

  // 층2 보조표기: 한자 + 영문 (미수록 시 자료불충분)
  const term = lookupPurposeTerm(item.purpose);
  const termEl = el("p", "tl-term");
  if (term.found) {
    const parts = [];
    if (term.hanja) parts.push(term.hanja);
    if (term.english) parts.push(term.english);
    termEl.textContent = parts.join(" · ");
  } else {
    termEl.classList.add("is-insufficient");
    termEl.textContent = "자료불충분(법령용어한영사전 미수록)";
  }
  card.appendChild(termEl);

  // 층1 사건 풀이 문장
  card.appendChild(el("p", "tl-basic", g.basic(item)));

  // 칩
  const chips = buildChips(item);
  if (chips) card.appendChild(chips);

  // 말소 표시는 헤더의 "말소됨" 칩 + 제목 취소선 + 카드 약화로 대체(중복 꼬리표 제거).

  wrap.appendChild(card);
  return wrap;
}

// ---------------------------------------------------------------------------
// 2층 ②③ — 갑구/을구 블록 (설계서 5-4, 기본 뷰)
//   순위번호 순 나열. 유효/말소 대비는 active/cancelled 클래스가 담당(CSS).
//   섹션 라벨은 등기부 원문 표기 그대로(사실) — 평가어 아님.
// ---------------------------------------------------------------------------

/**
 * 순위번호 문자열("8", "5-1")을 {main, sub} 숫자로 파싱.
 * 형식이 아니면 main=MAX(맨 뒤로), sub=0 — 문자열 비교 금지(숫자 비교만).
 * @param {(string|number)} rank
 * @returns {{main:number, sub:number}}
 */
function parseRank(rank) {
  const s = String(rank == null ? "" : rank).trim();
  const m = s.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return { main: Number.MAX_SAFE_INTEGER, sub: 0 };
  return { main: parseInt(m[1], 10), sub: m[2] ? parseInt(m[2], 10) : 0 };
}

/**
 * 순위번호 비교 — 주번호 오름차순, 같은 주번호 내 부기 오름차순.
 * 예: 1, 2, 5, 5-1, 5-2, 6 ("15" 가 "5" 뒤로 밀리는 문자열 비교 오류 없음).
 * @param {(string|number)} a
 * @param {(string|number)} b
 * @returns {number}
 */
function compareRank(a, b) {
  const ra = parseRank(a);
  const rb = parseRank(b);
  return ra.main - rb.main || ra.sub - rb.sub;
}

/** 구 구획 정의 — 라벨 문구는 등기부 원문 표기(사실). 색은 칸 분류색만. */
const GU_SECTIONS = [
  { gu: "갑구", tag: "tag-gap", title: "소유권에 관한 사항" },
  { gu: "을구", tag: "tag-eul", title: "소유권 이외의 권리에 관한 사항" },
];

/**
 * 갑구/을구 항목 1건 → .reg-item (설계서 5-4).
 * reg-head(순위 + 등기목적 + 말소칩) + reg-detail(접수일·권리자·금액·사건번호 —
 * 있는 것만 " · " 연결) + 해석 문장(층1, 조용한 회색 — 이 도구의 핵심 가치라 유지).
 * @param {object} item
 * @returns {HTMLElement}
 */
function buildRegItem(item) {
  const canceled = item.canceled === true;
  const row = el("div", `reg-item ${canceled ? "cancelled" : "active"}`);

  const head = el("div", "reg-head");
  if (hasVal(item.rank)) head.appendChild(el("span", "rank", String(item.rank).trim()));
  head.appendChild(el("span", "purpose", item.purpose || ""));
  if (canceled) head.appendChild(el("span", "chip-dead", chipDeadText(item)));
  row.appendChild(head);

  // 상세: 접수일 · 권리자 · 금액 · 사건번호 — 있는 것만(빈칸 노출 금지)
  const parts = [];
  if (hasVal(item.receiptDate)) {
    let receipt = formatDate(item.receiptDate);
    if (hasVal(item.receiptNo)) receipt += ` 제${item.receiptNo}호`;
    parts.push(receipt);
  }
  if (hasVal(item.party)) parts.push(String(item.party).trim());
  const amountText =
    formatAmount(item.amount) || (hasVal(item.amountRaw) ? item.amountRaw : null);
  if (amountText) {
    parts.push(
      `${hasVal(item.amountKind) ? String(item.amountKind).trim() + " " : ""}${amountText}`
    );
  }
  if (hasVal(item.caseNo)) parts.push(`사건번호 ${String(item.caseNo).trim()}`);
  if (parts.length > 0) row.appendChild(el("div", "reg-detail", parts.join(" · ")));

  // 층1 해석 문장(사실 풀이) — reg-detail 아래 작은 회색 줄
  const g = getGlossary(item.purpose);
  row.appendChild(el("p", "reg-plain", g.basic(item)));

  return row;
}

/**
 * 기본 뷰(설계서 5-4) — 갑구/을구 블록별로 순위번호 순 나열.
 * 표제부 블록은 위에 상시 표시되므로 여기서 중복 생성하지 않는다.
 * @param {Array} visibleItems  - display !== false 필터 완료된 timeline 항목
 * @returns {HTMLElement}
 */
function buildRegistryOrderView(visibleItems) {
  const wrap = el("div", "registry-order");
  for (const sec of GU_SECTIONS) {
    const block = el("section", "reg-block");
    block.setAttribute("aria-label", sec.gu);

    const label = el("div", "reg-label");
    label.appendChild(el("span", `tag ${sec.tag}`, sec.gu));
    label.appendChild(document.createTextNode(` ${sec.title}`));
    block.appendChild(label);

    const items = visibleItems
      .filter((it) => it && it.gu === sec.gu)
      .slice()
      .sort((a, b) => compareRank(a.rank, b.rank));

    if (items.length === 0) {
      block.appendChild(el("p", "gu-empty", "기록된 항목 없음"));
    } else {
      for (const item of items) block.appendChild(buildRegItem(item));
    }
    wrap.appendChild(block);
  }
  return wrap;
}

/**
 * 보기 전환 탭 + 두 뷰 컨테이너를 root 에 부착.
 * [시간순 통합](기본 선택) / [등기부 순서] — 클릭 시 재파싱·재정렬 없이 show/hide 만.
 * 등기부 순서 뷰는 처음 선택될 때 1회 지연 렌더 후 재사용.
 * @param {HTMLElement} root
 * @param {Array} visibleItems  - display !== false 필터 완료 항목
 */
function attachViewSwitch(root, visibleItems) {
  // 탭(터치타겟 ≥44px 는 CSS .view-tab 이 보장)
  const tabs = el("div", "view-switch");
  tabs.setAttribute("role", "group");
  tabs.setAttribute("aria-label", "보기 방식 선택");

  // 사용자 확정(2026-07): 등기부 순서가 기본(먼저) 표시, 통합 뷰 명칭은 "등기부등본 통합본".
  const btnReg = el("button", "view-tab", "등기부 순서");
  btnReg.type = "button";
  btnReg.setAttribute("aria-pressed", "true");

  const btnTime = el("button", "view-tab", "등기부등본 통합본");
  btnTime.type = "button";
  btnTime.setAttribute("aria-pressed", "false");

  tabs.appendChild(btnReg);
  tabs.appendChild(btnTime);
  root.appendChild(tabs);

  // 뷰 1: 등기부 순서(기본 표시 — 즉시 렌더)
  const registry = el("div", "registry-view");
  registry.appendChild(buildRegistryOrderView(visibleItems));
  root.appendChild(registry);

  // 뷰 2: 등기부등본 통합본(시간순 — 초기 숨김, 첫 선택 시 1회 렌더)
  const integrated = el("div", "timeline view-integrated");
  toggleHidden(integrated, true);
  root.appendChild(integrated);

  let integratedRendered = false;
  function selectView(showRegistry) {
    if (!showRegistry && !integratedRendered) {
      // 통합본 안내(중립) — 통합본 뷰 안에서 1회 노출
      integrated.appendChild(buildIntegratedNotice());
      for (const item of visibleItems) integrated.appendChild(buildTimelineItem(item));
      integratedRendered = true;
    }
    toggleHidden(integrated, showRegistry);
    toggleHidden(registry, !showRegistry);
    btnTime.setAttribute("aria-pressed", String(!showRegistry));
    btnReg.setAttribute("aria-pressed", String(showRegistry));
  }
  btnTime.addEventListener("click", () => selectView(false));
  btnReg.addEventListener("click", () => selectView(true));
}

// ---------------------------------------------------------------------------
// 요약본 — 사실 집계(개수·금액·날짜·이름)까지만. 법적 판단·평가어 금지.
//   registryData.timeline 에서 직접 계산(데이터 가공은 render 담당).
// ---------------------------------------------------------------------------

/** ISO 문자열 날짜 비교(YYYY-MM-DD 사전식). null/빈값은 빈 문자열로. */
function cmpDate(a, b) {
  const sa = a == null ? "" : String(a);
  const sb = b == null ? "" : String(b);
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

/** purpose 에 부분 문자열이 포함되는지(널 안전). */
function purposeHas(purpose, sub) {
  return String(purpose == null ? "" : purpose).includes(sub);
}

/**
 * "N번근저당권변경" purpose 가 주어진 rank 를 가리키는지(정확 번호 일치).
 * "15번근저당권변경" 이 rank "5" 를 substring 으로 잘못 매칭하는 것 방지.
 * @param {string} purpose
 * @param {(string|number)} rank
 * @returns {boolean}
 */
function changeTargetsRank(purpose, rank) {
  const p = String(purpose == null ? "" : purpose);
  const target = String(rank);
  const re = /(\d+(?:-\d+)?)번근저당권변경/g;
  let m;
  while ((m = re.exec(p)) !== null) {
    if (m[1] === target) return true;
  }
  return false;
}

/**
 * 현존 근저당설정 1건의 "현재 채권최고액" 계산.
 * 같은 구(gu)·canceled=false 인 "{rank}번근저당권변경" 중 amount 가 있는 항목의
 * 최신 receiptDate 값으로 대체. 변경이 없으면 설정 당시 amount.
 * @param {Array} timeline
 * @param {object} setItem  - 근저당설정 항목
 * @returns {(number|null)} 현재 채권최고액(없으면 null)
 */
function currentMortgageAmount(timeline, setItem) {
  let amount = setItem.amount != null ? setItem.amount : null;
  const rank = setItem.rank;
  if (rank != null && String(rank) !== "") {
    const changes = timeline.filter(
      (it) =>
        it &&
        it.canceled !== true &&
        it.gu === setItem.gu &&
        it.amount != null &&
        changeTargetsRank(it.purpose, rank)
    );
    if (changes.length > 0) {
      changes.sort((a, b) => cmpDate(a.receiptDate, b.receiptDate));
      amount = changes[changes.length - 1].amount;
    }
  }
  return amount;
}

/**
 * 요약 데이터 계산(순수 함수). 기본/중학생 두 렌더가 공유.
 * @param {{property?:object, timeline?:Array}} registryData
 * @returns {{currentOwner:object|null, ownerChain:Array, mortgages:Array, sum:number,
 *            hasSum:boolean, others:Array, canceled:Array, transfers:Array}}
 */
function computeSummary(registryData) {
  const data = registryData || {};
  const timeline = Array.isArray(data.timeline) ? data.timeline : [];

  // A. 현재 소유자: ownership·canceled=false 중 receiptDate 최신
  const owners = timeline
    .filter((it) => it && it.category === "ownership" && it.canceled !== true)
    .slice()
    .sort((a, b) => cmpDate(a.receiptDate, b.receiptDate));
  const currentOwner = owners.length ? owners[owners.length - 1] : null;

  // A(체인). 소유자 변동 이력: ownership·canceled=false·소유권보존/이전 항목을
  // receiptDate 오름차순으로 — 과거 소유자부터 현재 소유자(취득일자)까지의 연혁.
  const ownerChain = timeline
    .filter(
      (it) =>
        it &&
        it.category === "ownership" &&
        it.canceled !== true &&
        (purposeHas(it.purpose, "소유권이전") || purposeHas(it.purpose, "소유권보존"))
    )
    .slice()
    .sort((a, b) => cmpDate(a.receiptDate, b.receiptDate));

  // B. 현재 살아있는 근저당설정(변경/이전/말소 제외) + 변경 반영 현재금액
  const mortgages = timeline
    .filter(
      (it) =>
        it &&
        it.category === "loan" &&
        it.canceled !== true &&
        purposeHas(it.purpose, "근저당권설정") &&
        !purposeHas(it.purpose, "말소") &&
        !purposeHas(it.purpose, "이전")
    )
    .map((it) => ({ item: it, currentAmount: currentMortgageAmount(timeline, it) }));
  const hasSum = mortgages.some((m) => m.currentAmount != null);
  const sum = mortgages.reduce((acc, m) => acc + (m.currentAmount || 0), 0);

  // C. 현재 살아있는 그 외 권리(가압류·압류·경매·전세권·지상권·가등기 등)
  const otherCats = ["restraint", "auction", "right", "pending"];
  const others = timeline
    .filter(
      (it) =>
        it &&
        it.canceled !== true &&
        it.display !== false &&
        otherCats.indexOf(it.category) !== -1
    )
    .slice()
    .sort((a, b) => cmpDate(a.receiptDate, b.receiptDate));

  // D. 정리된(말소된) 권리 — 시간순
  const canceled = timeline
    .filter((it) => it && it.canceled === true)
    .slice()
    .sort((a, b) => cmpDate(a.receiptDate, b.receiptDate));

  // E. 근저당 이전 내역
  const transfers = timeline
    .filter((it) => it && purposeHas(it.purpose, "근저당권이전"))
    .slice()
    .sort((a, b) => cmpDate(a.receiptDate, b.receiptDate));

  return { currentOwner, ownerChain, mortgages, sum, hasSum, others, canceled, transfers };
}

/** 요약 소제목 + 빈 목록(ul)을 만들어 {sub, ul} 반환. */
function summarySub(titleText) {
  const sub = el("div", "summary-sub");
  sub.appendChild(el("h3", "summary-subtitle", titleText));
  const ul = el("ul", "summary-list");
  sub.appendChild(ul);
  return { sub, ul };
}

/** ul 에 한 줄(li) 추가. */
function addSummaryLine(ul, text, extraClass) {
  ul.appendChild(el("li", "summary-line" + (extraClass ? " " + extraClass : ""), text));
}

/**
 * 요약본 섹션(기본 모드). 사실 집계만 — 평가/판단 없음. 빈 소제목은 생략.
 * @param {{property?:object, timeline?:Array}} registryData
 * @returns {HTMLElement}
 */
export function buildSummary(registryData) {
  const s = computeSummary(registryData);
  const wrap = el("section", "summary");
  wrap.setAttribute("aria-label", "요약");
  wrap.appendChild(el("h2", "summary-title", "한눈에 보기 (사실 요약)"));
  wrap.appendChild(
    el(
      "p",
      "summary-note",
      "등기부에 적힌 내용을 항목별로 세어 정리한 사실 요약입니다. 권리의 인수·소멸 등 법적 판단은 포함하지 않습니다."
    )
  );

  // A. 소유자 변동 이력(체인) — 과거 소유자부터 날짜순으로, 마지막이 현재 소유자.
  //     마지막 줄(현재)만 강조 + "현재 소유자" 표시. 0명이면 "확인 정보 없음".
  {
    const { sub, ul } = summarySub("소유자 변동(현재 소유자)");
    const chain = s.ownerChain;
    if (chain.length > 0) {
      const last = chain.length - 1;
      chain.forEach((it, i) => {
        const party = displayValue(it.party);
        const date = formatDate(it.receiptDate);
        let base = date ? `${date} · ${party}` : party;
        // 소유권 변동 원인(매매/상속/증여 등 — 등기부 기재 그대로) 적시
        if (hasVal(it.cause)) base += ` (원인: ${String(it.cause).trim()})`;
        if (i === last) {
          addSummaryLine(ul, `${base}  — 현재 소유자`, "summary-owner-current");
        } else {
          addSummaryLine(ul, base, "summary-owner-past");
        }
      });
    } else {
      addSummaryLine(ul, "확인 정보 없음");
    }
    wrap.appendChild(sub);
  }

  // B. 현재 살아있는 근저당권 + 채권최고액 합계(변경 반영)
  if (s.mortgages.length > 0) {
    const { sub, ul } = summarySub("현재 살아있는 근저당권");
    for (const m of s.mortgages) {
      const parts = [];
      const date = formatDate(m.item.receiptDate);
      if (date) parts.push(date);
      const amt = m.currentAmount != null ? formatAmount(m.currentAmount) : null;
      parts.push(amt ? `채권최고액 ${amt}` : "채권최고액 자료불충분");
      if (hasVal(m.item.party)) parts.push(String(m.item.party).trim());
      addSummaryLine(ul, parts.join(" · "));
    }
    if (s.hasSum) {
      addSummaryLine(ul, `현재 채권최고액 합계: ${formatAmount(s.sum)}`, "summary-sum");
    }
    wrap.appendChild(sub);
  }

  // C. 현재 살아있는 그 외 권리
  if (s.others.length > 0) {
    const { sub, ul } = summarySub("현재 살아있는 그 외 권리");
    for (const it of s.others) {
      const parts = [];
      const date = formatDate(it.receiptDate);
      if (date) parts.push(date);
      parts.push(displayValue(it.purpose));
      if (hasVal(it.party)) parts.push(String(it.party).trim());
      const amt = formatAmount(it.amount);
      if (amt) parts.push(it.amountKind ? `${String(it.amountKind).trim()} ${amt}` : amt);
      if (hasVal(it.caseNo)) parts.push(`사건번호 ${String(it.caseNo).trim()}`);
      addSummaryLine(ul, parts.join(" · "));
    }
    wrap.appendChild(sub);
  }

  // D. 정리된(말소된) 권리 — 사실만("말소됨")
  if (s.canceled.length > 0) {
    const { sub, ul } = summarySub("정리된(말소된) 권리");
    for (const it of s.canceled) {
      const parts = [];
      const date = formatDate(it.receiptDate);
      if (date) parts.push(date);
      parts.push(displayValue(it.purpose));
      let line = parts.join(" · ");
      if (hasVal(it.cause)) line += ` (원인: ${String(it.cause).trim()})`;
      addSummaryLine(ul, line);
    }
    wrap.appendChild(sub);
  }

  // E. 근저당 이전 내역 (없으면 섹션 생략)
  if (s.transfers.length > 0) {
    const { sub, ul } = summarySub("근저당 이전 내역");
    for (const it of s.transfers) {
      const date = formatDate(it.receiptDate);
      const party = hasVal(it.party) ? String(it.party).trim() : "자료불충분";
      addSummaryLine(ul, date ? `${date} · ${party}에게 이전` : `${party}에게 이전`);
    }
    wrap.appendChild(sub);
  }

  return wrap;
}

// ---------------------------------------------------------------------------
// 3층 — CTA (설계서 5-5)
//   url 이 빈 항목은 그 줄 자체를 생략(빈 링크 금지). 둘 다 비면 블록 전체 생략.
// ---------------------------------------------------------------------------

/** 3층 CTA 블록. CTA 설정이 모두 비어 있으면 null. */
function buildCta() {
  const consult = hasVal(CTA.consultUrl) ? String(CTA.consultUrl).trim() : "";
  const lesson = hasVal(CTA.lessonUrl) ? String(CTA.lessonUrl).trim() : "";
  if (!consult && !lesson) return null;

  const box = el("div", "cta");

  const lead = el("p", "cta-lead");
  lead.appendChild(el("b", null, "계약을 앞두고 계신가요?"));
  lead.appendChild(document.createTextNode(" 등기부만으로 안심하긴 이릅니다."));
  box.appendChild(lead);

  if (consult) {
    const btn = el("a", "cta-btn", "계약 전 권리 진단 받기");
    btn.href = consult;
    btn.target = "_blank"; // 티스토리 iframe 안 → 새 탭
    btn.rel = "noopener";
    box.appendChild(btn);
  }

  if (lesson) {
    const sub = el("p", "cta-sub");
    sub.appendChild(document.createTextNode("이 물건이 경매로 넘어가면? → "));
    const link = el("a", null, "경매 권리분석 배우기");
    link.href = lesson;
    link.target = "_blank";
    link.rel = "noopener";
    sub.appendChild(link);
    box.appendChild(sub);
  }

  return box;
}

// ---------------------------------------------------------------------------
// 엔트리포인트
// ---------------------------------------------------------------------------

/**
 * 기본 모드(대중용 화면) 렌더 — 설계서 1절 3층 구조.
 *   1층 교육 블록 → 2층 사실 요약(표제부 + 갑구/을구, 유효/말소 대비) → 3층 CTA.
 * 면책 문구(확정 문구)는 index.html(상시 노출)에 있으므로 여기서 중복 출력하지 않는다.
 *
 * @param {{property:object, timeline:Array}} registryData
 * @param {HTMLElement} container
 * @returns {HTMLElement} container
 */
export function renderBasic(registryData, container) {
  if (!container) return container;
  container.innerHTML = "";

  const data = registryData || {};
  const root = el("div", "basic-result");

  // 1층) 교육 블록 "등기부등본 3분 이해" — 결과 맨 앞 1회
  root.appendChild(buildEduBlock());

  // 2층) 사실 요약 헤더 + 면책(설계서 5-2 / 9절 문구)
  const secTitle = el("h2", "sec-title", "주요 등기사항 요약 ");
  secTitle.appendChild(el("span", "ref", "(참고용)"));
  root.appendChild(secTitle);
  root.appendChild(
    el(
      "p",
      "ref-disclaimer",
      "이 요약은 등기부등본을 읽기 쉽게 정리한 것으로, 증명서로서의 기능을 제공하지 않습니다. " +
        "실제 권리사항 파악을 위해서는 등기부등본 원본을 확인하세요."
    )
  );

  // 2층 ①) 표제부 블록(집합/단독/토지 자동 분기 — 사실이 하나도 없으면 블록 생략)
  const pyo = buildPropertyHeader(data.property);
  if (pyo) root.appendChild(pyo);

  // 2층 ②③) 갑구/을구: display !== false 만.
  const timeline = Array.isArray(data.timeline) ? data.timeline : [];
  const visible = timeline.filter((it) => it && it.display !== false);

  if (visible.length === 0) {
    root.appendChild(
      el(
        "p",
        "tl-empty",
        "표시할 등기 항목을 찾지 못했어요. 등기소에서 받은 '등기사항전부증명서' PDF가 맞는지 확인해 주세요."
      )
    );
  } else {
    // 보기 전환 탭 + [등기부 순서(기본)]/[등기부등본 통합본] 두 뷰(재파싱 없이 show/hide)
    attachViewSwitch(root, visible);
  }

  // 한눈에 보기(사실 요약) — 등기 항목이 있을 때만(없으면 위 안내문으로 충분).
  if (timeline.length > 0) {
    root.appendChild(buildSummary(data));
  }

  // 3층) CTA — 한눈에 보기 아래·면책 위. 링크가 하나도 없으면 블록 생략.
  const cta = buildCta();
  if (cta) root.appendChild(cta);

  container.appendChild(root);
  return container;
}

// ===========================================================================
// M7 — 중학생 모드 렌더(설계서 8.2) + 전환 헬퍼(8.3)
//   가산형: renderBasic/parseRegistry/glossary 시그니처 불변. 1회 파싱 결과 재사용.
//   외부통신 0. 법적판단·평가어 금지(사실 + 사전풀이까지만). 이모지 금지 → mascot SVG.
// ===========================================================================

/** 값이 존재(널/공백 아님)하는지. */
function hasVal(v) {
  return v != null && String(v).trim() !== "";
}

/** mascot SVG 를 감싼 아바타 span(장식 → aria-hidden). */
function mascotEl(pose, size, extraClass) {
  const span = el("span", "mascot-avatar" + (extraClass ? " " + extraClass : ""));
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = mascotSvg(pose, { size });
  return span;
}

/** 집요정 말풍선(텍스트만 — 사실/안내 문장). */
function bubbleEl(text, extraClass) {
  const b = el("div", "bubble" + (extraClass ? " " + extraClass : ""));
  b.appendChild(el("p", "bubble-text", text));
  return b;
}

/** 인트로: 손 흔드는 집요정 + 환영 멘트(판단 없이 안내만). */
function buildEasyIntro() {
  const wrap = el("section", "easy-intro");
  wrap.setAttribute("aria-label", "안내");
  wrap.appendChild(mascotEl("wave", 72, "mascot-lg"));
  wrap.appendChild(
    bubbleEl(
      "안녕하세요! 제가 이 등기부를 쉽게 풀어드릴게요. 등기부에 적힌 사실만 시간순으로 차근차근 정리해 드릴게요. " +
        "등기부는 '갑구'(누가 주인인지)와 '을구'(빚·전세 같은 다른 권리)로 나뉘는데, 제가 둘을 시간순으로 합쳐서 한 번에 보여드릴게요. " +
        "이렇게 통합해서 보면 놓치는 걸 줄일 수 있어요.",
      "bubble-intro"
    )
  );
  return wrap;
}

/**
 * 받침 유무로 주격 보조사 은/는 선택(받침 있으면 "은", 없으면 "는").
 * 예: 아파트→는, 빌라→는, 공장→은. 비한글/빈값은 기본 "는".
 * @param {string} word
 * @returns {('은'|'는')}
 */
function subjectParticle(word) {
  const s = word == null ? "" : String(word).trim();
  if (s === "") return "는";
  const code = s.charCodeAt(s.length - 1);
  // 한글 음절(가~힣)에서 (code-0xAC00)%28 !== 0 이면 받침(종성) 있음 → "은".
  if (code >= 0xac00 && code <= 0xd7a3) {
    return (code - 0xac00) % 28 !== 0 ? "은" : "는";
  }
  return "는";
}

/**
 * 받침 유무로 서술 종결 이에요/예요 선택(받침 있으면 "이에요", 없으면 "예요").
 * 예: 집합건물→이에요, 토지→예요. 비한글/빈값은 기본 "이에요".
 * @param {string} word
 * @returns {('이에요'|'예요')}
 */
function copulaEyo(word) {
  const s = word == null ? "" : String(word).trim();
  if (s === "") return "이에요";
  const code = s.charCodeAt(s.length - 1);
  if (code >= 0xac00 && code <= 0xd7a3) {
    return (code - 0xac00) % 28 !== 0 ? "이에요" : "예요";
  }
  return "이에요";
}

/**
 * 표제부 → 쉬운 한 문장(값 없으면 해당 부분 생략, 전부 없으면 자료불충분).
 * propertyKind(사용자가 드롭다운에서 고른 건물 종류)가 있으면 호칭만 그 종류로 바꾼다
 * (예: "이 아파트는 …에 있어요."). 없으면 기존 buildingType 기반 분기 그대로.
 * 등기부 사실(주소·면적·대지지분)은 어느 경우든 불변 — 호칭 단어만 교체.
 * @param {object} p
 * @param {string} [propertyKind]  - "아파트"/"빌라"/"공장" 등. 빈값이면 기존 동작.
 */
function composeEasyPropertyText(p, propertyKind) {
  const property = p || {};
  const addr = hasVal(property.address) ? String(property.address).trim() : null;
  const type = hasVal(property.buildingType) ? String(property.buildingType).trim() : null;
  const kind = hasVal(propertyKind) ? String(propertyKind).trim() : null;

  const segs = [];
  if (kind) {
    // 사용자 선택 호칭: "이 {종류}{은/는}". 사실(주소·면적 등)은 그대로 둔다.
    const subject = `이 ${kind}${subjectParticle(kind)}`;
    if (addr) segs.push(`${subject} ${addr}에 있어요.`);
  } else {
    // 선택 안 함: 주어를 "이 물건은"으로 통일(받침 ㄴ → "은"). 사실 문장은 불변.
    const subject = "이 물건은";

    if (addr && type) {
      segs.push(`${subject} ${addr}에 있는 ${type}${copulaEyo(type)}.`);
    } else if (addr) {
      segs.push(`${subject} ${addr}에 있어요.`);
    } else if (type) {
      segs.push(`${subject} ${type}${copulaEyo(type)}.`);
    }
  }

  if (hasVal(property.area)) segs.push(`전용면적은 ${String(property.area).trim()}예요.`);
  if (hasVal(property.landShare))
    segs.push(`대지지분은 ${String(property.landShare).trim()}이에요.`);

  if (segs.length === 0) {
    return "표제부 정보는 자료가 충분하지 않아 생략했어요.";
  }
  return segs.join(" ");
}

/** 표제부 요약 행(집요정 + 쉬운 문장). propertyKind 있으면 호칭에 반영. */
function buildEasyProperty(property, propertyKind) {
  const wrap = el("section", "easy-pyo");
  wrap.setAttribute("aria-label", "표제부 요약");
  wrap.appendChild(mascotEl("point", 56));
  wrap.appendChild(bubbleEl(composeEasyPropertyText(property, propertyKind), "bubble-pyo"));
  return wrap;
}

/** 사실 칩: 날짜 · 등기목적(원문) · 금액. */
function buildEasyChips(item) {
  const chips = el("div", "easy-chips");
  let count = 0;

  const date = formatDate(item.receiptDate);
  if (date) {
    chips.appendChild(el("span", "easy-chip", `날짜 ${date}`));
    count++;
  }

  if (hasVal(item.purpose)) {
    chips.appendChild(el("span", "easy-chip", `등기 ${String(item.purpose).trim()}`));
    count++;
  }

  const amountText = formatAmount(item.amount) || item.amountRaw || null;
  if (amountText) {
    const label = item.amountKind ? `${item.amountKind} ` : "";
    chips.appendChild(el("span", "easy-chip easy-chip-amount", `${label}${amountText}`));
    count++;
  }

  return count > 0 ? chips : null;
}

/** 타임라인 엔트리 1개 → 집요정 아바타 + 말풍선 + 칩(+ 말소 꼬리표). */
function buildEasyItem(item) {
  const g = getGlossary(item.purpose);
  const category = resolveCategory(item, g);
  const canceled = item.canceled === true;

  // is-canceled 는 wrap 에만(가산형). 본문 약화는 .easy-body/.bubble 로 한정하고,
  // --cat 은 건드리지 않아 마스코트(집요정) 색이 회색으로 새지 않는다.
  const wrap = el(
    "article",
    `easy-item cat-${category}${canceled ? " is-canceled" : ""}`
  );
  wrap.appendChild(mascotEl("point", 40, "mascot-sm"));

  const body = el("div", "easy-body");

  // 말소 항목: "말소 · 날짜 · 원인" 회색 라벨(사실 보강). 취소선은 본문에 쓰지 않음(읽기 방해).
  if (canceled) body.appendChild(el("span", "easy-canceled-tag", canceledLabelText(item)));

  // 층1 쉬운 풀이 말풍선
  body.appendChild(bubbleEl(g.easy(item), "bubble-easy"));

  // 층2 보조표기: 한자 + 영문(미수록 시 자료불충분)
  const term = lookupPurposeTerm(item.purpose);
  const termEl = el("p", "easy-term");
  if (term.found) {
    const parts = [];
    if (term.hanja) parts.push(term.hanja);
    if (term.english) parts.push(term.english);
    termEl.textContent = parts.length > 0 ? parts.join(" · ") : term.term;
  } else {
    termEl.classList.add("is-insufficient");
    termEl.textContent = "자료불충분(법령용어한영사전 미수록)";
  }
  body.appendChild(termEl);

  // 사실 칩
  const chips = buildEasyChips(item);
  if (chips) body.appendChild(chips);

  // 말소 꼬리표(중립)
  if (item.canceled === true) {
    body.appendChild(el("p", "easy-canceled", "이 항목은 등기부에서 지워졌어요(말소)."));
  }

  wrap.appendChild(body);
  return wrap;
}

/** 아웃트로: 집요정 + 면책 멘트를 대사로(설계서 9절). 빨강 강조로 경고 가독성↑. */
function buildEasyOutro() {
  const wrap = el("section", "easy-outro");
  wrap.setAttribute("aria-label", "안내");
  wrap.appendChild(mascotEl("default", 72, "mascot-lg"));
  const bubble = bubbleEl(
    "저는 등기부에 적힌 걸 쉽게 정리해드릴 뿐이고, 권리의 인수·소멸 같은 법적 판단은 못 해요. " +
      "놓친 게 있을 수 있으니 꼭 등기부등본 원본이랑 비교해 보시고, 정확한 건 전문가와 상의하세요.",
    "bubble-outro"
  );
  const p = bubble.querySelector(".bubble-text");
  if (p) p.classList.add("disclaimer-warn");
  wrap.appendChild(bubble);
  return wrap;
}

/** 요약을 집요정 톤으로 풀어쓴 사실 문장(개수·합계만 — 평가/판단 금지). */
function composeEasySummaryText(s) {
  const segs = [];

  // 소유자 변동 이력(체인)을 쉬운 말로: 첫 주인 → … → 지금 주인(가장 최근 취득일).
  const chain = s.ownerChain;
  if (chain.length > 0) {
    const names = chain.map((it) =>
      hasVal(it.party) ? String(it.party).trim() : "자료불충분"
    );
    const lastName = names[names.length - 1];
    const lastDate = formatDate(chain[chain.length - 1].receiptDate);
    if (chain.length === 1) {
      segs.push(
        lastDate
          ? `지금 이 집 주인은 ${lastName} 님이에요(가장 최근 ${lastDate}에 등기됐어요).`
          : `지금 이 집 주인은 ${lastName} 님이에요.`
      );
    } else {
      segs.push(
        lastDate
          ? `역대 주인은 ${names.join(" → ")} 순서로 바뀌었고, 지금 주인은 ${lastName} 님이에요(가장 최근 ${lastDate}에 바뀌었어요).`
          : `역대 주인은 ${names.join(" → ")} 순서로 바뀌었고, 지금 주인은 ${lastName} 님이에요.`
      );
    }
  }

  if (s.mortgages.length > 0) {
    if (s.hasSum) {
      segs.push(
        `지금 살아있는 빚(근저당)은 ${s.mortgages.length}건이고, 채권최고액을 다 더하면 ${formatAmount(s.sum)}이에요.`
      );
    } else {
      segs.push(`지금 살아있는 빚(근저당)은 ${s.mortgages.length}건이에요.`);
    }
  } else {
    segs.push("지금 살아있는 빚(근저당)은 없어요.");
  }

  if (s.others.length > 0) {
    segs.push(`그 외에 살아있는 권리는 ${s.others.length}건 있어요.`);
  }

  segs.push(`정리돼서 지워진(말소된) 권리는 ${s.canceled.length}건이에요.`);
  segs.push("이건 등기부에 적힌 걸 그대로 세어본 사실 요약이에요.");

  return segs.join(" ");
}

/** 중학생 모드 요약 행(집요정 + 쉬운 사실 문장). */
function buildEasySummary(registryData) {
  const s = computeSummary(registryData);
  const wrap = el("section", "easy-summary");
  wrap.setAttribute("aria-label", "요약");
  wrap.appendChild(mascotEl("point", 56));
  wrap.appendChild(bubbleEl(composeEasySummaryText(s), "bubble-summary"));
  return wrap;
}

/**
 * 중학생 모드 렌더. registryData{property, timeline} 를 container 에 그린다.
 * renderBasic 과 같은 1회 파싱 결과를 표현만 바꿔 재사용(재파싱 X).
 *
 * 가산형: opts 는 선택적. opts.propertyKind(사용자가 고른 건물 종류)가 있으면
 * 표제부 호칭을 그 종류로 바꾼다. opts 없으면 기존 동작과 동일(회귀 없음).
 *
 * @param {{property:object, timeline:Array}} registryData
 * @param {HTMLElement} container
 * @param {{propertyKind?:string}} [opts]
 * @returns {HTMLElement} container
 */
export function renderEasy(registryData, container, opts) {
  if (!container) return container;
  container.innerHTML = "";

  const data = registryData || {};
  const propertyKind = opts && opts.propertyKind ? opts.propertyKind : "";
  const root = el("div", "easy-result");

  // 1) 인트로(집요정 환영)
  root.appendChild(buildEasyIntro());

  // 2) 표제부 쉬운 요약(사용자 선택 호칭 반영)
  root.appendChild(buildEasyProperty(data.property, propertyKind));

  // 3) 타임라인(display !== false, parser 정렬 그대로 시간순)
  const timeline = Array.isArray(data.timeline) ? data.timeline : [];
  const visible = timeline.filter((it) => it && it.display !== false);

  if (visible.length === 0) {
    root.appendChild(
      bubbleEl(
        "쉽게 풀어드릴 등기 항목을 찾지 못했어요. 등기소에서 받은 '등기사항전부증명서' PDF가 맞는지 확인해 주세요.",
        "bubble-empty"
      )
    );
  } else {
    const list = el("div", "easy-timeline");
    for (const item of visible) list.appendChild(buildEasyItem(item));
    root.appendChild(list);
  }

  // 3-1) 요약(쉬운 사실 문장) — 등기 항목이 있을 때만.
  if (timeline.length > 0) {
    root.appendChild(buildEasySummary(data));
  }

  // 4) 아웃트로(면책 대사)
  root.appendChild(buildEasyOutro());

  container.appendChild(root);
  return container;
}

/** node 의 표시/숨김 토글(aria-hidden 동기화). */
function toggleHidden(node, hidden) {
  if (!node) return;
  node.hidden = !!hidden;
  if (hidden) node.setAttribute("aria-hidden", "true");
  else node.removeAttribute("aria-hidden");
}

/**
 * 모드 전환 헬퍼. 재파싱 없이 basic/easy 영역을 show/hide.
 * easy 를 처음 펼칠 때 아직 비어 있으면 1회 파싱 결과(registryData)로 지연 렌더.
 *   - easyEl 자체가 렌더 타깃이거나, 내부의 `.easy-render` 컨테이너를 타깃으로 사용.
 *
 * @param {('basic'|'easy')} mode
 * @param {{property:object, timeline:Array}} registryData  - 보관된 파싱 결과(재사용)
 * @param {HTMLElement} basicEl  - 기본 모드 그룹
 * @param {HTMLElement} easyEl   - 중학생 모드 그룹
 * @returns {string} 적용된 mode
 */
export function setMode(mode, registryData, basicEl, easyEl) {
  const showEasy = mode === "easy";
  toggleHidden(basicEl, showEasy);
  toggleHidden(easyEl, !showEasy);

  if (showEasy && easyEl && registryData) {
    let target = null;
    if (easyEl.classList && easyEl.classList.contains("easy-render")) {
      target = easyEl;
    } else if (typeof easyEl.querySelector === "function") {
      target = easyEl.querySelector(".easy-render") || easyEl;
    } else {
      target = easyEl;
    }
    if (target && target.childElementCount === 0) {
      renderEasy(registryData, target);
    }
  }
  return mode;
}
