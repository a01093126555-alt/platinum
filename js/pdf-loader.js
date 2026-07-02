// ============================================================================
// pdf-loader.js — PDF.js 텍스트 추출 (M1 + M2)
//
// ES module. PDF.js는 로컬 vendor 빌드만 import (외부 통신 0 / CDN 금지).
// M1: 페이지별 텍스트를 라인으로 합쳐 반환 (loadPdfText) — 기존 시그니처 불변.
// M2: 좌표를 살린 추출(extractPages) + 라인 그룹화(groupLines) + 컬럼 배정
//     (assignColumns)을 가산형으로 추가. PARSING_NOTES 2절 x경계 준수.
// ============================================================================

import * as pdfjsLib from "../vendor/pdfjs/pdf.min.mjs";

// 워커도 로컬 파일만 (index.html에서도 설정하지만 여기서도 보장 — 멱등).
// 모듈 URL 기준 절대경로로 워커를 가리켜 어디서 import 되든 안전하게 동작.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "../vendor/pdfjs/pdf.worker.min.mjs",
  import.meta.url
).href;

/**
 * PDF ArrayBuffer를 받아 페이지별 텍스트를 추출한다.
 *
 * @param {ArrayBuffer} arrayBuffer - 업로드된 PDF의 바이트
 * @returns {Promise<{numPages: number, pages: {pageNum: number, text: string}[]}>}
 */
export async function loadPdfText(arrayBuffer) {
  if (!arrayBuffer || !(arrayBuffer.byteLength > 0)) {
    throw new Error("빈 PDF 데이터입니다.");
  }

  // getDocument는 ArrayBuffer를 소비(detach)할 수 있으므로 사본 전달.
  const data = arrayBuffer.slice(0);
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;

  const pages = [];
  try {
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();

      // M1: 같은 y(라인)로 그룹화해 사람이 읽을 수 있는 텍스트로 합친다.
      // 정식 좌표 컬럼 분리는 M2에서. 여기서는 구조 확인용 덤프가 목적.
      const text = itemsToLines(content.items);
      pages.push({ pageNum, text });

      // 메모리 정리
      page.cleanup();
    }
  } finally {
    // 문서/워커 자원 해제
    await pdf.cleanup();
    await pdf.destroy();
  }

  return { numPages: pdf.numPages, pages };
}

/**
 * PDF.js textContent items를 라인 단위 텍스트로 합친다(M1 임시 휴리스틱).
 * - transform[5](=y)가 비슷하면 같은 줄로 간주, x(transform[4]) 오름차순 정렬.
 * - 정밀 컬럼 경계 처리는 M2 담당.
 *
 * @param {Array} items - page.getTextContent().items
 * @returns {string}
 */
