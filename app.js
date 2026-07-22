
'use strict';

const DB_NAME = 'trt-mobile-db';
const DB_VERSION = 1;
const STORE_TRTS = 'trts';
const STORE_VISITS = 'visits';
const STORE_TASKS = 'tasks';
const STORE_MEDIA = 'media';
const STORE_SETTINGS = 'settings';

let db = null;
let trts = [];
let visits = [];
let tasks = [];
let mediaItems = [];
let selectedTrtId = null;
let map = null;
let markersLayer = null;
let userMarker = null;
let visitFiles = [];
let toastTimer = null;

const $ = (id) => document.getElementById(id);

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeText(value) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day:'2-digit', month:'2-digit', year:'numeric',
    hour:'2-digit', minute:'2-digit'
  }).format(date);
}

function formatDate(value) {
  if (!value) return 'Без срока';
  const date = new Date(value + 'T00:00:00');
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    day:'2-digit', month:'2-digit', year:'numeric'
  }).format(date);
}

function todayIso() {
  return new Date().toISOString().slice(0,10);
}


const SALES_MONTHS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

function salesArray(trt, year) {
  const values = trt?.sales?.[String(year)];
  return Array.isArray(values) ? values.slice(0, 12) : [];
}

function salesNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function salesSum(values, monthCount=12) {
  return values.slice(0, monthCount).reduce((sum, value) => {
    const number = salesNumber(value);
    return sum + (number ?? 0);
  }, 0);
}

function hasSales(trt) {
  return [2025, 2026].some(year => salesArray(trt, year).some(value => salesNumber(value) != null));
}

function formatSales(value, unit='') {
  const number = salesNumber(value);
  if (number == null) return '—';
  return `${number.toLocaleString('ru-RU')} ${unit || ''}`.trim();
}

function matchingSalesMonths(trt) {
  const values2026 = salesArray(trt, 2026);
  let last = -1;
  values2026.forEach((value, index) => {
    if (salesNumber(value) != null) last = index;
  });
  return last >= 0 ? last + 1 : 6;
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function colorForSize(size) {
  const value = Number(size);
  if (!Number.isFinite(value)) return '#98a2b3';
  if (value < 50) return '#d92d20';
  if (value <= 100) return '#f4b400';
  return '#12b76a';
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (value) => value * Math.PI / 180;
  const radius = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(a));
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Транзакция отменена'));
  });
}

async function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_TRTS)) {
        database.createObjectStore(STORE_TRTS, {keyPath:'id'});
      }
      if (!database.objectStoreNames.contains(STORE_VISITS)) {
        const store = database.createObjectStore(STORE_VISITS, {keyPath:'id'});
        store.createIndex('trtId', 'trtId', {unique:false});
        store.createIndex('createdAt', 'createdAt', {unique:false});
      }
      if (!database.objectStoreNames.contains(STORE_TASKS)) {
        const store = database.createObjectStore(STORE_TASKS, {keyPath:'id'});
        store.createIndex('trtId', 'trtId', {unique:false});
        store.createIndex('status', 'status', {unique:false});
        store.createIndex('dueDate', 'dueDate', {unique:false});
      }
      if (!database.objectStoreNames.contains(STORE_MEDIA)) {
        const store = database.createObjectStore(STORE_MEDIA, {keyPath:'id'});
        store.createIndex('trtId', 'trtId', {unique:false});
        store.createIndex('visitId', 'visitId', {unique:false});
      }
      if (!database.objectStoreNames.contains(STORE_SETTINGS)) {
        database.createObjectStore(STORE_SETTINGS, {keyPath:'key'});
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAll(storeName) {
  const tx = db.transaction(storeName, 'readonly');
  return requestToPromise(tx.objectStore(storeName).getAll());
}

async function putItem(storeName, item) {
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(item);
  await transactionComplete(tx);
}

async function deleteItem(storeName, id) {
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(id);
  await transactionComplete(tx);
}

async function replaceTrts(importedPoints) {
  const existingById = new Map(trts.map(item => [String(item.id), item]));
  const prepared = importedPoints.map((item, index) => {
    const id = String(item.id || [item.holding, item.address, item.format].join('|') || ('trt-' + index));
    const previous = existingById.get(id);
    return {
      id,
      client:String(item.client || item.holding || 'ТРТ'),
      holding:String(item.holding || item.client || ''),
      address:String(item.address || ''),
      format:String(item.format || ''),
      direction:String(item.direction || ''),
      manager:String(item.manager || ''),
      region:String(item.region || ''),
      size:Number.isFinite(Number(item.size)) ? Math.round(Number(item.size)) : null,
      unit:String(item.unit || ''),
      lat:Number(item.lat),
      lon:Number(item.lon),
      sales:item.sales || null,
      custom:previous?.custom || {},
      importedAt:new Date().toISOString()
    };
  }).filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lon));

  const tx = db.transaction(STORE_TRTS, 'readwrite');
  const store = tx.objectStore(STORE_TRTS);
  store.clear();
  prepared.forEach(item => store.put(item));
  await transactionComplete(tx);
}

