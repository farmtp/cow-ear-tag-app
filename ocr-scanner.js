// =====================================================================
// 耳標OCRスキャナー（interbcd の読み取りエンジンを移植）
// ---------------------------------------------------------------------
// バーコードではなく、耳標に印字された数字そのものを Tesseract.js でOCRする。
// 読み取りロジック（黄色タグ検出・レイアウト解析・多数決）は interbcd/index.html と同一。
// 設計の経緯・調整ポイントは interbcd/DESIGN.md を参照。
//
// 使い方: EarTagScanner.open({ lookup(num, kind) => [{id, status}], onSelect(id) })
// =====================================================================
(function () {
'use strict';

/* =====================================================================
 * 設定
 * =================================================================== */
const CONFIG = {
  workWidth: 640,          // 探索用の縮小幅
  tickMs: 120,             // 探索の間隔
  stableFramesForOcr: 2,   // 黄色領域がこのフレーム数安定したらOCR起動
  votesToConfirm: 3,       // 大4桁がこの回数一致したら「本確定」（1票で暫定確定は出る）
  satisfiedOcrIntervalMs: 700,  // 本確定かつ10桁まで揃った後のOCR間隔（2頭目検出用に完全停止はしない）
  voteWindow: 8,           // 投票の保持数
  voteTtlMs: 2500,         // 票の有効期限。これより古い読みは多数決から外す
  roiPadding: 0.10,        // ROI切り出し時の余白率
  maxRotationDeg: 30,      // これを超える傾き推定は無視（誤推定対策）
  cooldownLostMs: 1500,    // 確定後、黄色領域がこの時間消えたら再スキャン
  historyMax: 20,
  // ★実動画では耳標が原寸100px程度しかなく、そのままではOCRが読めない。
  //   ROIをこの幅まで拡大してから解析する（拡大率の上限も設ける）
  // レイアウト解析はこの幅で行い（重いので控えめ）、OCRに渡す切り抜きだけ
  // grayCropCanvas 側でさらに拡大する
  targetTagWidth: 320,
  maxUpscale: 5,
  ocrTargetCharH: 110,     // OCRに渡すときの目標文字高（行）
  cdTargetHeights: [80, 120, 200],   // CD単体OCRの目標文字高（複数スケールで読み最高信頼を採用）
                           // ※実測: 単文字OCRはスケールに敏感で、同じ「2」が120pxで正読・200pxで誤読、
                           //   別タグの「4」は全スケール正読。2本読みの信頼度比較で両方に対応
  maxCandidates: 3,        // 1フレームで評価する黄色ブロブの数
  minTagPxFullRes: 34,     // 原寸でこれ未満のタグは読めないので解析しない
  psm: '7',                // Tesseractのページ分割モード（行=7 / 単語=8）
  autoSelectOnConfirm: true, // 本確定かつ名簿で1頭に絞れたら自動で検索する
};

/* =====================================================================
 * チェックディジット検証（差し替え可能な1箇所）
 * ---------------------------------------------------------------------
 * 正確なアルゴリズムは未確証。候補を実装し、既知の有効番号で自己テストする。
 *  - ちょうど1つだけ通る  → それを採用
 *  - 複数通る / 0個       → 検証スキップ（常にtrue）をデフォルトにしUIに明示
 * 推測したアルゴリズムを正しいものとして黙って組み込まないこと。
 * =================================================================== */
const KNOWN_VALID_NUMBERS = [
  '1521507801',   // 実物確認済み
  '1401525192',   // 実物確認済み (JP 14015 / 2519 / 2)
];

const CHECK_DIGIT_ALGOS = {
  'Luhn': (d9) => {
    let tot = 0;
    for (let i = 0; i < 9; i++) {
      let x = d9[8 - i];
      if (i % 2 === 0) { x *= 2; if (x > 9) x -= 9; }
      tot += x;
    }
    return (10 - tot % 10) % 10;
  },
  '重み1-2交互 mod10': (d9) => {
    const w = [1,2,1,2,1,2,1,2,1];
    const tot = d9.reduce((a, d, i) => a + d * w[i], 0);
    return (10 - tot % 10) % 10;
  },
  '重み2-1交互 mod10': (d9) => {
    const w = [2,1,2,1,2,1,2,1,2];
    const tot = d9.reduce((a, d, i) => a + d * w[i], 0);
    return (10 - tot % 10) % 10;
  },
  '重み3-1交互 mod10 (JAN型)': (d9) => {
    const w = [3,1,3,1,3,1,3,1,3];
    const tot = d9.reduce((a, d, i) => a + d * w[i], 0);
    return (10 - tot % 10) % 10;
  },
  '重み1-3交互 mod10': (d9) => {
    const w = [1,3,1,3,1,3,1,3,1];
    const tot = d9.reduce((a, d, i) => a + d * w[i], 0);
    return (10 - tot % 10) % 10;
  },
  '単純和 mod10 補数': (d9) => {
    const tot = d9.reduce((a, d) => a + d, 0);
    return (10 - tot % 10) % 10;
  },
  '重み9..1 mod11': (d9) => {
    const w = [9,8,7,6,5,4,3,2,1];
    const tot = d9.reduce((a, d, i) => a + d * w[i], 0);
    const r = 11 - tot % 11;
    return r >= 10 ? 0 : r;
  },
};

let activeCheckDigit = { name: '検証スキップ', fn: () => true, skip: true };
let cdCandidateNames = [];   // 自己テストを通過した候補式（スキップモード時の照合用）

/**
 * スキップモード時の弱い照合: 通過中の候補式が「全会一致」で予測するCDを返す。
 * 一致しない/候補ゼロなら null。数字の生成には使わず、OCRで読んだCDが
 * 全候補式の予測と食い違うときに「そのCDを捨てて9桁に格下げする」判断にだけ使う。
 * （未確証の式を正として組み込まない、という方針の範囲内の使い方）
 */
function predictCheckDigit(d9str) {
  if (!activeCheckDigit.skip || !cdCandidateNames.length) return null;
  const d9 = d9str.split('').map(Number);
  let agreed = null;
  for (const name of cdCandidateNames) {
    const v = CHECK_DIGIT_ALGOS[name](d9);
    if (agreed === null) agreed = v;
    else if (agreed !== v) return null;   // 候補間で割れたら判断しない
  }
  return agreed;
}

function runCheckDigitSelfTest() {
  const lines = [];
  const passing = [];
  for (const [name, calc] of Object.entries(CHECK_DIGIT_ALGOS)) {
    let allOk = true;
    for (const num of KNOWN_VALID_NUMBERS) {
      const d9 = num.slice(0, 9).split('').map(Number);
      const expect = Number(num[9]);
      const got = calc(d9);
      if (got !== expect) { allOk = false; }
      lines.push(`${allOk ? '✔' : '✘'} ${name}: ${num.slice(0,9)} → ${got} (期待 ${expect})`);
    }
    if (allOk) passing.push(name);
  }
  lines.push('');
  if (passing.length === 1) {
    const name = passing[0];
    activeCheckDigit = {
      name,
      skip: false,
      fn: (num10) => {
        const d9 = num10.slice(0, 9).split('').map(Number);
        return CHECK_DIGIT_ALGOS[name](d9) === Number(num10[9]);
      },
    };
    lines.push(`→ 一意に通過: 「${name}」を採用`);
  } else if (passing.length > 1) {
    cdCandidateNames = passing;
    lines.push(`→ ${passing.length}件が通過（${passing.join(' / ')}）。`);
    lines.push(`  テストベクタ1件では特定できないため【検証スキップ】をデフォルトにする。`);
    lines.push(`  有効な番号が増えたら KNOWN_VALID_NUMBERS に追記して再判定すること。`);
  } else {
    lines.push(`→ 通過なし。【検証スキップ】をデフォルトにする。`);
  }
  return lines.join('\n');
}


/* =====================================================================
 * スキャナー画面（DOMはJSで生成）
 * =================================================================== */
const $ = (id) => document.getElementById(id);

const root = document.createElement('div');
root.id = 'ocrScanner';
root.className = 'ocr-scanner';
root.innerHTML = `
  <video id="ocrVideo" playsinline autoplay muted></video>
  <canvas id="ocrOverlay"></canvas>
  <div class="ocr-top">
    <span id="ocrStatus">初期化中…</span>
    <span class="ocr-chip" id="ocrTorch" style="display:none;">💡ライト</span>
    <button type="button" class="ocr-close" id="ocrClose">✕ 閉じる</button>
  </div>
  <div class="ocr-bottom">
    <div id="ocrHint">耳標（黄色タグ）の数字にカメラを向けてください</div>
    <div id="ocrNumber" title="タップでこの番号を入力欄へ"></div>
    <div id="ocrMatches"></div>
  </div>`;
document.body.appendChild(root);

const video = $('ocrVideo'), overlay = $('ocrOverlay');
const octx = overlay.getContext('2d');
const statusText = $('ocrStatus');

// デバッグ用の出力先（画面には出さない。runOcrPass などがそのまま書き込めるようダミーを用意）
const dummyDiv = () => document.createElement('div');
const ui = {
  hint: $('ocrHint'), number: $('ocrNumber'), matches: $('ocrMatches'),
  dbgMask: document.createElement('canvas'), dbgRoi: document.createElement('canvas'),
  dbgTop: document.createElement('canvas'), dbgBottom: document.createElement('canvas'),
  dbgTiming: dummyDiv(), dbgRaw: dummyDiv(), dbgCd: dummyDiv(),
};

// 色相は実角度(0-360°)。実物の耳標写真の実測値: 黄色地は hue 51-74° / 彩度35%+ / 明度22%+（日向）
// minArea は work(640px幅)座標での面積。実動画では耳標が 800〜3000px 程度しかない
const params = { hMin: 40, hMax: 80, sMin: 30, vMin: 30, minArea: 350, inkC: 8 };

/* =====================================================================
 * 作業用canvas
 * =================================================================== */
const workCanvas = document.createElement('canvas');   // 縮小探索用
const workCtx = workCanvas.getContext('2d', { willReadFrequently: true });
const fullCanvas = document.createElement('canvas');   // 原寸フレーム保持用
const fullCtx = fullCanvas.getContext('2d', { willReadFrequently: true });

/* =====================================================================
 * 黄色マスク + 連結成分
 * =================================================================== */
function buildYellowMask(imgData, w, h) {
  const src = imgData.data;
  const mask = new Uint8Array(w * h);
  const hMin = params.hMin, hMax = params.hMax;           // 実角度(0-360°)
  const sMin = params.sMin / 100, vMin = params.vMin / 100;
  for (let i = 0, p = 0; i < src.length; i += 4, p++) {
    const r = src[i] / 255, g = src[i + 1] / 255, b = src[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const v = max;
    if (v < vMin) continue;
    const d = max - min;
    if (d === 0) continue;
    const s = d / max;
    if (s < sMin) continue;
    let hDeg;
    if (max === r) hDeg = 60 * (((g - b) / d) % 6);
    else if (max === g) hDeg = 60 * ((b - r) / d + 2);
    else hDeg = 60 * ((r - g) / d + 4);
    if (hDeg < 0) hDeg += 360;
    if (hDeg >= hMin && hDeg <= hMax) mask[p] = 1;
  }
  return mask;
}

/* =====================================================================
 * タグ候補の検出（複数候補）
 * ---------------------------------------------------------------------
 * ★「最大の黄色ブロブ＝耳標」は誤り。実動画では配管に巻かれた黄色テープが
 *   最大ブロブになり、耳標より大きかった。よって候補を複数返し、
 *   後段の「数字らしい成分が並んでいるか」のスコアで選ぶ。
 * =================================================================== */
function findTagCandidates(mask, w, h, maxCandidates = 4) {
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const found = [];
  let label = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    label++;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = label;
    let area = 0, minX = w, maxX = 0, minY = h, maxY = 0;
    let sumX = 0, sumY = 0, sumXX = 0, sumYY = 0, sumXY = 0;
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % w, y = (p / w) | 0;
      area++;
      sumX += x; sumY += y; sumXX += x * x; sumYY += y * y; sumXY += x * y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0 && mask[p - 1] && !labels[p - 1]) { labels[p - 1] = label; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !labels[p + 1]) { labels[p + 1] = label; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !labels[p - w]) { labels[p - w] = label; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !labels[p + w]) { labels[p + w] = label; stack[sp++] = p + w; }
    }
    if (area < params.minArea) continue;
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const aspect = bw / bh;
    // 2枚組耳標は縦長(≈0.3)、単票は≈1.0〜1.3。極端なものだけ落とす
    if (aspect < 0.20 || aspect > 3.2) continue;
    if (area / (bw * bh) < 0.28) continue;
    const cx = sumX / area, cy = sumY / area;
    const mu20 = sumXX / area - cx * cx;
    const mu02 = sumYY / area - cy * cy;
    const mu11 = sumXY / area - cx * cy;
    const angle = 0.5 * Math.atan2(2 * mu11, mu20 - mu02);
    found.push({ area, minX, minY, maxX, maxY, w: bw, h: bh, cx, cy, angle });
  }
  found.sort((a, b) => b.area - a.area);
  return found.slice(0, maxCandidates);
}

