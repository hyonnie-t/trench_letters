/* 주제40 「참호에서 온 편지」 웹앱 — 로직(app.js). 구조는 vienna_diary를 따른다. */
const CONFIG = {
  SHEET_WEBAPP_URL: "https://script.google.com/macros/s/AKfycbyXSjCfWY_HiZFqW_OBR-FQDoIfF1z_STqyKWUI31MacHeY3u7hbirFSFDvW-5yuUHaJQ/exec",
  /* 포털 커리큘럼 관리에 이 id 하나로 활동을 등록한다 */
  GAME_NAME: "40차시_참호에서온편지_1차대전",
  LETTER_MIN: 100,
  RUB_NEED: 90 // 먹줄 한 줄을 지우는 데 필요한 문지른 거리(px)
};

const S = {
  sid: "", name: "", grade: 0, ban: 0, preview: false,
  chosen: "", checks: [false, false],
  sending: false, submitted: false, padletUrl: ""
};

const SCREENS = { s0: "", s1: "pick", s2: "read", s3: "sum", s4: "write", s5: "wrap" };
const STAGES = ["pick", "read", "sum", "write", "wrap"];

const $ = id => document.getElementById(id);
const letter = () => LETTERS.find(l => l.id === S.chosen);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function show(key) {
  Object.keys(SCREENS).forEach(k => { $(k).hidden = (k !== key); });
  const stage = SCREENS[key];
  $("steps").hidden = !stage;
  const cur = STAGES.indexOf(stage);
  document.querySelectorAll("#steps li").forEach(li => {
    const i = STAGES.indexOf(li.dataset.k);
    li.className = i === cur ? "on" : (i < cur ? "done" : "");
  });
  window.scrollTo(0, 0);
}

function parseSid(sid) {
  if (!/^\d{5}$/.test(sid)) return null;
  return { grade: Number(sid[0]), ban: Number(sid.slice(1, 3)), num: Number(sid.slice(3)) };
}

/* ── 고른 편지 기억(학번별, 미리보기는 저장 안 함). 글은 draft_guard가 맡는다. ── */
function storeKey() { return "trench_letters:" + CONFIG.GAME_NAME + ":" + S.sid; }
function loadPick() {
  if (S.preview) return;
  try {
    const v = JSON.parse(localStorage.getItem(storeKey()) || "null");
    if (v && LETTERS.some(l => l.id === v.chosen)) S.chosen = v.chosen;
    if (v && Array.isArray(v.checks)) S.checks = [!!v.checks[0], !!v.checks[1]];
  } catch (e) { /* 저장소가 막히면 메모리만 */ }
}
function savePick() {
  if (S.preview) return;
  try { localStorage.setItem(storeKey(), JSON.stringify({ chosen: S.chosen, checks: S.checks, ts: Date.now() })); } catch (e) { /* 메모리만 */ }
}

