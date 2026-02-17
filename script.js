// ==========================================
// グローバル変数定義
// ==========================================
let masterData = [];
let weightData = [];
let isDataLoaded = false;
let html5QrCode = null;
let myChart = null;

// ==========================================
// 初期化処理
// ==========================================
window.onload = function () {
  loadAllData();
};

// ==========================================
// データ読み込み処理
// ==========================================
async function loadAllData() {
  const loading = document.getElementById('loading');
  const errorArea = document.getElementById('error');
  loading.style.display = 'block';

  try {
    const [masterRes, weightRes] = await Promise.all([
      fetch('master.csv').then(res => {
        if (!res.ok) throw new Error("master.csvが見つかりません");
        return res.text();
      }),
      fetch('weight.csv').then(res => {
        if (!res.ok) throw new Error("weight.csvが見つかりません");
        return res.text();
      })
    ]);

    Papa.parse(masterRes, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => masterData = results.data
    });

    Papa.parse(weightRes, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => weightData = results.data
    });

    isDataLoaded = true;
    loading.style.display = 'none';

  } catch (error) {
    console.error(error);
    if (errorArea) errorArea.textContent = "データの読み込みに失敗しました";
    loading.style.display = 'none';
  }
}

// ==========================================
// ビープ音再生 (Web Audio API)
// ==========================================
function playBeep() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';       // 音色: 正弦波
    osc.frequency.value = 1500; // 周波数: 1500Hz (高めのピッ音)
    gain.gain.value = 0.1;   // 音量: 小さめ

    osc.start();
    setTimeout(() => {
      osc.stop();
      ctx.close();
    }, 100); // 0.1秒間再生
  } catch (e) {
    console.error("Audio play failed", e);
  }
}

// ==========================================
// カメラ起動処理
// ==========================================
// function startCamera() {
//   const errorArea = document.getElementById('error');
//   errorArea.textContent = "";

//   const readerElement = document.getElementById('qr-reader') || document.getElementById('reader');
//   if (!readerElement) {
//     alert("カメラ表示エリアが見つかりません");
//     return;
//   }

//   readerElement.style.display = 'block';

//   if (html5QrCode) {
//     html5QrCode.stop().then(() => {
//       html5QrCode.clear();
//       initAndStart(readerElement.id);
//     }).catch(err => {
//       console.log("Stop failed", err);
//       initAndStart(readerElement.id);
//     });
//   } else {
//     initAndStart(readerElement.id);
//   }
// }

// function startCamera() {
//   const reader = document.getElementById('qr-reader');
//   reader.style.display = 'block';

//   // すでに起動している場合は停止してから再起動
//   if (html5QrCode) {
//     html5QrCode.stop().then(() => {
//       html5QrCode.clear();
//       initCamera();
//     }).catch(err => {
//       console.error("Failed to stop camera", err);
//     });
//   } else {
//     initCamera();
//   }
// }

// function initCamera() {
//   html5QrCode = new Html5Qrcode("qr-reader");

//   // 【改善点1】読み取るフォーマットを限定する
//   // 牛の耳標でよく使われる "CODE_128" だけにする（必要に応じて ITF など追加）
//   // QRコードも読む必要がある場合は Html5QrcodeSupportedFormats.QR_CODE を配列に加える
//   const formatsToSupport = [
//     Html5QrcodeSupportedFormats.CODE_128,
//     // Html5QrcodeSupportedFormats.ITF, 
//   ];

//   const config = {
//     // 【改善点3】FPSを上げる (10 -> 20)
//     fps: 20, 
    
//     // 【改善点2】読み取り枠をバーコードに合わせて横長にする
//     qrbox: { width: 300, height: 100 },
    
//     // フォーマット設定を適用
//     formatsToSupport: formatsToSupport,
    
//     // 実験的機能：フォーカスモードのサポート（対応端末のみ有効）
//     videoConstraints: {
//         focusMode: "continuous"
//     }
//   };

//   html5QrCode.start(
//     { facingMode: "environment" },
//     config,
//     onScanSuccess,
//     onScanFailure
//   ).catch(err => {
//     console.error("カメラ起動エラー:", err);
//     alert("カメラの起動に失敗しました。権限を確認してください。");
//   });
// }

// function initAndStart(elementId) {
//   html5QrCode = new Html5Qrcode(elementId);
//   const config = {
//     fps: 10,
//     qrbox: { width: 250, height: 250 },
//     aspectRatio: 1.0
//   };

//   html5QrCode.start(
//     { facingMode: "environment" },
//     config,
//     (decodedText) => {
//       const match = decodedText.match(/\d{10}/);
//       if (match) {
//         // --- 音とバイブレーション ---
//         playBeep();
//         if (navigator.vibrate) {
//           navigator.vibrate(200);
//         }