async function refreshData() {
  [trts, visits, tasks, mediaItems] = await Promise.all([
    getAll(STORE_TRTS),
    getAll(STORE_VISITS),
    getAll(STORE_TASKS),
    getAll(STORE_MEDIA)
  ]);
  trts.sort((a,b) => (a.client || '').localeCompare(b.client || '', 'ru'));
  visits.sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  tasks.sort((a,b) => {
    if (a.status !== b.status) return a.status === 'done' ? 1 : -1;
    return String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'));
  });
  renderAll();
}

function initMap() {
  if (typeof window.L === 'undefined') {
    map = null;
    markersLayer = null;
    const mapNode = $('map');
    mapNode.innerHTML = '<div class="empty-state map-library-error"><h3>Карта временно недоступна</h3><p>Список ТРТ, продажи, визиты и задачи продолжают работать. Проверьте интернет и откройте приложение повторно.</p></div>';
    return;
  }
  map = L.map('map', {zoomControl:false}).setView([55.65, 37.62], 8);
  L.control.zoom({position:'bottomright'}).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom:19,
    attribution:'© OpenStreetMap',
    crossOrigin:true
  }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);
}

function markerIcon(trt) {
  return L.divIcon({
    className:'',
    html:'<div class="marker-dot" style="background:' + colorForSize(trt.size) + '"></div>',
    iconSize:[18,18],
    iconAnchor:[9,9]
  });
}

function renderMap() {
  const hasTrts = trts.length > 0;
  $('map-empty').classList.toggle('hidden', hasTrts);
  $('map').classList.toggle('hidden', !hasTrts);
  document.querySelector('.map-toolbar').classList.toggle('hidden', !hasTrts || !map);
  if (!map || !markersLayer) return;
  markersLayer.clearLayers();

  const query = normalizeText($('map-search').value);
  const shown = trts.filter(trt => {
    if (!query) return true;
    return normalizeText([trt.client, trt.holding, trt.address, trt.manager].join(' ')).includes(query);
  });

  shown.forEach(trt => {
    L.marker([trt.lat, trt.lon], {icon:markerIcon(trt)})
      .on('click', () => openTrt(trt.id))
      .addTo(markersLayer);
  });

  if (shown.length && query) {
    const bounds = L.latLngBounds(shown.map(item => [item.lat, item.lon]));
    map.fitBounds(bounds.pad(.16), {maxZoom:15});
  }
  setTimeout(() => map.invalidateSize(), 30);
}

function pointVisitCount(trtId) {
  return visits.filter(item => item.trtId === trtId).length;
}

function pointOpenTasks(trtId) {
  return tasks.filter(item => item.trtId === trtId && item.status !== 'done').length;
}

function trtItemHtml(trt) {
  const visitsCount = pointVisitCount(trt.id);
  const openTasks = pointOpenTasks(trt.id);
  const salesMonths = matchingSalesMonths(trt);
  const currentSales = hasSales(trt) ? salesSum(salesArray(trt, 2026), salesMonths) : null;
  return `
    <button class="trt-item" type="button" data-trt-id="${escapeHtml(trt.id)}">
      <div class="trt-item-top">
        <div class="trt-item-name">${escapeHtml(trt.client || trt.holding || 'ТРТ')}</div>
        <span class="marker-dot" style="background:${colorForSize(trt.size)};flex:0 0 auto;"></span>
      </div>
      <div class="trt-item-address">${escapeHtml(trt.address || 'Адрес не указан')}</div>
      <div class="trt-item-meta">
        ${trt.manager ? `<span class="meta-chip">${escapeHtml(trt.manager)}</span>` : ''}
        ${trt.format ? `<span class="meta-chip">${escapeHtml(trt.format)}</span>` : ''}
        ${visitsCount ? `<span class="meta-chip">Визитов: ${visitsCount}</span>` : ''}
        ${openTasks ? `<span class="meta-chip">Задач: ${openTasks}</span>` : ''}
        ${currentSales != null ? `<span class="meta-chip sales-chip">2026: ${formatSales(currentSales, trt.unit)}</span>` : ''}
      </div>
    </button>
  `;
}

