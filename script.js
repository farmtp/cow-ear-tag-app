let cowData = {};

fetch("data.json")
  .then(res => res.json())
  .then(data => cowData = data)
  .catch(err => {
    document.getElementById("result").textContent =
      "データ読み込みエラー";
  });

function search() {
  const id = document.getElementById("earTag").value.trim();
  const result = cowData[id];

  document.getElementById("result").textContent =
    result ? JSON.stringify(result, null, 2) : "見つかりません";
}
