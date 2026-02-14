// データ保持用変数
let masterData = [];
let weightData = [];
let isDataLoaded = false;

// ページ読み込み時にデータを取得
window.onload = function() {
    loadAllData();
};

async function loadAllData() {
    const loading = document.getElementById('loading');
    loading.style.display = 'block';

    try {
        // 並行して2つのCSVを読み込む
        const [masterRes, weightRes] = await Promise.all([
            fetch('master.csv').then(res => res.text()),
            fetch('weight.csv').then(res => res.text())
        ]);

        // CSVをJSON(オブジェクト)に変換
        Papa.parse(masterRes, {
            header: true,
            skipEmptyLines: true,
            complete: function(results) {
                masterData = results.data;
            }
        });

        Papa.parse(weightRes, {
            header: true,
            skipEmptyLines: true,
            complete: function(results) {
                weightData = results.data;
            }
        });

        isDataLoaded = true;
        loading.style.display = 'none';
        console.log("データ読み込み完了");

    } catch (error) {
        console.error("CSV読み込みエラー:", error);
        document.getElementById('error').textContent = "データの読み込みに失敗しました。CSVファイル名を確認してください。";
        loading.style.display = 'none';
    }
}

function searchCattle() {
    if (!isDataLoaded) {
        alert("データを読み込み中です。少々お待ちください。");
        return;
    }

    const inputId = document.getElementById('tagInput').value.trim();
    const resultArea = document.getElementById('result');
    const errorArea = document.getElementById('error');
    
    // リセット
    errorArea.textContent = "";
    resultArea.style.display = 'none';

    if (!inputId) {
        errorArea.textContent = "番号を入力してください";
        return;
    }

    // 1. マスターデータから検索
    // CSVのヘッダー名「個体識別番号」を使用します
    const cow = masterData.find(row => row['個体識別番号'] === inputId);

    if (!cow) {
        errorArea.textContent = "該当する牛が見つかりませんでした。";
        return;
    }

    // 2. 体重データから履歴を抽出
    const weights = weightData.filter(row => row['個体識別番号'] === inputId);
    
    // 日付順にソート（念のため）
    weights.sort((a, b) => new Date(b['体重測定日']) - new Date(a['体重測定日']));

    // 3. 画面に表示
    document.getElementById('resId').textContent = cow['個体識別番号'];
    document.getElementById('resStatus').textContent = cow['ステータス'] || '-';
    document.getElementById('resBirth').textContent = cow['生年月日'] || '-';
    document.getElementById('resBarn').textContent = cow['牛舎'] || '-';
    document.getElementById('resIntroDate').textContent = cow['導入日'] || '-';

    // 最新体重
    const latestWeight = weights.length > 0 ? weights[0]['体重'] + ' kg' : 'データなし';
    document.getElementById('resLatestWeight').textContent = latestWeight;

    // 体重テーブルの構築
    const tbody = document.querySelector('#weightTable tbody');
    tbody.innerHTML = '';
    weights.forEach(w => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${w['体重測定日']}</td><td>${w['体重']}</td>`;
        tbody.appendChild(tr);
    });

    resultArea.style.display = 'block';
}

let html5QrCode;
function startScan() {
    const reader = document.getElementById('reader');
    const stopBtn = document.getElementById('stopScanBtn');
    const errorArea = document.getElementById('error');
    
    reader.style.display = 'block';
    stopBtn.style.display = 'block';
    errorArea.textContent = "";

    // ★修正1: ネイティブ機能（useBarCodeDetectorIfSupported）を有効化
    // これによりスマホ専用のチップを使って高速に読み取ります
    html5QrCode = new Html5Qrcode("reader", { 
        formatsToSupport: [ 
            Html5QrcodeSupportedFormats.CODE_128, 
            Html5QrcodeSupportedFormats.ITF // 念のため旧規格も許可しておくと安心です
        ],
        experimentalFeatures: {
            useBarCodeDetectorIfSupported: true
        }
    });

    // ★修正2: 読み取りエリアを「横長」に変更
    // バーコード全体が枠に収まりやすくします
    const config = { 
        fps: 10, 
        qrbox: { width: 300, height: 100 }, 
        aspectRatio: 1.0
    };

    html5QrCode.start(
        { facingMode: "environment" },
        config,
        (decodedText, decodedResult) => {
            console.log(`Scan result: ${decodedText}`);
            
            // 数字だけを抜き出す処理（10桁）
            const match = decodedText.match(/\d{10}/);
            
            if (match) {
                // 読み取り成功時の音（スマホの設定によりますが、あると分かりやすいです）
                // navigator.vibrate(200); 

                const cattleId = match[0];
                document.getElementById('tagInput').value = cattleId;
                stopScan();
                searchCattle();
            } else {
                console.log("10桁の数値が含まれていません: " + decodedText);
            }
        },
        (errorMessage) => {
            // 認識失敗は無視
        }
    ).catch(err => {
        console.error("カメラ起動エラー", err);
        errorArea.textContent = "カメラ起動に失敗しました。再読み込みして許可してください。";
        stopScan();
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
        document.getElementById('reader').style.display = 'none';
        document.getElementById('stopScanBtn').style.display = 'none';
    }
}