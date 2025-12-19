let cowData={};
fetch('data.json').then(r=>r.json()).then(d=>cowData=d);
function search(){
 const id=document.getElementById('earTag').value.trim();
 const cow=cowData[id];
 const r=document.getElementById('result');
 if(!cow){r.innerHTML='<div class="result-card">見つかりません</div>';return;}
 let h='<div class="result-card">';
 for(const k in cow){
  h+=`<div class="label">${k}</div><div class="value">${cow[k]}</div>`;
 }
 h+='</div>'; r.innerHTML=h;
}