/* =====================================================================
 * ROI切り出し（原寸から）→ 傾き補正 → OCRに足る解像度へ拡大
 * =================================================================== */
function extractRoi(sourceCanvas, blob, scale) {
  const pad = CONFIG.roiPadding;
  const cx = blob.cx / scale, cy = blob.cy / scale;
  const baseW = (blob.w / scale) * (1 + pad * 2);
  const baseH = (blob.h / scale) * (1 + pad * 2);
  // 縦長ブロブでは主軸が±90°付近になるので±45°で折り返して「傾き」に正規化
  let angle = blob.angle;
  if (angle > Math.PI / 4) angle -= Math.PI / 2;
  else if (angle < -Math.PI / 4) angle += Math.PI / 2;
  if (Math.abs(angle) > CONFIG.maxRotationDeg * Math.PI / 180) angle = 0;
  // ★実動画では耳標が原寸でも100px程度しかない。OCRに足りないので拡大する
  const up = Math.max(1, Math.min(CONFIG.maxUpscale, CONFIG.targetTagWidth / baseW));
  const rw = Math.round(baseW * up), rh = Math.round(baseH * up);
  const roi = document.createElement('canvas');
  roi.width = rw; roi.height = rh;
  const rctx = roi.getContext('2d', { willReadFrequently: true });
  rctx.imageSmoothingEnabled = true;
  rctx.translate(rw / 2, rh / 2);
  rctx.rotate(-angle);
  rctx.scale(up, up);
  rctx.drawImage(sourceCanvas, -cx, -cy);
  roi._upscale = up;
  return roi;
}

function toGray(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const gray = new Uint8Array(w * h);
  const d = img.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    gray[p] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
  }
  return gray;
}

function otsuThreshold(gray) {
  const hist = new Uint32Array(256);
  for (const g of gray) hist[g]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, maxVar = 0, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) { maxVar = v; thr = t; }
  }
  return thr;
}

