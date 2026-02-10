/**
 * BurkeCSF — Unified Display Controller
 * QR → Mirror? → Calibration → Tutorial (real Gabors) → Test → Results
 */
import { QCSFEngine }    from './qcsf-engine.js';
import { createMode }    from './stimulus-modes.js';
import { drawGabor }     from './gabor.js';
import { drawCSFPlot }   from './csf-plot.js';
import { computeResult } from './results.js';
import { createHost }    from './peer-sync.js';

const MAX_TRIALS = 50, DEBOUNCE_MS = 250, NUM_CAL_STEPS = 5;

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}
window.showScreen = showScreen;

// ═══ PeerJS ═══
let host = null, phoneConnected = false, isMirror = false;

function initPeer() {
    if (typeof Peer === 'undefined') { document.getElementById('qr-debug').textContent = 'PeerJS unavailable'; return; }
    host = createHost(
        (id) => {
            const dir = location.pathname.substring(0, location.pathname.lastIndexOf('/'));
            const url = `${location.origin}${dir}/tablet.html?id=${id}`;
            document.getElementById('qr-debug').textContent = `ID: ${id}`;
            const qrEl = document.getElementById('qrcode'); qrEl.innerHTML = '';
            if (typeof QRCode !== 'undefined') new QRCode(qrEl, { text: url, width: 180, height: 180, colorDark: '#000', colorLight: '#fff' });
            else qrEl.innerHTML = `<p style="font-size:.5rem;word-break:break-all;max-width:240px">${url}</p>`;
        },
        () => {
            phoneConnected = true;
            document.getElementById('gamma-local').style.display = 'none';
            document.getElementById('gamma-remote').style.display = 'block';
            showScreen('scr-cal'); calGo(0);
        },
        (d) => handlePhoneMessage(d),
        () => {
            phoneConnected = false;
            document.getElementById('gamma-local').style.display = 'block';
            document.getElementById('gamma-remote').style.display = 'none';
        }
    );
}
function tx(msg) { if (host && host.connected) host.send(msg); }

function handlePhoneMessage(d) {
    if (d.type === 'gamma')    { document.getElementById('gs').value = d.value; updateGamma(); }
    if (d.type === 'cardSize') { document.getElementById('ss').value = d.value; updateCardSize(); }
    if (d.type === 'distance') { document.getElementById('dv').value = d.value; document.getElementById('du').value = d.unit; }
    if (d.type === 'mirror')   { setMirror(d.value); }
    if (d.type === 'nav') {
        if (d.to === 'next') { if (calStep === 3) calValidate(); else calGo(calStep + 1); }
        else if (d.to === 'back') calGo(Math.max(0, calStep - 1));
        else if (d.to === 'start') startTest();
    }
    if (d.type === 'input') handleInput(d.value);
}

window.skipPhone = function() {
    document.getElementById('gamma-local').style.display = 'block';
    document.getElementById('gamma-remote').style.display = 'none';
    showScreen('scr-cal'); calGo(0);
};
initPeer();

// ═══ Mirror ═══
window.setMirror = function(val) {
    isMirror = val;
    const box = document.getElementById('cal-box');
    if (isMirror) box.classList.add('mirrored'); else box.classList.remove('mirrored');
    tx({ type: 'mirrorSet', value: isMirror });
    calGo(1); // advance to luminance
};

// ═══ Calibration (5 steps: 0=mirror, 1=gamma, 2=card, 3=distance, 4=confirm) ═══
let calStep = 0;
const gs = document.getElementById('gs'), ss = document.getElementById('ss');
const ic = document.getElementById('ic'), csh = document.getElementById('card-shape');

function updateGamma() { const v = gs.value; ic.style.backgroundColor = `rgb(${v},${v},${v})`; document.getElementById('gv').textContent = v; }
function updateCardSize() { const px = parseFloat(ss.value); csh.style.width = px + 'px'; csh.style.height = (px / 1.585) + 'px'; document.getElementById('sv').textContent = px.toFixed(0); }
gs.oninput = updateGamma; ss.oninput = updateCardSize;
updateGamma(); updateCardSize();

window.calGo = function(n) {
    calStep = n;
    for (let i = 0; i < NUM_CAL_STEPS; i++) {
        document.getElementById('cs' + i).classList.remove('active');
        const d = document.getElementById('d' + i);
        d.classList.remove('done', 'cur');
        if (i < n) d.classList.add('done'); else if (i === n) d.classList.add('cur');
    }
    document.getElementById('cs' + n).classList.add('active');
    tx({ type: 'calStep', step: n, gamma: parseInt(gs.value), cardPx: parseFloat(ss.value), pxPerMm: parseFloat(ss.value) / 85.6, isMirror });
};

