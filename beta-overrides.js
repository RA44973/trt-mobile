'use strict';

// VOG Мобильный помощник Beta 0.2
// Additive override layer: production app.js remains unchanged.

const BETA_CHANNEL_VERSION = 'beta-0.2-map-v7';
let betaMapPoints = [];
let betaMapStatus = null;
let betaSelectedCardKey = '';
let betaMapLoadPromise = null;

const betaOriginalApplyProductBranding = applyProductBranding;
const betaOriginalSyncTrtsWithServer = syncTrtsWithServer;
const betaOriginalRenderMap = renderMap;
const betaOriginalOpenTrt = openTrt;
const betaOriginalSelectedTrt = selectedTrt;

function betaPointCardKey(point) {
  return String(point?.cardKey || '').trim();
}

function betaDirectionLabel(value) {
  const normalized = normalizeText(value);
  if (normalized === 'обои') return 'Обои';
  if (normalized === 'плитка') return 'Плитка';
  return String(value || '').trim();
}

function betaPointName(point) {
  return String(
    point?.canonicalTrtName
    || point?.trtName
    || point?.client
    || point?.holding
    || 'ТРТ'
  ).trim();
}

function betaMapSearchText(point) {
  return normalizeText([
    betaDirectionLabel(point?.direction),
    point?.city,
    point?.region,
    betaPointName(point),
    point?.client,
    point?.holding,
    point?.address,
    point?.manager,
    point?.format,
    point?.status,
    point?.cardKey,
  ].filter(Boolean).join(' '));
}

function betaMatchesMapQuery(point, query) {
  const terms = normalizeText(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = betaMapSearchText(point);
  return terms.every(term => haystack.includes(term));
}

function betaEnsureUi() {
  if (!document.getElementById('beta-channel-style')) {
    const style = document.createElement('style');
    style.id = 'beta-channel-style';
    style.textContent = `
      .beta-channel-badge{position:fixed;z-index:11000;right:10px;top:calc(8px + env(safe-area-inset-top));padding:5px 8px;border-radius:999px;background:#fff3cd;color:#704d00;border:1px solid #e5c04d;font:800 11px/1.1 system-ui,-apple-system,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.12);pointer-events:none}
      .beta-map-count{position:absolute;z-index:850;left:12px;bottom:12px;padding:6px 9px;border-radius:10px;background:rgba(255,255,255,.94);color:#344054;font:800 11px/1.2 system-ui,-apple-system,sans-serif;box-shadow:0 2px 10px rgba(16,24,40,.14);pointer-events:none}
      .beta-location-popup{min-width:220px;max-width:310px}
      .beta-location-popup-title{font-weight:900;font-size:14px;line-height:1.3;margin-bottom:4px}
      .beta-location-popup-hint{color:#667085;font-size:11px;line-height:1.35;margin-bottom:8px}
      .beta-location-popup-button{display:block;width:100%;margin:6px 0 0;padding:9px 10px;border:1px solid #d0d5dd;border-radius:10px;background:#fff;color:#17202a;text-align:left;font:750 12px/1.35 system-ui,-apple-system,sans-serif}
      .beta-marker-count{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#355a93;color:#fff;border:3px solid #fff;box-shadow:0 2px 7px rgba(0,0,0,.24);font:900 11px/1 system-ui,-apple-system,sans-serif}
    `;
    document.head.appendChild(style);
  }

  if (!document.querySelector('.beta-channel-badge')) {
    const badge = document.createElement('div');
    badge.className = 'beta-channel-badge';
    badge.textContent = 'BETA';
    document.body.appendChild(badge);
  }

  const mapNode = document.getElementById('map');
  if (mapNode && !document.getElementById('beta-map-count')) {
    const count = document.createElement('div');
    count.id = 'beta-map-count';
    count.className = 'beta-map-count';
    count.textContent = 'Карта Beta';
    mapNode.appendChild(count);
  }

  const mapSearch = document.getElementById('map-search');
  if (mapSearch) {
    mapSearch.placeholder = 'Направление, город или ТРТ';
    mapSearch.setAttribute('aria-label', 'Поиск по направлению, городу или ТРТ');
  }
}

applyProductBranding = function() {
  betaOriginalApplyProductBranding();
  document.title = 'VOG Мобильный помощник Beta';
  const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (appleTitle) appleTitle.content = 'VOG Beta';
  const authTitle = document.querySelector('.auth-card h1');
  if (authTitle) authTitle.textContent = 'Мобильный помощник Beta';
  betaEnsureUi();
};

async function betaFetchMapV7Status() {
  const status = await apiRequest('/trt-map-data?view=map_v7_status', {
    method:'GET',
    timeout:8000,
  });
  if (!status?.bundleReady || !status?.bundleBuildId || Number(status?.bundleRows || 0) <= 0) {
    throw new Error('Быстрый снимок карты v7 не готов.');
  }
  return status;
}

async function betaFetchBundleGroup(bundleBuildId, startChunk, count) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const payload = await apiRequest(
        `/trt-map-data?view=map_v7_bundle_group&bundle_id=${encodeURIComponent(bundleBuildId)}&start=${startChunk}&count=${count}`,
        {method:'GET', timeout:8000},
      );
      if (String(payload?.bundleBuildId || '') !== String(bundleBuildId)) {
        throw new Error('Снимок карты изменился во время загрузки.');
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 300 * attempt));
    }
  }
  throw lastError || new Error('Пакет карты v7 недоступен.');
}

