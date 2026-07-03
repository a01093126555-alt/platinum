// ============================================================================
// app.js — 흐름 제어 (M6: 파서 + 기본 모드 렌더 연결)
//
// 파일선택/드래그&드롭 → PDF 검사 → parseRegistry(6절 JSON) → renderBasic(DOM).
// raw 덤프는 콘솔에만 남긴다(구조 확인용). 외부 통신 0: 모든 처리는 브라우저 안에서만.
// ============================================================================

import { parseRegistry } from "./parser.js";
import { extractPages } from "./pdf-loader.js";
import { renderBasic, renderEasy, setMode } from "./render.js";

// ===== 접근 설정 (운영자 수정 지점) =====
//   도메인 잠금: 직접 접속(github.io 등 top-level)은 파싱 기능을 잠그고
//   티스토리 글로 안내한다. 티스토리 iframe 임베드·localhost·dev키는 허용.
const ACCESS = {
  lockEnabled: false,             // ★현재 꺼짐(테스트 기간) — 티스토리 글 발행 후 true로 켜기. false면 직접 접속도 허용
  tistoryPostUrl: "",             // ★티스토리 해석기 글 URL — 발행 후 입력 (예: "https://내블로그.tistory.com/123")
  allowedParents: ["tistory.com"],// 이 도메인이 부모(referrer)면 허용
  devKey: "pt-owner-2026",        // 운영자 해제: ?dev=pt-owner-2026 (원하면 변경)
};

// ===== 후원 설정 (운영자 수정 지점) =====
//   커피 사주기 버튼: 클릭 시 새 탭으로 이동하는 앵커일 뿐(외부 스크립트/위젯 로드 없음).
const SUPPORT = {
  url: "https://qr.kakaopay.com/FaN3mKR8T", // ★후원 링크(카카오페이 송금). 비우면 버튼 숨김
  label: "개발자후원은 카카오페이 100원부터",
};

// 스캔본(이미지) 판정 기준: 추출된 글자 수가 이보다 적으면 텍스트가 없는 PDF로 본다.
// 정상 등기사항전부증명서는 글자 수가 수천 자에 달한다.
const SCAN_TEXT_MIN = 30;

const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const statusEl = document.getElementById("statusMessage");
const resultEl = document.getElementById("resultContainer");
const kindSelect = document.getElementById("propertyKind");
const progressEl = document.getElementById("progress");

// ---------- 임베드(iframe) 모드 감지 + URL 파라미터 (Part 1) ----------
//   ?embed=1 또는 상위 프레임 안(window.self !== window.top)이면 임베드로 본다.
//   ?from=... 은 후속(방문자 카운터) 연동용으로 보관만 하고 지금은 미사용.
//   임베드가 아니면 아래 postHeight 등은 전부 no-op → 일반 접속에 무해.
const params = new URLSearchParams(location.search);
const isEmbedded = params.get("embed") === "1" || window.self !== window.top;
const fromSource = params.get("from") || ""; // 보관만(현재 미사용)
if (isEmbedded) {
  document.documentElement.classList.add("embed");
}

// ---------- 도메인 잠금 (접근 판정) ----------
//   unlocked 판정(아래 중 하나면 허용):
//   ① localhost/127.0.0.1 (개발·테스트)
//   ② ?dev= 값이 ACCESS.devKey 와 일치 → sessionStorage 저장(이 세션 동안 유지)
//   ③ 실제 iframe 안(self!==top)이고, referrer 가 비었거나 allowedParents 도메인
//      (referrer 가 있는데 허용 도메인이 아니면 잠금 — 타 사이트 무단 임베드 차단.
//       referrer 빈 값은 브라우저 referrer 정책상 흔해 허용.)
//   ④ ACCESS.lockEnabled === false
//   주의: 판정에는 isEmbedded 가 아니라 self!==top 을 직접 쓴다 —
//   isEmbedded 는 ?embed=1 만으로도 참이 되어 top-level 우회가 가능하기 때문.
const DEV_SESSION_KEY = "deungki:devUnlock";

