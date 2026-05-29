async function loadCities(selectedCities = []) {
  const r    = await fetch('/cities.json');
  const data = await r.json();
  const container = document.getElementById('cityCheckboxes');
  container.innerHTML = '';

  data.tokyo23.forEach(city => {
    const isSelected = selectedCities.includes(city.value);
    const label = document.createElement('label');
    label.className = 'checkbox-label' + (isSelected ? ' selected' : '');
    label.innerHTML = `
      <input type="checkbox" value="${city.value}" ${isSelected ? 'checked' : ''}>
      <span class="checkmark">${isSelected ? '✓' : ''}</span>
      <span class="city-name">${city.name}</span>
      <span class="city-en">${city.value}</span>`;

    label.querySelector('input').addEventListener('change', function() {
      if (this.checked) {
        label.classList.add('selected');
        label.querySelector('.checkmark').textContent = '✓';
      } else {
        label.classList.remove('selected');
        label.querySelector('.checkmark').textContent = '';
      }
      updateCityPreview();
    });

    container.appendChild(label);
  });

  updateCityPreview();
}

function updateCityPreview() {
  const selected = getSelectedCities();
  const preview  = document.getElementById('cityPreview');
  preview.textContent = selected.length
    ? `選択中（${selected.length}区）：${selected.join(', ')}`
    : '未選択';
}

function getSelectedCities() {
  return Array.from(
    document.querySelectorAll('#cityCheckboxes input:checked')
  ).map(cb => cb.value);
}

function selectAll() {
  document.querySelectorAll('#cityCheckboxes .checkbox-label').forEach(label => {
    label.classList.add('selected');
    label.querySelector('input').checked = true;
    label.querySelector('.checkmark').textContent = '✓';
  });
  updateCityPreview();
}

function selectNone() {
  document.querySelectorAll('#cityCheckboxes .checkbox-label').forEach(label => {
    label.classList.remove('selected');
    label.querySelector('input').checked = false;
    label.querySelector('.checkmark').textContent = '';
  });
  updateCityPreview();
}

async function load() {
  const r   = await fetch('/api/config');
  const cfg = await r.json();
  await loadCities(cfg.cities || []);
  document.getElementById('startHour').value    = cfg.startHour  ?? 15;
  document.getElementById('endHour').value      = cfg.endHour    ?? 21;
  document.getElementById('tempDiff').value     = cfg.tempDiff   ?? 5;
  document.getElementById('windLimit').value    = cfg.windLimit  ?? 10;
  document.getElementById('alertRain').checked  = !!cfg.alertRain;
  document.getElementById('alertCloud').checked = !!cfg.alertCloud;
  document.getElementById('alertSun').checked   = !!cfg.alertSun;
  document.getElementById('alertWind').checked  = !!cfg.alertWind;
  document.getElementById('alertFog').checked   = !!cfg.alertFog;
  document.getElementById('alertSnow').checked  = !!cfg.alertSnow;
}

async function save() {
  const cities = getSelectedCities();
  if (!cities.length) { showToast('❌ 少なくとも1区を選択してください'); return; }
  const cfg = {
    cities,
    startHour:  parseInt(document.getElementById('startHour').value),
    endHour:    parseInt(document.getElementById('endHour').value),
    tempDiff:   parseInt(document.getElementById('tempDiff').value),
    windLimit:  parseInt(document.getElementById('windLimit').value),
    alertRain:  document.getElementById('alertRain').checked,
    alertCloud: document.getElementById('alertCloud').checked,
    alertSun:   document.getElementById('alertSun').checked,
    alertWind:  document.getElementById('alertWind').checked,
    alertFog:   document.getElementById('alertFog').checked,
    alertSnow:  document.getElementById('alertSnow').checked,
  };
  await fetch('/api/config', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(cfg) });
  showToast('✅ 設定を保存しました');
}

async function reset() {
  await fetch('/api/config/reset');
  await load();
  showToast('↺ デフォルトに戻しました');
}

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

document.addEventListener('DOMContentLoaded', load);
