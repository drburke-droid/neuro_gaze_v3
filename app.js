/**
 * BurkeCSF — Unified Display Controller
 * Single page: QR → Calibration → Tutorial → Test → Results
 */
import { QCSFEngine }    from './qcsf-engine.js';
import { createMode }    from './stimulus-modes.js';
import { drawCSFPlot }   from './csf-plot.js';
import { computeResult } from './results.js';
import { createHost }    from './peer-sync.js';

const MAX_TRIALS = 50;
const DEBOUNCE_MS = 250;

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}
window.showScreen = showScreen;

// ═══ PeerJS — auto-assigned ID ═══
let host = null, phoneConnected = false;

function initPeer() {
    if (typeof Peer === 'undefined') {
        document.getElementById('qr-debug').textContent = 'PeerJS unavailable';
        return;
    }
    host = createHost(
        // onReady — peer registered, generate QR
        (id) => {
            const dir = location.pathname.substring(0, location.pathname.lastIndexOf('/'));
            const url = `${location.origin}${dir}/tablet.html?id=${id}`;
            document.getElementById('qr-debug').textContent = `ID: ${id}`;
            const qrEl = document.getElementById('qrcode');
            qrEl.innerHTML = '';
            if (typeof QRCode !== 'undefined') {
                new QRCode(qrEl, { text: url, width: 180, height: 180, colorDark: '#000', colorLight: '#fff' });
            } else {
                qrEl.innerHTML = `<p style="font-size:.5rem;word-break:break-all;max-width:240px">${url}</p>`;
            }
        },
        // onConnect
        () => {
            phoneConnected = true;
            document.getElementById('gamma-local').style.display = 'none';
            document.getElementById('gamma-remote').style.display = 'block';
            showScreen('scr-cal');
            calGo(0);
        },
        // onData
        (d) => handlePhoneMessage(d),
        // onDisconnect
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
    if (d.type === 'distance') {
        document.getElementById('dv').value = d.value;
        document.getElementById('du').value = d.unit;
    }
    if (d.type === 'nav') {
        if (d.to === 'next') { if (calStep === 2) calValidate(); else calGo(calStep + 1); }
        else if (d.to === 'back') calGo(Math.max(0, calStep - 1));
        else if (d.to === 'start') startTest();
    }
    if (d.type === 'input') handleInput(d.value);
}

window.skipPhone = function() {
    document.getElementById('gamma-local').style.display = 'block';
    document.getElementById('gamma-remote').style.display = 'none';
    showScreen('scr-cal');
    calGo(0);
};

initPeer();

// ═══ Calibration ═══
let calStep = 0;
const gs = document.getElementById('gs'), ss = document.getElementById('ss');
const ic = document.getElementById('ic'), csh = document.getElementById('card-shape');

function updateGamma() { const v = gs.value; ic.style.backgroundColor = `rgb(${v},${v},${v})`; document.getElementById('gv').textContent = v; }
function updateCardSize() { const px = parseFloat(ss.value); csh.style.width = px + 'px'; csh.style.height = (px / 1.585) + 'px'; document.getElementById('sv').textContent = px.toFixed(0); }
gs.oninput = updateGamma; ss.oninput = updateCardSize;
updateGamma(); updateCardSize();

window.calGo = function(n) {
    calStep = n;
    for (let i = 0; i < 4; i++) {
        document.getElementById('cs' + i).classList.remove('active');
        const d = document.getElementById('d' + i);
        d.classList.remove('done', 'cur');
        if (i < n) d.classList.add('done'); else if (i === n) d.classList.add('cur');
    }
    document.getElementById('cs' + n).classList.add('active');
    tx({ type: 'calStep', step: n, gamma: parseInt(gs.value), cardPx: parseFloat(ss.value), pxPerMm: parseFloat(ss.value) / 85.6 });
};

function distToMm() {
    const v = parseFloat(document.getElementById('dv').value);
    if (isNaN(v)) return NaN;
    return v * ({ ft: 304.8, m: 1000, cm: 10, 'in': 25.4 }[document.getElementById('du').value] || NaN);
}

window.calValidate = function() {
    const de = document.getElementById('de'), dv = document.getElementById('dv');
    de.textContent = '';
    const raw = dv.value.trim();
    if (!raw) { de.textContent = 'Enter a distance.'; return; }
    const val = parseFloat(raw);
    if (isNaN(val) || val <= 0) { de.textContent = 'Invalid number.'; return; }
    const mmVal = distToMm();
    if (mmVal < 200) { de.textContent = 'Too close (min ~8 in).'; return; }
    if (mmVal > 30000) { de.textContent = 'Too far (max ~100 ft).'; return; }
    const ppm = parseFloat(ss.value) / 85.6, ppd = mmVal * 0.017455 * ppm;
    document.getElementById('sg').textContent = gs.value;
    document.getElementById('sp2').textContent = ppm.toFixed(3);
    const u = document.getElementById('du').value;
    document.getElementById('sdi').textContent = `${val} ${u} (${(mmVal / 1000).toFixed(2)} m)`;
    document.getElementById('smi').textContent = document.getElementById('mm').checked ? 'On' : 'Off';
    document.getElementById('spp').textContent = ppd.toFixed(1) + ' px/°';
    document.getElementById('spp').style.color = ppd < 10 ? 'var(--e)' : 'var(--a)';
    calGo(3);
};

// ═══ Tutorial + Test ═══
let mode = null, engine = null, currentStim = null;
let testComplete = false, testStarted = false, lastInputTime = 0;

window.startTest = function() {
    localStorage.setItem('user_gamma_grey', gs.value);
    localStorage.setItem('user_px_per_mm', parseFloat(ss.value) / 85.6);
    localStorage.setItem('user_distance_mm', distToMm());
    localStorage.setItem('mirror_mode', document.getElementById('mm').checked);

    window._cal = {
        pxPerMm: parseFloat(ss.value) / 85.6,
        distMm: distToMm(),
        midPoint: parseInt(gs.value),
        isMirror: document.getElementById('mm').checked
    };
    if (window._cal.isMirror) document.getElementById('mirror-target').classList.add('mirror-flip');

    mode = createMode('gabor');
    mode.generate();
    engine = new QCSFEngine({ numAFC: mode.numAFC, psychometricSlope: mode.psychometricSlope });
    testComplete = false; testStarted = false; currentStim = null;
    updateProgress(0);

    // Draw grey canvas
    const canvas = document.getElementById('stimCanvas'), ctx = canvas.getContext('2d');
    const mp = window._cal.midPoint;
    ctx.fillStyle = `rgb(${mp},${mp},${mp})`; ctx.fillRect(0, 0, canvas.width, canvas.height);

    showScreen('scr-test');
    buildTutorial();

    // Tell phone to show tutorial first
    tx({ type: 'tutorial', labels: mode.labels, keys: mode.keys });
};

function buildTutorial() {
    const demos = document.getElementById('tut-demos');
    const items = [
        { arrow: '↑', label: 'Vertical', key: 'up' },
        { arrow: '→', label: 'Horizontal', key: 'right' },
        { arrow: '↗', label: 'Right tilt', key: 'upright' },
        { arrow: '↖', label: 'Left tilt', key: 'upleft' }
    ];
    demos.innerHTML = items.map(it =>
        `<div class="tut-card"><div class="tut-arrow">${it.arrow}</div><div class="tut-key">${it.label}</div></div>`
    ).join('') + `<div class="tut-card" style="border-color:rgba(255,69,58,.15)"><div class="tut-arrow" style="font-size:1.6rem;color:var(--t2)">✕</div><div class="tut-key">No Target</div></div>`;
    document.getElementById('tutorial').style.display = 'flex';
}

function dismissTutorial() {
    document.getElementById('tutorial').style.display = 'none';
    testStarted = true;
    nextTrial();
    tx({ type: 'testStart', maxTrials: MAX_TRIALS });
}

function handleInput(value) {
    if (testComplete) return;
    // Any input during tutorial → dismiss it and start
    if (!testStarted) { dismissTutorial(); return; }
    if (!currentStim || !mode) return;
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

// Keyboard
document.addEventListener('keydown', e => {
    if (testComplete) return;
    const k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'w') handleInput('up');
    else if (k === 'arrowright' || k === 'd') handleInput('right');
    else if (k === 'e') handleInput('upright');
    else if (k === 'q') handleInput('upleft');
    else if (k === 'n') handleInput('none');
    else if (k === ' ') { e.preventDefault(); handleInput('_start'); }
});

function nextTrial() {
    try { currentStim = engine.selectStimulus(); } catch (e) { finish(); return; }
    if (currentStim.contrast <= 0 || currentStim.contrast > 1 || isNaN(currentStim.contrast))
        currentStim.contrast = Math.max(0.001, Math.min(1.0, currentStim.contrast || 0.5));
    if (currentStim.frequency <= 0 || isNaN(currentStim.frequency)) currentStim.frequency = 4;
    const canvas = document.getElementById('stimCanvas');
    try { mode.render(canvas, currentStim, window._cal); } catch (e) {}
}

function updateProgress(t) {
    const el = document.getElementById('live-progress');
    if (el) el.textContent = `${t} / ${MAX_TRIALS}`;
    const fill = document.getElementById('progress-fill');
    if (fill) fill.style.width = `${(t / MAX_TRIALS) * 100}%`;
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
