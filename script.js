let cowData = {};

fetch("data.json")
  .then(r => r.json())
  .then(d => cowData = d);

function search() {
  const id = document.getElementById("earTag").value.trim();
  const cow = cowData[id];
  const result = document.getElementById("result");

  if (!cow) {
    result.innerHTML = "<div class='result-card'>見つかりません</div>";
    return;
  }

  result.innerHTML = `
    <div class="result-card">
      <div>耳標番号：${id}</div>
      <div>性別：${cow["性別"]}</div>
      <div>生年月日：${cow["生年月日"]}</div>
      <div>牧場：${cow["牧場"]}</div>
    </div>
  `;
}

function startScan() {
  alert("iPhone Safariのカメラ起動処理は実装済み想定");
}