function renderPoints() {
  const query = normalizeText($('points-search').value);
  const filter = $('points-filter').value;
  let rows = trts.filter(trt => {
    const text = normalizeText([trt.client, trt.holding, trt.address, trt.manager, trt.format].join(' '));
    if (query && !text.includes(query)) return false;
    if (filter === 'withTasks' && pointOpenTasks(trt.id) === 0) return false;
    if (filter === 'visited' && pointVisitCount(trt.id) === 0) return false;
    if (filter === 'withSales' && !hasSales(trt)) return false;
    return true;
  });

  $('points-count').textContent = rows.length;
  $('points-list').innerHTML = rows.length
    ? rows.map(trtItemHtml).join('')
    : '<div class="empty-state" style="margin:0;"><h3>Точки не найдены</h3><p>Измените поиск или фильтр.</p></div>';

  document.querySelectorAll('[data-trt-id]').forEach(button => {
    button.addEventListener('click', () => openTrt(button.dataset.trtId));
  });
}

function isOverdue(task) {
  return task.status !== 'done' && task.dueDate && task.dueDate < todayIso();
}

function priorityClass(priority) {
  if (priority === 'Высокий') return 'priority-high';
  if (priority === 'Низкий') return 'priority-low';
  return 'priority-medium';
}

function taskCardHtml(task, showPoint=true) {
  const trt = trts.find(item => item.id === task.trtId);
  return `
    <article class="task-card ${task.status === 'done' ? 'status-done' : ''}" data-task-card="${escapeHtml(task.id)}">
      <div class="task-head">
        <div class="task-title">${escapeHtml(task.title)}</div>
        <span class="meta-chip ${priorityClass(task.priority)}">${escapeHtml(task.priority || 'Средний')}</span>
      </div>
      <div class="task-meta">
        ${showPoint && trt ? `<span class="meta-chip">${escapeHtml(trt.client)}</span>` : ''}
        ${task.assignee ? `<span class="meta-chip">${escapeHtml(task.assignee)}</span>` : ''}
        <span class="meta-chip ${isOverdue(task) ? 'priority-high' : ''}">${escapeHtml(formatDate(task.dueDate))}</span>
        <span class="meta-chip">${task.status === 'done' ? 'Выполнена' : 'Открыта'}</span>
      </div>
      ${task.description ? `<div class="task-description">${escapeHtml(task.description)}</div>` : ''}
      <div class="task-actions">
        <button type="button" data-task-toggle="${escapeHtml(task.id)}">${task.status === 'done' ? 'Вернуть' : 'Выполнить'}</button>
        ${trt ? `<button type="button" data-task-open-trt="${escapeHtml(trt.id)}">Открыть ТРТ</button>` : ''}
        <button type="button" data-task-delete="${escapeHtml(task.id)}">Удалить</button>
      </div>
    </article>
  `;
}

function bindTaskActions(container) {
  container.querySelectorAll('[data-task-toggle]').forEach(button => {
    button.addEventListener('click', async () => {
      const task = tasks.find(item => item.id === button.dataset.taskToggle);
      if (!task) return;
      task.status = task.status === 'done' ? 'open' : 'done';
      task.completedAt = task.status === 'done' ? new Date().toISOString() : null;
      await putItem(STORE_TASKS, task);
      await refreshData();
      if (selectedTrtId) renderPointTasks();
    });
  });

  container.querySelectorAll('[data-task-delete]').forEach(button => {
    button.addEventListener('click', async () => {
      if (!confirm('Удалить задачу?')) return;
      await deleteItem(STORE_TASKS, button.dataset.taskDelete);
      await refreshData();
      if (selectedTrtId) renderPointTasks();
    });
  });

  container.querySelectorAll('[data-task-open-trt]').forEach(button => {
    button.addEventListener('click', () => openTrt(button.dataset.taskOpenTrt));
  });
}