/** 積分画像による局所平均（ボックスフィルタ）。適応的二値化に使う */
function boxMean(gray, w, h, radius) {
  const sat = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += gray[y * w + x];
      sat[(y + 1) * (w + 1) + (x + 1)] = sat[y * (w + 1) + (x + 1)] + rowSum;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius), y1 = Math.min(h - 1, y + radius);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius), x1 = Math.min(w - 1, x + radius);
      const s = sat[(y1 + 1) * (w + 1) + (x1 + 1)] - sat[y0 * (w + 1) + (x1 + 1)]
              - sat[(y1 + 1) * (w + 1) + x0] + sat[y0 * (w + 1) + x0];
      out[y * w + x] = s / ((y1 - y0 + 1) * (x1 - x0 + 1));
    }
  }
  return out;
}

/* =====================================================================
 * タグ内のレイアウト解析（バーコード帯に依存しない）
 * ---------------------------------------------------------------------
 * ★実動画では耳標が小さくバーコード帯が解像しない。よって帯をアンカーにする
 *   旧方式は捨て、「印字成分を見つけて行にまとめ、一番大きい行＝大4桁」とする。
 *   様式ではなく文字の幾何だけを見るのでフォントにも依存しない。
 * =================================================================== */
function analyzeTagLayout(roi) {
  const w = roi.width, h = roi.height;
  const rctx = roi.getContext('2d', { willReadFrequently: true });
  const img = rctx.getImageData(0, 0, w, h);
  const d = img.data;
  const gray = new Uint8Array(w * h);
  const tag = new Uint8Array(w * h);
  // タグ地(黄色)の判定は印字部分を含めたいので彩度・明度をゆるめに取る
  const hMin = Math.max(0, params.hMin - 5), hMax = Math.min(360, params.hMax + 10);
  const sMin = Math.max(0.12, params.sMin / 100 - 0.10), vMin = Math.max(0.12, params.vMin / 100 - 0.12);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    gray[p] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max < vMin) continue;
    const diff = max - min;
    if (diff === 0 || diff / max < sMin) continue;
    let hue;
    if (max === r) hue = 60 * (((g - b) / diff) % 6);
    else if (max === g) hue = 60 * ((b - r) / diff + 2);
    else hue = 60 * ((r - g) / diff + 4);
    if (hue < 0) hue += 360;
    if (hue >= hMin && hue <= hMax) tag[p] = 1;
  }
  // 膨張→収縮（クロージング）で印字の穴を埋め、タグを塊にする
  dilate(tag, w, h, 3);
  erode(tag, w, h, 3);
  let tagCount = 0;
  for (let p = 0; p < tag.length; p++) tagCount += tag[p];
  if (tagCount < w * h * 0.12) return null;

  // 適応的二値化: 局所平均 - C（タグの色ムラ・グラデーションに強い）
  const radius = Math.max(6, Math.round(Math.min(w, h) * 0.12));
  const mean = boxMean(gray, w, h, radius);
  const C = params.inkC;
  const ink = new Uint8Array(w * h);
  for (let p = 0; p < ink.length; p++) ink[p] = (tag[p] && gray[p] < mean[p] - C) ? 1 : 0;

  // 連結成分
  const comps = connectedComponents(ink, w, h, Math.max(12, Math.round(w * h * 0.00035)));
  if (!comps.length) return null;

  // 文字らしい成分に絞る（縦長〜正方。横に潰れたバーコード帯・傷は落とす）。
  // ★最小高さの基準はROIの「幅」に取る。高さ基準だと、
  //   - 高さ比6%: 2枚組耳標の縦長ROIで上段JP行(4%)が足切りされ9/10桁に届かない
  //   - 高さ比3%: 単票ROIで9pxのノイズ粒が行に混入し大桁行の検出を壊す
  //   の両方を実測した。タグ幅に対する文字高（JP行≈11%・大桁≈30%）は様式共通の不変量
  const digits = comps.filter(c => {
    const ar = c.w / c.h;
    return ar >= 0.10 && ar <= 1.35 && c.h >= Math.max(6, w * 0.055) && c.h <= h * 0.62 && c.w <= w * 0.42;
  });
  if (digits.length < 2) return null;

  // 文字の「中心線の近さ」で行にまとめる。
  // ★以前は行のy範囲を拡張しながら重なり判定していたが、それだと近接する行
  //   （上段JPとバーコードのバー群など）が橋渡し的に連鎖して1つの巨大行に融合し、
  //   上段行が大桁行と衝突して捨てられるバグがあった（実写真で発生）
  digits.sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
  const rows = [];
  for (const c of digits) {
    const cy = (c.y0 + c.y1) / 2;
    let placed = false;
    for (const row of rows) {
      if (Math.abs(cy - row.cy) < Math.max(c.h, row.mh) * 0.5) {
        row.items.push(c);
        row.cy = (row.cy * (row.items.length - 1) + cy) / row.items.length;
        row.mh = (row.mh * (row.items.length - 1) + c.h) / row.items.length;
        placed = true;
        break;
      }
    }
    if (!placed) rows.push({ cy, mh: c.h, items: [c] });
  }
  for (const row of rows) {
    row.items.sort((a, b) => a.x0 - b.x0);
    const hs = row.items.map(c => c.h).sort((a, b) => a - b);
    row.charH = hs[hs.length >> 1];
    row.x0 = Math.min(...row.items.map(c => c.x0));
    row.x1 = Math.max(...row.items.map(c => c.x1));
    row.y0 = Math.min(...row.items.map(c => c.y0));
    row.y1 = Math.max(...row.items.map(c => c.y1));
  }
  // 行の「数字らしさ」スコア: ★単純な成分数や文字高だけだと、
  //  - 配管の黄色テープの傷が並んだだけの候補（実動画）
  //  - 2枚組写真の裏札に写った指影（文字高では本物に勝ってしまう）
  // が誤選択される。「大きさの揃った文字が3〜5個、ほぼ等間隔で横に並ぶか」を
  // 主要因にし、大4桁の行選択と候補間比較の両方に同じ尺度を使う。
  const scoreRow = (items) => {
    const n = items.length;
    if (n < 3 || n > 6) return Math.min(n, 6) * 0.2;   // 多数のバー等が点を稼がないよう上限
    let sc = 6 - Math.abs(4 - n);                 // 4個が最良（大4桁）
    const hs = items.map(c => c.h);
    const hAvg = hs.reduce((a, b) => a + b, 0) / n;
    const hDev = hs.reduce((a, b) => a + Math.abs(b - hAvg), 0) / n / hAvg;
    sc += Math.max(0, 2 - hDev * 6);              // 文字高のばらつきが小さいほど良い
    const gaps = [];
    for (let i = 1; i < n; i++) gaps.push(items[i].x0 - items[i - 1].x0);
    const gAvg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const gDev = gaps.reduce((a, b) => a + Math.abs(b - gAvg), 0) / gaps.length / Math.max(1, gAvg);
    sc += Math.max(0, 2 - gDev * 4);              // 等間隔ほど良い
    const r = rectOf(items);
    if ((r.x1 - r.x0) / w > 0.35) sc += 1.5;      // タグ幅に対し十分な横幅
    return sc;
  };

  // 大4桁の行 = スコア最大の行（同点は文字高が大きい方）
  const candidates = rows.filter(r => r.items.length >= 2);
  if (!candidates.length) return null;
  let bigRow = null, rowScore = -1;
  for (const row of candidates) {
    const sc = scoreRow(row.items) + row.charH / h * 0.5;
    if (sc > rowScore || (sc === rowScore && bigRow && row.charH > bigRow.charH)) { bigRow = row; rowScore = sc; }
  }

  // チェックディジット: 大桁の右側にある、高さが 25〜72% の成分（下寄せ）
  let cd = null;
  for (const c of comps) {
    if (c.x0 < bigRow.x1 - bigRow.charH * 0.35) continue;
    if (c.h < bigRow.charH * 0.25 || c.h > bigRow.charH * 0.72) continue;
    const vOverlap = Math.min(bigRow.y1, c.y1) - Math.max(bigRow.y0, c.y0);
    if (vOverlap < c.h * 0.4) continue;
    if (!cd || c.area > cd.area) cd = c;
  }
  // 行の中心から縦に外れた成分（紛れ込んだバー・影・刻印）はrect計算から除外する。
  // ★これをしないと1成分の混入でrectがバーコード帯まで伸び、行OCRが壊れる（実写真で発生）
  const coreItems = (row) => {
    const kept = row.items.filter(c => Math.abs((c.y0 + c.y1) / 2 - row.cy) <= row.charH * 0.6);
    return kept.length ? kept : row.items;
  };
  // cd が bigRow の items に含まれていたら大桁側から外す
  const bigItems = coreItems(bigRow).filter(c => !(cd && c === cd));
  if (!bigItems.length) return null;
  const bigRect = rectOf(bigItems);

  // 上段(JP+5桁): 大桁より上にあり、文字高が 25〜80% の行
  let jpRow = null;
  for (const row of rows) {
    if (row === bigRow) continue;
    // 行の位置判定は中心線で行う（外れ成分1つで行のy範囲が伸びても壊れないように）
    if (row.cy >= bigRow.y0) continue;
    if (row.charH < bigRow.charH * 0.25 || row.charH > bigRow.charH * 0.80) continue;
    if (row.items.length < 3 || row.items.length > 8) continue;   // バー群(数十本)を除外
    // 細い成分ばかりの行はバーコード。文字なら中央値アスペクト比がもっと太い
    const ars = row.items.map(c => c.w / c.h).sort((a, b) => a - b);
    if (ars[ars.length >> 1] < 0.22) continue;
    if (!jpRow || row.y1 > jpRow.y1) jpRow = row;   // 大桁に最も近い行
  }

  let score = scoreRow(bigItems);
  if (cd) score += 1;
  if (jpRow) score += 1.5;
  // ★1票だけで数字を表示してよいかの判定に使う「切り出し品質」。
  //   Tesseractの信頼度は当てにならない（実測: 正読の"0334"がconf=0、
  //   誤読の"4284"がconf=29）ので、幾何量で判断する。
  //   耳標の大桁は「タグ幅の約30%の文字高が4つ」という様式共通の比率を持ち、
  //   遠すぎ・切れている場合はこの比が大きく下がる（実測: 正読0.28-0.33 / 誤読0.09-0.14）
  //   ※成分数を4個ちょうどに限定すると、桁が繋がった/分裂した正読まで弾いてしまう
  //     （実測: 写真の正読が5成分、動画の正読が3成分）ので 3〜5 で許容する
  const charRatio = bigRow.charH / w;
  const quality = bigItems.length >= 3 && bigItems.length <= 5 && charRatio >= 0.18;
  return {
    bigRect,
    bigCount: bigItems.length,
    quality,
    charRatio,
    cdRect: cd ? { x0: cd.x0, y0: cd.y0, x1: cd.x1, y1: cd.y1, h: cd.h } : null,
    jpRect: jpRow ? rectOf(coreItems(jpRow)) : null,
    jpCount: jpRow ? jpRow.items.length : 0,
    charH: bigRow.charH,
    score,
  };
}