async function betaLoadMapV7() {
  if (betaMapLoadPromise) return betaMapLoadPromise;

  betaMapLoadPromise = (async () => {
    const status = await betaFetchMapV7Status();
    const expected = Number(status.bundleRows || status.rows || 0);
    const bundleBuildId = String(status.bundleBuildId || '');
    const chunkCount = Number(status.bundleChunks || 0);
    if (!bundleBuildId || expected <= 0 || chunkCount <= 0) {
      throw new Error('Некорректный статус карты v7.');
    }

    const groupSize = 5;
    const starts = [];
    for (let start = 0; start < chunkCount; start += groupSize) starts.push(start);

    const groups = new Array(starts.length);
    let cursor = 0;
    const concurrency = Math.min(4, starts.length);

    async function worker() {
      while (true) {
        const index = cursor++;
        if (index >= starts.length) return;
        const start = starts[index];
        groups[index] = await betaFetchBundleGroup(
          bundleBuildId,
          start,
          Math.min(groupSize, chunkCount - start),
        );
      }
    }

    await Promise.all(Array.from({length:concurrency}, () => worker()));

    let rawRows = 0;
    const byCardKey = new Map();
    groups.forEach(group => {
      rawRows += Math.max(0, Number(group?.returnedRows || 0));
      (Array.isArray(group?.points) ? group.points : []).forEach(point => {
        const key = betaPointCardKey(point);
        if (key) byCardKey.set(key, point);
      });
    });

    if (rawRows !== expected) {
      throw new Error(`Карта v7 загружена не полностью: ${rawRows} из ${expected}.`);
    }

    betaMapStatus = status;
    betaMapPoints = [...byCardKey.values()]
      .filter(point => Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lon)))
      .map(point => ({
        ...point,
        id:String(point.id || ''),
        cardKey:betaPointCardKey(point),
        direction:betaDirectionLabel(point.direction),
        lat:Number(point.lat),
        lon:Number(point.lon),
      }));

    // Compatibility projection for existing visits/tasks/points screens:
    // exactly one row per physical point_id. The map itself never uses this
    // projection and therefore never loses multi-direction card identity.
    const physicalById = new Map();
    betaMapPoints.forEach(point => {
      const id = String(point.id || '');
      if (!id || physicalById.has(id)) return;
      physicalById.set(id, {
        ...point,
        client:betaPointName(point),
      });
    });
    await replaceTrts([...physicalById.values()]);
    await pruneLocalDataToVisibleTrts();

    return {
      status,
      points:betaMapPoints,
      visibleCards:betaMapPoints.length,
      physicalPoints:physicalById.size,
    };
  })();

  try {
    return await betaMapLoadPromise;
  } finally {
    betaMapLoadPromise = null;
  }
}