function renderTasks() {
  const query = normalizeText($('tasks-search').value);
  const filter = $('tasks-filter').value;
  let rows = tasks.filter(task => {
    const trt = trts.find(item => item.id === task.trtId);
    const text = normalizeText([task.title, task.description, task.assignee, trt?.client, trt?.address].join(' '));
    if (query && !text.includes(query)) return false;
    if (filter === 'open' && task.status === 'done') return false;
    if (filter === 'done' && task.status !== 'done') return false;
    if (filter === 'overdue' && !isOverdue(task)) return false;
    return true;
  });

  $('tasks-count').textContent = rows.filter(task => task.status !== 'done').length;
  $('tasks-list').innerHTML = rows.length
    ? rows.map(task => taskCardHtml(task, true)).join('')
    : '<div class="empty-state" style="margin:0;"><h3>Задач нет</h3><p>Создайте задачу в карточке ТРТ.</p></div>';
  bindTaskActions($('tasks-list'));
}

function renderStats() {
  $('stat-trts').textContent = trts.length;
  $('stat-sales').textContent = trts.filter(hasSales).length;
  $('stat-visits').textContent = visits.length;
  $('stat-tasks').textContent = tasks.length;
  $('stat-media').textContent = mediaItems.length;
  $('topbar-subtitle').textContent = trts.length ? `${trts.length} ТРТ · ${tasks.filter(t => t.status !== 'done').length} открытых задач` : 'Мобильный помощник';
}

function renderAll() {
  renderMap();
  renderPoints();
  renderTasks();
  renderStats();
  if (selectedTrtId) {
    renderSelectedTrt();
    renderSales();
    renderVisits();
    renderMedia();
    renderPointTasks();
  }
}

function switchScreen(name) {
  document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
  document.querySelectorAll('.nav-button').forEach(button => button.classList.toggle('active', button.dataset.screen === name));
  $('screen-' + name).classList.add('active');
  if (name === 'map' && map) setTimeout(() => map.invalidateSize(), 40);
}

function selectedTrt() {
  return trts.find(item => item.id === selectedTrtId) || null;
}

function openTrt(trtId) {
  const trt = trts.find(item => item.id === trtId);
  if (!trt) return;
  selectedTrtId = trt.id;
  renderSelectedTrt();
  setDetailTab('info');
  $('detail-overlay').classList.add('open');
  $('detail-overlay').setAttribute('aria-hidden', 'false');
}

function closeTrt() {
  $('detail-overlay').classList.remove('open');
  $('detail-overlay').setAttribute('aria-hidden', 'true');
}

function renderSelectedTrt() {
  const trt = selectedTrt();
  if (!trt) return;
  const custom = trt.custom || {};
  $('detail-title').textContent = trt.client || trt.holding || 'ТРТ';
  $('detail-address').textContent = trt.address || '';
  $('detail-direction').textContent = trt.direction || '—';
  $('detail-manager').textContent = trt.manager || '—';
  $('detail-format').textContent = trt.format || '—';
  $('detail-size').textContent = Number.isFinite(Number(trt.size))
    ? `${Math.round(Number(trt.size)).toLocaleString('ru-RU')} ${trt.unit || ''}`.trim()
    : '—';

  $('edit-contact').value = custom.contact || '';
  $('edit-phone').value = custom.phone || '';
  $('edit-actual-size').value = custom.actualSize ?? '';
  $('edit-stands').value = custom.stands ?? '';
  $('edit-potential').value = custom.potential || '';
  $('edit-brands').value = custom.brands || '';
  $('edit-notes').value = custom.notes || '';
}

async function saveSelectedTrt() {
  const trt = selectedTrt();
  if (!trt) return;
  trt.custom = {
    ...(trt.custom || {}),
    contact:$('edit-contact').value.trim(),
    phone:$('edit-phone').value.trim(),
    actualSize:$('edit-actual-size').value === '' ? null : Math.round(Number($('edit-actual-size').value)),
    stands:$('edit-stands').value === '' ? null : Math.round(Number($('edit-stands').value)),
    potential:$('edit-potential').value,
    brands:$('edit-brands').value.trim(),
    notes:$('edit-notes').value.trim(),
    updatedAt:new Date().toISOString()
  };
  await putItem(STORE_TRTS, trt);
  await refreshData();
  showToast('Карточка ТРТ сохранена');
}

