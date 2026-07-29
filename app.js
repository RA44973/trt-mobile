
'use strict';

const DB_NAME = 'trt-mobile-db';
const DB_VERSION = 1;
const STORE_TRTS = 'trts';
const STORE_VISITS = 'visits';
const STORE_TASKS = 'tasks';
const STORE_MEDIA = 'media';
const STORE_SETTINGS = 'settings';

const API_BASE_URL = 'https://d5dukure58mpc70n6ftu.uvah0e6r.apigw.yandexcloud.net';
const AUTH_TOKEN_KEY = 'trt-auth-token';
const AUTH_USER_KEY = 'trt-auth-user';
const AUTH_VERIFIED_AT_KEY = 'trt-auth-verified-at';
const AUTH_OFFLINE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const TASK_TYPES = Object.freeze([
  'Переместить внутри ТРТ',
  'Расширить ассортимент',
  'Провести ротацию',
  'Подключить к VOG Club',
  'Оформить БЗ'
]);

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
let sessionToken = '';
let currentUser = null;
let authOffline = false;
let appInitialized = false;
let visitsSyncPromise = null;
let tasksSyncPromise = null;
let mediaSyncPromise = null;
let saveVisitInProgress = false;
let saveTaskInProgress = false;
let selectedTaskId = null;
let selectedTaskMode = 'view';
let taskCompletionFiles = [];
let taskCreationFiles = [];
let completeTaskInProgress = false;

const $ = (id) => document.getElementById(id);


function readStoredUser() {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function saveAuth(token, user) {
  sessionToken = String(token || '');
  currentUser = user || null;
  localStorage.setItem(AUTH_TOKEN_KEY, sessionToken);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(currentUser));
  localStorage.setItem(AUTH_VERIFIED_AT_KEY, String(Date.now()));
}

function clearAuth() {
  sessionToken = '';
  currentUser = null;
  authOffline = false;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  localStorage.removeItem(AUTH_VERIFIED_AT_KEY);
}

function setLoginStatus(message, isSuccess=false) {
  const node = $('login-status');
  if (!node) return;
  node.textContent = message || '';
  node.classList.toggle('success', Boolean(isSuccess));
}

function setLoginBusy(isBusy) {
  const button = $('login-button');
  if (!button) return;
  button.disabled = isBusy;
  button.textContent = isBusy ? 'Проверяем…' : 'Войти';
}