syncTrtsWithServer = async function({silent=true}={}) {
  if (!sessionToken || authOffline || navigator.onLine === false) {
    return {ok:false, offline:true, downloaded:0, beta:true};
  }

  try {
    const result = await betaLoadMapV7();
    if (!silent) {
      showToast(`Карта Beta: ${result.visibleCards.toLocaleString('ru-RU')} карточек`);
    }
    return {
      ok:true,
      downloaded:result.visibleCards,
      physicalPoints:result.physicalPoints,
      access:result.status?.access || null,
      mapV7:true,
      bundleBuildId:result.status?.bundleBuildId || '',
    };
  } catch (error) {
    console.warn('Beta: карта v7 недоступна, используем безопасный fallback', error);
    const fallback = await betaOriginalSyncTrtsWithServer({silent:true});
    if (!silent) {
      showToast(fallback?.ok ? 'Карта открыта в резервном режиме' : 'Не удалось обновить список ТРТ');
    }
    return {...fallback, beta:true, mapV7:false, mapV7Error:error};
  }
};

selectedTrt = function() {
  if (betaSelectedCardKey) {
    const exact = betaMapPoints.find(point => betaPointCardKey(point) === betaSelectedCardKey);
    if (exact) return exact;
  }
  return betaOriginalSelectedTrt();
};

openTrt = function(trtId) {
  betaSelectedCardKey = '';
  return betaOriginalOpenTrt(trtId);
};

function betaApplyCardPayload(point, payload) {
  if (!point || !payload || typeof payload !== 'object') return;
  const originalCardKey = betaPointCardKey(point);
  const originalId = String(point.id || '');
  const originalDirection = point.directionCanonical ? point.direction : '';
  const directionSource = point.directionSource || '';

  if (payload.point && typeof payload.point === 'object') {
    Object.assign(point, payload.point);
  }
  point.id = originalId || String(point.id || '');
  point.cardKey = originalCardKey || betaPointCardKey(point);
  if (originalDirection) {
    point.direction = betaDirectionLabel(originalDirection);
    point.directionCanonical = true;
    point.directionSource = directionSource;
  } else {
    point.direction = betaDirectionLabel(point.direction);
  }

  if (payload.sales && typeof payload.sales === 'object') point.sales = payload.sales;
  if (payload.salesPlanCard && typeof payload.salesPlanCard === 'object') {
    point.salesPlanCard = payload.salesPlanCard;
    point._salesPlanCard = payload.salesPlanCard;
  }
  if (payload.fdiySales && typeof payload.fdiySales === 'object') {
    point.fdiySales = payload.fdiySales;
  }
  point._betaCardLoaded = true;
}

async function betaLoadExactCard(point) {
  const pointId = String(point?.id || '');
  const cardKey = betaPointCardKey(point);
  if (!pointId || !cardKey || point?._betaCardLoading) return;
  point._betaCardLoading = true;
  try {
    const payload = await apiRequest(
      `/trt-map-data?view=card&point_id=${encodeURIComponent(pointId)}&card_key=${encodeURIComponent(cardKey)}`,
      {method:'GET', timeout:20000},
    );
    betaApplyCardPayload(point, payload);
    if (betaSelectedCardKey === cardKey) {
      renderSelectedTrt();
      renderSales();
    }
  } catch (error) {
    console.warn('Beta: не удалось загрузить точную карточку ТРТ', cardKey, error);
    if (betaSelectedCardKey === cardKey) showToast('Карточка открыта, подробные данные временно недоступны');
  } finally {
    point._betaCardLoading = false;
  }
}

function betaOpenMapPoint(point) {
  if (!point?.id) return;
  betaSelectedCardKey = betaPointCardKey(point);
  betaOriginalOpenTrt(String(point.id));
  void betaLoadExactCard(point);
}

