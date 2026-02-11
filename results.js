/**
 * Burke Vision Lab — Results & Scoring
 */

function estimateCutoffCpd(engine, params) {
    const minF = 0.5, maxF = 60;
    let prevF = minF;
    let prev = engine.evaluateCSF(prevF, params);

    if (prev < 0) return minF;

    for (let i = 1; i <= 500; i++) {
        const f = Math.pow(10, Math.log10(minF) + (Math.log10(maxF / minF) * i / 500));
        const v = engine.evaluateCSF(f, params);
        if (prev >= 0 && v < 0) {
            const frac = (0 - prev) / (v - prev);
            return prevF + frac * (f - prevF);
        }
        prevF = f;
        prev = v;
    }

    return maxF;
}

function buildDisplayParams(engine, baseParams) {
    const adjusted = { ...baseParams };

    const testedFreqs = engine.history.map(t => engine.stimGrid[t.stimIndex]?.freq).filter(Number.isFinite);
    const lowBandCount = testedFreqs.filter(f => f >= 0.5 && f <= 5).length;

    // If low-frequency sampling is sparse, bias toward a more physiological knee/roll-off.
    if (lowBandCount < 2) {
        adjusted.peakFreq = Math.min(adjusted.peakFreq, 4.5);
        adjusted.bandwidth = Math.max(adjusted.bandwidth, 1.35);
        adjusted.truncation = Math.max(adjusted.truncation, 1.8);
    }

    // Global plausibility guards.
    adjusted.peakFreq = Math.min(adjusted.peakFreq, 10.0);
    adjusted.bandwidth = Math.max(adjusted.bandwidth, 1.15);
    adjusted.truncation = Math.max(adjusted.truncation, 1.4);

    // Keep high-frequency tail from unrealistically crossing near ~60 cpd.
    for (let i = 0; i < 5; i++) {
        const cutoff = estimateCutoffCpd(engine, adjusted);
        if (cutoff <= 42) break;
        adjusted.peakFreq = Math.max(2.2, adjusted.peakFreq * 0.9);
        adjusted.bandwidth = Math.min(2.8, adjusted.bandwidth + 0.12);
        adjusted.truncation = Math.min(3.2, adjusted.truncation + 0.15);
    }

    return adjusted;
}

export function computeResult(engine) {
    const rawParams = engine.getExpectedEstimate();
    const params = buildDisplayParams(engine, rawParams);
    const aulcsf = engine.computeAULCSF(params);

    let rank;
    if      (aulcsf > 2.0) rank = 'SUPERIOR';
    else if (aulcsf > 1.6) rank = 'ABOVE AVERAGE';
    else if (aulcsf > 1.2) rank = 'NORMAL';
    else if (aulcsf > 0.8) rank = 'BELOW AVERAGE';
    else                    rank = 'IMPAIRED';

    const peakSens = Math.pow(10, params.peakGain).toFixed(0);
    const detail   = `Low-freq Sens: ${peakSens} | Knee: ${params.peakFreq.toFixed(1)} cpd | Curvature: ${params.truncation.toFixed(1)}`;

    // Curve data for tablet rendering
    const curve = engine.getCSFCurve(params);

    return { aulcsf, rank, detail, params, curve };
}