function rectOf(items) {
  return {
    x0: Math.min(...items.map(c => c.x0)), y0: Math.min(...items.map(c => c.y0)),
    x1: Math.max(...items.map(c => c.x1)), y1: Math.max(...items.map(c => c.y1)),
  };
}

function connectedComponents(bin, w, h, minArea) {
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const out = [];
  let label = 0;
  for (let s0 = 0; s0 < bin.length; s0++) {
    if (!bin[s0] || labels[s0]) continue;
    label++;
    let sp = 0;
    stack[sp++] = s0; labels[s0] = label;
    let area = 0, mnX = w, mxX = 0, mnY = h, mxY = 0;
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % w, y = (p / w) | 0;
      area++;
      if (x < mnX) mnX = x; if (x > mxX) mxX = x;
      if (y < mnY) mnY = y; if (y > mxY) mxY = y;
      if (x > 0 && bin[p - 1] && !labels[p - 1]) { labels[p - 1] = label; stack[sp++] = p - 1; }
      if (x < w - 1 && bin[p + 1] && !labels[p + 1]) { labels[p + 1] = label; stack[sp++] = p + 1; }
      if (y > 0 && bin[p - w] && !labels[p - w]) { labels[p - w] = label; stack[sp++] = p - w; }
      if (y < h - 1 && bin[p + w] && !labels[p + w]) { labels[p + w] = label; stack[sp++] = p + w; }
    }
    if (area >= minArea) out.push({ x0: mnX, y0: mnY, x1: mxX, y1: mxY, w: mxX - mnX + 1, h: mxY - mnY + 1, area });
  }
  return out;
}

function dilate(bin, w, h, r) { morph(bin, w, h, r, true); }
function erode(bin, w, h, r) { morph(bin, w, h, r, false); }
function morph(bin, w, h, r, isDilate) {
  const tmp = new Uint8Array(bin.length);
  // 横方向
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = isDilate ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const xx = x + k;
        if (xx < 0 || xx >= w) { if (!isDilate) { v = 0; break; } continue; }
        if (isDilate) { if (bin[y * w + xx]) { v = 1; break; } }
        else if (!bin[y * w + xx]) { v = 0; break; }
      }
      tmp[y * w + x] = v;
    }
  }
  // 縦方向
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let v = isDilate ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        if (yy < 0 || yy >= h) { if (!isDilate) { v = 0; break; } continue; }
        if (isDilate) { if (tmp[yy * w + x]) { v = 1; break; } }
        else if (!tmp[yy * w + x]) { v = 0; break; }
      }
      bin[y * w + x] = v;
    }
  }
}

/**
 * ROIの矩形を「グレースケールのまま」コントラスト正規化して切り出す（白余白付き）。
 * ★二値化して渡さないこと。Tesseractはアンチエイリアス文字で学習されており、
 *   ベタ塗り二値はフォント次第で誤読が増える（実写真で "2519"→"7519" を実測）。
 *   二値化は位置検出（成分分析）にだけ使う。
 */
