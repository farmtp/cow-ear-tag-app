// ==========================================
// グローバル変数定義
// ==========================================
let masterData = [];   // 牛マスタデータ
let weightData = [];   // 体重データ
let isDataLoaded = false;
let html5QrCode = null; // カメラリーダー用
let myChart = null;     // グラフ用インスタンス

// ==========================================
// 初期化処理
// ==========================================
window.onload = function() {
    loadAllData();
};

// ==========================================
// データ読み込み処理 (CSV -> JSON)
// ==========================================
async function loadAllData() {
    const loading = document.getElementById('loading');
    const errorArea = document.getElementById('error');
    loading.style.display = 'block';

    try {
        // 並行してCSVをフェッチ
        // UTF-8で保存し直していただいたため、通常の text() で読み込みます
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

        // マスタデータのパース
        Papa.parse(masterRes, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                masterData = results.data;
            }
        });

        // 体重データのパース
        Papa.parse(weightRes, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                weightData = results.data;
            }
        });

        isDataLoaded = true;
        loading.style.display = 'none';
        console.log("データ読み込み完了");

    } catch (error) {
        console.error(error);
        errorArea.textContent = "データの読み込みに失敗しました。CSVファイルが配置されているか確認してください。";
        loading.style.display = 'none';
    }
}