async function apiRequest(path, options={}) {
  const method = options.method || 'GET';
  const token = options.token === undefined ? sessionToken : options.token;
  const headers = {'Content-Type':'application/json'};
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 15000);

  try {
    const response = await fetch(API_BASE_URL + path, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      cache: 'no-store'
    });

    const text = await response.text();
    let payload = {};
    if (text) {
      try { payload = JSON.parse(text); }
      catch (_) { payload = {raw:text}; }
    }

    if (!response.ok) {
      const error = new Error(payload.error || `Ошибка сервера: ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('Сервер не ответил вовремя. Проверьте интернет.');
      timeoutError.isNetworkError = true;
      throw timeoutError;
    }
    if (!error.status) error.isNetworkError = true;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function updateAccountUi() {
  if (!$('account-full-name')) return;
  $('account-full-name').textContent = currentUser?.full_name || '—';
  $('account-login').textContent = currentUser?.login || '—';
  $('account-role').textContent = currentUser?.role || '—';
  $('account-connection').textContent = authOffline ? 'Офлайн' : 'Онлайн';
  $('account-connection').className = authOffline ? 'account-offline' : 'account-online';
  $('offline-banner').classList.toggle('hidden', !authOffline);
}

function showLogin(message='') {
  $('auth-screen').classList.remove('hidden');
  document.querySelector('.app-shell').classList.add('hidden');
  $('offline-banner').classList.add('hidden');
  setLoginStatus(message);
  setLoginBusy(false);
  setTimeout(() => $('login-input')?.focus(), 50);
}

async function showApp() {
  $('auth-screen').classList.add('hidden');
  document.querySelector('.app-shell').classList.remove('hidden');
  updateAccountUi();

  if (!appInitialized) {
    initMap();
    bindEvents();
    await refreshData();
    appInitialized = true;
  } else {
    renderAll();
  }

  if (map) setTimeout(() => map.invalidateSize(), 80);

  if (!authOffline && sessionToken) {
    setTimeout(() => {
      syncAllWithServer({silent:true});
    }, 0);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const login = String($('login-input').value || '').trim().toLowerCase();
  const password = String($('password-input').value || '');

  if (!login || !password) {
    setLoginStatus('Введите логин и пароль.');
    return;
  }

  setLoginBusy(true);
  setLoginStatus('Подключаемся к серверу…', true);

  try {
    const result = await apiRequest('/auth/login', {
      method:'POST',
      token:'',
      body:{
        login,
        password,
        device_name:`ТРТ PWA · ${navigator.platform || 'устройство'}`
      }
    });

    saveAuth(result.session_token, result.user);
    authOffline = false;
    $('password-input').value = '';
    await showApp();
    showToast(`Вход выполнен: ${currentUser?.full_name || login}`);
  } catch (error) {
    setLoginStatus(error.message || 'Не удалось выполнить вход.');
  } finally {
    setLoginBusy(false);
  }
}

async function restoreAuth() {
  const storedToken = localStorage.getItem(AUTH_TOKEN_KEY) || '';
  const storedUser = readStoredUser();
  const verifiedAt = Number(localStorage.getItem(AUTH_VERIFIED_AT_KEY) || 0);

  if (!storedToken || !storedUser) {
    showLogin();
    return;
  }

  sessionToken = storedToken;
  currentUser = storedUser;
  setLoginStatus('Проверяем сохранённую сессию…', true);

  try {
    const result = await apiRequest('/auth/me');
    saveAuth(storedToken, result.user);
    authOffline = false;
    await showApp();
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      clearAuth();
      showLogin('Сессия завершена. Войдите снова.');
      return;
    }

    const canUseOffline = verifiedAt > 0 && Date.now() - verifiedAt <= AUTH_OFFLINE_MAX_AGE_MS;
    if (canUseOffline) {
      authOffline = true;
      await showApp();
      showToast('Приложение открыто в офлайн-режиме');
      return;
    }

    clearAuth();
    showLogin('Нет связи с сервером. Для первого входа нужен интернет.');
  }
}

async function handleLogout() {
  if (!confirm('Выйти из учётной записи на этом устройстве?')) return;

  const tokenToRevoke = sessionToken;
  try {
    if (tokenToRevoke && !authOffline) {
      await apiRequest('/auth/logout', {method:'POST', body:{}});
    }
  } catch (error) {
    console.warn('Не удалось завершить сессию на сервере', error);
  }

  clearAuth();
  closeTrt();
  $('password-input').value = '';
  showLogin('Вы вышли из учётной записи.');
}

function bindAuthEvents() {
  $('login-form').addEventListener('submit', handleLogin);
  $('logout-button').addEventListener('click', handleLogout);
  window.addEventListener('online', async () => {
    if (authOffline && sessionToken) {
      await restoreAuth();
      return;
    }
    if (sessionToken) {
      syncAllWithServer({silent:false});
    }
  });
}

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

async function getItem(storeName, id) {
  const tx = db.transaction(storeName, 'readonly');
  return requestToPromise(tx.objectStore(storeName).get(id));
}

async function putItem(storeName, item) {
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(item);
  await transactionComplete(tx);
}

async function putItems(storeName, items) {
  if (!Array.isArray(items) || !items.length) return;
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  items.forEach(item => store.put(item));
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


function optionalFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function visitSyncPayload(visit) {
  return {
    id:String(visit.id || ''),
    trtId:String(visit.trtId || ''),
    createdAt:visit.createdAt || new Date().toISOString(),
    result:String(visit.result || ''),
    nextStep:String(visit.nextStep || ''),
    comment:String(visit.comment || ''),
    latitude:optionalFiniteNumber(visit.latitude),
    longitude:optionalFiniteNumber(visit.longitude),
    distanceKm:optionalFiniteNumber(visit.distanceKm)
  };
}

async function syncOneVisitWithServer(visitId, {notify=true}={}) {
  if (!sessionToken || authOffline || navigator.onLine === false) {
    if (notify) showToast('Визит сохранён. Он отправится на сервер после появления интернета.');
    return {ok:false, offline:true};
  }

  const visit = await getItem(STORE_VISITS, visitId);
  if (!visit) return {ok:false, missing:true};
  if (visit.serverSyncedAt) return {ok:true, alreadySynced:true};

  try {
    const result = await apiRequest('/visits/sync', {
      method:'POST',
      timeout:20000,
      body:{visits:[visitSyncPayload(visit)]}
    });

    const accepted = (result.visit_ids || []).map(String).includes(String(visitId));
    if (!accepted) {
      const rejected = Array.isArray(result.rejected) ? result.rejected : [];
      const reason = rejected[0]?.error || 'Сервер не подтвердил сохранение визита.';
      throw new Error(reason);
    }

    visit.serverSyncedAt = new Date().toISOString();
    await putItem(STORE_VISITS, visit);
    if (notify) showToast('Визит отправлен на сервер');
    return {ok:true};
  } catch (error) {
    console.warn('Не удалось отправить визит на сервер', error);
    if (notify) showToast('Визит сохранён на устройстве. Отправка на сервер повторится автоматически.');
    return {ok:false, error, offline:Boolean(error.isNetworkError)};
  }
}

async function syncVisitsWithServer({silent=true}={}) {
  if (!sessionToken || authOffline || navigator.onLine === false) {
    return {ok:false, offline:true, uploaded:0, downloaded:0};
  }

  if (visitsSyncPromise) return visitsSyncPromise;

  visitsSyncPromise = (async () => {
    const localVisits = await getAll(STORE_VISITS);
    const pending = localVisits.filter(item => !item.serverSyncedAt);
    const syncedIds = new Set();
    const rejected = [];
    const batchSize = 20;

    for (let start = 0; start < pending.length; start += batchSize) {
      const batch = pending.slice(start, start + batchSize);
      const result = await apiRequest('/visits/sync', {
        method:'POST',
        timeout:20000,
        body:{visits:batch.map(visitSyncPayload)}
      });

      (result.visit_ids || []).forEach(id => syncedIds.add(String(id)));
      (result.rejected || []).forEach(item => rejected.push(item));
    }

    const syncedAt = new Date().toISOString();
    if (syncedIds.size) {
      const updatedLocal = localVisits
        .filter(item => syncedIds.has(String(item.id)))
        .map(item => ({...item, serverSyncedAt:syncedAt}));
      await putItems(STORE_VISITS, updatedLocal);
    }

    const remoteResult = await apiRequest('/visits', {
      method:'GET',
      timeout:20000
    });
    const remoteVisits = Array.isArray(remoteResult.visits) ? remoteResult.visits : [];

    if (remoteVisits.length) {
      const currentLocal = await getAll(STORE_VISITS);
      const localById = new Map(currentLocal.map(item => [String(item.id), item]));
      const merged = remoteVisits.map(item => ({
        ...(localById.get(String(item.id)) || {}),
        ...item,
        serverSyncedAt:syncedAt
      }));
      await putItems(STORE_VISITS, merged);
    }

    await refreshData();

    if (!silent) {
      if (rejected.length) {
        showToast(`Синхронизировано визитов: ${syncedIds.size}. Ошибок: ${rejected.length}`);
      } else {
        showToast('Визиты синхронизированы');
      }
    }

    return {
      ok:true,
      uploaded:syncedIds.size,
      downloaded:remoteVisits.length,
      rejected
    };
  })();

  try {
    return await visitsSyncPromise;
  } catch (error) {
    console.warn('Не удалось синхронизировать визиты', error);
    if (!silent) {
      showToast('Нет связи с сервером. Визиты сохранены на устройстве.');
    }
    return {
      ok:false,
      offline:Boolean(error.isNetworkError),
      error
    };
  } finally {
    visitsSyncPromise = null;
  }
}


function taskVersion(task) {
  const version = Number(task?.version);
  return Number.isInteger(version) && version > 0 ? version : 1;
}

function taskSyncPayload(task) {
  const trt = trts.find(item => String(item.id) === String(task.trtId));
  return {
    id:String(task.id || ''),
    trtId:task.trtId == null ? '' : String(task.trtId),
    direction:String(task.direction || trt?.direction || ''),
    assigneeId:String(task.assigneeId || currentUser?.employee_id || ''),
    title:String(task.title || ''),
    description:String(task.description || ''),
    completionComment:String(task.completionComment || ''),
    priority:String(task.priority || 'Средний'),
    status:String(task.status || 'open'),
    dueDate:String(task.dueDate || ''),
    completedAt:task.completedAt || null,
    createdAt:task.createdAt || new Date().toISOString(),
    updatedAt:task.updatedAt || task.createdAt || new Date().toISOString(),
    version:taskVersion(task)
  };
}

async function syncOneTaskWithServer(taskId, {notify=true}={}) {
  if (!sessionToken || authOffline || navigator.onLine === false) {
    if (notify) showToast('Задача сохранена. Она отправится на сервер после появления интернета.');
    return {ok:false, offline:true};
  }

  const task = await getItem(STORE_TASKS, taskId);
  if (!task) return {ok:false, missing:true};
  if (task.serverSyncedAt && !task.deletedAt) return {ok:true, alreadySynced:true};

  try {
    const result = await apiRequest('/tasks/sync', {
      method:'POST',
      timeout:20000,
      body:{tasks:[taskSyncPayload(task)]}
    });

    const accepted = (result.task_ids || []).map(String).includes(String(taskId));
    const deleted = (result.deleted_ids || []).map(String).includes(String(taskId));

    if (!accepted && !deleted) {
      const rejected = Array.isArray(result.rejected) ? result.rejected : [];
      const reason = rejected[0]?.error || 'Сервер не подтвердил сохранение задачи.';
      throw new Error(reason);
    }

    if (deleted) {
      await deleteItem(STORE_TASKS, taskId);
      if (notify) showToast('Задача удалена на сервере');
    } else {
      task.serverSyncedAt = new Date().toISOString();
      await putItem(STORE_TASKS, task);
      if (notify) showToast('Задача отправлена на сервер');
    }

    await refreshData();
    return {ok:true, deleted};
  } catch (error) {
    console.warn('Не удалось отправить задачу на сервер', error);
    if (notify) showToast('Задача сохранена на устройстве. Синхронизация повторится автоматически.');
    return {ok:false, error, offline:Boolean(error.isNetworkError)};
  }
}

async function syncTasksWithServer({silent=true}={}) {
  if (!sessionToken || authOffline || navigator.onLine === false) {
    return {ok:false, offline:true, uploaded:0, downloaded:0};
  }

  if (tasksSyncPromise) return tasksSyncPromise;

  tasksSyncPromise = (async () => {
    const localTasks = await getAll(STORE_TASKS);
    const pending = localTasks.filter(item => !item.serverSyncedAt);
    const syncedIds = new Set();
    const deletedIds = new Set();
    const rejected = [];
    const batchSize = 20;

    for (let start = 0; start < pending.length; start += batchSize) {
      const batch = pending.slice(start, start + batchSize);
      const result = await apiRequest('/tasks/sync', {
        method:'POST',
        timeout:20000,
        body:{tasks:batch.map(taskSyncPayload)}
      });

      (result.task_ids || []).forEach(id => syncedIds.add(String(id)));
      (result.deleted_ids || []).forEach(id => deletedIds.add(String(id)));
      (result.rejected || []).forEach(item => rejected.push(item));
    }

    const syncedAt = new Date().toISOString();

    if (syncedIds.size) {
      const updatedLocal = localTasks
        .filter(item => syncedIds.has(String(item.id)))
        .map(item => ({
          ...item,
          version:taskVersion(item),
          serverSyncedAt:syncedAt
        }));
      await putItems(STORE_TASKS, updatedLocal);
    }

    for (const id of deletedIds) {
      await deleteItem(STORE_TASKS, id);
    }

    const remoteResult = await apiRequest('/tasks', {
      method:'GET',
      timeout:20000
    });
    const remoteTasks = Array.isArray(remoteResult.tasks) ? remoteResult.tasks : [];
    const currentLocal = await getAll(STORE_TASKS);
    const localById = new Map(currentLocal.map(item => [String(item.id), item]));
    const remoteIds = new Set(remoteTasks.map(item => String(item.id)));
    const merged = [];

    for (const remote of remoteTasks) {
      const id = String(remote.id);
      const local = localById.get(id);

      if (local?.deletedAt) continue;

      const localIsNewer = local && !local.serverSyncedAt && taskVersion(local) > taskVersion(remote);
      if (localIsNewer) {
        merged.push(local);
      } else {
        merged.push({
          ...(local || {}),
          ...remote,
          deletedAt:null,
          serverSyncedAt:syncedAt
        });
      }
    }

    if (merged.length) await putItems(STORE_TASKS, merged);

    // Удаление, выполненное на другом устройстве, убирает только ранее синхронизированную локальную копию.
    for (const local of currentLocal) {
      if (local.deletedAt) continue;
      if (local.serverSyncedAt && !remoteIds.has(String(local.id))) {
        await deleteItem(STORE_TASKS, local.id);
      }
    }

    await refreshData();

    return {
      ok:true,
      uploaded:syncedIds.size,
      deleted:deletedIds.size,
      downloaded:remoteTasks.length,
      rejected
    };
  })();

  try {
    return await tasksSyncPromise;
  } catch (error) {
    console.warn('Не удалось синхронизировать задачи', error);
    return {
      ok:false,
      offline:Boolean(error.isNetworkError),
      error
    };
  } finally {
    tasksSyncPromise = null;
  }
}


function mediaUploadPayload(item) {
  return {
    id:String(item.id || ''),
    trtId:String(item.trtId || ''),
    visitId:item.visitId == null ? '' : String(item.visitId),
    taskId:item.taskId == null ? '' : String(item.taskId),
    purpose:String(item.purpose || ''),
    name:String(item.name || 'файл'),
    type:String(item.type || 'application/octet-stream'),
    size:Number(item.size || item.blob?.size || 0),
    createdAt:item.createdAt || new Date().toISOString()
  };
}

function normalizeRemoteMedia(item, local=null, syncedAt=null) {
  return {
    ...(local || {}),
    id:String(item.id || local?.id || ''),
    trtId:String(item.trtId || local?.trtId || ''),
    visitId:item.visitId || local?.visitId || null,
    taskId:item.taskId || local?.taskId || null,
    purpose:item.purpose || local?.purpose || (
      (item.taskId || local?.taskId) ? 'task_result' :
      (item.visitId || local?.visitId) ? 'visit' : 'point'
    ),
    employeeId:item.employeeId || local?.employeeId || '',
    objectKey:item.objectKey || local?.objectKey || '',
    name:item.name || local?.name || 'файл',
    type:item.type || local?.type || 'application/octet-stream',
    mediaKind:item.mediaKind || local?.mediaKind || '',
    size:Number(item.size || local?.size || 0),
    status:item.status || 'uploaded',
    etag:item.etag || local?.etag || '',
    createdAt:item.createdAt || local?.createdAt || new Date().toISOString(),
    updatedAt:item.updatedAt || local?.updatedAt || null,
    downloadUrl:item.downloadUrl || local?.downloadUrl || '',
    downloadUrlReceivedAt:item.downloadUrl ? new Date().toISOString() : (local?.downloadUrlReceivedAt || null),
    serverSyncedAt:syncedAt || local?.serverSyncedAt || new Date().toISOString()
  };
}

async function uploadOneMediaItem(item, {notify=false}={}) {
  if (!item?.id) return {ok:false, missing:true};
  if (!item.blob) return {ok:false, noBlob:true};

  const request = await apiRequest('/media/upload-url', {
    method:'POST',
    timeout:20000,
    body:mediaUploadPayload(item)
  });

  if (request.already_uploaded && request.media) {
    const updated = normalizeRemoteMedia(request.media, item, new Date().toISOString());
    await putItem(STORE_MEDIA, updated);
    if (notify) showToast('Файл уже был загружен');
    return {ok:true, alreadyUploaded:true};
  }

  const uploadHeaders = request.headers || {'Content-Type':item.type};
  const uploadResponse = await fetch(request.upload_url, {
    method:'PUT',
    headers:uploadHeaders,
    body:item.blob
  });

  if (!uploadResponse.ok) {
    throw new Error(`Object Storage не принял файл: ${uploadResponse.status}`);
  }

  const complete = await apiRequest('/media/complete', {
    method:'POST',
    timeout:20000,
    body:{
      mediaId:item.id,
      etag:uploadResponse.headers.get('ETag') || ''
    }
  });

  if (!complete.uploaded || !complete.media) {
    throw new Error('Сервер не подтвердил загрузку файла.');
  }

  const updated = normalizeRemoteMedia(
    complete.media,
    item,
    new Date().toISOString()
  );
  await putItem(STORE_MEDIA, updated);
  if (notify) showToast('Файл загружен');
  return {ok:true};
}

async function syncMediaWithServer({silent=true}={}) {
  if (!sessionToken || authOffline || navigator.onLine === false) {
    return {ok:false, offline:true, uploaded:0, downloaded:0};
  }

  if (mediaSyncPromise) return mediaSyncPromise;

  mediaSyncPromise = (async () => {
    const localItems = await getAll(STORE_MEDIA);
    const pending = localItems.filter(item => item.blob && !item.serverSyncedAt);
    let uploaded = 0;
    const errors = [];

    for (const item of pending) {
      try {
        const result = await uploadOneMediaItem(item, {notify:false});
        if (result.ok) uploaded += 1;
      } catch (error) {
        console.warn('Не удалось загрузить медиафайл', item.id, error);
        errors.push({id:item.id, error:error.message || String(error)});
      }
    }

    const remoteResult = await apiRequest('/media', {
      method:'GET',
      timeout:30000
    });
    const remoteItems = Array.isArray(remoteResult.media) ? remoteResult.media : [];
    const currentLocal = await getAll(STORE_MEDIA);
    const localById = new Map(currentLocal.map(item => [String(item.id), item]));
    const syncedAt = new Date().toISOString();
    const merged = remoteItems.map(item => normalizeRemoteMedia(
      item,
      localById.get(String(item.id)) || null,
      syncedAt
    ));

    if (merged.length) await putItems(STORE_MEDIA, merged);
    await refreshData();

    if (!silent) {
      if (errors.length) {
        showToast(`Загружено файлов: ${uploaded}. Ошибок: ${errors.length}`);
      } else {
        showToast('Фото и видео синхронизированы');
      }
    }

    return {
      ok:errors.length === 0,
      uploaded,
      downloaded:remoteItems.length,
      errors
    };
  })();

  try {
    return await mediaSyncPromise;
  } catch (error) {
    console.warn('Не удалось синхронизировать фото и видео', error);
    if (!silent) showToast('Фото и видео остались на устройстве. Отправка повторится автоматически.');
    return {ok:false, offline:Boolean(error.isNetworkError), error};
  } finally {
    mediaSyncPromise = null;
  }
}

async function syncAllWithServer({silent=true}={}) {
  const visitsResult = await syncVisitsWithServer({silent:true});
  const tasksResult = await syncTasksWithServer({silent:true});
  const mediaResult = await syncMediaWithServer({silent:true});

  if (!silent) {
    if (visitsResult.ok && tasksResult.ok && mediaResult.ok) {
      showToast('Данные синхронизированы');
    } else {
      showToast('Часть данных осталась на устройстве. Синхронизация повторится автоматически.');
    }
  }

  return {visits:visitsResult, tasks:tasksResult, media:mediaResult};
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
  tasks = tasks.filter(item => !item.deletedAt);
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
  map = L.map('map', {zoomControl:false, attributionControl:false}).setView([55.65, 37.62], 8);
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

function canCurrentUserCompleteTask(task) {
  if (!task || task.status === 'done') return false;

  const currentEmployeeId = String(currentUser?.employee_id || '').trim();
  const assigneeId = String(task.assigneeId || '').trim();
  if (currentEmployeeId && assigneeId) return currentEmployeeId === assigneeId;

  const currentName = normalizeText(currentUser?.full_name || '');
  const assigneeName = normalizeText(task.assignee || '');
  return Boolean(currentName && assigneeName && currentName === assigneeName);
}

function taskCardHtml(task, showPoint=true) {
  const trt = trts.find(item => item.id === task.trtId);
  const canComplete = canCurrentUserCompleteTask(task);
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
        <button type="button" data-task-view="${escapeHtml(task.id)}">Просмотр</button>
        ${canComplete ? `<button type="button" data-task-complete="${escapeHtml(task.id)}">Выполнить</button>` : ''}
        ${trt ? `<button type="button" data-task-open-trt="${escapeHtml(trt.id)}">Открыть ТРТ</button>` : ''}
      </div>
    </article>
  `;
}

function ensureTaskDetailsUi() {
  if ($('task-detail-modal')) return;

  const style = document.createElement('style');
  style.textContent = `
    .task-detail-sheet{max-height:92vh;overflow:auto}
    .task-detail-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0}
    .task-detail-box{background:#f7f8fa;border:1px solid #e4e7ec;border-radius:12px;padding:10px}
    .task-detail-box span{display:block;color:#667085;font-size:11px;margin-bottom:4px}
    .task-detail-box b{display:block;font-size:13px;overflow-wrap:anywhere}
    .task-detail-description{white-space:pre-wrap;line-height:1.5;background:#f7f8fa;border-radius:12px;padding:12px;margin:10px 0 14px}
    .task-media-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}
    .task-media-grid .media-card{min-height:110px}
    .task-detail-done-note{padding:12px;border-radius:12px;background:#ecfdf3;color:#067647;white-space:pre-wrap;line-height:1.45}
    @media (max-width:420px){.task-detail-summary{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  document.body.insertAdjacentHTML('beforeend', `
    <div id="task-detail-modal" class="modal-backdrop">
      <div class="modal-sheet task-detail-sheet">
        <div class="modal-handle"></div>
        <h2 id="task-detail-title" class="modal-title">Задача</h2>
        <div id="task-detail-summary" class="task-detail-summary"></div>
        <div class="field-group">
          <label class="field-label">Описание</label>
          <div id="task-detail-description" class="task-detail-description">—</div>
        </div>
        <div class="field-group">
          <label class="field-label">Материалы задачи</label>
          <div id="task-materials-media" class="task-media-grid"></div>
        </div>
        <div id="task-result-section">
          <div class="field-group">
            <label class="field-label" for="task-completion-comment">Комментарий *</label>
            <textarea id="task-completion-comment" class="text-area" placeholder="Что сделано или почему задача потеряла актуальность"></textarea>
          </div>
          <div class="field-group">
            <label class="field-label">Фото и видео</label>
            <div class="button-row">
              <button id="task-completion-photo-button" class="secondary-button" type="button">Фото</button>
              <button id="task-completion-video-button" class="secondary-button" type="button">Видео</button>
            </div>
            <input id="task-completion-photo-input" type="file" accept="image/*" capture="environment" multiple hidden>
            <input id="task-completion-video-input" type="file" accept="video/*" capture="environment" multiple hidden>
            <div id="task-completion-files-note" class="file-note">Файлы не выбраны</div>
          </div>
        </div>
        <div id="task-completed-section" class="hidden">
          <div class="field-group">
            <label class="field-label">Результат</label>
            <div id="task-completed-comment" class="task-detail-done-note"></div>
          </div>
        </div>
        <div id="task-result-media-section" class="field-group">
          <label class="field-label">Фото и видео результата</label>
          <div id="task-result-media" class="task-media-grid"></div>
        </div>
        <div class="modal-actions">
          <button id="task-detail-close-button" class="secondary-button" type="button">Закрыть</button>
          <button id="complete-task-button" class="primary-button" type="button">Выполнить</button>
        </div>
      </div>
    </div>
  `);

  $('task-detail-close-button').addEventListener('click', closeTaskDetails);
  $('task-detail-modal').addEventListener('click', event => {
    if (event.target === $('task-detail-modal')) closeTaskDetails();
  });
  $('task-completion-photo-button').addEventListener('click', () => $('task-completion-photo-input').click());
  $('task-completion-video-button').addEventListener('click', () => $('task-completion-video-input').click());
  $('task-completion-photo-input').addEventListener('change', event => {
    taskCompletionFiles.push(...Array.from(event.target.files || []));
    updateTaskCompletionFilesNote();
  });
  $('task-completion-video-input').addEventListener('change', event => {
    taskCompletionFiles.push(...Array.from(event.target.files || []));
    updateTaskCompletionFilesNote();
  });
  $('complete-task-button').addEventListener('click', completeSelectedTask);
}

function updateTaskCompletionFilesNote() {
  const note = $('task-completion-files-note');
  if (!note) return;
  note.textContent = taskCompletionFiles.length
    ? `Выбрано файлов: ${taskCompletionFiles.length}`
    : 'Файлы не выбраны';
}

function mediaDisplayUrl(item) {
  if (item?.blob) {
    return {url:URL.createObjectURL(item.blob), local:true};
  }
  return {url:String(item?.downloadUrl || ''), local:false};
}

function renderTaskMediaGrid(containerId, rows, emptyText) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = '';

  if (!rows.length) {
    container.innerHTML = `<div class="file-note">${escapeHtml(emptyText)}</div>`;
    return;
  }

  rows.forEach(item => {
    const display = mediaDisplayUrl(item);
    if (!display.url) return;
    const card = document.createElement('div');
    card.className = 'media-card';
    card.innerHTML = item.type.startsWith('video/')
      ? `<video src="${display.url}" controls preload="metadata"></video>`
      : `<img src="${display.url}" alt="Материал к задаче">`;
    container.appendChild(card);
  });
}

function renderTaskMedia(taskId) {
  const rows = mediaItems.filter(item => String(item.taskId || '') === String(taskId || ''));
  const materials = rows.filter(item => item.purpose === 'task_material');
  const results = rows.filter(item => item.purpose !== 'task_material');

  renderTaskMediaGrid('task-materials-media', materials, 'Материалы не приложены');
  renderTaskMediaGrid('task-result-media', results, 'Результат пока без файлов');
}

function openTaskDetails(taskId, mode='view') {
  ensureTaskDetailsUi();
  const task = tasks.find(item => String(item.id) === String(taskId));
  if (!task) return;

  selectedTaskId = task.id;
  selectedTaskMode = mode === 'complete' ? 'complete' : 'view';
  taskCompletionFiles = [];
  updateTaskCompletionFilesNote();

  const trt = trts.find(item => item.id === task.trtId);
  $('task-detail-title').textContent = task.title || 'Задача';
  $('task-detail-description').textContent = task.description || 'Описание не указано';
  $('task-detail-summary').innerHTML = `
    <div class="task-detail-box"><span>ТРТ</span><b>${escapeHtml(trt?.client || '—')}</b></div>
    <div class="task-detail-box"><span>Исполнитель</span><b>${escapeHtml(task.assignee || currentUser?.full_name || '—')}</b></div>
    <div class="task-detail-box"><span>Постановщик</span><b>${escapeHtml(task.createdBy || currentUser?.full_name || '—')}</b></div>
    <div class="task-detail-box"><span>Срок</span><b>${escapeHtml(formatDate(task.dueDate))}</b></div>
    <div class="task-detail-box"><span>Приоритет</span><b>${escapeHtml(task.priority || 'Средний')}</b></div>
    <div class="task-detail-box"><span>Статус</span><b>${task.status === 'done' ? 'Выполнена' : 'Открыта'}</b></div>
  `;

  const isDone = task.status === 'done';
  const completionMode = !isDone && selectedTaskMode === 'complete' && canCurrentUserCompleteTask(task);

  if (selectedTaskMode === 'complete' && !isDone && !completionMode) {
    selectedTaskMode = 'view';
    showToast('Выполнить задачу может только исполнитель');
  }

  $('task-result-section').classList.toggle('hidden', !completionMode);
  $('task-completed-section').classList.toggle('hidden', !isDone);
  $('task-result-media-section').classList.toggle('hidden', !isDone && !completionMode);
  $('complete-task-button').classList.toggle('hidden', !completionMode);
  $('task-completion-comment').value = '';
  $('task-completed-comment').textContent = task.completionComment || 'Комментарий не указан — задача была закрыта до обновления.';
  renderTaskMedia(task.id);
  $('task-detail-modal').classList.add('open');
}

function closeTaskDetails() {
  const modal = $('task-detail-modal');
  if (modal) modal.classList.remove('open');
  selectedTaskId = null;
  selectedTaskMode = 'view';
  taskCompletionFiles = [];
  completeTaskInProgress = false;
}

async function completeSelectedTask() {
  if (completeTaskInProgress) return;
  const task = tasks.find(item => String(item.id) === String(selectedTaskId));
  if (!task || task.status === 'done') return;
  if (!canCurrentUserCompleteTask(task)) {
    showToast('Выполнить задачу может только исполнитель');
    return;
  }

  const comment = String($('task-completion-comment').value || '').trim();
  if (!comment) {
    showToast('Добавьте комментарий');
    $('task-completion-comment').focus();
    return;
  }

  completeTaskInProgress = true;
  const button = $('complete-task-button');
  button.disabled = true;
  const files = taskCompletionFiles.slice();
  const completedAt = new Date().toISOString();

  $('task-detail-modal').classList.remove('open');

  const updatedTask = {
    ...task,
    status:'done',
    completionComment:comment,
    completedAt,
    version:taskVersion(task) + 1,
    updatedAt:completedAt,
    serverSyncedAt:null
  };

  try {
    await putItem(STORE_TASKS, updatedTask);
    if (files.length) await saveMediaFiles(files, task.trtId, null, task.id, 'task_result');
    await refreshData();
    showToast('Задача выполнена');
    (async () => {
      const taskSync = await syncOneTaskWithServer(updatedTask.id, {notify:true});
      if (taskSync.ok && files.length) {
        await syncMediaWithServer({silent:true});
      }
    })();
  } catch (error) {
    console.error(error);
    showToast('Не удалось выполнить задачу');
  } finally {
    selectedTaskId = null;
    taskCompletionFiles = [];
    completeTaskInProgress = false;
    button.disabled = false;
  }
}

function bindTaskActions(container) {
  container.querySelectorAll('[data-task-view]').forEach(button => {
    button.addEventListener('click', () => openTaskDetails(button.dataset.taskView, 'view'));
  });

  container.querySelectorAll('[data-task-complete]').forEach(button => {
    button.addEventListener('click', () => openTaskDetails(button.dataset.taskComplete, 'complete'));
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
  updateAccountUi();
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

function ensureTrtWorkspaceUi() {
  if (document.body.dataset.trtWorkspaceUi === '1') return;

  const actions = document.querySelector('#detail-overlay .detail-actions');
  const tabs = document.querySelector('#detail-overlay .tabs');
  const dataButton = $('open-sales-button');
  const visitButton = $('start-visit-button');
  const taskButton = $('new-task-button');
  if (!actions || !tabs || !dataButton || !visitButton || !taskButton) return;

  document.body.dataset.trtWorkspaceUi = '1';

  const style = document.createElement('style');
  style.id = 'trt-workspace-style';
  style.textContent = `
    .trt-work-actions{
      display:grid!important;
      grid-template-columns:repeat(3,minmax(0,1fr));
      gap:8px!important;
      margin-top:12px;
    }
    .trt-work-actions button{
      width:100%;
      min-width:0;
      min-height:44px;
      padding:10px 5px!important;
      font-size:14px!important;
      font-weight:750!important;
      white-space:nowrap;
    }
    .trt-archive-label{
      margin:15px 4px 7px;
      color:#98a2b3;
      font-size:11px;
      font-weight:650;
      letter-spacing:.04em;
    }
    .trt-archive-tabs{
      display:grid!important;
      grid-template-columns:repeat(4,minmax(0,1fr));
      gap:7px!important;
      overflow:visible!important;
      padding:0!important;
      margin:0 0 12px!important;
      border:0!important;
      background:transparent!important;
    }
    .trt-archive-tabs .tab-button{
      display:flex;
      align-items:center;
      justify-content:center;
      width:100%;
      min-width:0;
      min-height:44px;
      padding:9px 3px!important;
      border:1px solid #d0d5dd!important;
      border-radius:11px!important;
      background:#fff!important;
      color:#344054!important;
      font-size:13px!important;
      font-weight:750!important;
      line-height:1.15;
      white-space:nowrap;
      box-shadow:0 1px 2px rgba(16,24,40,.05);
    }
    .trt-archive-tabs .tab-button.active{
      border-color:#176b4d!important;
      background:#176b4d!important;
      color:#fff!important;
      box-shadow:0 2px 5px rgba(23,107,77,.18);
    }
    .trt-archive-tabs .trt-hidden-sales-tab{display:none!important}
    .task-actions{
      display:flex;
      flex-wrap:wrap;
      gap:7px;
    }
    .task-actions button{
      min-height:38px;
      font-weight:700;
    }
    @media (max-width:360px){
      .trt-work-actions button{font-size:13px!important}
      .trt-archive-tabs .tab-button{font-size:12px!important}
    }
  `;
  document.head.appendChild(style);

  dataButton.textContent = 'Данные';
  visitButton.textContent = 'Визит';
  taskButton.textContent = 'Задача';
  dataButton.setAttribute('aria-label', 'Открыть данные и продажи ТРТ');
  visitButton.setAttribute('aria-label', 'Зафиксировать визит в ТРТ');
  taskButton.setAttribute('aria-label', 'Поставить задачу по ТРТ');

  actions.classList.add('trt-work-actions');
  actions.append(dataButton, visitButton, taskButton);

  let archiveLabel = $('trt-archive-label');
  if (!archiveLabel) {
    archiveLabel = document.createElement('div');
    archiveLabel.id = 'trt-archive-label';
    archiveLabel.className = 'trt-archive-label';
    archiveLabel.textContent = 'Архив';
    tabs.insertAdjacentElement('beforebegin', archiveLabel);
  }

  const infoTab = tabs.querySelector('[data-tab="info"]');
  const salesTab = tabs.querySelector('[data-tab="sales"]');
  const visitsTab = tabs.querySelector('[data-tab="visits"]');
  const tasksTab = tabs.querySelector('[data-tab="tasks"]');
  const mediaTab = tabs.querySelector('[data-tab="media"]');

  if (infoTab) {
    infoTab.textContent = 'Карточка';
    infoTab.setAttribute('aria-label', 'Карточка ТРТ');
  }
  if (visitsTab) visitsTab.textContent = 'Визиты';
  if (tasksTab) tasksTab.textContent = 'Задачи';
  if (mediaTab) {
    mediaTab.textContent = 'Фото';
    mediaTab.setAttribute('aria-label', 'Фото и видео ТРТ');
  }
  if (salesTab) salesTab.classList.add('trt-hidden-sales-tab');

  tabs.classList.add('trt-archive-tabs');
  [infoTab, visitsTab, tasksTab, mediaTab, salesTab].forEach(tab => {
    if (tab) tabs.appendChild(tab);
  });

  const version = document.querySelector('.topbar-title span');
  if (version) version.textContent = 'v1.8';
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


function niceSalesMax(value) {
  if (!Number.isFinite(value) || value <= 0) return 10;
  const power = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / power;
  let factor = 10;
  if (normalized <= 1) factor = 1;
  else if (normalized <= 2) factor = 2;
  else if (normalized <= 5) factor = 5;
  return factor * power;
}

function buildSalesChartSvg(values25, values26, unit) {
  const width = 760;
  const height = 360;
  const margin = { top: 18, right: 12, bottom: 54, left: 46 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const allValues = [];
  values25.forEach(v => allValues.push(salesNumber(v) ?? 0));
  values26.forEach(v => allValues.push(salesNumber(v) ?? 0));
  const maxValue = Math.max(1, ...allValues);
  const axisMax = niceSalesMax(maxValue * 1.15);
  const steps = 4;
  const groupWidth = chartWidth / SALES_MONTHS.length;
  const barWidth = Math.max(8, Math.min(16, groupWidth * 0.22));
  const groupCenterOffset = groupWidth / 2;

  let svg = `<svg class="sales-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" aria-label="График продаж">`;

  for (let step = 0; step <= steps; step++) {
    const value = axisMax * step / steps;
    const y = margin.top + chartHeight - (value / axisMax * chartHeight);
    svg += `<line class="sales-grid-line" x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}"></line>`;
    svg += `<text class="sales-axis-label" x="${margin.left - 8}" y="${y + 4}" text-anchor="end">${Math.round(value).toLocaleString('ru-RU')}</text>`;
  }

  svg += `<line class="sales-axis-line" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + chartHeight}"></line>`;
  svg += `<line class="sales-axis-line" x1="${margin.left}" y1="${margin.top + chartHeight}" x2="${width - margin.right}" y2="${margin.top + chartHeight}"></line>`;

  SALES_MONTHS.forEach((month, index) => {
    const x = margin.left + index * groupWidth;
    const baseY = margin.top + chartHeight;
    const v25 = salesNumber(values25[index]) ?? 0;
    const v26 = salesNumber(values26[index]) ?? 0;
    const h25 = v25 / axisMax * chartHeight;
    const h26 = v26 / axisMax * chartHeight;
    const x25 = x + groupCenterOffset - barWidth - 2;
    const x26 = x + groupCenterOffset + 2;
    const y25 = baseY - h25;
    const y26 = baseY - h26;

    svg += `<rect x="${x25}" y="${y25}" width="${barWidth}" height="${Math.max(0, h25)}" rx="4" fill="#b9dcff"></rect>`;
    svg += `<rect x="${x26}" y="${y26}" width="${barWidth}" height="${Math.max(0, h26)}" rx="4" fill="#1677ff"></rect>`;

    if (v25 > 0) {
      svg += `<text class="sales-tooltip-value" x="${x25 + barWidth / 2}" y="${Math.max(margin.top + 12, y25 - 5)}" text-anchor="middle">${v25.toLocaleString('ru-RU')}</text>`;
    }
    if (v26 > 0) {
      svg += `<text class="sales-tooltip-value" x="${x26 + barWidth / 2}" y="${Math.max(margin.top + 12, y26 - 5)}" text-anchor="middle">${v26.toLocaleString('ru-RU')}</text>`;
    }

    svg += `<text class="sales-month-label" x="${x + groupCenterOffset}" y="${baseY + 20}" text-anchor="middle">${month}</text>`;
  });

  svg += `</svg>`;
  return svg;
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
  const s25 = SALES_MONTHS.map((_, index) => salesNumber(salesArray(trt, 2025)[index]));
  const s26 = SALES_MONTHS.map((_, index) => salesNumber(salesArray(trt, 2026)[index]));
  const months = matchingSalesMonths(trt);
  const y25 = salesSum(s25, months);
  const y26 = salesSum(s26, months);
  const yoy = y25 ? ((y26 - y25) / y25) * 100 : null;
  const yoyClass = yoy == null ? 'neutral' : yoy > 0 ? 'positive' : yoy < 0 ? 'negative' : 'neutral';
  const yoyText = yoy == null ? '—' : `${yoy > 0 ? '+' : ''}${yoy.toFixed(1).replace('.', ',')}%`;

  const chartSvg = buildSalesChartSvg(s25, s26, unit);

  const rows = SALES_MONTHS.map((month, index) => {
    const v25 = s25[index];
    const v26 = s26[index];
    if (v25 == null && v26 == null) return '';
    return `<tr>
      <td>${month}</td>
      <td class="year-2025">${formatSales(v25, unit)}</td>
      <td class="year-2026">${formatSales(v26, unit)}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="sales-summary-grid">
      <div class="sales-summary-card"><span>${SALES_MONTHS[0]}–${SALES_MONTHS[months-1]} 2025</span><b>${formatSales(y25, unit)}</b></div>
      <div class="sales-summary-card"><span>${SALES_MONTHS[0]}–${SALES_MONTHS[months-1]} 2026</span><b>${formatSales(y26, unit)}</b></div>
      <div class="sales-summary-card sales-yoy ${yoyClass}"><span>Изменение</span><b>${yoyText}</b></div>
    </div>

    <div class="sales-chart-wrap">
      <div class="sales-card-head">
        <h3 class="card-title">График продаж по месяцам</h3>
        <span class="sales-unit">${escapeHtml(unit)}</span>
      </div>
      <div class="sales-legend"><span><i class="legend-2025"></i>2025</span><span><i class="legend-2026"></i>2026</span></div>
      ${chartSvg}
    </div>

    <table class="sales-table">
      <thead>
        <tr>
          <th>Месяц</th>
          <th>2025</th>
          <th>2026</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
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
    const display = mediaDisplayUrl(item);
    if (!display.url) return;
    const card = document.createElement('div');
    card.className = 'media-card';
    card.innerHTML = item.type.startsWith('video/')
      ? `<video src="${display.url}" controls preload="metadata"></video>`
      : `<img src="${display.url}" alt="Фото ТРТ">`;

    if (!item.serverSyncedAt) {
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'media-delete';
      deleteButton.textContent = '×';
      deleteButton.addEventListener('click', async () => {
        if (!confirm('Удалить файл с устройства?')) return;
        if (display.local) URL.revokeObjectURL(display.url);
        await deleteItem(STORE_MEDIA, item.id);
        await refreshData();
      });
      card.appendChild(deleteButton);
    }

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

function setVisitSaveBusy(isBusy) {
  const button = $('save-visit-button');
  if (!button) return;
  if (!button.dataset.defaultText) button.dataset.defaultText = button.textContent || 'Сохранить визит';
  button.disabled = Boolean(isBusy);
  button.textContent = isBusy ? 'Сохраняем…' : button.dataset.defaultText;
}

function openVisitModal() {
  if (!selectedTrtId) return;
  if (saveVisitInProgress) {
    showToast('Предыдущий визит ещё сохраняется');
    return;
  }
  setVisitSaveBusy(false);
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

async function saveMediaFiles(files, trtId, visitId=null, taskId=null, purpose=null) {
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
      taskId,
      purpose:purpose || (taskId ? 'task_result' : visitId ? 'visit' : 'point'),
      name:file.name || 'файл',
      type:file.type || 'application/octet-stream',
      size:file.size,
      createdAt:new Date().toISOString(),
      status:'local',
      serverSyncedAt:null,
      objectKey:'',
      downloadUrl:'',
      blob:file
    });
  }
}

async function finishVisitSave(visit, trt, files, locationPromise) {
  try {
    const position = await locationPromise;
    if (position) {
      visit.latitude = position.lat;
      visit.longitude = position.lon;
      visit.accuracy = position.accuracy;
      visit.distanceKm = haversineKm(position.lat, position.lon, trt.lat, trt.lon);
      await putItem(STORE_VISITS, visit);
    }

    if (files.length) {
      await saveMediaFiles(files, trt.id, visit.id, null, 'visit');
    }

    await refreshData();
    const visitSync = await syncOneVisitWithServer(visit.id, {notify:true});
    if (visitSync.ok && files.length) {
      await syncMediaWithServer({silent:true});
    }
    await refreshData();
  } catch (error) {
    console.error('Ошибка фонового завершения визита', error);
    showToast('Визит сохранён, но часть дополнительных данных обработать не удалось.');
  }
}

async function saveVisit() {
  if (saveVisitInProgress) return;

  const trt = selectedTrt();
  if (!trt) return;

  saveVisitInProgress = true;
  setVisitSaveBusy(true);

  const files = [...visitFiles];
  visitFiles = [];
  const locationPromise = geolocate().catch(() => null);

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

  // Закрываем окно сразу после первого нажатия. Повторное создание исключается блокировкой.
  closeModals();

  try {
    await putItem(STORE_VISITS, visit);
    await refreshData();
    setDetailTab('visits');
    showToast('Визит сохранён на устройстве');
  } catch (error) {
    console.error('Не удалось сохранить визит', error);
    showToast('Не удалось сохранить визит на устройстве');
    return;
  } finally {
    saveVisitInProgress = false;
    setVisitSaveBusy(false);
  }

  // Координаты, файлы и серверная отправка завершаются после закрытия окна.
  finishVisitSave(visit, trt, files, locationPromise);
}

function ensureTaskCreationUi() {
  const modal = $('task-modal');
  const currentTitleField = $('task-title');
  if (!modal || !currentTitleField) return;

  if (currentTitleField.tagName !== 'SELECT') {
    const select = document.createElement('select');
    select.id = 'task-title';
    select.className = currentTitleField.className;
    select.innerHTML = [
      '<option value="">Выберите задачу</option>',
      ...TASK_TYPES.map(item => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`)
    ].join('');
    currentTitleField.replaceWith(select);

    const group = select.closest('.field-group');
    const label = group?.querySelector('.field-label');
    if (label) label.textContent = 'Задача';
  }

  if (!$('task-create-media-group')) {
    const actions = modal.querySelector('.modal-actions');
    if (!actions) return;
    actions.insertAdjacentHTML('beforebegin', `
      <div id="task-create-media-group" class="field-group">
        <label class="field-label">Материалы</label>
        <div class="button-row">
          <button id="task-create-photo-button" class="secondary-button" type="button">Фото</button>
          <button id="task-create-video-button" class="secondary-button" type="button">Видео</button>
        </div>
        <input id="task-create-photo-input" type="file" accept="image/*" capture="environment" multiple hidden>
        <input id="task-create-video-input" type="file" accept="video/*" capture="environment" multiple hidden>
        <div id="task-create-files-note" class="file-note">Файлы не выбраны</div>
      </div>
    `);

    $('task-create-photo-button').addEventListener('click', () => $('task-create-photo-input').click());
    $('task-create-video-button').addEventListener('click', () => $('task-create-video-input').click());
    $('task-create-photo-input').addEventListener('change', event => {
      taskCreationFiles.push(...Array.from(event.target.files || []));
      updateTaskCreationFilesNote();
    });
    $('task-create-video-input').addEventListener('change', event => {
      taskCreationFiles.push(...Array.from(event.target.files || []));
      updateTaskCreationFilesNote();
    });
  }
}