function grayCropCanvas(roi, x0, y0, x1, y1, targetH, pad = 26) {
  const m = Math.max(3, Math.round((y1 - y0) * 0.10));
  x0 = Math.max(0, Math.round(x0 - m)); y0 = Math.max(0, Math.round(y0 - m));
  x1 = Math.min(roi.width, Math.round(x1 + m)); y1 = Math.min(roi.height, Math.round(y1 + m));
  const w = x1 - x0, h = y1 - y0;
  if (w < 6 || h < 6) return null;
  const img = roi.getContext('2d').getImageData(x0, y0, w, h);
  const d = img.data;
  const g = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    g[p] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
  }
  // 2-98パーセンタイル正規化（露出のばらつきを吸収）
  const hist = new Uint32Array(256);
  for (let p = 0; p < g.length; p++) hist[g[p]]++;
  const n2 = w * h * 0.02;
  let lo = 0, hi = 255;
  for (let i = 0, a = 0; i < 256; i++) { a += hist[i]; if (a >= n2) { lo = i; break; } }
  for (let i = 255, a = 0; i >= 0; i--) { a += hist[i]; if (a >= n2) { hi = i; break; } }
  const range = Math.max(1, hi - lo);
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const tctx = tmp.getContext('2d');
  const out = tctx.createImageData(w, h);
  for (let p = 0; p < g.length; p++) {
    const v = Math.max(0, Math.min(255, Math.round((g[p] - lo) / range * 255)));
    out.data[p * 4] = out.data[p * 4 + 1] = out.data[p * 4 + 2] = v;
    out.data[p * 4 + 3] = 255;
  }
  tctx.putImageData(out, 0, 0);
  // 文字高が目標値になるよう拡大（小さすぎるとTesseractが取りこぼす）
  const scale = targetH ? Math.max(1, Math.min(6, targetH / h)) : 1;
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale) + pad * 2;
  c.height = Math.round(h * scale) + pad * 2;
  const cctx = c.getContext('2d');
  cctx.fillStyle = '#fff';
  cctx.fillRect(0, 0, c.width, c.height);
  cctx.imageSmoothingEnabled = true;
  cctx.drawImage(tmp, pad, pad, Math.round(w * scale), Math.round(h * scale));
  return c;
}


/* =====================================================================
 * Tesseract ワーカー（起動時に1度だけ初期化）
 * =================================================================== */
let worker = null;
let workerReady = false;

async function initWorker() {
  setStatus('OCRエンジン初期化中…');
  worker = await Tesseract.createWorker('eng', 1, {}, {
    load_system_dawg: '0',
    load_freq_dawg: '0',
    load_number_dawg: '0',
    load_punc_dawg: '0',
    load_unambig_dawg: '0',
    load_bigram_dawg: '0',
  });
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789',
    classify_bln_numeric_mode: '1',
    tessedit_pageseg_mode: CONFIG.psm,
  });
  currentPsm = CONFIG.psm;
  workerReady = true;
  setStatus('準備完了。耳標にかざしてください');
}

let currentPsm = null;
async function setPsm(psm) {
  if (currentPsm === psm) return;
  await worker.setParameters({ tessedit_pageseg_mode: psm });
  currentPsm = psm;
}

async function ocrDigits(canvas, psm) {
  await setPsm(psm || CONFIG.psm);
  const { data } = await worker.recognize(canvas);
  const raw = (data.text || '').trim();
  return { raw, digits: raw.replace(/\D/g, ''), conf: data.confidence || 0 };
}

/* =====================================================================
 * フレーム処理パイプライン
 * =================================================================== */
let running = false;
let ocrBusy = false;
let stableCount = 0;
let prevBlob = null;
let lastBlobSeenAt = 0;
let nextOcrAllowedAt = 0;
// 大4桁を識別の芯として投票し、CD・上段は読めたフレームの分だけ別々に多数決する
// 現在ロックしている個体の読み取り状態。state: 0=未確定 1=暫定 2=本確定
const lock = { entries: [], bigs: [], cds: [], jps: [], big: '', num: '', kind: 0, state: 0, histAdded: false };
let chosenBlob = null;
let prevCands = [];


function iou(a, b) {
  const x1 = Math.max(a.minX, b.minX), y1 = Math.max(a.minY, b.minY);
  const x2 = Math.min(a.maxX, b.maxX), y2 = Math.min(a.maxY, b.maxY);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const ua = a.w * a.h + b.w * b.h - inter;
  return ua > 0 ? inter / ua : 0;
}

let loopGen = 0;   // open/close を繰り返しても tick ループが二重に回らないための世代番号
async function tick(gen) {
  if (!running || gen !== loopGen) return;
  const t0 = performance.now();

  if (video.readyState >= 2 && video.videoWidth > 0) {
    const vw = video.videoWidth, vh = video.videoHeight;
    const scale = CONFIG.workWidth / vw;
    const ww = CONFIG.workWidth, wh = Math.round(vh * scale);
    if (workCanvas.width !== ww || workCanvas.height !== wh) { workCanvas.width = ww; workCanvas.height = wh; }
    workCtx.drawImage(video, 0, 0, ww, wh);
    const imgData = workCtx.getImageData(0, 0, ww, wh);

    const mask = buildYellowMask(imgData, ww, wh);

    const cands = findTagCandidates(mask, ww, wh, CONFIG.maxCandidates);
    const blob = cands[0] || null;
    drawOverlay(cands, ww, wh);

    const now = performance.now();
    if (cands.length) {
      lastBlobSeenAt = now;
      // ★安定判定は「候補集合の重なり」で行う。最大ブロブ基準だと、同格の
      //   タグが2つ写るシーンで首位が入れ替わるたびにリセットされ、OCRが起動しない
      const anyStable = prevCands.length &&
        cands.some(c => prevCands.some(pc => iou(c, pc) > 0.4));
      stableCount = anyStable ? stableCount + 1 : 1;
      prevCands = cands;

      // ★本確定に達し、かつこれ以上桁が増えない状態になったらOCRの間隔を空ける。
      //   完全に止めないのは、次の個体（2頭目）を検出するため
      const satisfied = lock.state === 2 && lock.kind === 10;
      const throttled = satisfied && now < nextOcrAllowedAt;
      if (stableCount >= CONFIG.stableFramesForOcr && !ocrBusy && workerReady && !throttled) {
        // 原寸フレームを保持してからOCRへ（探索は縮小、OCRは原寸から切り出し）
        if (fullCanvas.width !== vw || fullCanvas.height !== vh) { fullCanvas.width = vw; fullCanvas.height = vh; }
        fullCtx.drawImage(video, 0, 0);
        if (satisfied) nextOcrAllowedAt = now + CONFIG.satisfiedOcrIntervalMs;
        runOcrPass(cands, scale);   // await しない（tickは回し続ける）
      }
    } else {
      stableCount = 0;
      prevCands = [];
      if (now - lastBlobSeenAt > CONFIG.cooldownLostMs) {
        // ★見失ったらロックを解除する。これが無いと、離れた前の個体の票が
        //   次の個体に持ち越される
        if (lock.state > 0 || lock.bigs.length) {
          resetLock();
          chosenBlob = null;
          clearDisplay();
          setStatus('スキャン中…');
        }
      } else if (lock.state === 0) {
        // 黄色は写っているのに形状条件で棄却されている場合はヒントを出す
        let yellowCount = 0;
        for (let p = 0; p < mask.length; p++) yellowCount += mask[p];
        if (yellowCount > params.minArea) setStatus('黄色検出中…もう少し近づけて正面から');
      }
    }
  }

  const dt = performance.now() - t0;
  setTimeout(() => tick(gen), Math.max(20, CONFIG.tickMs - dt));
}