function itemsToLines(items) {
  if (!Array.isArray(items) || items.length === 0) return "";

  const Y_TOLERANCE = 2; // 같은 줄로 묶을 y 허용 오차(pt)
  const rows = [];

  for (const it of items) {
    // 이미지/마커 등 str 없는 항목 skip
    if (typeof it.str !== "string") continue;

    const x = Array.isArray(it.transform) ? it.transform[4] : 0;
    const y = Array.isArray(it.transform) ? it.transform[5] : 0;

    let row = rows.find((r) => Math.abs(r.y - y) <= Y_TOLERANCE);
    if (!row) {
      row = { y, cells: [] };
      rows.push(row);
    }
    row.cells.push({ x, str: it.str });

    // PDF.js가 EOL 힌트를 줄 때 줄바꿈 보강
    if (it.hasEOL) {
      row.cells.push({ x: Number.POSITIVE_INFINITY, str: "" });
    }
  }

  // y 내림차순(위→아래: PDF 좌표계는 위가 큰 y)
  rows.sort((a, b) => b.y - a.y);

  return rows
    .map((r) =>
      r.cells
        .sort((a, b) => a.x - b.x)
        .map((c) => c.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((line) => line.length > 0)
    .join("\n");
}

// ============================================================================
// M2: 좌표 기반 추출 API (가산형 — loadPdfText는 그대로 둠)
// ============================================================================

/**
 * @typedef {Object} TextItem
 * @property {string} str   - 텍스트 조각
 * @property {number} x     - transform[4] (좌→우 증가)
 * @property {number} y     - transform[5] (아래→위 증가, PDF 좌표계)
 * @property {number} width - item.width (PDF.js 보고값)
 */

/**
 * @typedef {Object} PageText
 * @property {number} pageNum
 * @property {TextItem[]} items
 */

/**
 * @typedef {Object} Line
 * @property {number} y                - 라인 대표 y(반올림된 그룹 키)
 * @property {TextItem[]} items        - x오름차순 정렬된 항목들
 * @property {string} text             - items.str을 x순으로 join한 라인 텍스트
 */

/**
 * 컬럼 x좌표 경계 (PARSING_NOTES.md 2절 기준 — 변경 금지).
 *   순위번호 rank    : x < 75
 *   등기목적 purpose : 75 ≤ x < 175
 *   접수    receipt  : 175 ≤ x < 260
 *   등기원인 cause    : 260 ≤ x < 340
 *   권리자  party    : x ≥ 340
 * 역할분리: 구조(컬럼)는 좌표가 결정, 값추출은 parser의 정규식이 담당.
 */
export const COLUMN_BOUNDS = Object.freeze({
  RANK_MAX: 75,     // x < 75            → rank
  PURPOSE_MAX: 175, // 75 ≤ x < 175      → purpose
  RECEIPT_MAX: 260, // 175 ≤ x < 260     → receipt
  CAUSE_MAX: 340,   // 260 ≤ x < 340     → cause
  // x ≥ 340                              → party
});

/**
 * PDF ArrayBuffer를 받아 페이지별로 좌표를 살린 텍스트 항목을 추출한다.
 * loadPdfText(라인 문자열)와 달리, 컬럼 배정/블록 분리에 쓸 원시 좌표를 보존.
 *
 * @param {ArrayBuffer} arrayBuffer - 업로드된 PDF의 바이트
 * @returns {Promise<PageText[]>}
 */
export async function extractPages(arrayBuffer) {
  if (!arrayBuffer || !(arrayBuffer.byteLength > 0)) {
    throw new Error("빈 PDF 데이터입니다.");
  }

  // getDocument는 ArrayBuffer를 소비(detach)할 수 있으므로 사본 전달.
  const data = arrayBuffer.slice(0);
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;

  /** @type {PageText[]} */
  const pages = [];
  try {
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();

      /** @type {TextItem[]} */
      const items = [];
      for (const it of content.items) {
        // 이미지/마커 등 str 없는 항목 skip
        if (typeof it.str !== "string") continue;
        // trim 후 빈 항목(공백만)은 제외 — 컬럼 배정 시 노이즈 방지.
        // (의미 있는 내부 공백은 str 원문에 그대로 보존됨)
        if (it.str.trim() === "") continue;

        const tf = Array.isArray(it.transform) ? it.transform : null;
        items.push({
          str: it.str,
          x: tf ? tf[4] : 0,
          y: tf ? tf[5] : 0,
          width: typeof it.width === "number" ? it.width : 0,
        });
      }

      pages.push({ pageNum, items });
      page.cleanup();
    }
  } finally {
    await pdf.cleanup();
    await pdf.destroy();
  }

  return pages;
}

/**
 * TextItem[] 를 라인 단위로 그룹화한다.
 * - 같은 y(±yTolerance 반올림)끼리 한 줄로 묶고, 각 줄 내부는 x오름차순 정렬.
 * - 반환 순서는 y 내림차순(위→아래: PDF 좌표계는 위가 큰 y).
 *
 * @param {TextItem[]} items
 * @param {number} [yTolerance=2] - 같은 줄로 묶을 y 허용 오차(pt)
 * @returns {Line[]}
 */
export function groupLines(items, yTolerance = 2) {
  if (!Array.isArray(items) || items.length === 0) return [];

  /** @type {Line[]} */
  const lines = [];
  for (const it of items) {
    if (!it || typeof it.str !== "string") continue;
    const y = typeof it.y === "number" ? it.y : 0;

    let line = lines.find((l) => Math.abs(l.y - y) <= yTolerance);
    if (!line) {
      line = { y, items: [], text: "" };
      lines.push(line);
    }
    line.items.push(it);
  }

  // 위→아래
  lines.sort((a, b) => b.y - a.y);

  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.text = line.items
      .map((c) => c.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return lines;
}

/**
 * 한 라인의 항목들을 x좌표 경계에 따라 5개 컬럼에 배정한다.
 * 각 컬럼 값 = 해당 컬럼에 속한 item들의 str을 x오름차순으로 join.
 * 경계는 COLUMN_BOUNDS(=PARSING_NOTES 2절) 상수를 사용.
 *
 * @param {Line | TextItem[]} line - groupLines 결과의 Line 또는 TextItem[]
 * @returns {{ rank:string, purpose:string, receipt:string, cause:string, party:string }}
 */
export function assignColumns(line) {
  const src = Array.isArray(line) ? line : line && line.items;
  const cols = { rank: [], purpose: [], receipt: [], cause: [], party: [] };
  if (!Array.isArray(src)) {
    return { rank: "", purpose: "", receipt: "", cause: "", party: "" };
  }

  // x오름차순 보장(이미 정렬되어 있어도 멱등)
  const sorted = src
    .filter((it) => it && typeof it.str === "string")
    .slice()
    .sort((a, b) => (a.x || 0) - (b.x || 0));

  for (const it of sorted) {
    const x = typeof it.x === "number" ? it.x : 0;
    if (x < COLUMN_BOUNDS.RANK_MAX) cols.rank.push(it.str);
    else if (x < COLUMN_BOUNDS.PURPOSE_MAX) cols.purpose.push(it.str);
    else if (x < COLUMN_BOUNDS.RECEIPT_MAX) cols.receipt.push(it.str);
    else if (x < COLUMN_BOUNDS.CAUSE_MAX) cols.cause.push(it.str);
    else cols.party.push(it.str);
  }

  const join = (arr) => arr.join(" ").replace(/\s+/g, " ").trim();
  return {
    rank: join(cols.rank),
    purpose: join(cols.purpose),
    receipt: join(cols.receipt),
    cause: join(cols.cause),
    party: join(cols.party),
  };
}