/* ── 시트 전송 (vienna_diary와 같은 재시도 방식, 원본 history26 snippets/submit_retry.js) ── */
async function postWithRetry(url, payload) {
  const body = Object.assign({}, payload);
  const canRetry = !body.action;
  if (canRetry && !body.clientId) body.clientId = newClientId();
  let lastErr = null;
  for (let i = 0; i < (canRetry ? 3 : 1); i++) {
    if (i) await new Promise(r => setTimeout(r, 1000 + submitRand() * 2000));
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 30000) : null;
    try {
      const res = await fetch(url, { method: "POST", body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (e) { /* 구글 오류 화면 */ }
      if (res.ok && json && typeof json === "object") return json;
      lastErr = new Error("서버가 붐벼 저장하지 못했어. 잠시 뒤 다시 눌러 줘.");
    } catch (e) {
      lastErr = new Error("인터넷 연결이 불안정해 저장하지 못했어. 잠시 뒤 다시 눌러 줘.");
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastErr;
}
function newClientId() {
  try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* 아래로 */ }
  let s = "c" + Date.now().toString(36);
  for (let i = 0; i < 3; i++) s += Math.floor(submitRand() * 4294967296).toString(36);
  return s;
}
function submitRand() {
  try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; } catch (e) { return (Date.now() % 1000) / 1000; }
}
async function postToSheet(payload) {
  if (S.preview) return { result: "success", preview: true };
  const json = await postWithRetry(CONFIG.SHEET_WEBAPP_URL, payload);
  if (json.result !== "success") {
    const err = new Error(json.message || "저장 실패");
    err.locked = !!json.locked;
    throw err;
  }
  return json;
}

/* 패들렛 링크는 백엔드 학년정보(포트폴리오)에서 가져온다 */
function ensureUrlScheme(u) {
  u = String(u || "").trim();
  return u && !/^https?:\/\//i.test(u) ? "https://" + u : u;
}
async function loadPadletUrl(grade, ban) {
  try {
    const res = await fetch(CONFIG.SHEET_WEBAPP_URL + "?mode=curriculum");
    const json = await res.json();
    const pf = json && json.grades && json.grades[String(grade)] && json.grades[String(grade)].portfolio;
    if (!pf) return "";
    return ensureUrlScheme(pf.urlByBan ? (pf.urlByBan[ban] || pf.urlByBan[String(ban)] || "") : (pf.url || ""));
  } catch (e) { return ""; }
}

/* ── 시작 ── */
function startApp() {
  const sid = $("sid").value.trim();
  const name = $("sname").value.trim();
  const p = parseSid(sid);
  if (!p) { $("startErr").textContent = "학번은 숫자 5자리로 써 줘. (예: 20512)"; return; }
  if (!name) { $("startErr").textContent = "이름을 써 줘."; return; }
  $("startErr").textContent = "";
  S.sid = sid; S.name = name; S.grade = p.grade; S.ban = p.ban;
  FocusGuard.start({ key: CONFIG.GAME_NAME + ":" + sid });
  if (window.DraftGuard) DraftGuard.start({ key: CONFIG.GAME_NAME, sid: sid });
  loadPadletUrl(p.grade, p.ban).then(u => { S.padletUrl = u; renderPadlet(); });
  loadPick();
  renderEnvelopes();
  show("s1");
}

/* ── 1. 봉투 ── */
function renderEnvelopes() {
  const box = $("envList");
  box.innerHTML = "";
  LETTERS.forEach(l => {
    const b = el("button", "env");
    b.type = "button";
    b.setAttribute("aria-label", l.who + " 편지 열기");
    const img = el("img", "env-thumb"); img.src = l.img; img.alt = ""; img.loading = "lazy";
    b.appendChild(img);
    b.appendChild(el("span", "env-stamp", "✉"));
    b.appendChild(el("span", "env-who", l.who));
    b.appendChild(el("span", "env-from", l.from));
    b.addEventListener("click", () => openEnvelope(l.id, b));
    box.appendChild(b);
  });
}

function openEnvelope(id, btn) {
  if (S.submitted && S.chosen && S.chosen !== id) { $("s1Err").textContent = "이미 제출했어. 다른 편지로 바꿀 수 없어."; return; }
  if (S.chosen && S.chosen !== id && hasWriting()) {
    $("s1Err").textContent = "다른 편지로 바꾸면 쓰던 정리와 편지가 지워져. 바꾸려면 한 번 더 눌러.";
    if (btn.dataset.confirm !== "1") {
      document.querySelectorAll(".env").forEach(x => { x.dataset.confirm = ""; });
      btn.dataset.confirm = "1"; return;
    }
    clearWriting();
  }
  $("s1Err").textContent = "";
  S.chosen = id; savePick();
  btn.classList.add("opening");
  setTimeout(() => { btn.classList.remove("opening"); btn.dataset.confirm = ""; renderLetter(); show("s2"); }, 850);
}

function hasWriting() {
  return SUMS.some(s => $(s.id).value.trim()) || $("letterOut").value.trim();
}
function clearWriting() {
  SUMS.map(s => s.id).concat("letterOut").forEach(id => { $(id).value = ""; $(id).dispatchEvent(new Event("input", { bubbles: true })); });
  S.checks = [false, false];
  if (window.DraftGuard) DraftGuard.clear();
}

/* ── 2. 편지 읽기 + 검열 먹줄 문지르기 ── */
function renderLetter() {
  const l = letter();
  $("s2Img").src = l.img; $("s2Img").alt = l.alt;
  $("s2Who").textContent = l.from;
  $("s2Date").textContent = l.date;
  const body = $("s2Body");
  body.innerHTML = "";
  l.body.forEach(par => {
    const p = el("p");
    par.split(/(\[\[.+?\]\])/).forEach(chunk => {
      const m = chunk.match(/^\[\[(.+)\]\]$/);
      if (!m) { if (chunk) p.appendChild(document.createTextNode(chunk)); return; }
      p.appendChild(censorEl(m[1]));
    });
    body.appendChild(p);
  });
  const ul = $("s2MemoList");
  ul.innerHTML = "";
  l.memo.forEach(t => ul.appendChild(el("li", "", t)));
  $("s2Page").textContent = "교과서 " + l.page;
  $("s2Memo").open = false;
  updateCensorNote();
}

function censorEl(text) {
  const s = el("span", "censor");
  s.appendChild(document.createTextNode(text));
  s.tabIndex = 0;
  s.setAttribute("role", "button");
  s.setAttribute("aria-label", "검열로 지워진 부분. 문지르거나 눌러서 보기");
  let rub = 0, last = null;
  const reveal = () => {
    if (s.classList.contains("done")) return;
    s.classList.add("done");
    s.removeAttribute("role"); s.removeAttribute("aria-label"); s.tabIndex = -1;
    updateCensorNote();
  };
  const fade = () => { s.style.setProperty("--a", String(Math.max(0, 1 - rub / CONFIG.RUB_NEED).toFixed(2))); };
  s.addEventListener("pointerdown", e => {
    last = { x: e.clientX, y: e.clientY };
    try { s.setPointerCapture(e.pointerId); } catch (er) { /* 무시 */ }
    rub += 15; fade(); // 톡톡 눌러도 조금씩 지워진다
    if (rub >= CONFIG.RUB_NEED) reveal();
  });
  s.addEventListener("pointermove", e => {
    if (!last || s.classList.contains("done")) return;
    rub += Math.abs(e.clientX - last.x) + Math.abs(e.clientY - last.y);
    last = { x: e.clientX, y: e.clientY };
    fade();
    if (rub >= CONFIG.RUB_NEED) reveal();
  });
  const stop = () => { last = null; };
  s.addEventListener("pointerup", stop);
  s.addEventListener("pointercancel", stop);
  s.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); reveal(); } });
  return s;
}