async function runOcrPass(candidates, scale) {
  ocrBusy = true;
  const t0 = performance.now();
  try {
    // 候補ごとにレイアウト解析（OCRなし・安価）し、最も数字らしいものを1つ選ぶ
    let best = null;
    for (const cand of candidates) {
      // 原寸で小さすぎる候補は解析コストの無駄（読めないことが確定している）
      if (Math.max(cand.w, cand.h) / scale < CONFIG.minTagPxFullRes) continue;
      const roi = extractRoi(fullCanvas, cand, scale);
      const layout = analyzeTagLayout(roi);
      if (!layout) continue;
      if (!best || layout.score > best.layout.score) best = { roi, layout, cand };
    }
    if (!best) {
      ui.dbgRaw.textContent = '印字成分を検出できず（候補 ' + candidates.length + '件すべて）';
      ui.dbgTiming.textContent = `解析: ${Math.round(performance.now() - t0)}ms / OCRなし`;
      setStatus('タグは見えています。もう少し近づけてください');
      return;
    }
    const { roi, layout } = best;
    chosenBlob = best.cand;
    previewCanvas(ui.dbgRoi, roi);

    // OCRに渡すのはグレースケール。文字高を目標値まで拡大する
    const bigCanvas = grayCropCanvas(roi, layout.bigRect.x0, layout.bigRect.y0, layout.bigRect.x1, layout.bigRect.y1, CONFIG.ocrTargetCharH);
    const cdCanvases = layout.cdRect
      ? CONFIG.cdTargetHeights.map(th => grayCropCanvas(roi, layout.cdRect.x0, layout.cdRect.y0, layout.cdRect.x1, layout.cdRect.y1, th)).filter(Boolean)
      : [];
    const jpCanvas = layout.jpRect
      ? grayCropCanvas(roi, layout.jpRect.x0, layout.jpRect.y0, layout.jpRect.x1, layout.jpRect.y1, CONFIG.ocrTargetCharH)
      : null;
    if (bigCanvas) previewCanvas(ui.dbgBottom, bigCanvas);
    if (jpCanvas) previewCanvas(ui.dbgTop, jpCanvas);

    // デバッグ用: ROIプレビューに 大桁(青)・CD(桃)・上段(緑) を描く
    {
      const dctx = ui.dbgRoi.getContext('2d');
      dctx.lineWidth = Math.max(2, roi.width / 150);
      const box = (r, color) => { if (!r) return; dctx.strokeStyle = color; dctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0); };
      box(layout.bigRect, '#08f');
      box(layout.cdRect, '#f0f');
      box(layout.jpRect, '#0f0');
    }

    const linePsm = CONFIG.psm;
    let bigRes = { raw: '', digits: '', conf: 0 }, cdRes = { raw: '', digits: '', conf: 0 }, jpRes = { raw: '', digits: '', conf: 0 };
    if (bigCanvas) bigRes = await ocrDigits(bigCanvas, linePsm);
    for (const cdc of cdCanvases) {
      const r = await ocrDigits(cdc, '10');
      if (r.digits && r.conf > cdRes.conf) cdRes = r;   // 高信頼側を採用
    }
    if (jpCanvas) jpRes = await ocrDigits(jpCanvas, linePsm);
    // ★CDは1文字ゆえ「タグ縁の影が数字に化けた」誤読と区別が付きにくい。
    //   実測で正読時の信頼度は90+だったため、低信頼の読みは票に入れない
    if (cdRes.digits && cdRes.conf < 35) cdRes = { raw: cdRes.raw, digits: '', conf: cdRes.conf };

    const dt = Math.round(performance.now() - t0);
    ui.dbgTiming.textContent = `パス: ${dt}ms / 候補${candidates.length}件→採用score=${layout.score.toFixed(1)} / 拡大x${(roi._upscale || 1).toFixed(1)} / 文字高${layout.charH}px(比${layout.charRatio.toFixed(2)}) / 品質${layout.quality ? '良' : '低'}`;
    ui.dbgRaw.textContent =
      `大桁raw: "${bigRes.raw}" → ${bigRes.digits || '(なし)'} [成分${layout.bigCount} conf${Math.round(bigRes.conf)}]
` +
      `CD raw: "${cdRes.raw}" → ${cdRes.digits || '(なし)'} [${layout.cdRect ? '検出' : '未検出'} conf${Math.round(cdRes.conf)}]
` +
      `上段raw: "${jpRes.raw}" → ${jpRes.digits || '(なし)'} [成分${layout.jpCount} conf${Math.round(jpRes.conf)}]`;

    handleOcrResult(bigRes.digits, cdRes.digits, jpRes.digits, layout.quality);
  } catch (e) {
    console.error(e);
    ui.dbgRaw.textContent = 'OCRエラー: ' + e.message;
  } finally {
    ocrBusy = false;
  }
}

/* =====================================================================
 * 組み上げ・投票・確定
 * ---------------------------------------------------------------------
 * ★読める桁数は現場の距離で変わる（実動画では大4桁+CDのみ、上段JPは解像しない）。
 *   よって「大4桁」を識別の芯として投票し、上段5桁・CDは読めたフレームの分だけ
 *   別々に多数決して積み増す。結果は 4 / 5 / 9 / 10桁 のいずれかで確定する。
 * =================================================================== */
function normalizeParts(bigDigits, cdDigit, jpDigits) {
  // 大桁: 4桁。CDがくっついて5桁で来たら末尾をCDに回す
  let big = bigDigits, cd = cdDigit, jp = jpDigits;
  if (big.length === 5 && !cd) { cd = big.slice(4); big = big.slice(0, 4); }
  if (big.length > 4) big = big.slice(0, 4);
  if (cd.length > 1) cd = cd.slice(0, 1);
  // 上段: JP+5桁。whitelist強制でJP等が数字に化けて先頭に混ざるので末尾5桁を採る
  if (jp.length > 5 && jp.length <= 8) jp = jp.slice(-5);
  if (jp.length !== 5) jp = '';
  return { big, cd, jp };
}

function buildNumber(big, cd, jp) {
  if (big.length !== 4) return null;
  if (jp.length === 5 && cd.length === 1) return { num: jp + big + cd, kind: 10 };
  if (jp.length === 5) return { num: jp + big, kind: 9 };
  if (cd.length === 1) return { num: big + cd, kind: 5 };
  return { num: big, kind: 4 };
}

/**
 * 大4桁の多数決。★切り出し品質で重み付けする。
 * 等重みだと、遠くて小さいタグの一発誤読が、近づいて綺麗に読めた1票と同点になり、
 * 先に入っていた誤読の方が勝ってしまう（実動画で確認）。
 * 品質の良い読みを2票、低い読みを1票として数える。
 */
function tallyWeighted(entries) {
  const m = new Map();
  for (const e of entries) {
    if (!e.big) continue;
    m.set(e.big, (m.get(e.big) || 0) + (e.q ? 2 : 1));
  }
  let bestV = '', bestW = 0;
  for (const [v, wt] of m) if (wt > bestW) { bestV = v; bestW = wt; }
  // countは「品質の良い読みなら1回で確定相当」にはせず、実回数で返す
  const count = entries.filter(e => e.big === bestV).length;
  return { value: bestV, count, weight: bestW };
}

function tally(arr) {
  const m = new Map();
  for (const v of arr) if (v) m.set(v, (m.get(v) || 0) + 1);
  let bestV = '', bestC = 0;
  for (const [v, c] of m) if (c > bestC) { bestV = v; bestC = c; }
  return { value: bestV, count: bestC };
}

/**
 * 1回読めた時点で「暫定確定」して即表示し、票が集まったら「本確定」へ格上げする。
 * ---------------------------------------------------------------------
 * ★以前は大4桁が3回一致するまで何も出さなかったため、確定までかざし続ける必要があった。
 *   現場では「粗くてもまず数字が出る」方が有用なので2段構えにする。
 *   - 暫定(1票)  : すぐ表示・履歴にも入れる。以降の読みで数字が変われば訂正する
 *   - 本確定(3票): 表示を確定色に切り替え、以後は多数決で守られる
 *   桁数の格上げ（4→5→9→10）は従来どおり、暫定・本確定のどちらの状態でも行う。
 *
 * 票は「変わったらリセット」ではなく直近N回のスライディング窓での多数決にする。
 * こうすると単発の誤読は勝手に負け、本物が続けば自然に逆転して訂正される。
 */
