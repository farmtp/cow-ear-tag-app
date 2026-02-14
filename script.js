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
window.onload = function() {
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
        errorArea.textContent = "データの読み込みに失敗しました。";
        loading.style.display = 'none';
    }
}

// ==========================================
// 検索実行処理
// ==========================================
function searchCattle() {
    if (!isDataLoaded) { alert("データ読み込み中です。"); return; }

    const inputId = document.getElementById('tagInput').value.trim();
    const resultArea = document.getElementById('result');
    const errorArea = document.getElementById('error');
    
    errorArea.textContent = "";
    resultArea.style.display = 'none';

    // クラスのリセット（注視のピンク色などが残らないように）
    resultArea.classList.remove('alert-mode');

    if (!inputId) {
        errorArea.textContent = "番号を入力してください";
        return;
    }

    // 1. マスタデータ検索
    const cow = masterData.find(row => row['個体識別番号'] === inputId);

    if (!cow) {
        errorArea.textContent = "該当する牛が見つかりませんでした。";
        return;
    }

    // ★追加機能: 「注視」が「○」の場合の処理
    if (cow['注視'] && cow['注視'].trim() === '○') {
        resultArea.classList.add('alert-mode'); // 全体をピンクにする
    }

    // 2. ヘッダー情報の表示
    document.getElementById('resId').textContent = cow['個体識別番号'];
    
    // ステータスの色分け
    const statusEl = document.getElementById('resStatus');
    const statusText = cow['ステータス'] || '在籍';
    statusEl.textContent = statusText;
    statusEl.className = 'status-badge';
    if (statusText.includes('出荷')) statusEl.classList.add('status-out');
    else if (statusText.match(/淘汰|死亡|事故/)) statusEl.classList.add('status-alert');
    else statusEl.classList.add('status-active');

    // 3. 全情報表示
    const grid = document.getElementById('allInfoGrid');
    grid.innerHTML = '';

    // 表示から除外するキー（「注視」はここで除外して表示しない）
    const excludeKeys = ['ステータス', '個体識別番号', '注視']; 

    Object.keys(cow).forEach(key => {
        // 値が空でなく、除外リストになければ表示
        if (!excludeKeys.includes(key) && cow[key] && cow[key].trim() !== "") {
            const div = document.createElement('div');
            div.className = 'info-item';
            div.innerHTML = `<div class="info-label">${key}</div><div class="info-value">${cow[key]}</div>`;
            grid.appendChild(div);
        }
    });

    // 4. 体重データの構築（マスタデータからの結合）
    // まずはCSVの体重データ
    let combinedWeights = weightData.filter(row => row['個体識別番号'] === inputId).map(w => {
        return {
            date: w['体重測定日'],
            weight: parseFloat(w['体重']), // 数値化
            note: w['報告'] || ''
        };
    });

    // ★追加機能: 「導入時」データの追加
    if (cow['導入日'] && cow['導入時']) {
        combinedWeights.push({
            date: cow['導入日'],
            weight: parseFloat(cow['導入時']),
            note: '導入時'
        });
    }

    // ★追加機能: 「出荷」かつ「出荷時体重」の追加
    if (statusText.includes('出荷') && cow['屠畜日'] && cow['出荷時体重']) {
        combinedWeights.push({
            date: cow['屠畜日'],
            weight: parseFloat(cow['出荷時体重']),
            note: '出荷時'
        });
    }

    // 日付順にソート (グラフ用)
    combinedWeights.sort((a, b) => new Date(a.date) - new Date(b.date));

    // 重複除去（もし同じ日に複数のデータがあった場合、グラフが見づらくなるため）
    // 簡易的にそのまま表示しますが、必要ならここでフィルタリング可能です

    // 5. テーブル更新 (新しい順 = 逆順)
    const tbody = document.querySelector('#weightTable tbody');
    tbody.innerHTML = '';
    
    // テーブルには「導入時」「出荷時」も含めるか？
    // 通常、履歴としてすべて見えたほうが便利なので含めます
    [...combinedWeights].reverse().forEach(w => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${w.date}</td><td>${w.weight} kg</td><td>${w.note}</td>`;
        tbody.appendChild(tr);
    });

    resultArea.style.display = 'block';

    // 6. グラフ描画
    drawChart(combinedWeights);
}

// ==========================================
// グラフ描画
// ==========================================
function drawChart(weights) {
    const ctx = document.getElementById('weightChart').getContext('2d');
    if (myChart) myChart.destroy();

    if (weights.length === 0) return;

    const labels = weights.map(w => w.date);
    const dataPoints = weights.map(w => w.weight);

    myChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: '体重 (kg)',
                data: dataPoints,
                borderColor: '#3498db',
                backgroundColor: 'rgba(52, 152, 219, 0.1)',
                borderWidth: 2,
                pointRadius: 5,
                pointBackgroundColor: '#fff', // ポイントの中の色
                tension: 0.1,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: false, title: { display: true, text: 'kg' } }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        // ツールチップにメモ（導入時など）を表示する
                        afterLabel: function(context) {
                            const index = context.dataIndex;
                            return weights[index].note ? `(${weights[index].note})` : '';
                        }
                    }
                }
            }
        }
    });
}

// ==========================================
// カメラ制御 (安定版)
// ==========================================
function startScan() {
    const reader = document.getElementById('reader');
    const stopBtn = document.getElementById('stopScanBtn');
    const errorArea = document.getElementById('error');
    
    reader.style.display = 'block';
    stopBtn.style.display = 'block';
    errorArea.textContent = "";

    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            html5QrCode.clear();
        }).catch(err => {
            console.log("Cleanup error:", err);
        }).finally(() => {
            initCamera();
        });
    } else {
        initCamera();
    }

    function initCamera() {
        html5QrCode = new Html5Qrcode("reader");
        const config = { 
            fps: 10,
            qrbox: { width: 300, height: 150 },
            aspectRatio: 1.0
        };

        html5QrCode.start(
            { facingMode: "environment" }, 
            config,
            (decodedText) => {
                const match = decodedText.match(/\d{10}/);
                if (match) {
                    if (navigator.vibrate) navigator.vibrate(200);
                    document.getElementById('tagInput').value = match[0];
                    stopScan();
                    searchCattle();
                }
            },
            () => {} 
        ).catch(err => {
            console.error("Camera Error", err);
            errorArea.textContent = "カメラを起動できませんでした。";
            stopScan();
        });
    }
}

function stopScan() {
    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            html5QrCode.clear();
            document.getElementById('reader').style.display = 'none';
            document.getElementById('stopScanBtn').style.display = 'none';
            html5QrCode = null;
        }).catch(err => {
            console.log("Stop Error", err);
        });
    } else {
        document.getElementById('reader').style.display = 'none';
        document.getElementById('stopScanBtn').style.display = 'none';
    }
}