// =====================================================
//  MUSIC TRIVIA — BRIGHT MULTIPLE-CHOICE (Autoplay)
//  This version matches your current HTML:
//  - Question page:   #question + #answers (4 dancing cards)
//  - Answer page:     #answerTitle + #answerFact (two cards)
//  - Top-right timer: #timer (only; no circular timer on pages)
//  - Loads questions.json ({ questions: [{ q, choices[4], correctIndex, fact? }] })
// =====================================================

(() => {
  "use strict";

  // ---------- CONFIG ----------
  const CONFIG = {
    qSeconds: 5,
    aSeconds: 5,
    loop: true,
    vanta: { color: 0xec4899, shininess: 50, waveHeight: 18, waveSpeed: 0.9, zoom: 0.85 }
  };

  // ---------- UTIL ----------
  const $ = (id) => document.getElementById(id);

  function shuffleInPlace(arr){
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  // Slow down/obfuscate question text in “hard mode” (off by default here)
  const hardMode = false;
  function harden(text){
    if(!hardMode) return text;
    const generic = Math.random()<0.5 ? "this song" : "this track";
    return text.replace(/'[^']*'/g, generic).replace(/“[^”]*”/g, generic).replace(/\s{2,}/g,' ').replace(/\s\?/g,'?');
  }

  // ---------- DOM refs (exactly your ids) ----------
  let qPage, aPage, questionEl, answersWrap, answerTitle, answerFact, overlay, startBtn, topTimer;

  function bindDOM(){
    qPage       = $("qPage")   || $("pageQ");
    aPage       = $("aPage")   || $("pageA");
    questionEl  = $("question");
    answersWrap = $("answers");
  answerTitle = $("answerTitle");
  // Remove answerFact, add answerImagePanel
  answerImagePanel = $("answerImagePanel");
    overlay     = $("overlay");
    startBtn    = $("startBtn");
    topTimer    = $("timer");
  }

  // ---------- VANTA  ----------
  function ensureVantaContainer(){
    let v = document.getElementById("vanta-bg");
    if(!v){ v = document.createElement("div"); v.id="vanta-bg"; v.setAttribute("aria-hidden","true"); document.body.prepend(v); }
  }
  function loadScriptOnce(id, src){
    return new Promise((resolve, reject) => {
      if(document.getElementById(id)){ resolve(); return; }
      const s=document.createElement("script"); s.id=id; s.src=src; s.async=true; s.onload=resolve; s.onerror=()=>reject(new Error("Failed "+src));
      document.head.appendChild(s);
    });
  }
  async function initVanta(){
    try{
      ensureVantaContainer();
      await loadScriptOnce("threejs-cdn","https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.min.js");
      await loadScriptOnce("vanta-waves-cdn","https://cdn.jsdelivr.net/npm/vanta@latest/dist/vanta.waves.min.js");
      if(window.VANTA && !window.__vantaInstance){
        window.__vantaInstance = VANTA.WAVES({
          el:"#vanta-bg",
          mouseControls:false, touchControls:false, gyroControls:false,
          color:CONFIG.vanta.color, shininess:CONFIG.vanta.shininess,
          waveHeight:CONFIG.vanta.waveHeight, waveSpeed:CONFIG.vanta.waveSpeed, zoom:CONFIG.vanta.zoom
        });
      }
    }catch(e){ console.warn("Vanta init failed:", e); }
  }

  // ---------- DATA ----------
  let QUESTIONS = [
    // Built-ins used if questions.json can’t be fetched
    {
      q: "Who sang “Girls Just Want to Have Fun”?",
      options: ["Belinda Carlisle","Madonna","Debbie Gibson","Cyndi Lauper"],
      correct: 3,
      fact: "1983 pop anthem that became a feminist sing-along."
    },
    {
      q: "Who sang “Like a Prayer”?",
      options: ["Cyndi Lauper","Paula Abdul","Madonna","Whitney Houston"],
      correct: 2,
      fact: "1989 single blending pop with gospel influences."
    }
  ];

  // Accepts either: {questions:[…]} or just […]
  // Each item may be { q, choices, correctIndex, fact } or { q, options, correct, fact }
  async function loadExternalQuestions(){
    const loadStatus = $("loadStatus");
    try{
      const url = new URL("questions.json", window.location.href);
      url.searchParams.set("ts", Date.now()); // cache-bust
      const res = await fetch(url.toString(), { cache: "no-store" });
      if(!res.ok) throw new Error("HTTP "+res.status);
      const json = await res.json();

      const arr = Array.isArray(json) ? json
                : (json && Array.isArray(json.questions) ? json.questions : []);
      if(!arr.length) throw new Error("questions.json is empty or wrong shape");

      const mapped = arr.map(it => {
        const opts = it.options || it.choices;
        const corr = Number.isInteger(it.correct) ? it.correct : it.correctIndex;
        return {
          q: String(it.q || "").trim(),
          options: Array.isArray(opts) ? opts.map(String) : [],
          correct: Number.isInteger(corr) ? corr : -1,
          fact: it.fact ? String(it.fact) : ""
        };
      }).filter(it => it.q && it.options.length === 4 && it.correct >= 0 && it.correct < 4);

      if(!mapped.length) throw new Error("No valid questions after mapping");

      QUESTIONS = mapped;
      if(loadStatus) loadStatus.textContent = `Loaded ${QUESTIONS.length} questions.`;
      if(startBtn) startBtn.disabled = false;
    }catch(err){
      console.warn("Using built-in questions; couldn't load questions.json:", err);
      if(loadStatus) loadStatus.textContent = `Using built-in ${QUESTIONS.length} questions (couldn’t fetch questions.json).`;
      if(startBtn) startBtn.disabled = false;
    }
  }

  // ---------- AUTOFIT HELPERS (SINGLE SOURCE OF TRUTH) ----------
  function fitSoon(kind){
    const run = () => (kind === "a" ? fitAnswerAuto() : fitQuestionAuto());
    run();
    requestAnimationFrame(run);
    document.fonts?.ready?.then(run);
  }

  function fitQuestionAuto(){
    const root = document.documentElement;
    const page = document.getElementById('qPage') || document.getElementById('pageQ');
    if (!page) return;

    // start generous each time
    root.style.setProperty('--qScale','1');
    root.style.setProperty('--optScale','1.15');                     // answers a touch bigger by default
    root.style.setProperty('--qaSpace','clamp(20px, 3vw, 32px)');
    root.style.setProperty('--answersGap','clamp(24px, 3.6vw, 40px)');
    root.style.setProperty('--cardPadY','1.4rem');
    root.style.setProperty('--cardPadX','1.5rem');

    let steps = 0;
    while (page.getBoundingClientRect().bottom > (window.innerHeight - 8) && steps < 24) {
      const cs = getComputedStyle(root);
      const q  = parseFloat(cs.getPropertyValue('--qScale'))  || 1;
      const a  = parseFloat(cs.getPropertyValue('--optScale')) || 1;

      // shrink the question fastest
      if (q > 0.50) root.style.setProperty('--qScale',  (q - 0.05).toFixed(3));
      if (a > 0.70) root.style.setProperty('--optScale', (a - 0.04).toFixed(3));

      // progressively tighten gaps/padding if still overflowing
      if (steps >= 6)  root.style.setProperty('--qaSpace','clamp(12px, 2vw, 20px)');
      if (steps >= 8)  root.style.setProperty('--answersGap','clamp(16px, 2.2vw, 24px)');
      if (steps >= 10) root.style.setProperty('--cardPadY','0.95rem');
      if (steps >= 12) root.style.setProperty('--cardPadX','1.0rem');

      steps++;
    }
  }


  function fitAnswerAuto(){
    const root = document.documentElement;
    const page = document.getElementById('aPage') || document.getElementById('pageA');
    if (!page) return;

    root.style.setProperty('--ansPageScale','1.15');

    page.classList.add('measuring');
    let steps = 0;
    while (page.getBoundingClientRect().bottom > (window.innerHeight - 8) && steps < 16) {
      const s = parseFloat(getComputedStyle(root).getPropertyValue('--ansPageScale')) || 1;
      if (s > 0.80) root.style.setProperty('--ansPageScale', (s - 0.06).toFixed(3));
      steps++;
    }
    page.classList.remove('measuring');
  }

  // ---------- RENDERERS ----------
  function renderQuestionLayout(item){
    if(questionEl) questionEl.textContent = harden(item.q);

    if(answersWrap){
      answersWrap.classList.remove("reveal");
      answersWrap.innerHTML = "";
      const tags = ["a","b","c","d"];
      item.options.forEach((txt, i) => {
        const div = document.createElement("div");
        div.className = `card ${tags[i]}`;
        if(i === item.correct) div.classList.add("correct");
        div.textContent = txt;
        answersWrap.appendChild(div);
      });
    }

    fitSoon("q");
  }

  function renderAnswerLayout(item){
    if(answerTitle) answerTitle.textContent = item.options[item.correct];
    // Remove fun fact, show image
    if(answerImagePanel) {
      answerImagePanel.innerHTML = "";
      const answerText = item.options[item.correct];
      const imgFile = answerText.toLowerCase().replace(/[^a-z0-9]/g, '_') + '.png';
      const img = document.createElement('img');
      img.src = `img/${imgFile}`;
      img.alt = answerText;
      img.className = "slideshow-img";
      img.onerror = function(){ img.style.display = 'none'; };
      img.onload = function() {
        // Get available space below answer
        const panel = answerImagePanel.parentElement;
        const panelRect = panel.getBoundingClientRect();
        const answerRect = panel.querySelector('.answer-title').getBoundingClientRect();
        const availableHeight = panelRect.bottom - answerRect.bottom - 32; // 32px margin
        // Scale image to fit available space
        img.style.maxHeight = Math.max(120, Math.min(availableHeight, window.innerHeight * 0.48)) + 'px';
        img.style.maxWidth = Math.min(panelRect.width * 0.96, window.innerWidth * 0.92, img.naturalWidth) + 'px';
      };
      answerImagePanel.appendChild(img);
    }

    fitSoon("a");
  }

  // ---------- TIMER / FLOW ----------
  let started=false, ptr=0, deadline=0, rafId=null, playlist=[];

  function updateTopTimer(label, secs){
    if(topTimer){
      topTimer.textContent = `${label} · ${Math.max(0, Math.ceil(secs))}s`;
    }
  }

  function buildPlaylist(){
    playlist = [];
    for(let i=0;i<QUESTIONS.length;i++){
      playlist.push({type:"q", i});
      playlist.push({type:"a", i});
    }
  }

  function showQuestion(i){
    const item = QUESTIONS[i];
    renderQuestionLayout(item);

    if(qPage){ qPage.classList.remove("hidden"); }
    if(aPage){ aPage.classList.add("hidden"); }
    deadline = performance.now() + CONFIG.qSeconds*1000;
    updateTopTimer("Question", CONFIG.qSeconds);
  }

  function showAnswer(i){
    const item = QUESTIONS[i];
    if(answersWrap) answersWrap.classList.add("reveal"); // dim wrong, keep correct bright

  renderAnswerLayout(item);

    if(qPage){ qPage.classList.add("hidden"); }
    if(aPage){ aPage.classList.remove("hidden"); }
    deadline = performance.now() + CONFIG.aSeconds*1000;
    updateTopTimer("Answer", CONFIG.aSeconds);
  }

  function renderCurrent(){
    const s = playlist[ptr];
    if(!s) return;
    (s.type === "q") ? showQuestion(s.i) : showAnswer(s.i);
  }

  function advance(){
    ptr++;
    if(ptr >= playlist.length){
      if(!CONFIG.loop){ started = false; return; }
      buildPlaylist(); ptr = 0;
    }
    renderCurrent();
  }

  function loop(ts){
    if(started){
      const remaining = (deadline - ts)/1000;
      const s = playlist[ptr];
      updateTopTimer(s?.type === "q" ? "Question" : "Answer", remaining);
      if(remaining <= 0){
        advance();
        requestAnimationFrame(loop);
        return;
      }
    }
    requestAnimationFrame(loop);
  }

  function startShow(){
    if(started) return;
    started = true;
    if(overlay) overlay.classList.add("hidden");
    shuffleInPlace(QUESTIONS);
    buildPlaylist(); ptr=0;
    renderCurrent();
    document.documentElement.requestFullscreen?.().catch(()=>{});
    if(!rafId) rafId = requestAnimationFrame(loop);
    // make the page non-interactive after the start click
    setTimeout(() => { document.body.style.pointerEvents = "none"; }, 400);
  }

  // Re-fit on resize if current page is visible
  window.addEventListener('resize', () => {
    if (!started) return;
    const qVisible = qPage && !qPage.classList.contains('hidden');
    const aVisible = aPage && !aPage.classList.contains('hidden');
    if (qVisible) fitSoon("q");
    if (aVisible) fitSoon("a");
  });

  // ---------- INIT ----------
  async function prime(){
    bindDOM();
    await initVanta();
    await loadExternalQuestions();

    // Prepare first screens offstage so there's no flash
    renderQuestionLayout(QUESTIONS[0]);
    renderAnswerLayout(QUESTIONS[0]);

    // KEEP EVERYTHING HIDDEN until Start is clicked
    if (qPage) qPage.classList.add("hidden");
    if (aPage) aPage.classList.add("hidden");
    if (topTimer) topTimer.textContent = "Ready";

    // Enable Start button
    if (startBtn){
      startBtn.disabled = false;
      startBtn.addEventListener("click", startShow, { once:true });
    }
  }

  // go!
  prime();
})();
