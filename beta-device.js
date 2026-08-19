'use strict';

// VOG Мобильный помощник Beta 0.4
// Android Back + geolocation diagnostics + task select arrow alignment.

const BETA_DEVICE_VERSION = 'beta-0.4-device-navigation';
const BETA_GEO_DIAG_KEY = 'vog-beta-geo-diagnostics-v1';
let betaGeoAccuracyLayer = null;
let betaHistoryApplying = false;

function betaGeoErrorLabel(error) {
  const code = Number(error?.code || 0);
  if (code === 1) return 'permission_denied';
  if (code === 2) return 'position_unavailable';
  if (code === 3) return 'timeout';
  return 'unknown';
}

function betaGeoPermissionState() {
  return navigator.permissions?.query
    ? navigator.permissions.query({name:'geolocation'})
        .then(result => result?.state || 'unknown')
        .catch(() => 'unknown')
    : Promise.resolve('unsupported');
}

function betaGeoReadDiag() {
  try { return JSON.parse(localStorage.getItem(BETA_GEO_DIAG_KEY) || 'null'); }
  catch (_) { return null; }
}

function betaGeoWriteDiag(value) {
  try { localStorage.setItem(BETA_GEO_DIAG_KEY, JSON.stringify(value)); }
  catch (_) {}
  betaGeoRenderDiag(value);
}

function betaGeoRenderDiag(diag=betaGeoReadDiag()) {
  const host = document.getElementById('beta-geo-diagnostics');
  if (!host) return;
  if (!diag) {
    host.innerHTML = '<div class="data-stat"><span>Статус</span><b>Нет измерений</b></div>';
    return;
  }
  const coord = diag.lastSuccess
    ? `${Number(diag.lastSuccess.lat).toFixed(6)}, ${Number(diag.lastSuccess.lon).toFixed(6)}`
    : '—';
  host.innerHTML = `
    <div class="data-stat"><span>Разрешение</span><b>${escapeHtml(diag.permission || 'unknown')}</b></div>
    <div class="data-stat"><span>Последний результат</span><b>${escapeHtml(diag.result || '—')}</b></div>
    <div class="data-stat"><span>Ожидание</span><b>${Number(diag.waitMs || 0).toLocaleString('ru-RU')} мс</b></div>
    <div class="data-stat"><span>Точность</span><b>${Number.isFinite(Number(diag.accuracy)) ? `${Math.round(Number(diag.accuracy))} м` : '—'}</b></div>
    <div class="data-stat"><span>Последняя координата</span><b>${escapeHtml(coord)}</b></div>`;
}

function betaEnsureDeviceUi() {
  if (!document.getElementById('beta-device-style')) {
    const style = document.createElement('style');
    style.id = 'beta-device-style';
    style.textContent = `
      #task-title.select-input{appearance:none;-webkit-appearance:none;background-image:linear-gradient(45deg,transparent 50%,#667085 50%),linear-gradient(135deg,#667085 50%,transparent 50%);background-position:calc(100% - 18px) 50%,calc(100% - 13px) 50%;background-size:5px 5px,5px 5px;background-repeat:no-repeat;padding-right:38px!important}
      .beta-geo-note{margin-top:8px;color:#667085;font-size:11px;line-height:1.35}
      .beta-location-busy{opacity:.68;pointer-events:none}
    `;
    document.head.appendChild(style);
  }

  const taskTitle = document.getElementById('task-title');
  if (taskTitle?.tagName === 'SELECT') taskTitle.classList.add('select-input');

  const settings = document.querySelector('#screen-settings .screen-inner');
  if (settings && !document.getElementById('beta-geo-card')) {
    const card = document.createElement('div');
    card.id = 'beta-geo-card';
    card.className = 'card settings-block';
    card.innerHTML = `
      <h3 class="card-title">Геолокация · Beta диагностика</h3>
      <div id="beta-geo-diagnostics"></div>
      <div class="beta-geo-note">Диагностика нужна только на этапе Beta: статус разрешения, код ошибки, длительность ожидания, точность и последняя успешная координата.</div>`;
    settings.appendChild(card);
    betaGeoRenderDiag();
  }
}

// Replace only the low-level geolocation function. Existing callers keep working.
geolocate = function() {
  return new Promise(async (resolve, reject) => {
    const startedAt = performance.now();
    const permission = await betaGeoPermissionState();
    if (!navigator.geolocation) {
      const error = new Error('Геолокация не поддерживается');
      betaGeoWriteDiag({permission,result:'unsupported',waitMs:0,accuracy:null,lastSuccess:betaGeoReadDiag()?.lastSuccess || null});
      reject(error);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      position => {
        const result = {
          lat:Number(position.coords.latitude),
          lon:Number(position.coords.longitude),
          accuracy:Number(position.coords.accuracy),
        };
        const waitMs = Math.round(performance.now() - startedAt);
        betaGeoWriteDiag({
          permission,
          result:'success',
          waitMs,
          accuracy:result.accuracy,
          lastSuccess:{...result,at:new Date().toISOString()},
        });
        resolve(result);
      },
      error => {
        const waitMs = Math.round(performance.now() - startedAt);
        betaGeoWriteDiag({
          permission,
          result:betaGeoErrorLabel(error),
          errorCode:Number(error?.code || 0),
          message:String(error?.message || ''),
          waitMs,
          accuracy:null,
          lastSuccess:betaGeoReadDiag()?.lastSuccess || null,
        });
        reject(error);
      },
      {enableHighAccuracy:true, timeout:12000, maximumAge:15000},
    );
  });
};

function betaDistanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = value => value * Math.PI / 180;
  const radius = 6371000;
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function betaNearestMapPoint(position) {
  const source = Array.isArray(betaMapPoints) && betaMapPoints.length ? betaMapPoints : trts;
  let best = null;
  source.forEach(point => {
    const lat = Number(point?.lat);
    const lon = Number(point?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const distance = betaDistanceMeters(position.lat, position.lon, lat, lon);
    if (!best || distance < best.distance) best = {point,distance};
  });
  return best;
}

locateUser = async function(openNearest=false) {
  const button = document.getElementById('map-location-button');
  button?.classList.add('beta-location-busy');
  try {
    const position = await geolocate();
    if (!map) return position;

    try { if (userMarker) map.removeLayer(userMarker); } catch (_) {}
    try { if (betaGeoAccuracyLayer) map.removeLayer(betaGeoAccuracyLayer); } catch (_) {}

    userMarker = L.circleMarker([position.lat, position.lon], {
      radius:8,
      color:'#fff',
      weight:3,
      fillColor:'#1677ff',
      fillOpacity:1,
    }).addTo(map);

    if (Number.isFinite(position.accuracy) && position.accuracy > 0) {
      betaGeoAccuracyLayer = L.circle([position.lat, position.lon], {
        radius:position.accuracy,
        weight:1,
        opacity:.45,
        fillOpacity:.07,
      }).addTo(map);
    }

    map.setView([position.lat, position.lon], Math.max(Number(map.getZoom() || 0), 14));

    const nearest = betaNearestMapPoint(position);
    if (nearest) {
      const distanceText = nearest.distance < 1000
        ? `${Math.round(nearest.distance)} м`
        : `${(nearest.distance/1000).toFixed(1).replace('.',',')} км`;
      showToast(`Местоположение найдено · ближайшая ТРТ ${distanceText}`);
      if (openNearest) {
        if (Array.isArray(betaMapPoints) && betaMapPoints.includes(nearest.point) && typeof betaOpenMapPoint === 'function') {
          betaOpenMapPoint(nearest.point);
        } else if (nearest.point?.id) {
          openTrt(String(nearest.point.id));
        }
      }
    } else {
      showToast(`Местоположение найдено · точность ${Math.round(position.accuracy || 0)} м`);
    }
    return position;
  } catch (error) {
    const type = betaGeoErrorLabel(error);
    const messages = {
      permission_denied:'Нет разрешения на геолокацию',
      position_unavailable:'Координаты сейчас недоступны',
      timeout:'Не удалось определить местоположение за 12 секунд',
      unknown:'Не удалось определить местоположение',
    };
    showToast(messages[type] || messages.unknown);
    console.warn('Beta geolocation error', type, error);
    return null;
  } finally {
    button?.classList.remove('beta-location-busy');
  }
};

function betaVisibleModal() {
  return [...document.querySelectorAll('.modal-backdrop.open')].reverse()[0] || null;
}

function betaDetailOpen() {
  return document.getElementById('detail-overlay')?.classList.contains('open');
}

function betaPushLayer(layer, extra={}) {
  if (betaHistoryApplying) return;
  const current = history.state || {};
  history.pushState({...current,vogBeta:true,layer,...extra}, '');
}

function betaCloseTopLayer() {
  const modal = betaVisibleModal();
  if (modal) {
    modal.classList.remove('open');
    return true;
  }
  if (betaDetailOpen()) {
    const detail = document.getElementById('detail-overlay');
    detail.classList.remove('open');
    detail.setAttribute('aria-hidden','true');
    betaSelectedCardKey = '';
    return true;
  }
  return false;
}

// Wrap opens so Android/browser Back has an internal state to return to.
const betaDeviceOriginalOpenTrt = openTrt;
openTrt = function(trtId) {
  const wasOpen = betaDetailOpen();
  const result = betaDeviceOriginalOpenTrt(trtId);
  if (!wasOpen && betaDetailOpen()) betaPushLayer('trt',{trtId:String(trtId || '')});
  return result;
};

const betaDeviceOriginalOpenModal = openModal;
openModal = function(id) {
  const modal = document.getElementById(id);
  const wasOpen = modal?.classList.contains('open');
  const result = betaDeviceOriginalOpenModal(id);
  if (!wasOpen && modal?.classList.contains('open')) betaPushLayer('modal',{modalId:id});
  return result;
};

window.addEventListener('popstate', () => {
  betaHistoryApplying = true;
  try { betaCloseTopLayer(); }
  finally { betaHistoryApplying = false; }
});

// Capture visible Back/Cancel controls so they consume the matching history entry.
document.addEventListener('click', event => {
  const target = event.target?.closest?.('#detail-close,.modal-cancel,.task-create-close,.visit-picker-close,[data-fourp-close]');
  if (!target) return;
  if (!betaVisibleModal() && !betaDetailOpen()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  history.back();
}, true);

// Seed a root entry; Android Back can only leave once there is no internal layer left.
try {
  const current = history.state || {};
  if (!current.vogBetaRoot) history.replaceState({...current,vogBeta:true,vogBetaRoot:true,layer:'root'}, '');
} catch (_) {}

// Task title is converted from input to select by the production UI. Keep arrow styling aligned.
const betaTaskUiObserver = new MutationObserver(() => betaEnsureDeviceUi());
betaTaskUiObserver.observe(document.documentElement,{subtree:true,childList:true});

document.addEventListener('DOMContentLoaded', () => betaEnsureDeviceUi());
betaEnsureDeviceUi();
