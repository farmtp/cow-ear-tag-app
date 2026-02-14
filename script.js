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