//         document.getElementById('tagInput').value = match[0];
//         stopCamera();
//         searchCattle();
//       }
//     },
//     (errorMessage) => { }
//   ).catch(err => {
//     console.error(err);
//     document.getElementById('error').textContent = "カメラを起動できませんでした。HTTPS接続か確認してください。";
//     stopCamera();
//   });
// }

// function stopCamera() {
//   const readerElement = document.getElementById('qr-reader') || document.getElementById('reader');
//   if (html5QrCode) {
//     html5QrCode.stop().then(() => {
//       html5QrCode.clear();
//       if (readerElement) readerElement.style.display = 'none';
//       html5QrCode = null;
//     }).catch(err => {
//       console.log(err);
//     });
//   } else {
//     if (readerElement) readerElement.style.display = 'none';
//   }
// }

// ==========================================
// カメラ起動処理 (iPhone修正 & 高速化版)
// ==========================================
// function startCamera() {
//   const errorArea = document.getElementById('error');
//   errorArea.textContent = "";

//   const readerElement = document.getElementById('qr-reader');
//   if (!readerElement) {
//     alert("カメラ表示エリアが見つかりません");
//     return;
//   }

//   // 【iPhone対策】先に表示領域を確保しないと初期化に失敗することがある
//   readerElement.style.display = 'block';

//   // 既にインスタンスがある場合は停止処理を試みる
//   if (html5QrCode) {
//     html5QrCode.stop().then(() => {
//       html5QrCode.clear();
//       initAndStart(readerElement.id);
//     }).catch(err => {
//       console.log("Stop failed", err);
//       // 停止に失敗しても強制的に再作成を試みる
//       html5QrCode.clear();
//       initAndStart(readerElement.id);
//     });
//   } else {
//     initAndStart(readerElement.id);
//   }
// }

// ==========================================
// カメラ起動処理
// ==========================================
function startCamera() {
  const resultArea = document.getElementById('result');
  const qrReader = document.getElementById('qr-reader');

  resultArea.style.display = 'none';
  qrReader.style.display = 'block';

  // もし既に起動していたら止める（念のため）
  if (html5QrCode) {
    html5QrCode.stop().then(() => {
      html5QrCode.clear();
    }).catch(err => {
      console.log("Stop failed: ", err);
    });
  }

  // ★変更点1：読み取りフォーマットを GS1-128 (CODE_128) に限定する
  // これにより、QRコードなどを探す無駄な処理が減り、感度が上がります
  const formatsToSupport = [ Html5QrcodeSupportedFormats.CODE_128 ];

  // インスタンス作成時にフォーマット指定を渡す
  html5QrCode = new Html5Qrcode("qr-reader", { 
    formatsToSupport: formatsToSupport,
    experimentalFeatures: {
      useBarCodeDetectorIfSupported: true // ブラウザネイティブの機能が使えれば使う
    }
  });

  // ★変更点2：設定の調整
  const config = {
    fps: 15, // フレームレートを少し上げる (デフォルト10 → 15)
    // バーコードは横長なので、正方形ではなく横長のボックスにする
    qrbox: { width: 300, height: 150 }, 
    aspectRatio: 1.0
  };

  // ★変更点3：カメラの解像度とフォーカス設定を強化
  // const videoConstraints = {
  //   facingMode: "environment", // 外側カメラ
  //   width: { min: 1280, ideal: 1920, max: 2560 }, // できるだけ高解像度を要求
  //   height: { min: 720, ideal: 1080, max: 1440 },
  //   focusMode: "continuous" // オートフォーカスを継続（対応ブラウザのみ）
  // };

  // ★修正：iPhone対応版のカメラ設定（制約を緩める）
  const videoConstraints = {
    facingMode: "environment", // 外側カメラ
    // "min" を消して "ideal"（推奨）だけにします。
    // これなら対応できない解像度でもエラーにならず、可能な最高画質になります。
    width: { ideal: 1920 },
    height: { ideal: 1080 }
    // focusMode は iOS Safari でエラーの原因になることがあるため一旦削除します
  };
  
  // startメソッドの第一引数を object 形式に変更して詳細なカメラ設定を渡す
  html5QrCode.start(
    videoConstraints, 
    config,
    onScanSuccess,
    onScanFailure
  ).catch(err => {
    console.error("カメラ起動エラー:", err);
    alert("カメラの起動に失敗しました。\nブラウザのカメラ権限を確認してください。");
  });
}