function updateTaskCreationFilesNote() {
  const note = $('task-create-files-note');
  if (!note) return;
  note.textContent = taskCreationFiles.length
    ? `Выбрано файлов: ${taskCreationFiles.length}`
    : 'Файлы не выбраны';
}

function setTaskSaveBusy(isBusy) {
  const button = $('save-task-button');
  if (!button) return;
  if (!button.dataset.defaultText) button.dataset.defaultText = button.textContent || 'Создать задачу';
  button.disabled = Boolean(isBusy);
  button.textContent = isBusy ? 'Сохраняем…' : button.dataset.defaultText;
}

function openTaskModal() {
  if (!selectedTrtId) return;
  ensureTaskCreationUi();
  if (saveTaskInProgress) {
    showToast('Предыдущая задача ещё сохраняется');
    return;
  }

  setTaskSaveBusy(false);
  taskCreationFiles = [];
  $('task-title').value = '';
  $('task-create-photo-input').value = '';
  $('task-create-video-input').value = '';
  updateTaskCreationFilesNote();
  $('task-assignee').value = currentUser?.full_name || '';
  $('task-assignee').disabled = true;
  $('task-due').value = '';
  $('task-priority').value = 'Средний';
  $('task-description').value = '';
  openModal('task-modal');
}

async function saveTask() {
  if (saveTaskInProgress) return;

  const title = $('task-title').value.trim();
  if (!TASK_TYPES.includes(title)) {
    showToast('Выберите задачу');
    return;
  }

  const dueDate = $('task-due').value;
  if (!dueDate) {
    showToast('Укажите срок');
    return;
  }

  saveTaskInProgress = true;
  setTaskSaveBusy(true);

  const trt = selectedTrt();
  const now = new Date().toISOString();
  const task = {
    id:uuid(),
    trtId:selectedTrtId,
    direction:trt?.direction || '',
    title,
    assignee:currentUser?.full_name || '',
    assigneeId:currentUser?.employee_id || '',
    createdById:currentUser?.employee_id || '',
    dueDate,
    priority:$('task-priority').value,
    description:$('task-description').value.trim(),
    status:'open',
    version:1,
    createdAt:now,
    updatedAt:now,
    completedAt:null,
    deletedAt:null,
    serverSyncedAt:null
  };

  const files = taskCreationFiles.slice();
  taskCreationFiles = [];
  closeModals();

  try {
    await putItem(STORE_TASKS, task);
  } catch (error) {
    console.error('Не удалось сохранить задачу', error);
    showToast('Не удалось сохранить задачу на устройстве');
    saveTaskInProgress = false;
    setTaskSaveBusy(false);
    return;
  }

  if (files.length) {
    try {
      await saveMediaFiles(files, task.trtId, null, task.id, 'task_material');
    } catch (error) {
      console.error('Не удалось сохранить материалы задачи', error);
      showToast('Задача сохранена, но материалы сохранить не удалось');
    }
  }

  await refreshData();
  setDetailTab('tasks');
  showToast('Задача сохранена на устройстве');
  saveTaskInProgress = false;
  setTaskSaveBusy(false);

  (async () => {
    const taskSync = await syncOneTaskWithServer(task.id, {notify:true});
    if (taskSync.ok && files.length) {
      await syncMediaWithServer({silent:false});
    }
  })();
}

async function addStandaloneMedia(files) {
  if (!selectedTrtId || !files.length) return;
  try {
    await saveMediaFiles(Array.from(files), selectedTrtId, null, null, 'point');
    await refreshData();
    setDetailTab('media');
    showToast('Материалы сохранены');
    syncMediaWithServer({silent:false});
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
  ensureTaskCreationUi();
  ensureTrtWorkspaceUi();

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
    bindAuthEvents();
    await registerServiceWorker();
    await restoreAuth();
  } catch (error) {
    console.error(error);
    document.body.innerHTML = '<div class="empty-state"><h3>Не удалось запустить приложение</h3><p>' +
      escapeHtml(error.message || String(error)) + '</p></div>';
  }
}

document.addEventListener('DOMContentLoaded', init);