function setDetailTab(name) {
  document.querySelectorAll('.tab-button').forEach(button => button.classList.toggle('active', button.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === 'tab-' + name));
  if (name === 'sales') renderSales();
  if (name === 'visits') renderVisits();
  if (name === 'media') renderMedia();
  if (name === 'tasks') renderPointTasks();
}


function renderSales() {
  const trt = selectedTrt();
  const container = $('sales-content');
  if (!trt || !container) return;

  if (!hasSales(trt)) {
    container.innerHTML = '<div class="empty-state" style="margin:0;"><h3>Продажи не загружены</h3><p>В компьютерной версии сначала загрузите таблицу продаж, затем заново скачайте JSON для мобильного приложения и импортируйте его в настройках.</p></div>';
    return;
  }

  const unit = trt.unit || '';
  const s25 = salesArray(trt, 2025);
  const s26 = salesArray(trt, 2026);
  const months = matchingSalesMonths(trt);
  const y25 = salesSum(s25, months);
  const y26 = salesSum(s26, months);
  const yoy = y25 ? ((y26 - y25) / y25) * 100 : null;
  const yoyClass = yoy == null ? 'neutral' : yoy > 0 ? 'positive' : yoy < 0 ? 'negative' : 'neutral';
  const yoyText = yoy == null ? '—' : `${yoy > 0 ? '+' : ''}${yoy.toFixed(1).replace('.', ',')}%`;
  const maxValue = Math.max(1, ...s25.map(value => salesNumber(value) ?? 0), ...s26.map(value => salesNumber(value) ?? 0));

  const rows = SALES_MONTHS.map((month, index) => {
    const v25 = salesNumber(s25[index]);
    const v26 = salesNumber(s26[index]);
    if (v25 == null && v26 == null) return '';
    const width25 = v25 == null ? 0 : Math.max(2, Math.round(v25 / maxValue * 100));
    const width26 = v26 == null ? 0 : Math.max(2, Math.round(v26 / maxValue * 100));
    return `
      <div class="sales-month-row">
        <div class="sales-month-name">${month}</div>
        <div class="sales-bars">
          <div class="sales-bar-line"><span class="sales-year-label">25</span><div class="sales-bar-track"><div class="sales-bar sales-bar-2025" style="width:${width25}%"></div></div><b>${formatSales(v25)}</b></div>
          <div class="sales-bar-line"><span class="sales-year-label">26</span><div class="sales-bar-track"><div class="sales-bar sales-bar-2026" style="width:${width26}%"></div></div><b>${formatSales(v26)}</b></div>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="sales-summary-grid">
      <div class="sales-summary-card"><span>${SALES_MONTHS[0]}–${SALES_MONTHS[months-1]} 2025</span><b>${formatSales(y25, unit)}</b></div>
      <div class="sales-summary-card"><span>${SALES_MONTHS[0]}–${SALES_MONTHS[months-1]} 2026</span><b>${formatSales(y26, unit)}</b></div>
      <div class="sales-summary-card sales-yoy ${yoyClass}"><span>Изменение</span><b>${yoyText}</b></div>
    </div>
    <div class="card sales-card">
      <div class="sales-card-head"><h3 class="card-title">Продажи по месяцам</h3><span class="sales-unit">${escapeHtml(unit)}</span></div>
      <div class="sales-legend"><span><i class="legend-2025"></i>2025</span><span><i class="legend-2026"></i>2026</span></div>
      <div class="sales-months">${rows}</div>
    </div>`;
}

function renderVisits() {
  const rows = visits.filter(item => item.trtId === selectedTrtId);
  $('visits-list').innerHTML = rows.length
    ? rows.map(item => `
      <article class="timeline-item">
        <div class="timeline-date">${escapeHtml(formatDateTime(item.createdAt))}${item.distanceKm != null ? ` · ${item.distanceKm.toFixed(2)} км от точки` : ''}</div>
        <div class="timeline-title">${escapeHtml(item.result || 'Визит')}</div>
        ${item.nextStep ? `<div class="timeline-text"><b>Следующий шаг:</b> ${escapeHtml(item.nextStep)}</div>` : ''}
        ${item.comment ? `<div class="timeline-text">${escapeHtml(item.comment)}</div>` : ''}
      </article>
    `).join('')
    : '<div class="empty-state" style="margin:0;"><h3>Визитов пока нет</h3><p>Нажмите «Зафиксировать визит» во время посещения точки.</p></div>';
}

function renderMedia() {
  const rows = mediaItems.filter(item => item.trtId === selectedTrtId);
  const grid = $('media-grid');
  grid.innerHTML = '';
  if (!rows.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;margin:0;"><h3>Материалов нет</h3><p>Добавьте фото или видео этой точки.</p></div>';
    return;
  }

  rows.forEach(item => {
    const url = URL.createObjectURL(item.blob);
    const card = document.createElement('div');
    card.className = 'media-card';
    card.innerHTML = item.type.startsWith('video/')
      ? `<video src="${url}" controls preload="metadata"></video>`
      : `<img src="${url}" alt="Фото ТРТ">`;
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'media-delete';
    deleteButton.textContent = '×';
    deleteButton.addEventListener('click', async () => {
      if (!confirm('Удалить файл?')) return;
      URL.revokeObjectURL(url);
      await deleteItem(STORE_MEDIA, item.id);
      await refreshData();
    });
    card.appendChild(deleteButton);
    grid.appendChild(card);
  });
}

function renderPointTasks() {
  const rows = tasks.filter(item => item.trtId === selectedTrtId);
  const container = $('point-tasks-list');
  container.innerHTML = rows.length
    ? rows.map(task => taskCardHtml(task, false)).join('')
    : '<div class="empty-state" style="margin:0;"><h3>Задач по точке нет</h3><p>Нажмите «Поставить задачу».</p></div>';
  bindTaskActions(container);
}

function openModal(id) {
  $(id).classList.add('open');
}

function closeModals() {
  document.querySelectorAll('.modal-backdrop').forEach(modal => modal.classList.remove('open'));
}

function geolocate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Геолокация не поддерживается'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      position => resolve({
        lat:position.coords.latitude,
        lon:position.coords.longitude,
        accuracy:position.coords.accuracy
      }),
      error => reject(error),
      {enableHighAccuracy:true, timeout:12000, maximumAge:30000}
    );
  });
}

