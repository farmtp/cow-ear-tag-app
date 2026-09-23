// ==========================================
// グローバル変数定義
// ==========================================
let masterData = [];
let weightData = [];
let isDataLoaded = false;
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
    if (errorArea) {
      errorArea.textContent = location.protocol === 'file:'
        ? "データの読み込みに失敗しました。ファイルを直接開くとCSVを読めません。ローカルサーバー（http://localhost）経由で開いてください。"
        : "データの読み込みに失敗しました";
    }
    loading.style.display = 'none';
  }
}

// ==========================================
// 耳標番号の部分一致検索
// ------------------------------------------
// OCRは距離によって読める桁数が変わる（4 / 5 / 9 / 10桁）。
// 耳標の並び「上段5桁 + 大きい4桁 + CD1桁」に合わせて照合する。
//   10桁: 完全一致
//    9桁: 先頭9桁（CD無し）
//    5桁: 下5桁（大きい4桁 + CD）
//    4桁: 6〜9桁目（大きい4桁）
// ==========================================
function findCattleByPartial(num, kind) {
  kind = kind || num.length;
  const seen = new Set();
  const out = [];
  for (const row of masterData) {
    const id = (row['個体識別番号'] || '').trim();
    if (id.length !== 10 || seen.has(id)) continue;
    let hit = false;
    if (kind === 10) hit = id === num;
    else if (kind === 9) hit = id.startsWith(num);
    else if (kind === 5) hit = id.slice(5) === num;
    else if (kind === 4) hit = id.slice(5, 9) === num;
    if (hit) {
      seen.add(id);
      out.push({ id, status: (row['ステータス'] || '').trim() });
    }
  }
  // 在籍中（ステータス空欄）の牛を先頭に
  out.sort((a, b) => (a.status ? 1 : 0) - (b.status ? 1 : 0));
  return out;
}

// ==========================================
// カメラ起動処理（耳標の数字をOCRで読み取る）
// 読み取りエンジンは ocr-scanner.js（interbcd から移植）
// ==========================================
async function startCamera() {
  const errorArea = document.getElementById('error');
  errorArea.textContent = "";

  if (!window.EarTagScanner) {
    errorArea.textContent = "読み取り機能を読み込めませんでした。ページを再読み込みしてください。";
    return;
  }

  try {
    await EarTagScanner.open({
      lookup: (num, kind) => (isDataLoaded ? findCattleByPartial(num, kind) : []),
      onSelect: (id) => {
        document.getElementById('tagInput').value = id;
        searchCattle();
      }
    });
  } catch (err) {
    console.error(err);
    errorArea.innerText = err.message || "カメラを起動できませんでした。";
  }
}

function stopCamera() {
  if (window.EarTagScanner) EarTagScanner.close();
}

// 候補が複数あるときに一覧を出す（手入力で4桁・5桁を入れた場合など）
function showCandidateList(list) {
  const errorArea = document.getElementById('error');
  errorArea.innerHTML = '';
  const p = document.createElement('div');
  p.textContent = `該当が${list.length}頭あります。選択してください：`;
  errorArea.appendChild(p);
  const wrap = document.createElement('div');
  wrap.className = 'candidate-list';
  list.forEach(m => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'candidate-btn';
    btn.textContent = `${m.id.slice(0, 5)}-${m.id.slice(5)}（${m.status || '在籍'}）`;
    btn.onclick = () => {
      document.getElementById('tagInput').value = m.id;
      searchCattle();
    };
    wrap.appendChild(btn);
  });
  errorArea.appendChild(wrap);
}

// ==========================================
// 検索実行処理
// ==========================================
function searchCattle() {
  if (!isDataLoaded) { alert("データ読み込み中です"); return; }

  let inputId = document.getElementById('tagInput').value.trim().replace(/[\s-]/g, '');
  const resultArea = document.getElementById('result');
  const errorArea = document.getElementById('error');

  errorArea.textContent = "";
  resultArea.style.display = 'none';
  resultArea.className = 'result-card';

  if (!inputId) {
    errorArea.textContent = "番号を入力してください";
    return;
  }

  let originalCow = masterData.find(row => row['個体識別番号'] === inputId);

  // 完全一致しない場合、4桁（大きい数字）・5桁・9桁なら部分一致で探す
  if (!originalCow && /^\d+$/.test(inputId) && [4, 5, 9].includes(inputId.length)) {
    const list = findCattleByPartial(inputId);
    if (list.length === 1) {
      inputId = list[0].id;
      document.getElementById('tagInput').value = inputId;
      originalCow = masterData.find(row => row['個体識別番号'] === inputId);
    } else if (list.length > 1) {
      showCandidateList(list);
      return;
    }
  }

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