function isAllowedParentReferrer(referrer, allowedParents) {
  if (!referrer) return true; // 빈 referrer 는 정책상 흔함 → 허용
  let host = "";
  try {
    host = new URL(referrer).hostname;
  } catch (e) {
    return true; // 파싱 불가한 referrer 는 빈 값과 동일 취급
  }
  return allowedParents.some(
    (d) => host === d || host.endsWith("." + d)
  );
}

function computeAccessUnlocked() {
  if (ACCESS.lockEnabled === false) return true; // ④ 잠금 기능 끔

  // ① 로컬 개발·테스트
  const host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return true;

  // ② 운영자 dev 키 (?dev=...) — 세션 동안 유지(재방문/네비게이션 포함)
  try {
    if (params.get("dev") === ACCESS.devKey) {
      sessionStorage.setItem(DEV_SESSION_KEY, "1");
    }
    if (sessionStorage.getItem(DEV_SESSION_KEY) === "1") return true;
  } catch (e) {
    /* sessionStorage 접근 불가(일부 임베드 환경) → 다른 조건으로 판정 */
  }

  // ③ 실제 iframe 임베드 + 허용 부모(referrer)
  const inIframe = window.self !== window.top;
  if (inIframe && isAllowedParentReferrer(document.referrer, ACCESS.allowedParents)) {
    return true;
  }

  return false;
}

const accessUnlocked = computeAccessUnlocked();

// 잠금 안내 박스(.access-lock) 생성 — 평가어/법적판단 없이 중립 안내만.
function buildAccessLockBox() {
  const box = document.createElement("section");
  box.className = "access-lock";
  box.setAttribute("aria-label", "이용 안내");

  const title = document.createElement("h2");
  title.className = "access-lock-title";
  title.textContent = "이 프로그램은 블로그 글 안에서 이용할 수 있어요";
  box.appendChild(title);

  const text = document.createElement("p");
  text.className = "access-lock-text";
  text.textContent =
    "등기부등본 해석은 아래 블로그 글에서 무료로 이용하실 수 있습니다.";
  box.appendChild(text);

  if (ACCESS.tistoryPostUrl) {
    // 이동은 사용자가 버튼을 클릭할 때만 일어난다(자동 리다이렉트 없음).
    const link = document.createElement("a");
    link.className = "upload-button access-lock-link";
    link.href = ACCESS.tistoryPostUrl;
    link.textContent = "블로그에서 이용하기 →";
    box.appendChild(link);
  } else {
    const pending = document.createElement("p");
    pending.className = "access-lock-pending";
    pending.textContent = "블로그 글 준비 중입니다.";
    box.appendChild(pending);
  }

  return box;
}

// 잠금 적용: 업로드존·건물종류 드롭다운·파일 input 숨김 + 그 자리에 안내 박스.
//   면책 footer 는 그대로 노출. postHeight/프로그레스 등 기존 로직은 불변.
function applyAccessLock() {
  const lockBox = buildAccessLockBox();
  if (dropZone && dropZone.parentNode) {
    dropZone.parentNode.insertBefore(lockBox, dropZone);
    dropZone.hidden = true;
    dropZone.setAttribute("aria-hidden", "true");
    dropZone.removeAttribute("tabindex");
  }
  const kindWrap = kindSelect ? kindSelect.closest(".kind-select") : null;
  if (kindWrap) {
    kindWrap.hidden = true;
    kindWrap.setAttribute("aria-hidden", "true");
  }
  if (fileInput) fileInput.disabled = true;
  postHeight(); // 잠금 UI 반영 후 높이 재전송(임베드 아니면 no-op)
}

