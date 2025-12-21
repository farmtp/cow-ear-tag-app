async function scanImage(input) {
  const file = input.files[0];
  if (!file) return;

  const img = document.createElement("img");
  img.src = URL.createObjectURL(file);

  img.onload = async () => {
    const hints = new Map();
    hints.set(
      ZXing.DecodeHintType.POSSIBLE_FORMATS,
      [
        ZXing.BarcodeFormat.CODE_128,
        ZXing.BarcodeFormat.EAN_13,
        ZXing.BarcodeFormat.EAN_8
      ]
    );

    const reader = new ZXing.BrowserBarcodeReader(hints);

    try {
      const result = await reader.decodeFromImage(img);
      document.getElementById("earTag").value = normalize(result.text);
      search();
    } catch (e) {
      alert("バーコードを認識できませんでした。\n少し近づけて撮り直してください。");
    }
  };
}

function normalize(text) {
  return text
    .replace(/[^0-9]/g, "")  // 数字以外を除去
    .trim();
}
