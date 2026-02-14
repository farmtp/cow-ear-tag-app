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

    // 3. 【全情報表示】牛情報の全カラムをループして表示
    const grid = document.getElementById('allInfoGrid');
    grid.innerHTML = ''; // クリア

    // 表示したくない列があればここに記述
    const excludeKeys = ['ステータス', '個体識別番号']; 

    Object.keys(cow).forEach(key => {
        // 値が空でなく、除外リストになければ表示
        if (!excludeKeys.includes(key) && cow[key] && cow[key].trim() !== "") {
            const div = document.createElement('div');
            div.className = 'info-item';
            div.innerHTML = `<div class="info-label">${key}</div><div class="info-value">${cow[key]}</div>`;
            grid.appendChild(div);
        }
    });

    // 4. 体重データの抽出
    const weights = weightData.filter(row => row['個体識別番号'] === inputId);
    weights.sort((a, b) => new Date(a['体重測定日']) - new Date(b['体重測定日']));

    // 5. テーブル更新（報告カラムを追加）
    const tbody = document.querySelector('#weightTable tbody');
    tbody.innerHTML = '';
    
    [...weights].reverse().forEach(w => {
        const tr = document.createElement('tr');
        // '報告'列が存在しない場合も考慮して表示
        const note = w['報告'] ? w['報告'] : ''; 
        tr.innerHTML = `<td>${w['体重測定日']}</td><td>${w['体重']} kg</td><td>${note}</td>`;
        tbody.appendChild(tr);
    });

    resultArea.style.display = 'block';

    // 6. グラフ描画
    drawChart(weights);
}

// ==========================================
// グラフ描画
// ==========================================
function drawChart(weights) {
    const ctx = document.getElementById('weightChart').getContext('2d');
    if (myChart) myChart.destroy();

    if (weights.length === 0) return;

    const labels = weights.map(w => w['体重測定日']);
    const dataPoints = weights.map(w => w['体重']);

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
                tension: 0.1,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: false, title: { display: true, text: 'kg' } }
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
    
    // UI表示
    reader.style.display = 'block';
    stopBtn.style.display = 'block';
    errorArea.textContent = "";

    // 以前のインスタンスが残っていたら停止させる安全策
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
        // インスタンス作成
        html5QrCode = new Html5Qrcode("reader");

        // Code 128のみ指定 (Experimental機能はオフにして安定性を優先)
        const config = { 
            fps: 10,
            // qrboxを指定しないことで全画面スキャンとなり、認識率が上がることがあります
            // 枠を表示したい場合は { width: 300, height: 150 } を設定してください
            qrbox: { width: 300, height: 150 },
            aspectRatio: 1.0
        };

        html5QrCode.start(
            { facingMode: "environment" }, 
            config,
            (decodedText) => {
                // 成功時
                const match = decodedText.match(/\d{10}/);
                if (match) {
                    if (navigator.vibrate) navigator.vibrate(200);
                    document.getElementById('tagInput').value = match[0];
                    stopScan();
                    searchCattle();
                }
            },
            () => {} // 失敗時は無視
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
            html5QrCode = null; // 参照を切る
        }).catch(err => {
            console.log("Stop Error", err);
        });
    } else {
        document.getElementById('reader').style.display = 'none';
        document.getElementById('stopScanBtn').style.display = 'none';
    }
}