// ---------- 자동 높이 통신 (Part 1) ----------
//   자식(iframe)→부모로 문서 높이 숫자만 postMessage 전송(민감정보 없음).
//   임베드가 아니면 즉시 반환 → 일반 접속엔 아무 영향 없음.
function postHeight() {
  if (!isEmbedded) return;
  const h = document.documentElement.scrollHeight;
  try {
    window.parent.postMessage({ type: "deungki:height", height: h }, "*");
  } catch (e) {
    /* 부모 접근 불가 시 조용히 무시(폴백: 부모가 min-height 유지) */
  }
}

// 디바운스된 높이 전송(~100ms) — 잦은 리사이즈/렌더 변화 대응.
function debounce(fn, wait) {
  let t = null;
  return function () {
    if (t) clearTimeout(t);
    t = setTimeout(fn, wait);
  };
}
const debouncedPostHeight = debounce(postHeight, 100);

// 드롭다운(건물 종류)을 바꿨을 때, 현재 렌더된 중학생 표제부 문장만 재렌더하는 콜백.
// showResult 마다 갱신된다(재파싱 없음). 기본 모드/파싱에는 영향 없음.
let easyRerender = null;

// [요약본 보기](쉽게 보기 요약 아래 버튼, render.js 가 발행하는 deungki:showSummary)
// 처리 콜백. 리스너는 1회만 등록하고 콜백만 showResult 마다 갱신(재업로드 중복 방지).
let showSummaryHandler = null;
document.addEventListener("deungki:showSummary", () => {
  if (showSummaryHandler) showSummaryHandler();
});

// ---------- 상태 메시지 헬퍼 ----------
function setStatus(message, kind = "") {
  statusEl.textContent = message || "";
  statusEl.className = "status-message" + (kind ? " is-" + kind : "");
}

// ---------- 추출 텍스트 길이 측정 (스캔본 판정용) ----------
//   이미 추출한 pages 에서 직접 글자 수를 센다(재추출 없음 — 1회추출 최적화).
function countTextLength(pages) {
  if (!Array.isArray(pages)) return 0;
  return pages.reduce(
    (n, p) =>
      n +
      (p && Array.isArray(p.items)
        ? p.items.reduce((m, it) => m + ((it && it.str) || "").trim().length, 0)
        : 0),
    0
  );
}

// ---------- PDF 여부 검사 ----------
function isPdfFile(file) {
  if (!file) return false;
  const byType = file.type === "application/pdf";
  const byExt = /\.pdf$/i.test(file.name || "");
  return byType || byExt;
}

// ---------- 후원 박스 (커피 사주기) ----------
//   SUPPORT.url 이 있을 때만 카드 생성(비어 있으면 null → 아무것도 렌더 안 함).
//   버튼은 새 탭 앵커일 뿐 — 외부 스크립트/위젯 로드 없음(외부통신 0 유지).
function buildSupportBox() {
  if (!SUPPORT.url) return null;

  const box = document.createElement("div");
  box.className = "support-box";
  box.setAttribute("aria-label", "후원 안내");

  const text = document.createElement("p");
  text.className = "support-text";
  text.textContent =
    "여러분의 커피한잔 응원이 무료운영과 기능 개선에 큰 힘이 됩니다.";
  box.appendChild(text);

  // 카카오페이 송금 링크는 모바일 전용 — PC 브라우저 접속은 카카오페이 서버가
  // 404로 거부함(실측 확인: PC UA 404 / iPhone·Android UA 200).
  // → 모바일 기기: 버튼(앱 직결)만 표시 / PC: 버튼 없이 QR(폰 카메라 스캔)만 표시.
  const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (isMobileDevice) {
    const link = document.createElement("a");
    link.className = "support-button";
    link.href = SUPPORT.url;
    link.target = "_blank";         // 티스토리 iframe 안 → 새 탭 필수
    link.rel = "noopener";

    // 커피잔 아이콘 — 인라인 SVG(머그컵 + 손잡이 + 김), currentColor. 장식용.
    const iconWrap = document.createElement("span");
    iconWrap.className = "support-icon";
    iconWrap.setAttribute("aria-hidden", "true");
    iconWrap.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round">' +
      '<rect x="3" y="10" width="12" height="9" rx="2"/>' +
      '<path d="M15 12h2a3 3 0 0 1 0 6h-2"/>' +
      '<path d="M6 7c0-1 .8-1.2.8-2"/>' +
      '<path d="M10 7c0-1 .8-1.2.8-2"/>' +
      "</svg>";
    link.appendChild(iconWrap);
    link.appendChild(document.createTextNode(SUPPORT.label));
    box.appendChild(link);
  } else {
    // PC 방문자용 QR(동봉 정적 SVG — 외부 QR API 미사용): 폰 카메라로 찍어 송금.
    const qrWrap = document.createElement("div");
    qrWrap.className = "support-qr";
    const qrImg = document.createElement("img");
    qrImg.src = "assets/kakaopay-qr.svg";
    qrImg.alt = "카카오페이 후원 QR 코드";
    qrImg.width = 132;
    qrImg.height = 132;
    qrWrap.appendChild(qrImg);
    const qrCap = document.createElement("p");
    qrCap.className = "support-qr-caption";
    qrCap.appendChild(
      document.createTextNode("휴대폰 카메라로 QR을 찍으면 카카오페이로 후원할 수 있어요")
    );
    qrCap.appendChild(document.createElement("br"));
    qrCap.appendChild(document.createTextNode("(100원부터 자유롭게)"));
    qrWrap.appendChild(qrCap);
    box.appendChild(qrWrap);
  }

  return box;
}