function distToMm() {
    const v = parseFloat(document.getElementById('dv').value);
    if (isNaN(v)) return NaN;
    return v * ({ ft: 304.8, m: 1000, cm: 10, 'in': 25.4 }[document.getElementById('du').value] || NaN);
}

window.calValidate = function() {
    const de = document.getElementById('de'), raw = document.getElementById('dv').value.trim();
    de.textContent = '';
    if (!raw) { de.textContent = 'Enter a distance.'; return; }
    const val = parseFloat(raw);
    if (isNaN(val) || val <= 0) { de.textContent = 'Invalid.'; return; }
    const mmVal = distToMm();
    if (mmVal < 200) { de.textContent = 'Too close.'; return; }
    if (mmVal > 30000) { de.textContent = 'Too far.'; return; }
    const ppm = parseFloat(ss.value) / 85.6, ppd = mmVal * 0.017455 * ppm, u = document.getElementById('du').value;
    document.getElementById('smi').textContent = isMirror ? 'On (distance doubled)' : 'Off';
    document.getElementById('sg').textContent = gs.value;
    document.getElementById('sp2').textContent = ppm.toFixed(3);
    document.getElementById('sdi').textContent = `${val} ${u}` + (isMirror ? ` × 2 = ${(val*2).toFixed(1)} ${u}` : '') + ` (${((isMirror ? mmVal*2 : mmVal) / 1000).toFixed(2)} m)`;
    const effMm = isMirror ? mmVal * 2 : mmVal;
    const effPpd = effMm * 0.017455 * ppm;
    document.getElementById('spp').textContent = effPpd.toFixed(1) + ' px/°';
    document.getElementById('spp').style.color = effPpd < 10 ? 'var(--e)' : 'var(--a)';
    calGo(4);
};

// ═══ Tutorial — render REAL Gabor patches, step through each orientation ═══
const TUTORIAL_STEPS = [
    { angle: 0,   key: 'up',      arrow: '↑', name: 'Vertical' },
    { angle: 90,  key: 'right',   arrow: '→', name: 'Horizontal' },
    { angle: 45,  key: 'upright', arrow: '↗', name: 'Right Tilt (45°)' },
    { angle: 135, key: 'upleft',  arrow: '↖', name: 'Left Tilt (135°)' },
    { angle: -1,  key: 'none',    arrow: '✕', name: 'No Target Visible' }
];
let tutStep = 0;

function renderTutorialStep(idx) {
    tutStep = idx;
    const step = TUTORIAL_STEPS[idx];
    const tc = document.getElementById('tut-canvas');
    const sub = document.getElementById('tut-sub');
    const arrow = document.getElementById('tut-arrow');
    const keyName = document.getElementById('tut-key-name');

    // Render Gabor or grey
    if (step.angle >= 0) {
        const demoCal = { pxPerMm: 0.5, distMm: 600, midPoint: 128 };
        drawGabor(tc, { cpd: 3, contrast: 0.95, angle: step.angle }, demoCal);
        sub.innerHTML = `This is a <strong>${step.name}</strong> grating`;
    } else {
        // "No target" — show plain grey
        const ctx = tc.getContext('2d');
        ctx.fillStyle = 'rgb(128,128,128)'; ctx.fillRect(0, 0, tc.width, tc.height);
        sub.innerHTML = `If you <strong>cannot see</strong> a grating, press <strong>No Target</strong>`;
    }

    arrow.textContent = step.arrow;
    keyName.textContent = `Press ${step.arrow} ${step.name} on phone`;

    // Progress dots
    const dots = document.getElementById('tut-dots');
    dots.innerHTML = TUTORIAL_STEPS.map((_, i) =>
        `<div class="tut-dot${i === idx ? ' active' : ''}"></div>`
    ).join('');

    // Hint
    document.getElementById('tut-hint').textContent =
        idx < TUTORIAL_STEPS.length - 1
            ? 'Tap the highlighted button on your phone to continue'
            : 'Tap No Target on your phone to start the test';

    // Tell phone which button to highlight
    tx({ type: 'tutStep', stepIdx: idx, key: step.key, arrow: step.arrow, name: step.name, total: TUTORIAL_STEPS.length });
}

function advanceTutorial(responseKey) {
    const expected = TUTORIAL_STEPS[tutStep].key;
    if (responseKey !== expected) return; // wrong button, ignore
    if (tutStep < TUTORIAL_STEPS.length - 1) {
        renderTutorialStep(tutStep + 1);
    } else {
        // Tutorial complete — start real test
        document.getElementById('tutorial').style.display = 'none';
        testStarted = true;
        nextTrial();
        tx({ type: 'testStart', maxTrials: MAX_TRIALS });
    }
}