async function locateUser(openNearest=false) {
  try {
    const position = await geolocate();
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.circleMarker([position.lat, position.lon], {
      radius:8, color:'#fff', weight:3, fillColor:'#1677ff', fillOpacity:1
    }).addTo(map);
    map.setView([position.lat, position.lon], 14);

    if (openNearest && trts.length) {
      const nearest = trts
        .map(trt => ({trt, distance:haversineKm(position.lat, position.lon, trt.lat, trt.lon)}))
        .sort((a,b) => a.distance - b.distance)[0];
      if (nearest) {
        showToast(`Ближайшая ТРТ: ${nearest.distance.toFixed(2)} км`);
        openTrt(nearest.trt.id);
      }
    }
  } catch (error) {
    showToast('Не удалось получить геолокацию. Проверьте разрешение браузера.');
  }
}

function openVisitModal() {
  if (!selectedTrtId) return;
  visitFiles = [];
  $('visit-result').value = 'Переговоры проведены';
  $('visit-next-step').value = '';
  $('visit-comment').value = '';
  $('visit-photo-input').value = '';
  $('visit-video-input').value = '';
  $('visit-files-note').textContent = 'Файлы не выбраны';
  openModal('visit-modal');
}

function updateVisitFilesNote() {
  $('visit-files-note').textContent = visitFiles.length
    ? `Выбрано файлов: ${visitFiles.length}`
    : 'Файлы не выбраны';
}

async function saveMediaFiles(files, trtId, visitId=null) {
  const maxSize = 80 * 1024 * 1024;
  for (const file of files) {
    if (file.size > maxSize) {
      showToast(`Файл ${file.name} больше 80 МБ и пропущен`);
      continue;
    }
    await putItem(STORE_MEDIA, {
      id:uuid(),
      trtId,
      visitId,
      name:file.name || 'файл',
      type:file.type || 'application/octet-stream',
      size:file.size,
      createdAt:new Date().toISOString(),
      blob:file
    });
  }
}