// ---------- 결과 UI 구성 (기본 모드 + 전환 UI + 중학생 모드) ----------
//   파싱 결과(data)를 보관해 두 모드가 같은 결과를 재사용한다(재파싱 X).
function showResult(data) {
  resultEl.innerHTML = "";

  // 기본 모드 그룹: 기본 렌더 + 하단 전환 안내박스/버튼
  const basicGroup = document.createElement("div");
  basicGroup.className = "mode-group mode-basic";
  // 접근성(M8): 모드 전환 후 포커스를 옮길 수 있도록 컨테이너를 포커스 가능하게.
  basicGroup.tabIndex = -1;

  const basicRender = document.createElement("div");
  renderBasic(data, basicRender);
  basicGroup.appendChild(basicRender);

  const switchBox = document.createElement("div");
  switchBox.className = "mode-switch";
  const switchText = document.createElement("p");
  switchText.className = "mode-switch-text";
  switchText.textContent = "더 쉽게 보기 · 중학생 버전"; // 간결 문구(사용자 확정 2026-07)
  const toEasyBtn = document.createElement("button");
  toEasyBtn.type = "button";
  toEasyBtn.className = "mode-btn mode-btn-easy";
  toEasyBtn.textContent = "쉽게 보기";
  switchBox.appendChild(switchText);
  switchBox.appendChild(toEasyBtn);
  basicGroup.appendChild(switchBox);

  // 중학생 모드 그룹: 기본으로 돌아가기 버튼 + 렌더 타깃(.easy-render)
  const easyGroup = document.createElement("div");
  easyGroup.className = "mode-group mode-easy";
  easyGroup.hidden = true;
  easyGroup.setAttribute("aria-hidden", "true");
  easyGroup.tabIndex = -1;

  const backBar = document.createElement("div");
  backBar.className = "mode-switch mode-switch-back";
  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "mode-btn mode-btn-basic";
  backBtn.textContent = "기본 해석으로 돌아가기";
  backBar.appendChild(backBtn);
  easyGroup.appendChild(backBar);

  const easyRender = document.createElement("div");
  easyRender.className = "easy-render";
  easyGroup.appendChild(easyRender);

  resultEl.appendChild(basicGroup);
  resultEl.appendChild(easyGroup);

  // 후원 박스: 결과(두 모드 그룹) 하단·면책 footer 위에 한 번만 append.
  //   showResult 진입 시 resultEl.innerHTML="" 로 비우므로 재업로드 중복 없음.
  //   SUPPORT.url 이 비어 있으면 buildSupportBox 가 null → 렌더 안 함(현재 기본).
  const supportBox = buildSupportBox();
  if (supportBox) resultEl.appendChild(supportBox);

  // 렌더 완료 → 임베드 높이 재조정(임베드 아니면 no-op).
  postHeight();

  // 중학생 모드 렌더: 드롭다운에서 고른 건물 종류(opts.propertyKind)를 전달.
  //   선택 안 함(value="")이면 빈 문자열 → render.js 가 기존 buildingType 분기 사용.
  function renderEasyWithKind() {
    renderEasy(data, easyRender, {
      propertyKind: kindSelect ? kindSelect.value : "",
    });
  }

  // 전환: 첫 클릭 때만 중학생 모드 렌더(재파싱 없이 보관 결과 재사용)
  let easyRendered = false;
  // 모드 전환 후 새 화면 '맨 위'부터 보이게(사용자 확정 — 스크롤 잔존 방지).
  //   rAF 는 백그라운드 탭에서 멈추므로 setTimeout 만 사용.
  function scrollToGroupTop(group) {
    setTimeout(() => {
      if (group && typeof group.scrollIntoView === "function") {
        group.scrollIntoView({ behavior: "auto", block: "start" });
      }
    }, 120);
  }

  toEasyBtn.addEventListener("click", () => {
    if (!easyRendered) {
      renderEasyWithKind();
      easyRendered = true;
    }
    setMode("easy", data, basicGroup, easyGroup);
    // 전환 대상 컨테이너로 포커스 이동(읽기 위치 재설정).
    if (typeof easyGroup.focus === "function") {
      try { easyGroup.focus({ preventScroll: true }); } catch (e) { easyGroup.focus(); }
    }
    scrollToGroupTop(easyGroup); // 쉽게 보기 맨 위부터
    postHeight(); // 모드 전환으로 높이 급변 → 임베드 재조정
  });

  // 드롭다운 변경 시: 이미 중학생 모드가 렌더돼 있으면 표제부 문장만 재렌더(재파싱 X).
  //   아직 안 펼쳤으면 다음에 펼칠 때 최신 선택값으로 렌더되므로 별도 작업 불필요.
  easyRerender = () => {
    if (easyRendered) {
      renderEasyWithKind();
      postHeight(); // 표제부 문장 재렌더로 높이 변화 가능
    }
  };
  backBtn.addEventListener("click", () => {
    setMode("basic", data, basicGroup, easyGroup);
    if (typeof basicGroup.focus === "function") {
      try { basicGroup.focus({ preventScroll: true }); } catch (e) { basicGroup.focus(); }
    }
    scrollToGroupTop(basicGroup); // 기본 해석 맨 위부터
    postHeight(); // 모드 전환으로 높이 급변 → 임베드 재조정
  });

  // [요약본 보기] → 기본 모드로 전환(backBtn 과 동일 경로) 후 '한눈에 보기'(.summary)로 스크롤.
  //   콜백만 갱신(리스너는 모듈 상단에서 1회 등록) — 기존 전환 버튼/시그니처 불변(가산형).
  showSummaryHandler = () => {
    setMode("basic", data, basicGroup, easyGroup);
    if (typeof basicGroup.focus === "function") {
      try {
        basicGroup.focus({ preventScroll: true }); // 포커스 이동이 스크롤을 가로채지 않게
      } catch (e) {
        basicGroup.focus();
      }
    }
    // 전환 직후에는 기본 뷰 레이아웃이 확정 전이라 스크롤 목표 좌표가 어긋난다.
    // 다음 프레임 + 소지연 후 스크롤(레이스 방지).
    // rAF 는 백그라운드 탭에서 정지되므로 쓰지 않는다 — setTimeout 만으로 확정 실행.
    setTimeout(() => {
      const summaryEl = basicGroup.querySelector(".summary");
      if (summaryEl && typeof summaryEl.scrollIntoView === "function") {
        summaryEl.scrollIntoView({ behavior: "auto", block: "start" });
      }
    }, 120);
    postHeight(); // 모드 전환으로 높이 급변 → 임베드 재조정
  };
}

