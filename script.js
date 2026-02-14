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
    resultArea.className = 'result-card'; // クラスリセット

    if (!inputId) {
        errorArea.textContent = "番号を入力してください";
        return;
    }

    // 1. マスタデータ検索
    const originalCow = masterData.find(row => row['個体識別番号'] === inputId);
    if (!originalCow) {
        errorArea.textContent = "該当する牛が見つかりませんでした。";
        return;
    }

    // 表示用にコピー
    const cow = { ...originalCow };

    // --- ステータスと設定の判定 ---
    const statusText = (cow['ステータス'] || '').trim();
    const isWatch = (cow['注視'] && ['○', '〇', '●'].includes(cow['注視'].trim())); // ●も念のため追加
    
    // 表示除外リスト（共通設定）
    // 要望: 「購買日」「導入時」を非表示
    // ※「ステータス」「個体識別番号」「注視」は基本情報として別扱いにするため除外
    let excludeKeys = ['ステータス', '個体識別番号', '注視', '購買日', '導入時']; 

    // --- 日付計算用ヘルパー ---
    const getDaysDiff = (startStr, endStr) => {
        if (!startStr || !endStr) return null;
        const s = new Date(startStr);
        const e = new Date(endStr);
        if (isNaN(s.getTime()) || isNaN(e.getTime())) return null;
        const diff = e - s;
        return Math.floor(diff / (1000 * 60 * 60 * 24));
    };

    // --- ステータス別ロジック ---
    
    // ヘッダー情報コンテナ取得
    const headerInfo = document.querySelector('.header-info');
    // 個体識別番号(ID)以外のバッジ要素を一度削除して再構築する
    const resId = document.getElementById('resId');
    headerInfo.innerHTML = ''; 
    headerInfo.appendChild(resId);
    resId.textContent = cow['個体識別番号'];

    // バッジ生成関数
    const addBadge = (text, cssClass) => {
        const span = document.createElement('span');
        span.className = `status-badge ${cssClass}`;
        span.textContent = text;
        headerInfo.appendChild(span);
    };

    // オメガ日数計算ロジック変数
    let omegaEndDay = null;

    if (statusText === '死亡') {
        // ■ 死亡
        resultArea.classList.add('status-dead');
        addBadge('死亡', 'badge-dead'); // 黒

    } else if (statusText === '淘汰') {
        // ■ 淘汰
        resultArea.classList.add('status-cull');
        addBadge('淘汰', 'badge-cull'); // 濃い水色
        
        // 非表示: 牛舎
        excludeKeys.push('牛舎');
        
        // オメガ日数計算用: 屠畜日
        omegaEndDay = cow['屠畜日'];

    } else if (statusText === '出荷') {
        // ■ 出荷
        resultArea.classList.add('status-ship');
        addBadge('出荷', 'badge-ship'); // 緑
        
        // 非表示: 牛舎, 出荷時体重
        excludeKeys.push('牛舎', '出荷時体重');

        // 追加表示: 値段 (枝重 * 単価)
        if (cow['枝重'] && cow['単価']) {
            const w = parseFloat(cow['枝重'].replace(/,/g, ''));
            const p = parseFloat(cow['単価'].replace(/,/g, ''));
            if (!isNaN(w) && !isNaN(p)) {
                cow['値段'] = Math.floor(w * p).toLocaleString(); // 値段を追加
            }
        }
        
        // オメガ日数計算用: 屠畜日
        omegaEndDay = cow['屠畜日'];

    } else if (statusText === '' && isWatch) {
        // ■ 注視 (ステータス空白かつ注視○)
        resultArea.classList.add('status-alert');
        addBadge('在籍', 'badge-active'); // 緑
        addBadge('注視', 'badge-watch');  // 赤 + 点滅

        // オメガ日数計算用: 今日の日付
        omegaEndDay = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    } else {
        // ■ 通常 (在籍)
        addBadge(statusText || '在籍', 'badge-active');
        
        // 通常の在籍牛でもオメガ日数を出すならここに追加。今回は指定がないのでスキップ
    }

    // --- オメガ日数の計算と適用 ---
    // 「オメガ開始日」があれば計算して書き換え
    if (cow['オメガ開始日']) {
        let diff = null;
        if (omegaEndDay) {
            diff = getDaysDiff(cow['オメガ開始日'], omegaEndDay);
        } else {
            // 指定がない場合（通常の在籍など）は今日時点を出すのが一般的ですが、
            // 要望に明記されているのは「淘汰/出荷/注視」の場合のみなので、条件分岐
             // 必要ならここで default: Today を設定
        }

        if (diff !== null) {
            cow['オメガ開始日'] = `${cow['オメガ開始日']} (${diff}日)`;
        }
    }


    // --- 4. 情報表示 (Grid生成) ---
    const grid = document.getElementById('allInfoGrid');
    grid.innerHTML = '';

    Object.keys(cow).forEach(key => {
        // 除外リストになく、値が空でないものを表示
        // ※「値段」などの計算項目もここでcowに入っていれば表示される
        if (!excludeKeys.includes(key) && cow[key] && cow[key].toString().trim() !== "") {
            const div = document.createElement('div');
            div.className = 'info-item';
            div.innerHTML = `<div class="info-label">${key}</div><div class="info-value">${cow[key]}</div>`;
            grid.appendChild(div);
        }
    });


    // --- 5. 体重データ・グラフ構築 ---
    // ここは以前と同じロジック
    let combinedWeights = weightData.filter(row => row['個体識別番号'] === inputId).map(w => {
        return {
            date: w['体重測定日'],
            weight: parseFloat(w['体重']),
            note: w['報告'] || ''
        };
    });

    // 導入時 (グラフには含めるがリストからは消えていることに注意)
    if (cow['導入日'] && cow['導入時']) {
        combinedWeights.push({
            date: cow['導入日'],
            weight: parseFloat(cow['導入時']),
            note: '導入時'
        });
    }

    // 出荷時体重 (出荷ステータスの場合)
    if (statusText.includes('出荷') && cow['屠畜日'] && cow['出荷時体重']) {
        combinedWeights.push({
            date: cow['屠畜日'],
            weight: parseFloat(cow['出荷時体重']),
            note: '出荷時'
        });
    }

    combinedWeights.sort((a, b) => new Date(a.date) - new Date(b.date));

    // テーブル表示 (逆順)
    const tbody = document.querySelector('#weightTable tbody');
    tbody.innerHTML = '';
    [...combinedWeights].reverse().forEach(w => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${w.date}</td><td>${w.weight} kg</td><td>${w.note}</td>`;
        tbody.appendChild(tr);
    });

    resultArea.style.display = 'block';

    // グラフ描画
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
                pointBackgroundColor: '#fff',
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