function handleOcrResult(bigDigits, cdDigit, jpDigits, quality) {
  const { big, cd, jp } = normalizeParts(bigDigits, cdDigit, jpDigits);
  if (big.length !== 4) {
    if (lock.state === 0) {
      setStatus(`読取中… 大桁:${bigDigits.length}桁${cd ? ' CD:○' : ''}${jp ? ' 上段:○' : ''}`);
    }
    return;
  }
  // ★票には有効期限を持たせる。窓を件数だけで管理すると、
  //   数秒前に別の牛を映したときの読みが窓に残り、今まさに読めた値に勝ってしまう
  //   （実動画で、6秒前の誤読"4284"が正しい"0334"を押しのける事象を確認）
  const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  lock.entries.push({ big, cd, jp, q: !!quality, t: nowMs });
  lock.entries = lock.entries.filter(e => nowMs - e.t <= CONFIG.voteTtlMs);
  if (lock.entries.length > CONFIG.voteWindow) lock.entries = lock.entries.slice(-CONFIG.voteWindow);
  lock.bigs = lock.entries.map(e => e.big);
  lock.cds = lock.entries.map(e => e.cd);
  lock.jps = lock.entries.map(e => e.jp);

  // 「訂正」と「別個体」の区別:
  //   暫定(state=1)のうちに違う番号が優勢になった → 同じ耳標の誤読なので【訂正】
  //   本確定(state=2)の後に違う番号が2回読めた   → 別の牛なので【新しい履歴行】
  // ★これを state で分けないと、確定済みの前の牛の番号が上書きされて消える
  const curCount = lock.bigs.filter(v => v === big).length;
  if (lock.state === 2 && lock.big && big !== lock.big && curCount >= 2) {
    lock.entries = lock.entries.filter(e => e.big === big);
    lock.bigs = lock.entries.map(e => e.big);
    lock.cds = lock.entries.map(e => e.cd);
    lock.jps = lock.entries.map(e => e.jp);
    lock.state = 0; lock.big = ''; lock.num = ''; lock.kind = 0; lock.histAdded = false;
  }
  const best = tallyWeighted(lock.entries);

  // 補助桁は「暫定のうちは1票でも採用、本確定後は2票必要」とする
  const needAux = best.count >= CONFIG.votesToConfirm ? 2 : 1;
  const cdB = tally(lock.cds), jpB = tally(lock.jps);
  const cdUse = cdB.count >= needAux ? cdB.value : '';
  const jpUse = jpB.count >= needAux ? jpB.value : '';

  let built = buildNumber(best.value, cdUse, jpUse);
  if (!built) return;

  // チェックディジット検証（採用式が確定している場合のみ棄却）
  if (built.kind === 10 && !activeCheckDigit.fn(built.num)) {
    const demoted = buildNumber(best.value, '', jpUse);
    if (!demoted) return;
    setStatus(`CD不一致 → 9桁扱い ${demoted.num}`);
    built = demoted;
  } else if (built.kind === 10) {
    // スキップモードでも、候補式が全会一致で予測するCDと食い違うなら9桁へ格下げ
    const pred = predictCheckDigit(built.num.slice(0, 9));
    if (pred !== null && String(pred) !== built.num[9]) {
      const demoted = buildNumber(best.value, '', jpUse);
      if (demoted) built = demoted;
    }
  }

  const newState = best.count >= CONFIG.votesToConfirm ? 2 : 1;
  const changedNum = built.num !== lock.num;
  const correctedBig = lock.histAdded && lock.big && best.value !== lock.big;
  const promoted = newState > lock.state;
  const kindUp = built.kind > lock.kind;

  lock.big = best.value;
  lock.num = built.num;
  lock.kind = built.kind;
  lock.state = Math.max(lock.state, newState);

  // ★1票で表示に出すのは「切り出し品質が良い」ときだけ。
  //   品質が低い読みは票としては積むが、2票揃うまで表示しない
  //   （遠くのタグの一発誤読がそのまま暫定表示されるのを防ぐ）
  if (!lock.histAdded && !quality && best.count < 2) {
    setStatus(`読取中… ${big}（もう少し近づけると確定します）`);
    return;
  }

  if (!lock.histAdded) {
    // 暫定でもここで表示する（あとで訂正・格上げされる）
    lock.histAdded = true;
    showConfirmed(built.num, built.kind, lock.state);
    feedback(lock.state === 2);
  } else if (changedNum || kindUp || promoted) {
    showConfirmed(built.num, built.kind, lock.state);
    if (promoted) feedback(true);
    else if (kindUp || changedNum) { if (navigator.vibrate) navigator.vibrate(60); }
  }

  const label = lock.state === 2 ? '確定' : '暫定';
  if (correctedBig) {
    setStatus(`訂正 ${formatNumber(built.num, built.kind)}（${label}・${best.count}/${CONFIG.votesToConfirm}票）`);
  } else if (kindUp) {
    setStatus(`${built.kind}桁に格上げ ${formatNumber(built.num, built.kind)}（${label}）`);
  } else {
    setStatus(`${label} ${formatNumber(built.num, built.kind)}（${best.count}/${CONFIG.votesToConfirm}票・${built.kind}桁）`);
  }

  // 名簿（master.csv）と照合して候補を出す。本確定で1頭に絞れたら自動で検索へ
  onNumberConfirmed(built.num, { kind: built.kind, state: lock.state, at: new Date() });
}

/** 読み取り対象を見失った/リセットするときに呼ぶ */
function resetLock() {
  lock.entries = []; lock.bigs = []; lock.cds = []; lock.jps = [];
  lock.big = ''; lock.num = ''; lock.kind = 0; lock.state = 0; lock.histAdded = false;
}

const KIND_LABEL = { 10: '10桁 完全', 9: '9桁 CD無', 5: '5桁 下段のみ', 4: '4桁 大のみ' };

/** 桁数に応じた区切り表示（10桁=5-4-1 / 9桁=5-4 / 5桁=4-1 / 4桁=そのまま） */
function formatNumber(n, kind) {
  if (!kind) kind = n.length;
  if (kind === 10) return n.slice(0, 5) + ' ' + n.slice(5, 9) + ' ' + n.slice(9);
  if (kind === 9) return n.slice(0, 5) + ' ' + n.slice(5);
  if (kind === 5) return n.slice(0, 4) + ' ' + n.slice(4);
  return n;
}

/* =====================================================================
 * フィードバック（音・バイブ）
 * =================================================================== */
let audioCtx = null;
function feedback(isFinal) {
  if (navigator.vibrate) navigator.vibrate(isFinal ? 120 : 45);
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    const notes = isFinal ? [[1318, 0, 0.09], [1760, 0.1, 0.14]] : [[988, 0, 0.07]];
    for (const [freq, start, dur] of notes) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain); gain.connect(audioCtx.destination);
      gain.gain.setValueAtTime(0.25, t + start);
      gain.gain.exponentialRampToValueAtTime(0.001, t + start + dur);
      osc.start(t + start); osc.stop(t + start + dur);
    }
  } catch (e) { /* 音は最善努力 */ }
}