function initAndStart(elementId) {
  // インスタンス作成
  html5QrCode = new Html5Qrcode(elementId);

  // 【高速化】Code 128（牛の耳標）のみに限定して処理を軽くする
  const formatsToSupport = [
     Html5QrcodeSupportedFormats.CODE_128 
  ];

  const config = {
    // 【高速化】FPSを上げて、ブレている一瞬の隙に読み取る (10 -> 20)
    fps: 20,
    
    // 【高速化】横長のバーコードに合わせて読み取り枠を横長にする
    // iPhoneの画面からはみ出さないよう少し幅を調整 (300 -> 250)
    qrbox: { width: 250, height: 100 },
    
    // アスペクト比指定（未指定の方がモバイルでは安定する場合があるため削除または1.0）
    aspectRatio: 1.0,

    formatsToSupport: formatsToSupport
  };

  html5QrCode.start(
    // リアカメラを指定
    { facingMode: "environment" },
    config,
    (decodedText) => {
      // 読み取り成功時の処理
      const match = decodedText.match(/\d{10}/);
      if (match) {
        playBeep();
        
        // iPhoneではvibrateが効かないことが多いですが一応記述
        if (navigator.vibrate) {
          navigator.vibrate(200);
        }

        document.getElementById('tagInput').value = match[0];
        stopCamera();
        searchCattle();
      }
    },
    (errorMessage) => { 
      // 読み取り待機中のエラーは無視（コンソールに出すと重くなるので何もしない）
    }
  ).catch(err => {
    console.error(err);
    
    // 具体的なエラーメッセージを表示
    let msg = "カメラを起動できませんでした。";
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
      msg += "\n【重要】iPhoneでは https:// での接続が必須です。";
    } else {
      msg += "\nブラウザのカメラ権限を確認するか、ページを再読み込みしてください。";
    }
    document.getElementById('error').innerText = msg;
    
    stopCamera();
  });
}

function stopCamera() {
  const readerElement = document.getElementById('qr-reader');
  if (html5QrCode) {
    html5QrCode.stop().then(() => {
      html5QrCode.clear();
      if (readerElement) readerElement.style.display = 'none';
      html5QrCode = null; // 変数をリセット
    }).catch(err => {
      console.log("Stop error:", err);
      // エラーでも表示は消す
      if (readerElement) readerElement.style.display = 'none';
      html5QrCode = null;
    });
  } else {
    if (readerElement) readerElement.style.display = 'none';
  }
}