// ═══ Test ═══
let mode = null, engine = null, currentStim = null;
let testComplete = false, testStarted = false, inTutorial = false, lastInputTime = 0;

window.startTest = function() {
    localStorage.setItem('user_gamma_grey', gs.value);
    localStorage.setItem('user_px_per_mm', parseFloat(ss.value) / 85.6);
    const effDist = isMirror ? distToMm() * 2 : distToMm();
    localStorage.setItem('user_distance_mm', effDist);
    localStorage.setItem('mirror_mode', isMirror);

    window._cal = {
        pxPerMm: parseFloat(ss.value) / 85.6,
        distMm: effDist,
        midPoint: parseInt(gs.value),
        isMirror
    };
    if (isMirror) document.getElementById('mirror-target').classList.add('mirror-flip');

    mode = createMode('gabor'); mode.generate();
    engine = new QCSFEngine({ numAFC: mode.numAFC, psychometricSlope: mode.psychometricSlope });
    testComplete = false; testStarted = false; inTutorial = true; currentStim = null;
    updateProgress(0);

    const canvas = document.getElementById('stimCanvas'), ctx = canvas.getContext('2d');
    ctx.fillStyle = `rgb(${window._cal.midPoint},${window._cal.midPoint},${window._cal.midPoint})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    showScreen('scr-test');

    // Show tutorial overlay and render first step
    document.getElementById('tutorial').style.display = 'flex';
    renderTutorialStep(0);
};

function handleInput(value) {
    if (testComplete) return;
    // During tutorial — advance if correct button pressed
    if (inTutorial) {
        advanceTutorial(value);
        if (testStarted) inTutorial = false; // tutorial just ended
        return;
    }
    if (!testStarted || !currentStim || !mode) return;
    const validKeys = new Set(mode.keys);
    if (!validKeys.has(value)) return;
    const now = performance.now();
    if (now - lastInputTime < DEBOUNCE_MS) return;
    lastInputTime = now;

    const correct = mode.checkAnswer(value);
    try { engine.update(currentStim.stimIndex, correct); } catch (e) { finish(); return; }
    updateProgress(engine.trialCount);
    tx({ type: 'progress', trial: engine.trialCount, maxTrials: MAX_TRIALS });
    if (engine.trialCount >= MAX_TRIALS) { finish(); return; }
    nextTrial();
}
window.handleInput = handleInput;

document.addEventListener('keydown', e => {
    if (testComplete) return;
    const k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'w') handleInput('up');
    else if (k === 'arrowright' || k === 'd') handleInput('right');
    else if (k === 'e') handleInput('upright');
    else if (k === 'q') handleInput('upleft');
    else if (k === 'n') handleInput('none');
});

function nextTrial() {
    try { currentStim = engine.selectStimulus(); } catch (e) { finish(); return; }
    if (currentStim.contrast <= 0 || currentStim.contrast > 1 || isNaN(currentStim.contrast))
        currentStim.contrast = Math.max(0.001, Math.min(1.0, currentStim.contrast || 0.5));
    if (currentStim.frequency <= 0 || isNaN(currentStim.frequency)) currentStim.frequency = 4;
    try { mode.render(document.getElementById('stimCanvas'), currentStim, window._cal); } catch (e) {}
}

function updateProgress(t) {
    const el = document.getElementById('live-progress'); if (el) el.textContent = `${t} / ${MAX_TRIALS}`;
    const fill = document.getElementById('progress-fill'); if (fill) fill.style.width = `${(t / MAX_TRIALS) * 100}%`;
}

function finish() {
    testComplete = true;
    let result;
    try { result = computeResult(engine); }
    catch (e) { result = { aulcsf: 0, rank: 'ERROR', detail: '', params: null, curve: [] }; }
    showScreen('scr-results');
    document.getElementById('final-auc').innerText = result.aulcsf.toFixed(2);
    document.getElementById('final-rank').innerText = result.rank;
    document.getElementById('final-detail').innerText = result.detail;
    let plotUrl = '';
    try { plotUrl = drawCSFPlot(document.getElementById('csf-plot'), engine, result.params); } catch (e) {}
    tx({
        type: 'results', score: result.aulcsf.toFixed(2), rank: result.rank,
        detail: result.detail, plotDataUrl: plotUrl,
        curve: result.curve || [],
        history: engine.history.map(h => ({
            stimIndex: h.stimIndex, correct: h.correct,
            freq: engine.stimGrid[h.stimIndex].freq,
            logContrast: engine.stimGrid[h.stimIndex].logContrast
        }))
    });
}
