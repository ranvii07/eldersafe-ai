// ElderSafe AI — detection core. Same code runs in the browser (Monitor + Evaluate pages)
// and in Node (offline check). No dependencies.
(function (root) {
  const L = { lSh: 11, rSh: 12, lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnk: 27, rAnk: 28 };
  const VIS = 0.3;

  // Thresholds learned on all 19 UR clips (see Evaluate page). Used until a new model is saved.
  const DEFAULT_MODEL = { angle: 55, ratio: 1.2, duration: 0.5, drop: 0.2, trainedOn: 19 };

  // ---- 1. per-frame features from 33 landmarks ([x, y, visibility], normalised 0..1) ----
  function frameFeatures(lm, w, h) {
    if (!lm) return null;
    const p = (i) => ({ x: lm[i][0] * w, y: lm[i][1] * h, v: lm[i][2] });
    const sh = mid(p(L.lSh), p(L.rSh)), hip = mid(p(L.lHip), p(L.rHip));
    if (sh.v < VIS || hip.v < VIS) return null;
    const dx = sh.x - hip.x, dy = hip.y - sh.y; // dy > 0 when shoulders above hips
    const torsoAngle = Math.abs(Math.atan2(dx, dy) * 180 / Math.PI); // 0 upright, 90 flat
    const pts = lm.filter((q) => q[2] >= VIS);
    const xs = pts.map((q) => q[0] * w), ys = pts.map((q) => q[1] * h);
    const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
    return {
      torsoAngle,
      boxRatio: bh > 0 ? bw / bh : null,
      hipY: hip.y / h,               // 0 = top of image, 1 = bottom
      bodyH: Math.max(bh, bw) / h,   // body size, used to normalise speed
    };
  }
  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) }; }

  // ---- 2. preprocessing: MEDIAN fill + smoothing of numeric values ----
  function median(a) {
    const s = a.filter((v) => v != null && !Number.isNaN(v)).sort((x, y) => x - y);
    if (!s.length) return null;
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function medianFill(series, k = 7) {
    // fill missing values with the median of nearby valid values; then median-smooth (k frames)
    const n = series.length, all = median(series);
    const filled = series.map((v, i) => v != null ? v : (median(series.slice(Math.max(0, i - k), i + k + 1)) ?? all));
    const r = k >> 1;
    return filled.map((_, i) => median(filled.slice(Math.max(0, i - r), Math.min(n, i + r + 1))));
  }

  // ---- posture category per frame, then MODE over a window ----
  function posture(f, model) {
    if (!f || f.torsoAngle == null) return null;
    if (f.torsoAngle >= model.angle || (f.boxRatio != null && f.boxRatio >= model.ratio)) return 'lying';
    if (f.torsoAngle >= 30) return 'bending';
    if (f.boxRatio != null && f.boxRatio >= 0.6) return 'sitting';
    return 'standing';
  }
  function mode(a) {
    const c = {}; let best = null;
    for (const v of a) if (v != null) { c[v] = (c[v] || 0) + 1; if (best == null || c[v] > c[best]) best = v; }
    return best;
  }
  function modeFill(labels, k = 9) {
    const r = k >> 1, n = labels.length;
    return labels.map((_, i) => mode(labels.slice(Math.max(0, i - r), Math.min(n, i + r + 1))));
  }

  // ---- full preprocessing of a clip: raw landmarks -> clean per-frame series ----
  function preprocess(clip) {
    const raw = clip.frames.map((lm) => frameFeatures(lm, clip.w, clip.h));
    const keys = ['torsoAngle', 'boxRatio', 'hipY', 'bodyH'];
    const s = {};
    for (const k of keys) s[k] = medianFill(raw.map((f) => (f ? f[k] : null)));
    const frames = s.torsoAngle.map((_, i) => {
      const o = {}; for (const k of keys) o[k] = s[k][i]; return o;
    });
    return { name: clip.name, fps: clip.fps || 30, frames, missing: raw.filter((f) => !f).length,
             label: labelFromName(clip.name) };
  }

  // ---- LABEL encoding: fall = 1, not fall (ADL) = 0 ----
  function labelFromName(name) {
    if (/fall/i.test(name)) return 1;
    if (/adl/i.test(name)) return 0;
    return null;
  }

  // ---- detector: same rule used live and offline ----
  // Fall = body becomes "lying" after a fast downward hip movement and stays lying >= duration.
  function detect(pre, model) {
    const fps = pre.fps, post = modeFill(pre.frames.map((f) => posture(f, model)));
    const need = Math.max(1, Math.round(model.duration * fps));
    let run = 0, fallAt = -1, drop = 0;
    for (let i = 0; i < pre.frames.length; i++) {
      run = post[i] === 'lying' ? run + 1 : 0;
      if (run === 1) drop = dropAt(pre, i, fps); // how fast the hips came down just before lying
      if (run >= need && drop >= model.drop && fallAt < 0) fallAt = i;
    }
    return { fall: fallAt >= 0 ? 1 : 0, fallFrame: fallAt, postures: post };
  }
  function dropAt(pre, start, fps) {
    // max hip drop speed in the 1.5 s before the lying spell starts
    let best = 0; const win = Math.round(fps * 0.5);
    for (let i = Math.max(win, start - Math.round(1.5 * fps)); i <= Math.min(start + win, pre.frames.length - 1); i++) {
      const a = pre.frames[i - win], b = pre.frames[i];
      const v = (b.hipY - a.hipY) / Math.max(0.15, a.bodyH) * (fps / win);
      if (v > best) best = v;
    }
    return best;
  }

  // ---- training: pick thresholds that best separate falls from ADLs ----
  const GRID = {
    angle: [45, 50, 55, 60, 65, 70],
    ratio: [0.9, 1.0, 1.1, 1.2, 1.4],
    duration: [0.5, 1.0, 1.5, 2.0],
    drop: [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0],
  };
  function score(clips, m) {
    let ok = 0; for (const c of clips) if (detect(c, m).fall === c.label) ok++;
    return ok;
  }
  function train(clips) {
    let best = null, bestS = -1, bestD = Infinity;
    for (const angle of GRID.angle) for (const ratio of GRID.ratio)
      for (const duration of GRID.duration) for (const drop of GRID.drop) {
        const m = { angle, ratio, duration, drop };
        const s = score(clips, m);
        // tie-break: stay close to the textbook defaults (less over-fitting)
        const d = Math.abs(angle - 55) / 10 + Math.abs(ratio - 1.1) / 0.2 + Math.abs(duration - 1) / 0.5 + Math.abs(drop - 0.3) / 0.3;
        if (s > bestS || (s === bestS && d < bestD)) { best = m; bestS = s; bestD = d; }
      }
    return { ...best, trainedOn: clips.length, trainAccuracy: bestS / clips.length };
  }

  // ---- leave-one-clip-out evaluation ----
  function evaluate(clips, onProgress) {
    const rows = [];
    clips.forEach((c, i) => {
      const m = train(clips.filter((_, j) => j !== i));
      const r = detect(c, m);
      rows.push({ name: c.name, label: c.label, pred: r.fall, fallSec: r.fallFrame >= 0 ? +(r.fallFrame / c.fps).toFixed(1) : null });
      onProgress && onProgress(i + 1, clips.length);
    });
    const tp = rows.filter((r) => r.label === 1 && r.pred === 1).length;
    const fn = rows.filter((r) => r.label === 1 && r.pred === 0).length;
    const tn = rows.filter((r) => r.label === 0 && r.pred === 0).length;
    const fp = rows.filter((r) => r.label === 0 && r.pred === 1).length;
    const metrics = {
      tp, fn, tn, fp,
      recall: tp / Math.max(1, tp + fn),
      specificity: tn / Math.max(1, tn + fp),
      precision: tp / Math.max(1, tp + fp),
      accuracy: (tp + tn) / Math.max(1, rows.length),
    };
    return { rows, metrics, finalModel: train(clips) };
  }

  async function evaluateAsync(clips, onProgress) {
    // same as evaluate(), but yields to the browser between folds so the page stays responsive
    const rows = [];
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i], m = train(clips.filter((_, j) => j !== i)), r = detect(c, m);
      rows.push({ name: c.name, label: c.label, pred: r.fall, fallSec: r.fallFrame >= 0 ? +(r.fallFrame / c.fps).toFixed(1) : null, missing: c.missing, frames: c.frames.length });
      onProgress && onProgress(i + 1, clips.length);
      await new Promise((res) => setTimeout(res, 0));
    }
    return { rows, metrics: metricsOf(rows), finalModel: train(clips) };
  }
  function metricsOf(rows) {
    const n = (l, p) => rows.filter((r) => r.label === l && r.pred === p).length;
    const tp = n(1, 1), fn = n(1, 0), tn = n(0, 0), fp = n(0, 1);
    return { tp, fn, tn, fp, recall: tp / Math.max(1, tp + fn), specificity: tn / Math.max(1, tn + fp),
      precision: tp / Math.max(1, tp + fp), accuracy: (tp + tn) / Math.max(1, rows.length) };
  }

  // ---- live helper: keeps a rolling buffer of frames and runs the same rule ----
  function createLiveDetector(model, fps = 30) {
    const buf = [];
    return {
      push(lm, w, h, liveFps) {
        if (liveFps) fps = Math.max(5, Math.min(60, liveFps));
        buf.push(lm); if (buf.length > fps * 6) buf.shift();
        const pre = preprocess({ name: 'live', w, h, fps, frames: buf });
        const r = detect(pre, model);
        const last = pre.frames[pre.frames.length - 1];
        return { posture: r.postures[r.postures.length - 1] || 'unknown', fall: r.fall === 1, feat: last };
      },
      reset() { buf.length = 0; },
    };
  }

  const api = { DEFAULT_MODEL, frameFeatures, preprocess, posture, detect, train, evaluate, evaluateAsync, metricsOf, labelFromName, createLiveDetector, median, mode };
  if (typeof module !== 'undefined') module.exports = api; else root.ElderCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