// ==========================================
// 検索実行処理
// ==========================================
function searchCattle() {
  if (!isDataLoaded) { alert("データ読み込み中です"); return; }

  const inputId = document.getElementById('tagInput').value.trim();
  const resultArea = document.getElementById('result');
  const errorArea = document.getElementById('error');

  errorArea.textContent = "";
  resultArea.style.display = 'none';
  resultArea.className = 'result-card';

  if (!inputId) {
    errorArea.textContent = "番号を入力してください";
    return;
  }

  const originalCow = masterData.find(row => row['個体識別番号'] === inputId);
  if (!originalCow) {
    errorArea.textContent = "該当する牛が見つかりませんでした";
    return;
  }

  const cow = { ...originalCow };
  const todayStr = new Date().toISOString().split('T')[0];
  const statusText = (cow['ステータス'] || '').trim();
  const isWatch = (cow['注視'] && ['○', '〇', '●'].includes(cow['注視'].trim()));

  const getDaysDiff = (startStr, endStr) => {
    if (!startStr || !endStr) return null;
    const s = new Date(startStr);
    const e = new Date(endStr);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return null;
    return Math.floor((e - s) / (1000 * 60 * 60 * 24));
  };

  const getAge = (birth, end) => {
    const days = getDaysDiff(birth, end);
    return days !== null ? (days / 365.25).toFixed(1) : null;
  };

  let excludeKeys = ['ステータス', '個体識別番号', '注視', '購買日', '導入時', '出荷時体重'];
  const headerInfo = document.querySelector('.header-info');
  const resId = document.getElementById('resId');
  headerInfo.innerHTML = '';
  headerInfo.appendChild(resId);

  const rawId = cow['個体識別番号'] || "";
  resId.textContent = rawId.length === 10 ? `${rawId.slice(0, 5)}-${rawId.slice(5)}` : rawId;

  const addBadge = (text, cssClass) => {
    const span = document.createElement('span');
    span.className = `status-badge ${cssClass}`;
    span.textContent = text;
    headerInfo.appendChild(span);
  };

  let ageBaseDate = null;

  if (statusText === '死亡') {
    resultArea.classList.add('status-dead');
    addBadge('死亡', 'badge-dead');
    excludeKeys.push('牛舎');
    ageBaseDate = cow['屠畜日'];
    if (cow['オメガ開始日'] && cow['屠畜日']) {
      const diff = getDaysDiff(cow['オメガ開始日'], cow['屠畜日']);
      cow['オメガ開始日'] = `${cow['オメガ開始日']} (${diff}日)`;
    }

  } else if (statusText === '淘汰') {
    resultArea.classList.add('status-cull');
    addBadge('淘汰', 'badge-cull');
    excludeKeys.push('牛舎');
    ageBaseDate = cow['屠畜日'];
    if (cow['オメガ開始日'] && cow['屠畜日']) {
      const diff = getDaysDiff(cow['オメガ開始日'], cow['屠畜日']);
      cow['オメガ開始日'] = `${cow['オメガ開始日']} (${diff}日)`;
    }

  } else if (statusText === '出荷') {
    resultArea.classList.add('status-ship');
    addBadge('出荷', 'badge-ship');
    excludeKeys.push('牛舎');
    ageBaseDate = cow['屠畜日'];
    if (cow['オメガ開始日'] && cow['屠畜日']) {
      const diff = getDaysDiff(cow['オメガ開始日'], cow['屠畜日']);
      cow['オメガ開始日'] = `${cow['オメガ開始日']} (${diff}日)`;
    }

    if (cow['枝重'] && cow['単価']) {
      const w = parseFloat(cow['枝重'].replace(/,/g, ''));
      const p = parseFloat(cow['単価'].replace(/,/g, ''));
      if (!isNaN(w) && !isNaN(p)) cow['値段'] = Math.floor(w * p).toLocaleString();
    }
    if (cow['枝重'] && cow['出荷時体重']) {
      const carcass = parseFloat(cow['枝重'].replace(/,/g, ''));
      const shipWeight = parseFloat(cow['出荷時体重'].replace(/,/g, ''));
      if (!isNaN(carcass) && !isNaN(shipWeight) && shipWeight > 0) {
        const yieldRate = (carcass / shipWeight * 100).toFixed(1);
        cow['歩留'] = `${yieldRate}%`;
      }
    }

  } else if (statusText === '') {
    addBadge('在籍', 'badge-active');
    if (isWatch) {
      addBadge('注視', 'badge-watch');
      resultArea.classList.add('status-alert');
    }
    ageBaseDate = todayStr;
    if (cow['オメガ開始日']) {
      const diff = getDaysDiff(cow['オメガ開始日'], todayStr);
      if (diff !== null) cow['オメガ開始日'] = `${cow['オメガ開始日']} (${diff}日)`;
    }

  } else {
    addBadge(statusText, 'badge-active');
    ageBaseDate = todayStr;
  }

  if (cow['生年月日'] && ageBaseDate) {
    const age = getAge(cow['生年月日'], ageBaseDate);
    if (age) cow['生年月日'] = `${cow['生年月日']} (${age}才)`;
  }

  const grid = document.getElementById('allInfoGrid');
  grid.innerHTML = '';
  Object.keys(cow).forEach(key => {
    if (!excludeKeys.includes(key) && cow[key] && cow[key].toString().trim() !== "") {
      const div = document.createElement('div');
      div.className = 'info-item';
      div.innerHTML = `<div class="info-label">${key}</div><div class="info-value">${cow[key]}</div>`;
      grid.appendChild(div);
    }
  });

  let combinedWeights = weightData.filter(row => row['個体識別番号'] === inputId).map(w => {
    return { date: w['体重測定日'], weight: parseFloat(w['体重']), note: w['報告'] || '' };
  });
  if (cow['導入日'] && originalCow['導入時']) {
    combinedWeights.push({ date: cow['導入日'].split(' ')[0], weight: parseFloat(originalCow['導入時']), note: '導入時' });
  }
  if (statusText === '出荷' && cow['屠畜日'] && originalCow['出荷時体重']) {
    combinedWeights.push({ date: cow['屠畜日'], weight: parseFloat(originalCow['出荷時体重']), note: '出荷時' });
  }

  combinedWeights.sort((a, b) => new Date(a.date) - new Date(b.date));

  const tbody = document.querySelector('#weightTable tbody');
  tbody.innerHTML = '';
  combinedWeights.forEach(w => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${w.date}</td><td>${w.weight} kg</td><td>${w.note}</td>`;
    tbody.appendChild(tr);
  });

  resultArea.style.display = 'block';
  drawChart(combinedWeights);
}

// ==========================================
// グラフ描画 (Chart.js)
// ==========================================
function drawChart(data) {
  const ctx = document.getElementById('weightChart').getContext('2d');

  if (myChart) {
    myChart.destroy();
  }

  const labels = data.map(d => d.date);
  const weights = data.map(d => d.weight);

  myChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: '体重 (kg)',
        data: weights,
        borderColor: '#3498db',
        backgroundColor: 'rgba(52, 152, 219, 0.2)',
        borderWidth: 2,
        tension: 0.1,
        pointRadius: 4,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          // --- 変更点: データ範囲に合わせて自動調整 (suggestedMinを削除) ---
          beginAtZero: false
        }
      }
    }
  });
}