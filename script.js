let cowData = {};

fetch("data.json")
  .then(res => res.json())
  .then(data => cowData = data)
  .catch(() => {
    document.getElementById("result").textContent = "データ読み込みエラー";
  });

function search() {
  const id = document.getElementById("earTag").value.trim();
  const result = cowData[id];
  document.getElementById("result").textContent =
    result ? JSON.stringify(result, null, 2) : "見つかりません";
}

async function scanImage(input) {
  const file = input.files[0];
  if (!file) return;

  const img = document.createElement("img");
  img.src = URL.createObjectURL(file);

  img.onload = async () => {
    const reader = new ZXing.BrowserBarcodeReader();
    try {
      const result = await reader.decodeFromImage(img);
      document.getElementById("earTag").value = result.text;
      search();
    } catch {
      alert("バーコードを読み取れませんでした");
    }
  };
}