// ---------- 지연 헬퍼 (Part 3: 의도적 체감지연 — 로컬 타이머만) ----------
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 프로그레스바 표시/완료/숨김 (Part 3) ----------
//   채움은 CSS 트랜지션(0→100%, 2s)으로만 진행 — 외부 통신 없음.
function showProgress() {
  if (!progressEl) return;
  progressEl.hidden = false;
  progressEl.classList.remove("is-filling"); // 재업로드 시 0%로 초기화
  progressEl.setAttribute("aria-valuenow", "0");
  // 리플로우 강제 후 채움 시작 → 0% 상태를 확정한 뒤 트랜지션 발동.
  void progressEl.offsetWidth;
  progressEl.classList.add("is-filling");
  postHeight();
}
function completeProgress() {
  if (!progressEl) return;
  progressEl.setAttribute("aria-valuenow", "100");
}
function hideProgress() {
  if (!progressEl) return;
  progressEl.hidden = true;
  progressEl.classList.remove("is-filling");
  progressEl.setAttribute("aria-valuenow", "0");
  postHeight();
}

// ---------- 파싱 실행부 함수화 (Part 3) ----------
//   기존 로직 그대로: PDF 텍스트 1회 추출 → 글자수(스캔본 판정) → parseRegistry.
//   스캔본이면 { scan:true }, 정상이면 { scan:false, data } 반환.
async function doParse(arrayBuffer) {
  // PDF 텍스트를 한 번만 추출하고(1회추출), 글자수 측정·파싱에 함께 재사용한다.
  const pages = await extractPages(arrayBuffer);

  // (1) 스캔본(이미지) 판정: PDF에서 뽑아낸 글자 수가 거의 0이면
  //     텍스트가 들어있지 않은 이미지 PDF로 보고 안내.
  const textLength = countTextLength(pages);
  if (textLength < SCAN_TEXT_MIN) {
    return { scan: true };
  }

  // 이미 추출한 pages 를 전달 → parseRegistry 내부 재추출 없음(가산형 다형 입력).
  const data = await parseRegistry(pages);
  return { scan: false, data };
}