function censorLeft() { return $("s2Body").querySelectorAll(".censor:not(.done)").length; }
function updateCensorNote() {
  const n = censorLeft();
  $("censorNote").textContent = n
    ? "✍️ 검은 먹줄은 군대가 지운 곳이야. 손가락으로 문질러서 지워 봐. (남은 먹줄 " + n + "개)"
    : "먹줄을 다 지웠어. 군대는 왜 이 부분을 지웠을까? 아래 역사 메모도 읽어 봐.";
  if (!n) $("s2Err").textContent = "";
}

/* ── 3. 정리 ── */
function buildSums() {
  const box = $("sumBox");
  SUMS.forEach(s => {
    const d = el("div", "sum");
    const lab = el("label", "", s.label); lab.htmlFor = s.id;
    d.appendChild(lab);
    d.appendChild(el("p", "guide", s.guide));
    const ta = el("textarea"); ta.id = s.id; ta.rows = 2;
    const cnt = el("div", "count");
    const upd = () => { cnt.textContent = ta.value.trim().length + "자"; $("s3Err").textContent = ""; };
    ta.addEventListener("input", upd); upd();
    d.appendChild(ta); d.appendChild(cnt);
    box.appendChild(d);
  });
}
const squash = t => String(t).replace(/[\s.,'"‘’“”«»()?!]/g, "");
function checkSums() {
  for (const s of SUMS) {
    const v = $(s.id).value.trim();
    if (v.length < s.min) return s.label.slice(0, 1) + " 칸을 조금 더 써 줘.";
    if (squash(v) === squash(s.guide)) return s.label.slice(0, 1) + " 칸에 내 글을 써 줘.";
  }
  return "";
}

/* ── 4. 1919년 편지 ── */
function foundTerms(text) {
  const t = String(text).replace(/\s+/g, " ");
  const tight = t.replace(/\s/g, "");
  return TERMS.filter(term => term.match.some(m => t.includes(m) || tight.includes(m.replace(/\s/g, ""))));
}
function renderChecks() {
  const found = foundTerms($("letterOut").value).map(t => t.name);
  const chips = $("termChips"); chips.innerHTML = "";
  TERMS.forEach(t => chips.appendChild(el("span", "chip" + (found.indexOf(t.name) >= 0 ? " on" : ""), t.name)));
  $("ckTerms").querySelector(".ck").classList.toggle("on", found.length >= 2);
  document.querySelectorAll(".ck.manual").forEach((c, i) => {
    c.classList.toggle("on", S.checks[i]);
    c.setAttribute("aria-checked", S.checks[i] ? "true" : "false");
  });
  $("letterCount").textContent = $("letterOut").value.trim().length + "자 / " + CONFIG.LETTER_MIN + "자 이상";
}
function checkLetter() {
  const v = $("letterOut").value.trim();
  if (v.length < CONFIG.LETTER_MIN) return "편지를 " + CONFIG.LETTER_MIN + "자 넘게 써 줘. (지금 " + v.length + "자)";
  if (foundTerms(v).length < 2) return "교과서 용어를 2개 이상 넣어 줘. (위 목록에서 골라)";
  if (!S.checks[0] || !S.checks[1]) return "«꼭 넣을 것»을 다 넣었는지 확인하고 네모를 눌러 줘.";
  const bk = squash("전쟁이 끝나고 승전국들은 파리 강화 회의를 열었다");
  if (squash(v).includes(bk.slice(0, 16))) return "교과서 문장을 그대로 옮겼어. 내 말로 바꿔 써 줘.";
  return "";
}

/* ── 5. 제출 ── */
function sumText() { return SUMS.map(s => s.label + ": " + $(s.id).value.trim()).join("\n"); }
function buildOutText() {
  const l = letter();
  return [
    "[참호에서 온 편지] " + S.sid + " " + S.name,
    "내가 맡은 편지: " + l.who,
    "",
    sumText(),
    "",
    "[1919년, 보내지 못한 편지]",
    $("letterOut").value.trim()
  ].join("\n");
}
function renderFinal() {
  const l = letter();
  const box = $("final"); box.innerHTML = "";
  box.appendChild(el("h3", "", "내가 맡은 편지: " + l.who));
  SUMS.forEach(s => { box.appendChild(el("h3", "", s.label)); box.appendChild(el("p", "", $(s.id).value.trim())); });
  box.appendChild(el("h3", "", "1919년, 보내지 못한 편지"));
  box.appendChild(el("p", "hand", $("letterOut").value.trim()));
  $("submitBtn").disabled = S.submitted;
  $("submitBtn").textContent = S.submitted ? "제출 완료" : "제출";
  renderPadlet();
}
function renderPadlet() {
  const a = $("padletBtn");
  if (S.padletUrl) { a.href = S.padletUrl; a.hidden = false; $("padletMsg").textContent = ""; }
  else { a.hidden = true; $("padletMsg").textContent = "패들렛 링크는 선생님이 알려 준 곳을 써 줘."; }
}
async function submitAll() {
  if (S.sending || S.submitted) return;
  const err = checkSums() || checkLetter();
  if (err) { $("s5Err").textContent = err; return; }
  $("s5Err").textContent = "";
  S.sending = true; $("submitBtn").disabled = true; $("submitBtn").textContent = "보내는 중…";
  const l = letter();
  const payload = {
    studentId: S.sid, studentName: S.name, gameName: CONFIG.GAME_NAME,
    choiceSummary: l.who, diffSummary: "",
    reflection: sumText() + "\n\n[1919년 편지]\n" + $("letterOut").value.trim(),
    choicesJson: JSON.stringify({
      sid: S.sid, name: S.name, ban: S.ban, letterId: l.id,
      sums: SUMS.reduce((o, s) => { o[s.id] = $(s.id).value.trim(); return o; }, {}),
      letter: $("letterOut").value.trim(),
      terms: foundTerms($("letterOut").value).map(t => t.name),
      ts: new Date().toISOString()
    })
  };
  Object.assign(payload, FocusGuard.payload());
  try {
    await postToSheet(payload);
  } catch (e) {
    $("s5Err").textContent = e.locked ? e.message : "저장이 안 됐어. 인터넷을 확인하고 다시 눌러 줘.";
    S.sending = false; $("submitBtn").disabled = false; $("submitBtn").textContent = "제출";
    return;
  }
  S.sending = false; S.submitted = true;
  if (window.DraftGuard) DraftGuard.clear();
  $("submitBtn").textContent = "제출 완료";
  $("outMsg").textContent = S.preview ? "미리보기라 저장하지 않았어." : "제출했어! 이제 글 복사를 눌러 패들렛에 올려 줘.";
}
async function copyOut() {
  const text = buildOutText();
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const ta = el("textarea");
    ta.value = text; ta.setAttribute("data-no-draft", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
  $("outMsg").textContent = S.submitted ? "복사했어. 패들렛에 붙여넣기 해." : "복사했어. 제출 버튼도 꼭 눌러 줘!";
}

/* ── 화면 이동 ── */
function goSum() {
  const n = censorLeft();
  if (n) { $("s2Err").textContent = "먹줄이 " + n + "개 남았어. 다 문질러서 읽어 봐."; return; }
  $("s3Who").textContent = letter().who;
  show("s3");
}
function goWrite() {
  const err = checkSums();
  if (err) { $("s3Err").textContent = err; return; }
  $("s4Who").textContent = letter().who;
  renderChecks();
  show("s4");
}
function goWrap() {
  const err = checkLetter();
  if (err) { $("s4Err").textContent = err; return; }
  renderFinal(); show("s5");
}

/* ── 부팅 ── */
function init() {
  const q = new URLSearchParams(location.search);
  S.preview = q.get("preview") === "1";
  let sid = (q.get("sid") || "").trim(), name = (q.get("name") || "").trim();
  if (S.preview) {
    $("previewBar").hidden = false;
    if (!sid) sid = "20599";
    if (!name) name = "미리보기";
  }
  $("sid").value = sid; $("sname").value = name;
  buildSums();
  document.querySelectorAll(".ck.manual").forEach((c, i) => {
    c.setAttribute("role", "checkbox"); c.tabIndex = 0;
    const tog = () => { S.checks[i] = !S.checks[i]; savePick(); renderChecks(); $("s4Err").textContent = ""; };
    c.parentElement.addEventListener("click", tog);
    c.parentElement.style.cursor = "pointer";
    c.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tog(); } });
  });
  $("letterOut").addEventListener("input", () => { renderChecks(); $("s4Err").textContent = ""; });
  $("startBtn").addEventListener("click", startApp);
  $("s2Back").addEventListener("click", () => { renderEnvelopes(); show("s1"); });
  $("s2Next").addEventListener("click", goSum);
  $("s3Back").addEventListener("click", () => show("s2"));
  $("s3Next").addEventListener("click", goWrite);
  $("s4Back").addEventListener("click", () => show("s3"));
  $("s4Next").addEventListener("click", goWrap);
  $("s5Back").addEventListener("click", () => { renderChecks(); show("s4"); });
  $("submitBtn").addEventListener("click", submitAll);
  $("copyBtn").addEventListener("click", copyOut);
}

init();