function drawOverlay(cands, ww, wh) {
  const dw = overlay.clientWidth, dh = overlay.clientHeight;
  if (overlay.width !== dw || overlay.height !== dh) { overlay.width = dw; overlay.height = dh; }
  octx.clearRect(0, 0, dw, dh);
  if (!cands || !cands.length) return;
  // object-fit: cover の座標補正
  const videoAspect = ww / wh, dispAspect = dw / dh;
  let sx, sy, offX = 0, offY = 0;
  if (dispAspect > videoAspect) {
    sx = dw / ww; sy = sx;
    offY = (dh - wh * sy) / 2;
  } else {
    sy = dh / wh; sx = sy;
    offX = (dw - ww * sx) / 2;
  }
  // 採用中の候補は太い黄（確定後は緑）、その他の候補は細いグレーで描く
  for (const c of cands) {
    const isChosen = chosenBlob && Math.abs(c.cx - chosenBlob.cx) < 8 && Math.abs(c.cy - chosenBlob.cy) < 8;
    if (isChosen || cands.length === 1) {
      octx.strokeStyle = lock.state === 2 ? '#7bd88f' : (lock.state === 1 ? '#ffa94d' : '#f5c400');
      octx.lineWidth = 3;
    } else {
      octx.strokeStyle = 'rgba(255,255,255,0.35)';
      octx.lineWidth = 1.5;
    }
    octx.strokeRect(c.minX * sx + offX, c.minY * sy + offY, c.w * sx, c.h * sy);
  }
}

function drawMaskPreview(mask, w, h) {
  const c = ui.dbgMask;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let p = 0; p < mask.length; p++) {
    const v = mask[p] ? 255 : 0;
    img.data[p * 4] = v; img.data[p * 4 + 1] = v; img.data[p * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function previewCanvas(dst, src) {
  dst.width = src.width; dst.height = src.height;
  dst.getContext('2d').drawImage(src, 0, 0);
}

/* =====================================================================
 * カメラ制御（iOS Safari 対応）
 * =================================================================== */
let stream = null;

async function startCamera() {
  stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'environment',
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  setupTorch();
}

function setupTorch() {
  const btn = $('ocrTorch');
  const track = stream && stream.getVideoTracks()[0];
  let hasTorch = false;
  try { hasTorch = !!(track && track.getCapabilities && track.getCapabilities().torch); } catch (e) {}
  if (!hasTorch) { btn.style.display = 'none'; return; }   // iOS Safariでは効かないため非表示
  btn.style.display = '';
  let on = false;
  btn.onclick = async () => {
    on = !on;
    try {
      await track.applyConstraints({ advanced: [{ torch: on }] });
      btn.classList.toggle('on', on);
    } catch (e) { btn.style.display = 'none'; }
  };
}

// バックグラウンド復帰でストリームが死んでいたら再取得
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !running) return;
  const track = stream && stream.getVideoTracks()[0];
  if (!track || track.readyState === 'ended') {
    try {
      await startCamera();
      setStatus('カメラ再開');
    } catch (e) {
      setStatus('カメラ再取得に失敗。ページを再読み込みしてください');
    }
  }
});

/* =====================================================================
 * 画面表示
 * =================================================================== */
let opts = { lookup: () => [], onSelect: () => {} };
let finished = false;

function setStatus(msg) { statusText.textContent = msg; }

/** 番号が表示・更新されるたびに呼ばれる（外部連携の一点集約）。
 *  meta: { kind(4|5|9|10), state(1=暫定 2=本確定), at(Date) } */
function onNumberConfirmed(number, meta) {
  updateMatches(number, meta.kind, meta.state);
}

function showConfirmed(num, kind, state) {
  ui.number.textContent = formatNumber(num, kind);
  ui.number.dataset.num = num;
  ui.number.dataset.kind = kind;
  ui.number.classList.toggle('provisional', state !== 2);
  ui.hint.textContent = state === 2
    ? `確定（${KIND_LABEL[kind] || kind + '桁'}）`
    : `暫定（${KIND_LABEL[kind] || kind + '桁'}）— 読み取り継続中`;
}

function clearDisplay() {
  ui.number.textContent = '';
  ui.number.dataset.num = '';
  ui.matches.innerHTML = '';
  ui.hint.textContent = '耳標（黄色タグ）の数字にカメラを向けてください';
}

function fmtId(id) {
  return id.length === 10 ? `${id.slice(0, 5)}-${id.slice(5, 9)}-${id.slice(9)}` : id;
}

/** 読み取り結果を名簿と照合し、候補ボタンを出す。本確定＋1頭なら自動で検索 */
function updateMatches(num, kind, state) {
  if (finished) return;
  let list = [];
  try { list = opts.lookup(num, kind) || []; } catch (e) { console.error(e); }

  ui.matches.innerHTML = '';
  if (!list.length) {
    const p = document.createElement('div');
    p.className = 'ocr-nomatch';
    p.textContent = kind === 10
      ? '名簿に該当する牛がいません（数字をタップすると入力欄に入れます）'
      : '名簿に該当なし — もう少し近づけると桁が増えます';
    ui.matches.appendChild(p);
    return;
  }

  if (list.length === 1 && state === 2 && CONFIG.autoSelectOnConfirm) {
    finish(list[0].id);
    return;
  }

  const head = document.createElement('div');
  head.className = 'ocr-match-head';
  head.textContent = list.length === 1 ? '該当 1頭（タップで表示）' : `該当 ${list.length}頭 — タップで選択`;
  ui.matches.appendChild(head);
  for (const m of list.slice(0, 6)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ocr-match';
    btn.innerHTML = `<span class="ocr-match-id">${fmtId(m.id)}</span><span class="ocr-match-status">${m.status || '在籍'}</span>`;
    btn.addEventListener('click', () => finish(m.id));
    ui.matches.appendChild(btn);
  }
  if (list.length > 6) {
    const more = document.createElement('div');
    more.className = 'ocr-match-head';
    more.textContent = `ほか ${list.length - 6}頭。近づけて桁を増やすと絞り込めます`;
    ui.matches.appendChild(more);
  }
}

// 読み取った数字そのものをタップ → そのまま入力欄へ（名簿に無い番号でも使えるように）
ui.number.addEventListener('click', () => {
  const num = ui.number.dataset.num;
  if (num) finish(num);
});

function finish(id) {
  if (finished) return;
  finished = true;
  feedback(true);
  close();
  opts.onSelect(id);
}

/* =====================================================================
 * 開閉
 * =================================================================== */
let cdTested = false;
let workerInitPromise = null;   // 初期化は1度だけ（初期化中に開き直しても二重起動しない）

async function open(options) {
  opts = Object.assign({ lookup: () => [], onSelect: () => {} }, options || {});
  if (!cdTested) { ui.dbgCd.textContent = runCheckDigitSelfTest(); cdTested = true; }
  finished = false;
  resetLock();
  clearDisplay();
  chosenBlob = null; prevCands = []; stableCount = 0;
  root.classList.add('open');
  document.body.classList.add('ocr-open');
  setStatus('カメラ起動中…');
  try {
    await startCamera();
  } catch (e) {
    close();
    let msg = 'カメラを起動できませんでした。';
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
      msg += '\n【重要】iPhoneでは https:// での接続が必須です。';
    } else {
      msg += '\nブラウザのカメラ権限を確認するか、ページを再読み込みしてください。';
    }
    throw new Error(msg);
  }
  running = true;
  loopGen++;
  tick(loopGen);
  if (!workerReady) {
    if (typeof Tesseract === 'undefined') {
      setStatus('OCRエンジンを読み込めませんでした（ネット接続を確認）');
      return;
    }
    if (!workerInitPromise) workerInitPromise = initWorker();
    try { await workerInitPromise; }
    catch (e) { workerInitPromise = null; worker = null; setStatus('OCRエンジン初期化に失敗: ' + e.message); }
  } else {
    setStatus('準備完了。耳標にかざしてください');
  }
}

function close() {
  running = false;
  loopGen++;
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  video.srcObject = null;
  octx.clearRect(0, 0, overlay.width, overlay.height);
  root.classList.remove('open');
  document.body.classList.remove('ocr-open');
}

$('ocrClose').addEventListener('click', close);

window.EarTagScanner = { open, close, formatNumber };
})();