async function saveVisit() {
  const trt = selectedTrt();
  if (!trt) return;

  const visit = {
    id:uuid(),
    trtId:trt.id,
    createdAt:new Date().toISOString(),
    result:$('visit-result').value,
    nextStep:$('visit-next-step').value.trim(),
    comment:$('visit-comment').value.trim(),
    latitude:null,
    longitude:null,
    accuracy:null,
    distanceKm:null
  };

  try {
    const position = await geolocate();
    visit.latitude = position.lat;
    visit.longitude = position.lon;
    visit.accuracy = position.accuracy;
    visit.distanceKm = haversineKm(position.lat, position.lon, trt.lat, trt.lon);
  } catch (error) {
    // Визит всё равно сохраняется без координат.
  }

  await putItem(STORE_VISITS, visit);
  if (visitFiles.length) await saveMediaFiles(visitFiles, trt.id, visit.id);
  closeModals();
  await refreshData();
  setDetailTab('visits');
  showToast('Визит сохранён');
}

function openTaskModal() {
  if (!selectedTrtId) return;
  $('task-title').value = '';
  $('task-assignee').value = selectedTrt()?.manager || '';
  $('task-due').value = '';
  $('task-priority').value = 'Средний';
  $('task-description').value = '';
  openModal('task-modal');
}

async function saveTask() {
  const title = $('task-title').value.trim();
  if (!title) {
    showToast('Введите название задачи');
    return;
  }
  const task = {
    id:uuid(),
    trtId:selectedTrtId,
    title,
    assignee:$('task-assignee').value.trim(),
    dueDate:$('task-due').value,
    priority:$('task-priority').value,
    description:$('task-description').value.trim(),
    status:'open',
    createdAt:new Date().toISOString(),
    completedAt:null
  };
  await putItem(STORE_TASKS, task);
  closeModals();
  await refreshData();
  setDetailTab('tasks');
  showToast('Задача создана');
}

async function addStandaloneMedia(files) {
  if (!selectedTrtId || !files.length) return;
  try {
    await saveMediaFiles(Array.from(files), selectedTrtId, null);
    await refreshData();
    setDetailTab('media');
    showToast('Материалы сохранены');
  } catch (error) {
    console.error(error);
    showToast('Не удалось сохранить файл. Возможно, закончилась память браузера.');
  }
}

async function importMobileJson(file) {
  const text = await file.text();
  const payload = JSON.parse(text);
  if (payload.schema !== 'trt-mobile-v1' || !Array.isArray(payload.points)) {
    throw new Error('Это не файл экспорта мобильного приложения.');
  }
  await replaceTrts(payload.points);
  await putItem(STORE_SETTINGS, {
    key:'lastImport',
    fileName:file.name,
    importedAt:new Date().toISOString(),
    exportedAt:payload.exportedAt || null,
    pointCount:payload.points.length
  });
  await refreshData();
  $('import-status').textContent = `Загружено ТРТ: ${trts.length}. Файл: ${file.name}`;
  showToast(`Загружено точек: ${trts.length}`);
  switchScreen('map');
  if (trts.length && map && typeof window.L !== 'undefined') {
    const bounds = L.latLngBounds(trts.map(item => [item.lat, item.lon]));
    map.fitBounds(bounds.pad(.08), {maxZoom:12});
  }
}

