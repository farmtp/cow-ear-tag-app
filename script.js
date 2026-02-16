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

    // PapaParseでCSVを解析
    Papa.parse(masterRes, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => { masterData = results.data; }
    });

    Papa.parse(weightRes, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => { weightData = results.data; }
    });

    isDataLoaded = true;
    loading.style.display = 'none';

  } catch (error) {
    console.error(error);
    if (errorArea) errorArea.innerText = "データの読み込みに失敗しました。ファイル名を確認してください。";
    loading.style.display = 'none';
  }
}

// ==========================================
// 検索・表示メイン処理
// ==========================================
function searchCattle() {
  if (!isDataLoaded) return;

  const tagInput = document.getElementById('tagInput');
  const tag = tagInput.value.trim();
  const resultArea = document.getElementById('result');
  const errorArea = document.getElementById('error');

  errorArea.innerText = '';
  resultArea.style.display = 'none';

  if (!tag) {
    errorArea.innerText = '個体識別番号を入力してください。';
    return;
  }

  // 1. 個体情報を検索 (型を文字列に統一して比較)
  const cow = masterData.find(d => String(d['個体識別番号']).trim() === String(tag));

  if (!cow) {
    errorArea.innerText = '該当する牛が見つかりませんでした。';
    return;
  }

  // 2. 基本情報の表示
  document.getElementById('resId').innerText = `個体番号: ${tag}`;
  const grid = document.getElementById('allInfoGrid');
  grid.innerHTML = '';

  // ステータスバッジの作成
  const status = cow['ステータス'] || '不明';
  let badgeClass = 'badge-active';
  if (status === '出荷') badgeClass = 'badge-ship';
  if (status === '淘汰') badgeClass = 'badge-cull';
  if (status === '死亡') badgeClass = 'badge-dead';
  if (cow['注視'] && cow['注視'].trim() !== "") badgeClass = 'badge-watch';

  const statusHtml = `
    <div class="info-item">
      <span class="info-label">ステータス</span>
      <span class="status-badge ${badgeClass}">${status} ${cow['注視'] || ''}</span>
    </div>
  `;
  grid.innerHTML += statusHtml;

  // その他の項目を表示
  const displayFields = [
    '生年月日', '導入日', '市場', '牛舎', '導入時', '落札金額', 'コメント', '注意'
  ];

  displayFields.forEach(field => {
    if (cow[field]) {
      const item = document.createElement('div');
      item.className = 'info-item';
      item.innerHTML = `<span class="info-label">${field}</span><span class="info-value">${cow[field]}</span>`;
      grid.innerHTML += item.innerHTML;
    }
  });

  // 3. 体重データの集計
  let combinedWeights = [];

  // 導入時体重
  const introWeight = parseFloat(cow['導入時']);
  if (!isNaN(introWeight) && cow['導入日']) {
    combinedWeights.push({ date: cow['導入日'], weight: introWeight, note: '導入時' });
  }

  // 履歴データ (weight.csvから検索)
  const history = weightData.filter(d => String(d['個体識別番号']).trim() === String(tag));
  history.forEach(h => {
    const w = parseFloat(h['体重']);
    if (!isNaN(w)) {
      combinedWeights.push({ 
        date: h['体重測定日'], 
        weight: w, 
        note: h['報告'] || '' 
      });
    }
  });

  // 出荷時体重
  const shipWeight = parseFloat(cow['出荷時体重']);
  if (!isNaN(shipWeight) && cow['屠畜日']) {
    combinedWeights.push({ date: cow['屠畜日'], weight: shipWeight, note: '出荷時' });
  }

  // 日付順に並び替え
  combinedWeights.sort((a, b) => new Date(a.date) - new Date(b.date));

  // 4. テーブル表示
  const tbody = document.querySelector('#weightTable tbody');
  tbody.innerHTML = '';
  combinedWeights.forEach(w => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${w.date}</td><td>${w.weight} kg</td><td>${w.note}</td>`;
    tbody.appendChild(tr);
  });

  resultArea.style.display = 'block';

  // 5. グラフ描画
  if (combinedWeights.length > 0) {
    drawChart(combinedWeights);
  } else {
    if (myChart) myChart.destroy();
    // データがない場合はグラフエリアを隠すか、メッセージを出す処理をここに追加可能
  }
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
        borderWidth: 3,
        pointRadius: 5,
        pointBackgroundColor: '#3498db',
        tension: 0.1, // グラフの曲がり具合
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: false,
          title: { display: true, text: '体重 (kg)' }
        },
        x: {
          title: { display: true, text: '測定日' }
        }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

// ==========================================
// カメラ（QRコードリーダー）制御
// ==========================================
function startCamera() {
  const readerEl = document.getElementById('qr-reader');
  readerEl.style.display = 'block';

  if (!html5QrCode) {
    html5QrCode = new Html5Qrcode("qr-reader");
  }

  const config = { fps: 10, qrbox: { width: 250, height: 150 } };

  html5QrCode.start(
    { facingMode: "environment" },
    config,
    (decodedText) => {
      document.getElementById('tagInput').value = decodedText;
      stopCamera();
      searchCattle();
    },
    (errorMessage) => {
      // 読み取り失敗時は何もしない
    }
  ).catch(err => {
    alert("カメラの起動に失敗しました: " + err);
  });
}

function stopCamera() {
  if (html5QrCode) {
    html5QrCode.stop().then(() => {
      document.getElementById('qr-reader').style.display = 'none';
    });
  }
}