// ---------- 메인 처리 ----------
async function handleFile(file) {
  if (!accessUnlocked) return; // 도메인 잠금: 이벤트가 발화해도 무시
  if (!file) return;

  if (!isPdfFile(file)) {
    setStatus(
      "PDF 파일만 분석할 수 있어요. 등기부등본 PDF 파일을 올려 주세요.",
      "error"
    );
    return;
  }

  // 파일 선택 즉시: 결과영역 비움 + 진행표시 시작(약 2초).
  resultEl.innerHTML = "";
  setStatus("등기부를 읽는 중…", "busy");
  showProgress();

  try {
    const arrayBuffer = await file.arrayBuffer();

    // 실제 파싱은 백그라운드로 진행하되, 결과 표시는 최소 ~2초 뒤.
    //   Promise.all: 파싱·지연 둘 다 끝나야 진행. 파싱이 2초보다 오래 걸리면
    //   실제 파싱 시간대로 늘어난다(의도적 체감지연 — 로컬 연산만).
    const [result] = await Promise.all([doParse(arrayBuffer), delay(2000)]);
    completeProgress();

    // 스캔본(이미지 PDF): 진행표시 숨기고 안내.
    if (result.scan) {
      hideProgress();
      setStatus(
        "이미지로 스캔된 PDF는 글자를 읽을 수 없어요. 인터넷등기소에서 '열람용'으로 받은(텍스트가 들어있는) PDF를 올려주세요.",
        "error"
      );
      return;
    }

    const data = result.data;

    // 콘솔 덤프 (구조 확인용 — 화면에는 렌더 결과만)
    console.log("[등기부 해석기] 파싱 결과:", data);

    const property = (data && data.property) || {};
    const hasKeyField = Boolean(property.uid || property.address);
    const hasTimeline =
      data && Array.isArray(data.timeline) && data.timeline.length > 0;

    const visibleCount = hasTimeline
      ? data.timeline.filter((it) => it && it.display !== false).length
      : 0;

    // (2) 등기부 아닌 PDF: 표제부 핵심필드(uid/address)도 없고 등기 항목도 0건.
    if (!hasTimeline && !hasKeyField) {
      hideProgress();
      setStatus(
        "이 PDF에서 등기 내용을 찾지 못했어요. 인터넷등기소에서 받은 등기사항전부증명서 PDF가 맞는지 확인해 주세요.",
        "error"
      );
      return;
    }

    // (3) 표제부는 읽혔지만 등기 항목이 0건인 경우 — 표제부만이라도 보여주고 안내.
    if (!hasTimeline) {
      hideProgress();
      renderBasic(data, resultEl);
      setStatus(
        "표제부는 읽었지만 갑구·을구에서 등기 항목을 찾지 못했어요. 등기사항전부증명서 전체가 담긴 PDF인지 확인해 주세요.",
        "error"
      );
      return;
    }

    hideProgress();
    showResult(data);
    setStatus(`해석 완료: 표시 항목 ${visibleCount}건.`, "");
  } catch (err) {
    // 기술 스택을 노출하지 않는 사용자 친화 메시지로만 안내.
    hideProgress();
    console.error("[등기부 해석기] PDF 처리 오류:", err);
    setStatus(
      "이 PDF를 읽는 중 문제가 생겼어요. 인터넷등기소에서 받은 등기사항전부증명서 PDF가 맞는지 확인해 주세요.",
      "error"
    );
  }
}