async function exportBackup() {
  const payload = {
    schema:'trt-mobile-backup-v1',
    exportedAt:new Date().toISOString(),
    trts,
    visits,
    tasks,
    note:'Фото и видео в эту резервную копию не включены.'
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'Резервная_копия_ТРТ_' + todayIso() + '.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}


async function restoreBackup(file) {
  const text = await file.text();
  const payload = JSON.parse(text);
  if (payload.schema !== 'trt-mobile-backup-v1' || !Array.isArray(payload.trts)) {
    throw new Error('Это не резервная копия приложения ТРТ.');
  }

  const tx = db.transaction([STORE_TRTS, STORE_VISITS, STORE_TASKS], 'readwrite');
  const trtStore = tx.objectStore(STORE_TRTS);
  const visitStore = tx.objectStore(STORE_VISITS);
  const taskStore = tx.objectStore(STORE_TASKS);
  trtStore.clear(); visitStore.clear(); taskStore.clear();
  payload.trts.forEach(item => trtStore.put(item));
  (payload.visits || []).forEach(item => visitStore.put(item));
  (payload.tasks || []).forEach(item => taskStore.put(item));
  await transactionComplete(tx);
  await refreshData();
  showToast(`Восстановлено ТРТ: ${trts.length}`);
  switchScreen('map');
}

async function clearAllData() {
  if (!confirm('Удалить все ТРТ, визиты, задачи, фото и видео с этого устройства?')) return;
  const stores = [STORE_TRTS, STORE_VISITS, STORE_TASKS, STORE_MEDIA, STORE_SETTINGS];
  const tx = db.transaction(stores, 'readwrite');
  stores.forEach(name => tx.objectStore(name).clear());
  await transactionComplete(tx);
  selectedTrtId = null;
  closeTrt();
  await refreshData();
  showToast('Данные приложения удалены');
}

function bindEvents() {
  document.querySelectorAll('.nav-button').forEach(button => {
    button.addEventListener('click', () => switchScreen(button.dataset.screen));
  });

  $('map-search').addEventListener('input', renderMap);
  $('points-search').addEventListener('input', renderPoints);
  $('points-filter').addEventListener('change', renderPoints);
  $('tasks-search').addEventListener('input', renderTasks);
  $('tasks-filter').addEventListener('change', renderTasks);

  $('map-location-button').addEventListener('click', () => locateUser(false));
  $('quick-nearest-button').addEventListener('click', () => locateUser(true));

  $('detail-close').addEventListener('click', closeTrt);
  $('detail-location').addEventListener('click', () => {
    const trt = selectedTrt();
    if (!trt) return;
    closeTrt();
    switchScreen('map');
    if (map) map.setView([trt.lat, trt.lon], 16);
    else showToast('Карта сейчас недоступна, но карточка ТРТ сохранена');
  });

  document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => setDetailTab(button.dataset.tab));
  });

  $('save-trt-button').addEventListener('click', saveSelectedTrt);
  $('start-visit-button').addEventListener('click', openVisitModal);
  $('new-task-button').addEventListener('click', openTaskModal);
  $('open-sales-button').addEventListener('click', () => setDetailTab('sales'));
  $('save-visit-button').addEventListener('click', saveVisit);
  $('save-task-button').addEventListener('click', saveTask);

  document.querySelectorAll('.modal-cancel').forEach(button => button.addEventListener('click', closeModals));
  document.querySelectorAll('.modal-backdrop').forEach(modal => {
    modal.addEventListener('click', event => {
      if (event.target === modal) closeModals();
    });
  });

  $('add-photo-button').addEventListener('click', () => $('photo-input').click());
  $('add-video-button').addEventListener('click', () => $('video-input').click());
  $('photo-input').addEventListener('change', event => addStandaloneMedia(event.target.files));
  $('video-input').addEventListener('change', event => addStandaloneMedia(event.target.files));

  $('visit-photo-button').addEventListener('click', () => $('visit-photo-input').click());
  $('visit-video-button').addEventListener('click', () => $('visit-video-input').click());
  $('visit-photo-input').addEventListener('change', event => {
    visitFiles.push(...Array.from(event.target.files || []));
    updateVisitFilesNote();
  });
  $('visit-video-input').addEventListener('change', event => {
    visitFiles.push(...Array.from(event.target.files || []));
    updateVisitFilesNote();
  });

  $('mobile-import-button').addEventListener('click', () => $('mobile-import-input').click());
  $('mobile-import-input').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    $('import-status').textContent = `Чтение файла ${file.name}…`;
    try {
      await importMobileJson(file);
    } catch (error) {
      console.error(error);
      $('import-status').textContent = 'Ошибка: ' + error.message;
      showToast('Не удалось импортировать файл');
    } finally {
      event.target.value = '';
    }
  });

  $('export-backup-button').addEventListener('click', exportBackup);
  $('restore-backup-button').addEventListener('click', () => $('restore-backup-input').click());
  $('restore-backup-input').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { await restoreBackup(file); }
    catch (error) { console.error(error); showToast(error.message || 'Не удалось восстановить копию'); }
    finally { event.target.value = ''; }
  });
  $('clear-app-button').addEventListener('click', clearAllData);
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    try {
      await navigator.serviceWorker.register('./sw.js', { scope: './' });
    } catch (error) {
      console.warn('Service Worker не зарегистрирован', error);
    }
  }
}

async function init() {
  try {
    db = await openDatabase();
    initMap();
    bindEvents();
    await refreshData();
    await registerServiceWorker();
  } catch (error) {
    console.error(error);
    document.body.innerHTML = '<div class="empty-state"><h3>Не удалось запустить приложение</h3><p>' +
      escapeHtml(error.message || String(error)) + '</p></div>';
  }
}

document.addEventListener('DOMContentLoaded', init);
