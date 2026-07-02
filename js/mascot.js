// js/mascot.js — 집요정 마스코트 (SVG 자체 제작, ESM)
//
// 설계서 8.2: 중학생 모드의 친근한 "집요정" 캐릭터.
// 절대원칙:
//  - 외부통신 0 (외부 이미지/폰트/CDN 금지, 순수 인라인 SVG)
//  - 이모지 금지 (기기별 깨짐) → 단순 기하 도형(path/rect/circle/polygon)으로 직접 그림
//  - 개인정보/평가어/법적판단 문구 없음, 가산형(신규 파일만)
//  - 접근성: role="img" + <title> (aria-label 지원)
//  - 색은 currentColor / CSS 변수 활용 → 다크모드에서도 보임 (하드코딩 색 최소화)
//  - viewBox 사용 → 무한 확대/축소(반응형)

/** 지원하는 포즈 목록 */
export const POSES = ['default', 'wave', 'point'];

/** 기본 viewBox 한 변 크기 (정사각 좌표계) */
const VB = 100;

/**
 * 문자열을 SVG/XML 속성값에 안전하게 넣기 위한 최소 이스케이프.
 * (title 등 텍스트 노드/속성에 사용)
 * @param {string} s
 * @returns {string}
 */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 공통 집(몸통) 본체.
 * - 지붕(polygon) + 벽(rect) + 문(rect) + 창문(rect) + 굴뚝(rect)
 * - 윤곽선은 currentColor, 면은 CSS 변수(--mascot-*)로 채우되 없으면 currentColor 폴백.
 *   다크모드에서도 보이도록 채움은 반투명/변수 기반.
 * @returns {string}
 */
function houseBody() {
  // CSS 변수 폴백 체인: 사용처에서 --mascot-fill 등을 정의하면 그 색,
  // 아니면 currentColor 기반의 옅은 면을 쓰도록 fill-opacity로 톤 조절.
  return [
    // 굴뚝
    '<rect x="64" y="20" width="10" height="16" rx="1.5" ' +
      'fill="var(--mascot-roof, currentColor)" fill-opacity="0.85" ' +
      'stroke="currentColor" stroke-width="2"/>',
    // 지붕 (삼각형)
    '<polygon points="50,12 86,40 14,40" ' +
      'fill="var(--mascot-roof, currentColor)" fill-opacity="0.85" ' +
      'stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>',
    // 벽 (얼굴/몸통)
    '<rect x="20" y="40" width="60" height="48" rx="4" ' +
      'fill="var(--mascot-fill, currentColor)" fill-opacity="0.12" ' +
      'stroke="currentColor" stroke-width="2.5"/>',
    // 문
    '<rect x="44" y="66" width="14" height="22" rx="2" ' +
      'fill="var(--mascot-door, currentColor)" fill-opacity="0.25" ' +
      'stroke="currentColor" stroke-width="2"/>',
    // 문 손잡이
    '<circle cx="54.5" cy="77" r="1.4" fill="currentColor"/>',
  ].join('');
}

/**
 * 눈 + 표정(입/볼).
 * @param {('default'|'wave'|'point')} pose
 * @returns {string}
 */
function face(pose) {
  // 눈 (창문 자리). point 포즈는 한쪽을 살짝 윙크.
  const leftEye = '<circle cx="34" cy="52" r="3.2" fill="currentColor"/>';
  const rightEye =
    pose === 'point'
      ? '<path d="M60 52 q3.5 -3 7 0" fill="none" stroke="currentColor" ' +
        'stroke-width="2.4" stroke-linecap="round"/>' // 윙크(살짝 감은 눈)
      : '<circle cx="63.5" cy="52" r="3.2" fill="currentColor"/>';

  // 볼(친근함) — 옅은 면
  const cheeks =
    '<circle cx="30" cy="60" r="3" fill="var(--mascot-cheek, currentColor)" fill-opacity="0.25"/>' +
    '<circle cx="67" cy="60" r="3" fill="var(--mascot-cheek, currentColor)" fill-opacity="0.25"/>';

  // 입 — 부드러운 미소
  const mouth =
    '<path d="M42 60 q6.8 6 14 0" fill="none" stroke="currentColor" ' +
    'stroke-width="2.4" stroke-linecap="round"/>';

  return leftEye + rightEye + cheeks + mouth;
}

/**
 * 포즈별 추가 장식(팔/손짓 등).
 * @param {('default'|'wave'|'point')} pose
 * @returns {string}
 */
function poseExtras(pose) {
  if (pose === 'wave') {
    // 오른쪽으로 든 손(인사). 팔 + 손바닥.
    return (
      '<g stroke="currentColor" stroke-width="2.5" stroke-linecap="round" fill="none">' +
      '<path d="M80 56 q12 -4 16 -16"/>' +
      '</g>' +
      '<circle cx="96" cy="38" r="4.5" ' +
      'fill="var(--mascot-fill, currentColor)" fill-opacity="0.25" ' +
      'stroke="currentColor" stroke-width="2"/>'
    );
  }
  if (pose === 'point') {
    // 가리키는 팔 + 손가락(설명용).
    return (
      '<g stroke="currentColor" stroke-width="2.5" stroke-linecap="round" fill="none">' +
      '<path d="M80 62 h14"/>' +
      '<path d="M94 62 l4 -3 M94 62 l4 3"/>' + // 화살촉(가리킴)
      '</g>'
    );
  }
  return '';
}

/**
 * 집요정 마스코트 SVG 문자열을 반환한다.
 *
 * @param {('default'|'wave'|'point')} [pose='default'] 캐릭터 포즈. 미지원 값은 'default'로 폴백.
 * @param {Object} [opts]
 * @param {number} [opts.size=64] 픽셀 크기. 0/falsy면 '100%'(부모에 맞춤).
 * @param {string} [opts.title] 접근성 라벨(<title> + aria-label). 기본 '집요정 캐릭터'.
 * @param {string} [opts.className] 루트 <svg>에 추가할 class.
 * @returns {string} 인라인 SVG 문자열 ("<svg ...>...</svg>")
 */
export function mascotSvg(pose = 'default', opts = {}) {
  const safePose = POSES.includes(pose) ? pose : 'default';
  const title = opts && opts.title != null ? String(opts.title) : '집요정 캐릭터';

  // size: 숫자면 px, 그 외(0/null/undefined)면 100%로 반응형.
  let dim;
  if (opts && typeof opts.size === 'number' && opts.size > 0) {
    dim = `width="${opts.size}" height="${opts.size}"`;
  } else if (opts && opts.size === undefined) {
    dim = `width="64" height="64"`; // 기본 64
  } else {
    dim = `width="100%" height="100%"`;
  }

  const cls = opts && opts.className ? ` class="${esc(String(opts.className))}"` : '';
  const safeTitle = esc(title);

  const inner =
    houseBody() + face(safePose) + poseExtras(safePose);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB} ${VB}" ` +
    `${dim} role="img" aria-label="${safeTitle}"${cls} ` +
    `data-pose="${safePose}" fill="none" preserveAspectRatio="xMidYMid meet">` +
    `<title>${safeTitle}</title>` +
    inner +
    `</svg>`
  );
}

export default mascotSvg;