// ---------- 건물 종류 드롭다운 ----------
//   리스너는 1회만 등록(showResult 마다 쌓이지 않게). 실제 재렌더는 easyRerender 가 담당.
if (kindSelect) {
  kindSelect.addEventListener("change", () => {
    if (easyRerender) easyRerender();
  });
}

// ---------- 파일 선택 ----------
fileInput.addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  handleFile(file);
  // 같은 파일 다시 선택 가능하도록 초기화
  fileInput.value = "";
});

// ---------- 드래그 & 드롭 ----------
["dragenter", "dragover"].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add("is-dragover");
  });
});

["dragleave", "dragend"].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove("is-dragover");
  });
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove("is-dragover");
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  handleFile(file);
});

// ---------- 드롭존 클릭/키보드 → 파일 선택 ----------
dropZone.addEventListener("click", (e) => {
  if (!accessUnlocked) return; // 도메인 잠금: 파일 선택창 열지 않음
  // '파일 선택' 라벨 클릭은 기본 동작(input 열기)에 맡김 — 중복 방지
  if (e.target.closest(".upload-button")) return;
  fileInput.click();
});

dropZone.addEventListener("keydown", (e) => {
  if (!accessUnlocked) return; // 도메인 잠금: 파일 선택창 열지 않음
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});

// ---------- 도메인 잠금 적용 ----------
//   허용이 아니면 업로드 UI를 잠금 안내 박스로 대체(기능 비활성은 위 가드가 담당).
if (!accessUnlocked) {
  applyAccessLock();
}

// 초기 상태
setStatus("");

// ---------- 임베드 높이 지속 감시 (Part 1) ----------
//   본문 높이가 바뀔 때마다(렌더/모드전환/폰트로딩 등) 부모에 높이 재전송.
//   임베드가 아니면 postHeight 자체가 no-op → 일반 접속엔 아무 영향 없음.
if (isEmbedded) {
  window.addEventListener("resize", debouncedPostHeight);
  if (typeof ResizeObserver === "function" && document.body) {
    const ro = new ResizeObserver(debouncedPostHeight);
    ro.observe(document.body);
  }
  // 초기 로드 직후 1회 전송(초기 높이 확정).
  postHeight();
}
