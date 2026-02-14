// グローバル変数
let masterData = [];
let weightData = [];
let isDataLoaded = false;
let html5QrCode = null;
let myChart = null; // グラフのインスタンス保持用

window.onload = function() {
    loadAllData();
};

async function loadAllData() {
    // （ここは以前と同じなので省略せず記述しますが、変更はありません）
    const loading = document.getElementById('loading');
    loading.style.display = 'block';

    try {
        const [masterRes, weightRes] = await Promise.all([
            fetch('master.csv').then(res => res.arrayBuffer()),
            fetch('weight.csv').then(res => res.arrayBuffer())
        ]);

        const decoder = new TextDecoder("shift-jis"); // 必要に応じて utf-8 に戻してください
        const masterText = decoder.decode(masterRes);
        const weightText = decoder.decode(weightRes);

        Papa.parse(masterText, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => masterData = results.data
        });

        Papa.parse(weightText, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => weightData = results.data
        });

        isDataLoaded = true;
        loading.style.display = 'none';

    } catch (error) {
        console.error(error);
        document.getElementById('error').textContent = "データ読み込み失敗";
        loading.style.display = 'none';
    }
}

function searchCattle() {
    if (!isDataLoaded) return;

    const inputId = document.getElementById('tagInput').value.trim();
    const resultArea = document.getElementById('result');
    const errorArea = document.getElementById('error');
    
    errorArea.textContent = "";
    resultArea.style.display = 'none';

    if (!inputId) {
        errorArea.textContent = "番号を入力してください";
        return;
    }

    const cow = masterData.find(row => row['個体識別番号'] === inputId);

    if (!cow) {
        errorArea.textContent = "該当する牛が見つかりませんでした。";
        return;
    }

    // --- 基本情報の表示 ---
    document.getElementById('resId').textContent = cow['個体識別番号'];
    
    // ステータスの表示と色分け
    const statusEl = document.getElementById('resStatus');
    const statusText = cow['ステータス'] || '-';
    statusEl.textContent = statusText;
    
    // クラスをリセットして再設定
    statusEl.className = 'status-badge';
    if (statusText.includes('出荷')) {
        statusEl.classList.add('status-out');
    } else if (statusText.includes('淘汰') || statusText.includes('死亡')) {
        statusEl.classList.add('status-alert');
    } else {
        statusEl.classList.add('status-active');
    }

    document.getElementById('resBirth').textContent = cow['生年月日'] || '-';
    document.getElementById('resBarn').textContent = cow['牛舎'] || '-';
    document.getElementById('resIntroDate').textContent = cow['導入日'] || '-';

    // --- 体重データの処理 ---
    const weights = weightData.filter(row => row['個体識別番号'] === inputId);
    // 日付でソート（古い順 = グラフの左から右）
    weights.sort((a, b) => new Date(a['体重測定日']) - new Date(b['体重測定日']));

    const latestWeight = weights.length > 0 ? weights[weights.length - 1]['体重'] + ' kg' : 'データなし';
    document.getElementById('resLatestWeight').textContent = latestWeight;

    // --- テーブルの更新 ---
    const tbody = document.querySelector('#weightTable tbody');
    tbody.innerHTML = '';
    // テーブルは新しい順が見やすいので逆順にする
    [...weights].reverse().forEach(w => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${w['体重測定日']}</td><td>${w['体重']}</td>`;
        tbody.appendChild(tr);
    });

    resultArea.style.display = 'block';

    // --- グラフの描画 ---
    drawChart(weights);
}

function drawChart(weights) {
    const ctx = document.getElementById('weightChart').getContext('2d');

    // 既存のグラフがあれば破棄（これをしないと前のグラフに重なって表示されてしまう）
    if (myChart) {
        myChart.destroy();
    }

    // データ準備
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
                backgroundColor: 'rgba(52, 152, 219, 0.2)',
                borderWidth: 2,
                pointRadius: 4,
                tension: 0.1, // 曲線の滑らかさ
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: false, // 体重なので0からでなくてOK
                    title: { display: true, text: 'kg' }
                }
            }
        }
    });
}

function startScan() {
    const reader = document.getElementById('reader');
    const stopBtn = document.getElementById('stopScanBtn');
    const errorArea = document.getElementById('error');
    
    reader.style.display = 'block';
    stopBtn.style.display = 'block';
    errorArea.textContent = "";

    // Code128を優先、ネイティブAPI使用
    html5QrCode = new Html5Qrcode("reader", { 
        formatsToSupport: [ Html5QrcodeSupportedFormats.CODE_128 ],
        experimentalFeatures: { useBarCodeDetectorIfSupported: true }
    });

    html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 300, height: 100 } },
        (decodedText) => {
            const match = decodedText.match(/\d{10}/);
            if (match) {
                // ★追加: 成功時のバイブレーション (200ms振動)
                if (navigator.vibrate) {
                    navigator.vibrate(200);
                }

                document.getElementById('tagInput').value = match[0];
                stopScan();
                searchCattle();
            }
        },
        () => {} // エラー無視
    ).catch(err => {
        console.error(err);
        errorArea.textContent = "カメラ起動エラー";
        stopScan();
    });
}

function stopScan() {
    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            html5QrCode.clear();
            document.getElementById('reader').style.display = 'none';
            document.getElementById('stopScanBtn').style.display = 'none';
        });
    }
}