function betaSameLocationPopup(points) {
  const rows = [...points].sort((a,b) =>
    betaPointName(a).localeCompare(betaPointName(b), 'ru')
    || betaDirectionLabel(a.direction).localeCompare(betaDirectionLabel(b.direction), 'ru')
    || betaPointCardKey(a).localeCompare(betaPointCardKey(b), 'ru')
  );
  const names = [...new Set(rows.map(betaPointName))];

  const root = document.createElement('div');
  root.className = 'beta-location-popup';

  const title = document.createElement('div');
  title.className = 'beta-location-popup-title';
  title.textContent = names.length === 1 ? names[0] : `${names.length} ТРТ в одной точке`;
  root.appendChild(title);

  const hint = document.createElement('div');
  hint.className = 'beta-location-popup-hint';
  hint.textContent = names.length === 1
    ? 'Выберите направление'
    : 'Одинаковые координаты не объединяют разные ТРТ';
  root.appendChild(hint);

  rows.forEach(point => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'beta-location-popup-button';
    const direction = betaDirectionLabel(point.direction) || 'ТРТ';
    button.textContent = names.length === 1
      ? direction
      : `${betaPointName(point)} — ${direction}`;
    button.addEventListener('click', () => {
      try { map?.closePopup(); } catch (_) {}
      betaOpenMapPoint(point);
    });
    root.appendChild(button);
  });

  return root;
}

function betaMarkerIcon(points) {
  if (points.length <= 1) return markerIcon(points[0]);
  return L.divIcon({
    className:'',
    html:`<div class="beta-marker-count">${points.length}</div>`,
    iconSize:[28,28],
    iconAnchor:[14,14],
  });
}

renderMap = function() {
  betaEnsureUi();
  const source = betaMapPoints.length ? betaMapPoints : trts;
  const hasPoints = source.length > 0;
  $('map-empty').classList.toggle('hidden', hasPoints);
  $('map').classList.toggle('hidden', !hasPoints);
  document.querySelector('.map-toolbar').classList.toggle('hidden', !hasPoints || !map);
  if (!map || !markersLayer) return;

  markersLayer.clearLayers();
  const query = $('map-search')?.value || '';
  const shown = source.filter(point => betaMatchesMapQuery(point, query));

  const grouped = new Map();
  shown.forEach(point => {
    const lat = Number(point.lat);
    const lon = Number(point.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const key = `${lat.toFixed(6)}|${lon.toFixed(6)}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(point);
  });

  grouped.forEach(points => {
    const first = points[0];
    const marker = L.marker([Number(first.lat), Number(first.lon)], {icon:betaMarkerIcon(points)});
    if (points.length === 1) {
      marker.on('click', () => betaOpenMapPoint(first));
    } else {
      marker.bindPopup(betaSameLocationPopup(points), {maxWidth:340});
    }
    marker.addTo(markersLayer);
  });

  const count = $('beta-map-count');
  if (count) {
    const suffix = betaMapPoints.length ? 'карточек' : 'точек · резерв';
    count.textContent = `${shown.length.toLocaleString('ru-RU')} ${suffix}`;
  }

  if (shown.length && normalizeText(query)) {
    const bounds = L.latLngBounds(shown.map(item => [Number(item.lat), Number(item.lon)]));
    map.fitBounds(bounds.pad(.16), {maxZoom:15});
  }
  setTimeout(() => map.invalidateSize(), 30);
};

// Make the Beta channel visually explicit as soon as DOM is ready.
document.addEventListener('DOMContentLoaded', () => {
  betaEnsureUi();
  const mapSearch = $('map-search');
  if (mapSearch && mapSearch.dataset.betaSearchBound !== '1') {
    mapSearch.dataset.betaSearchBound = '1';
    mapSearch.addEventListener('input', () => {
      // renderMap is already bound by production code; this explicit call also
      // covers browsers that restore a search value without emitting input.
      renderMap();
    });
  }
});