// ==========================================
// 検索実行処理
// ==========================================
function searchCattle() {
    // データ読み込み前ならアラート
    if (!isDataLoaded) {
        alert("データ読み込み中です。");
        return;
    }

    const inputId = document.getElementById('tagInput').value.trim();
    const resultArea = document.getElementById('result');
    const errorArea = document.getElementById('error');
    
    // 表示リセット
    errorArea.textContent = "";
    resultArea.style.display = 'none';

    if (!inputId) {
        errorArea.textContent = "番号を入力してください";
        return;
    }

    // 1. マスタデータから検索
    const cow = masterData.find(row => row['個体識別番号'] === inputId);

    if (!cow) {
        errorArea.textContent = "該当する牛が見つかりませんでした。";
        return;
    }

    // 2. 基本情報の表示
    document.getElementById('resId').textContent = cow['個体識別番号'];
    document.getElementById('resBirth').textContent = cow['生年月日'] || '-';
    document.getElementById('resBarn').textContent = cow['牛舎'] || '-';
    document.getElementById('resIntroDate').textContent = cow['導入日'] || '-';

    // 3. ステータスの色分け処理
    const statusEl = document.getElementById('resStatus');
    const statusText = cow['ステータス'] || '在籍'; // 空欄なら在籍扱いなど、運用に合わせて調整
    statusEl.textContent = statusText;
    
    // クラスを一度リセット
    statusEl.className = 'status-badge';
    
    // 文言に応じた色クラスの付与
    if (statusText.includes('出荷')) {
        statusEl.classList.add('status-out'); // 青
    } else if (statusText.includes('淘汰') || statusText.includes('死亡') || statusText.includes('事故')) {
        statusEl.classList.add('status-alert'); // 赤
    } else {
        statusEl.classList.add('status-active'); // 緑
    }

    // 4. 体重データの抽出と整形
    const weights = weightData.filter(row => row['個体識別番号'] === inputId);
    
    // グラフ用: 日付の古い順にソート (左→右)
    weights.sort((a, b) => new Date(a['体重測定日']) - new Date(b['体重測定日']));

    // 最新体重の表示
    const latestWeight = weights.length > 0 ? weights[weights.length - 1]['体重'] + ' kg' : 'データなし';
    document.getElementById('resLatestWeight').textContent = latestWeight;

    // 5. テーブルの更新 (新しい順が見やすいため逆順で表示)
    const tbody = document.querySelector('#weightTable tbody');
    tbody.innerHTML = '';
    
    // 配列のコピーを作って反転させる（元のweightsはグラフ用に昇順のままにしておくため）
    [...weights].reverse().forEach(w => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${w['体重測定日']}</td><td>${w['体重']}</td>`;
        tbody.appendChild(tr);
    });

    // 結果エリアを表示
    resultArea.style.display = 'block';

    // 6. グラフの描画
    drawChart(weights);
}

// ==========================================
// グラフ描画処理 (Chart.js)
// ==========================================
function drawChart(weights) {
    const ctx = document.getElementById('weightChart').getContext('2d');

    // 以前のグラフが残っていたら破棄する (重複表示防止)
    if (myChart) {
        myChart.destroy();
    }

    // データが0件の場合はグラフを表示しない、または空で表示
    if (weights.length === 0) {
        return; 
    }

    const labels = weights.map(w => w['体重測定日']);
    const dataPoints = weights.map(w => w['体重']);

    myChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: '体重推移 (kg)',
                data: dataPoints,
                borderColor: '#3498db',         // 線の色
                backgroundColor: 'rgba(52, 152, 219, 0.1)', // 塗りつぶしの色
                borderWidth: 2,
                pointRadius: 5,                 // 点の大きさ
                pointBackgroundColor: '#fff',
                pointBorderColor: '#3498db',
                tension: 0.1,                   // 線の滑らかさ (0で直線)
                fill: true                      // 下側を塗りつぶす
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index',
            },
            scales: {
                y: {
                    beginAtZero: false, // 体重の変化を見やすくするため0スタートにしない
                    title: {
                        display: true,
                        text: 'kg'
                    }
                }
            }
        }
    });
}

// ==========================================
// カメラ / バーコード読み取り処理
// ==========================================
function startScan() {
    const reader = document.getElementById('reader');
    const stopBtn = document.getElementById('stopScanBtn');
    const errorArea = document.getElementById('error');
    
    reader.style.display = 'block';
    stopBtn.style.display = 'block';
    errorArea.textContent = "";

    // 読み取り設定: Code 128 (GS1-128) を優先
    // useBarCodeDetectorIfSupported: true でスマホのネイティブ機能を使用(高速)
    html5QrCode = new Html5Qrcode("reader", { 
        formatsToSupport: [ Html5QrcodeSupportedFormats.CODE_128 ],
        experimentalFeatures: {
            useBarCodeDetectorIfSupported: true
        }
    });

    const config = { 
        fps: 10, 
        qrbox: { width: 300, height: 100 }, // 横長のバーコード向け
        aspectRatio: 1.0
    };

    html5QrCode.start(
        { facingMode: "environment" }, // 背面カメラ
        config,
        (decodedText, decodedResult) => {
            // ■ 読み取り成功時のコールバック
            console.log(`Scan result: ${decodedText}`);
            
            // 読み取った文字列から10桁の数字を抽出
            const match = decodedText.match(/\d{10}/);
            
            if (match) {
                // 10桁の数字が見つかった場合
                
                // 1. バイブレーションで通知 (対応端末のみ)
                if (navigator.vibrate) {
                    navigator.vibrate(200); 
                }

                // 2. 入力欄にセット
                const cattleId = match[0];
                document.getElementById('tagInput').value = cattleId;
                
                // 3. カメラ停止
                stopScan();
                
                // 4. 自動検索
                searchCattle();
            } else {
                console.log("10桁の番号が含まれていません: " + decodedText);
            }
        },
        (errorMessage) => {
            // 読み取り失敗（認識中）は無視
        }
    ).catch(err => {
        console.error("カメラ起動エラー", err);
        errorArea.textContent = "カメラを起動できませんでした。ブラウザの権限設定を確認してください。";
        stopScan(); // エラー時はボタン等を隠す
    });
}

function stopScan() {
    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            html5QrCode.clear();
            document.getElementById('reader').style.display = 'none';
            document.getElementById('stopScanBtn').style.display = 'none';
        }).catch(err => {
            console.log("停止エラー", err);
        });
    } else {
        // インスタンスが無い場合もUIだけは隠す
        document.getElementById('reader').style.display = 'none';
        document.getElementById('stopScanBtn').style.display = 'none';
    }
}