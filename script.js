let masterData = [];
let weightData = [];

// ページ読み込み時にExcelデータを取得
window.onload = async function() {
    try {
        // ファイル名は作成したExcelファイル名に合わせてください
        const response = await fetch('./cattle_data.xlsx');
        if (!response.ok) throw new Error("Excelファイルが見つかりません");
        
        const arrayBuffer = await response.arrayBuffer();
        
        // 日付を文字列として読み込む設定 (raw: false)
        const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
        
        // 1. 牛マスタシートの読み込み
        if (workbook.Sheets["牛マスタ"]) {
            masterData = XLSX.utils.sheet_to_json(workbook.Sheets["牛マスタ"], { defval: "" });
            console.log("牛マスタ読込:", masterData.length + "件");
        } else {
            alert("「牛マスタ」シートが見つかりません");
        }

        // 2. 体重データシートの読み込み
        if (workbook.Sheets["体重データ"]) {
            weightData = XLSX.utils.sheet_to_json(workbook.Sheets["体重データ"], { defval: "" });
            console.log("体重データ読込:", weightData.length + "件");
        }
        
    } catch (error) {
        console.error(error);
        alert("データの読み込みに失敗しました。\nGitHubにファイルがアップされているか確認してください。");
    }
};

function searchCow(scannedId = null) {
    const inputId = scannedId || document.getElementById('manualInput').value;
    if (!inputId) return;

    // --- マスタ検索 ---
    // 文字列化して比較 (Excelの数値扱い対策)
    const cow = masterData.find(d => String(d['個体識別番号']) === String(inputId));

    const resDiv = document.getElementById('result');
    
    if (cow) {
        // 基本情報の表示
        document.getElementById('res-id').innerText = cow['個体識別番号'];
        
        // ステータスに応じた色変更
        const status = cow['ステータス'] || '在籍';
        const statusBadge = document.getElementById('res-status');
        statusBadge.innerText = status;
        statusBadge.style.backgroundColor = (status.includes('出荷') || status.includes('淘汰')) ? '#95a5a6' : '#e67e22'; // 出荷済はグレー、在籍はオレンジ

        document.getElementById('res-barn').innerText = cow['牛舎'] || '-';
        document.getElementById('res-birth').innerText = formatDate(cow['生年月日']);
        document.getElementById('res-intro').innerText = formatDate(cow['導入日']);
        document.getElementById('res-market').innerText = cow['市場'] || '-';
        document.getElementById('res-price').innerText = cow['落札金額'] ? Number(cow['落札金額']).toLocaleString() + '円' : '-';

        // --- 体重情報の取得 ---
        // その牛の体重データを全検索して抽出
        const myWeights = weightData.filter(d => String(d['個体識別番号']) === String(inputId));
        
        if (myWeights.length > 0) {
            // 日付でソート（新しい順）
            myWeights.sort((a, b) => new Date(b['体重測定日']) - new Date(a['体重測定日']));
            
            const latest = myWeights[0];
            document.getElementById('res-weight').innerText = latest['体重'];
            document.getElementById('res-weight-date').innerText = formatDate(latest['体重測定日']);
            
            // 履歴の表示（直近3回分など）
            /* もし履歴一覧を出したい場合はここで myWeights をループしてHTMLを作れます
            */
        } else {
            document.getElementById('res-weight').innerText = '-';
            document.getElementById('res-weight-date').innerText = '-';
        }

        resDiv.style.display = 'block';
    } else {
        alert("該当する牛が見つかりませんでした。\n番号: " + inputId);
        resDiv.style.display = 'none';
    }
}

// Excelの日付シリアル値やDate型を「YYYY-MM-DD」形式に変換する関数
function formatDate(dateVal) {
    if (!dateVal) return '-';
    // 既に文字列ならそのまま返す
    if (typeof dateVal === 'string') return dateVal; 
    // Date型ならフォーマット
    if (dateVal instanceof Date) {
        return dateVal.toISOString().split('T')[0];
    }
    return dateVal;
}

// --- カメラ機能 (前回と同じ) ---
let html5QrcodeScanner;
function startScanner() {
    document.getElementById('reader').style.display = 'block';
    if (!html5QrcodeScanner) {
        html5QrcodeScanner = new Html5Qrcode("reader");
    }
    html5QrcodeScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 150 } },
        (decodedText) => {
            html5QrcodeScanner.stop();
            document.getElementById('reader').style.display = 'none';
            document.getElementById('manualInput').value = decodedText;
            searchCow(decodedText);
        },
        () => {}
    ).catch(err => alert("カメラ起動エラー: " + err));
}