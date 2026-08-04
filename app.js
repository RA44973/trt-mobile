
'use strict';

const DB_NAME = 'trt-mobile-db';

const PRODUCT_NAME = 'VOG Мобильный помощник';
const PRODUCT_SHORT_NAME = 'VOG Помощник';

function applyProductBranding() {
  document.title = PRODUCT_NAME;

  const appleTitle = document.querySelector(
    'meta[name="apple-mobile-web-app-title"]'
  );
  if (appleTitle) appleTitle.content = PRODUCT_SHORT_NAME;

  const authLogo = document.querySelector('.auth-logo');
  if (authLogo) authLogo.textContent = 'VOG';

  const authTitle = document.querySelector('.auth-card h1');
  if (authTitle) authTitle.textContent = 'Мобильный помощник';

  const topbarTitle = document.querySelector('.topbar-title');
  if (topbarTitle) {
    const version = topbarTitle.querySelector('span');
    topbarTitle.textContent = 'VOG ';
    if (version) topbarTitle.appendChild(version);
  }

  const topbarSubtitle = $('topbar-subtitle');
  if (topbarSubtitle && !trts.length) {
    topbarSubtitle.textContent = 'Мобильный помощник';
  }
}

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
const DATA_OWNER_KEY = 'trt-data-owner-employee-id';
const AUTH_OFFLINE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const TASK_TYPES = Object.freeze([
  'Переместить внутри ТРТ',
  'Расширить ассортимент',
  'Провести ротацию',
  'Подключить к VOG Club',
  'Оформить БЗ'
]);

const VISIT_RESULT_OPTIONS = Object.freeze([
  'Переговоры проведены',
  'Договорённость достигнута',
  'Нужен повторный визит',
  'Отказ',
  'Точка закрыта'
]);


const FOUR_P_VERSION = 2;
const FOUR_P_COMMERCIAL_STATUS = 'Ожидает данных КУ';

function fourPInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function fourPScore(value) {
  const number = fourPInteger(value);
  return number != null && number >= 1 && number <= 5 ? number : null;
}

function fourPDecimal(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function fourPAssortmentScore(skuCount) {
  const value = fourPInteger(skuCount);
  if (value == null || value < 0) return null;
  if (value < 300) return 1;
  if (value < 800) return 2;
  if (value < 1500) return 3;
  if (value < 3000) return 4;
  return 5;
}

function fourPVogShareScore(sharePercent) {
  const value = fourPDecimal(sharePercent);
  if (value == null || value < 0 || value > 100) return null;
  if (value <= 5) return 1;
  if (value <= 10) return 2;
  if (value < 20) return 3;
  if (value < 30) return 4;
  return 5;
}

function fourPSellerMotivationScore(participationPercent) {
  const value = fourPDecimal(participationPercent);
  if (value == null || value < 0 || value > 100) return null;
  if (value <= 0) return 1;
  if (value <= 25) return 2;
  if (value <= 50) return 3;
  if (value <= 75) return 4;
  return 5;
}

function fourPAverage(values) {
  const numbers = values.filter(value => Number.isFinite(Number(value))).map(Number);
  if (!numbers.length) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function normalizeFourPAssessment(value) {
  if (!value || typeof value !== 'object') return null;

  const placeLocationScore = fourPScore(value.place?.locationScore);
  const placeVogPlacementScore = fourPScore(value.place?.vogPlacementScore);

  const skuCount = fourPInteger(value.product?.skuCount);
  const vogSkuCountRaw = fourPInteger(value.product?.vogSkuCount);
  const legacyShare = fourPDecimal(value.product?.vogSharePercent);
  const vogSkuCount = vogSkuCountRaw != null && vogSkuCountRaw >= 0 ? vogSkuCountRaw : null;
  const vogSharePercent = skuCount != null && skuCount > 0 && vogSkuCount != null
    ? Math.round((vogSkuCount / skuCount) * 1000) / 10
    : (legacyShare != null && legacyShare >= 0 && legacyShare <= 100 ? Math.round(legacyShare * 10) / 10 : null);
  const assortmentScore = fourPAssortmentScore(skuCount);
  const vogShareScore = fourPVogShareScore(vogSharePercent);

  const commercialTermsScore = fourPScore(
    value.promotion?.commercialTermsScore ?? value.promotion?.ownerIncentiveScore
  );
  const sellerCount = fourPInteger(value.promotion?.sellerCount);
  const vogClubParticipants = fourPInteger(value.promotion?.vogClubParticipants);
  const sellerParticipationPercent = sellerCount != null && sellerCount > 0 && vogClubParticipants != null
    ? Math.round((vogClubParticipants / sellerCount) * 1000) / 10
    : null;
  const sellerMotivationScore = sellerParticipationPercent != null
    ? fourPSellerMotivationScore(sellerParticipationPercent)
    : fourPScore(value.promotion?.sellerMotivationScore);
  const consumerPromoScore = fourPScore(value.promotion?.consumerPromoScore);

  const userScoresComplete = [
    placeLocationScore,
    placeVogPlacementScore,
    assortmentScore,
    vogShareScore,
    sellerMotivationScore,
    consumerPromoScore,
  ].every(score => score != null);

  const placeScore = fourPAverage([placeLocationScore, placeVogPlacementScore]);
  const productScore = fourPAverage([assortmentScore, vogShareScore]);
  const promotionScore = fourPAverage([
    commercialTermsScore,
    sellerMotivationScore,
    consumerPromoScore,
  ]);
  const totalScore = userScoresComplete
    ? fourPAverage([placeScore, productScore, promotionScore])
    : null;

  return {
    version: FOUR_P_VERSION,
    complete: userScoresComplete,
    place: {
      locationScore: placeLocationScore,
      vogPlacementScore: placeVogPlacementScore,
      score: placeScore,
    },
    product: {
      skuCount: skuCount != null && skuCount >= 0 ? skuCount : null,
      assortmentScore,
      vogSkuCount,
      vogSharePercent,
      vogShareScore,
      outdatedSamples: Boolean(value.product?.outdatedSamples),
      score: productScore,
    },
    promotion: {
      commercialTermsScore,
      commercialTermsStatus: commercialTermsScore == null
        ? FOUR_P_COMMERCIAL_STATUS
        : 'Получено из системы',
      sellerCount: sellerCount != null && sellerCount >= 0 ? sellerCount : null,
      vogClubParticipants: vogClubParticipants != null && vogClubParticipants >= 0
        ? vogClubParticipants
        : null,
      sellerParticipationPercent,
      sellerMotivationScore,
      consumerPromoScore,
      score: promotionScore,
    },
    price: {
      status: 'Нет данных / не оценивается',
    },
    totalScore,
    assessedAt: value.assessedAt || new Date().toISOString(),
  };
}

function fourPFormatScore(value, empty='0,0') {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toFixed(1).replace('.', ',')
    : empty;
}

function fourPStarsHtml(value, className='fourp-stars') {
  const number = Math.max(0, Math.min(5, Number(value) || 0));
  const stars = Array.from({length:5}, (_, index) => {
    const fill = Math.max(0, Math.min(100, (number - index) * 100));
    return `<span class="fourp-star" style="--fill:${fill}%">★</span>`;
  }).join('');
  return `<span class="${className}" aria-label="Рейтинг ${fourPFormatScore(number)} из 5">${stars}</span>`;
}

const FOUR_P_HELP = Object.freeze({
  location: {
    title: 'Местоположение ТРТ',
    html: '<b>5</b> — первая линия, первый этаж, рядом со входом.<br><b>4</b> — хорошая видимость и удобный доступ.<br><b>3</b> — обычное расположение со средним потоком.<br><b>2</b> — слабая зона, вход сложно найти.<br><b>1</b> — удалённое помещение и низкий поток.'
  },
  placement: {
    title: 'Местоположение ВОГ внутри ТРТ',
    html: '<b>5</b> — входная или дизайнерская зона с максимальной видимостью.<br><b>4</b> — заметная зона с хорошей навигацией.<br><b>3</b> — стандартная выкладка.<br><b>2</b> — малозаметная отдельная зона.<br><b>1</b> — товар разбросан в слабой зоне.'
  },
  sku: {
    title: 'Общее количество SKU в ТРТ',
    html: 'Оценка выставляется автоматически в зависимости от размера ассортимента:<br><b>5</b> — 3000 и более;<br><b>4</b> — 1500–2999;<br><b>3</b> — 800–1499;<br><b>2</b> — 300–799;<br><b>1</b> — менее 300.'
  },
  share: {
    title: 'SKU от ВОГ в ассортименте ТРТ',
    html: 'Введите количество SKU от ВОГ. Доля рассчитывается от общего количества SKU автоматически:<br><b>5</b> — 30% и более;<br><b>4</b> — 20–29%;<br><b>3</b> — 11–19%;<br><b>2</b> — 6–10%;<br><b>1</b> — до 5%.'
  },
  commercial: {
    title: 'Коммерческие условия',
    html: 'Оценка недоступна для ручного изменения. Она будет поступать из системы автоматически на основании коммерческих условий клиента.'
  },
  motivation: {
    title: 'Мотивация продавцов',
    html: 'Введите общее количество продавцов и количество участников VOG Club. Оценка рассчитывается автоматически по доле участников:<br><b>5</b> — 76–100%;<br><b>4</b> — 51–75%;<br><b>3</b> — 26–50%;<br><b>2</b> — 1–25%;<br><b>1</b> — 0%.'
  },
  display: {
    title: 'Качество выставки ВОГ',
    html: '<b>5</b> — полноценная бренд-зона ВОГ.<br><b>4</b> — заметная и качественно оформленная зона.<br><b>3</b> — базовая аккуратная выставка.<br><b>2</b> — минимальная выкладка без оформления.<br><b>1</b> — выставка отсутствует или товар разрознен.'
  },
});

let fourPScoreTargetId = '';
let fourPScoreHelpKey = '';

function ensureFourPDialogs() {
  if (!$('fourp-help-modal')) {
    const helpModal = document.createElement('div');
    helpModal.id = 'fourp-help-modal';
    helpModal.className = 'modal-backdrop';
    helpModal.innerHTML = `
      <div class="modal-sheet fourp-dialog-sheet">
        <div class="modal-grabber"></div>
        <div class="fourp-dialog-head">
          <h3 id="fourp-help-title">Подсказка</h3>
          <button class="icon-button" type="button" data-fourp-close>×</button>
        </div>
        <div id="fourp-help-body" class="fourp-help-body"></div>
        <button class="secondary-button" type="button" data-fourp-close>Понятно</button>
      </div>`;
    document.body.appendChild(helpModal);
  }

  if (!$('fourp-score-modal')) {
    const scoreModal = document.createElement('div');
    scoreModal.id = 'fourp-score-modal';
    scoreModal.className = 'modal-backdrop';
    scoreModal.innerHTML = `
      <div class="modal-sheet fourp-dialog-sheet">
        <div class="modal-grabber"></div>
        <div class="fourp-dialog-head">
          <h3 id="fourp-score-title">Выберите оценку</h3>
          <button class="icon-button" type="button" data-fourp-close>×</button>
        </div>
        <div class="fourp-score-choice-grid">
          ${[5,4,3,2,1].map(score => `<button type="button" data-fourp-score-value="${score}">${score}</button>`).join('')}
        </div>
        <div id="fourp-score-description" class="fourp-help-body"></div>
      </div>`;
    document.body.appendChild(scoreModal);
  }

  document.querySelectorAll('[data-fourp-close]').forEach(button => {
    if (button.dataset.bound === '1') return;
    button.dataset.bound = '1';
    button.addEventListener('click', () => {
      $('fourp-help-modal')?.classList.remove('open');
      $('fourp-score-modal')?.classList.remove('open');
    });
  });

  document.querySelectorAll('[data-fourp-score-value]').forEach(button => {
    if (button.dataset.bound === '1') return;
    button.dataset.bound = '1';
    button.addEventListener('click', () => {
      const target = $(fourPScoreTargetId);
      if (target) target.value = button.dataset.fourpScoreValue;
      $('fourp-score-modal')?.classList.remove('open');
      updateFourPVisitPreview();
    });
  });
}

function openFourPHelp(helpKey) {
  ensureFourPDialogs();
  const help = FOUR_P_HELP[helpKey];
  if (!help) return;
  $('fourp-help-title').textContent = help.title;
  $('fourp-help-body').innerHTML = help.html;
  $('fourp-help-modal').classList.add('open');
}

function openFourPScorePicker(targetId, helpKey) {
  ensureFourPDialogs();
  fourPScoreTargetId = targetId;
  fourPScoreHelpKey = helpKey;
  const help = FOUR_P_HELP[helpKey];
  $('fourp-score-title').textContent = help?.title || 'Выберите оценку';
  $('fourp-score-description').innerHTML = help?.html || '';
  $('fourp-score-modal').classList.add('open');
}

function fourPRowHtml({help, label, scoreId, inputHtml='', manualTarget=''}) {
  const score = manualTarget
    ? `<button id="${scoreId}" class="fourp-rating-button" type="button" data-fourp-manual-target="${manualTarget}" data-fourp-manual-help="${help}">0,0</button>`
    : `<span id="${scoreId}" class="fourp-rating-pill auto" aria-disabled="true">0,0</span>`;

  if (inputHtml) {
    return `
      <div class="fourp-rating-row has-input">
        <div class="fourp-rating-label-line">
          <button class="fourp-help-button" type="button" data-fourp-help="${help}" aria-label="Показать подсказку">?</button>
          <div class="fourp-rating-label">${label}</div>
        </div>
        <div class="fourp-rating-control-line">
          <div class="fourp-rating-input-area">${inputHtml}</div>
          ${score}
        </div>
      </div>`;
  }

  return `
    <div class="fourp-rating-row">
      <div class="fourp-rating-label-line">
        <button class="fourp-help-button" type="button" data-fourp-help="${help}" aria-label="Показать подсказку">?</button>
        <div class="fourp-rating-label">${label}</div>
        ${score}
      </div>
    </div>`;
}

function ensureFourPVisitUi() {
  const modal = $('visit-modal');
  if (!modal || $('fourp-visit-section')) return;

  const mediaField = $('visit-photo-button')?.closest('.field-group');
  if (!mediaField) return;

  if (!$('fourp-mobile-style')) {
    const style = document.createElement('style');
    style.id = 'fourp-mobile-style';
    style.textContent = `
      .fourp-section{margin:14px 0;padding:14px;border:1px solid #d7e2d5;border-radius:16px;background:#fff}
      .fourp-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px}
      .fourp-section-title{margin:0;font-size:19px;font-weight:850;color:#17202a}
      .fourp-total-display{display:flex;align-items:center;gap:8px;white-space:nowrap}
      .fourp-total-value{font-size:19px;font-weight:900;color:#17202a}
      .fourp-stars{display:inline-flex;gap:1px}
      .fourp-star{position:relative;display:inline-block;color:#d0d5dd;font-size:20px;line-height:1}
      .fourp-star::after{content:'★';position:absolute;inset:0;color:#f5b800;clip-path:inset(0 calc(100% - var(--fill)) 0 0)}
      .fourp-rating-list{margin-top:6px}
      .fourp-rating-row{padding:12px 0;border-bottom:1px solid #eaecf0}
      .fourp-rating-row:last-child{border-bottom:0}
      .fourp-rating-label-line{display:grid;grid-template-columns:26px minmax(0,1fr) 60px;gap:9px;align-items:center}
      .fourp-rating-row.has-input .fourp-rating-label-line{grid-template-columns:26px minmax(0,1fr)}
      .fourp-rating-control-line{display:grid;grid-template-columns:minmax(0,1fr) 60px;gap:9px;align-items:start;margin-left:35px;margin-top:8px}
      .fourp-help-button{width:24px;height:24px;border:1px solid #89b76f;border-radius:50%;padding:0;background:#fff;color:#5b8d43;font-size:13px;font-weight:900;line-height:22px}
      .fourp-rating-label{color:#17202a;font-size:14px;font-weight:800;line-height:1.25}
      .fourp-rating-input-area{min-width:0}
      .fourp-rating-note{margin-top:5px;color:#667085;font-size:11px;line-height:1.35}
      .fourp-rating-pill,.fourp-rating-button{display:inline-flex;align-items:center;justify-content:center;width:60px;height:40px;border:0;border-radius:10px;background:#cfe6bf;color:#31582b;font-size:19px;font-weight:900}
      .fourp-rating-button{cursor:pointer;box-shadow:inset 0 0 0 1px rgba(49,88,43,.1)}
      .fourp-rating-pill.auto{opacity:.92}
      .fourp-compact-input{width:100%;height:40px;border:1.5px solid #3d6e99;border-radius:8px;padding:0 10px;background:#fff;color:#17202a;font:inherit;box-sizing:border-box}
      .fourp-double-input{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .fourp-input-caption{display:block;margin-bottom:4px;color:#667085;font-size:10px;font-weight:700;line-height:1.2}
      .fourp-double-input .fourp-compact-input{margin-top:0}
      .fourp-system-note{min-height:40px;display:flex;align-items:center;color:#667085;font-size:11px;line-height:1.35}
      .fourp-dialog-sheet{padding-bottom:calc(18px + env(safe-area-inset-bottom))}
      .fourp-dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}
      .fourp-dialog-head h3{margin:0;font-size:19px;line-height:1.25}
      .fourp-help-body{padding:12px;border-radius:12px;background:#f8fafc;color:#344054;font-size:14px;line-height:1.55}
      .fourp-score-choice-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:8px 0 12px}
      .fourp-score-choice-grid button{height:50px;border:1px solid #b8d4a8;border-radius:11px;background:#e7f3df;color:#31582b;font-size:20px;font-weight:900}
      .fourp-trt-card .card-title{display:flex;align-items:center;justify-content:space-between;gap:10px}
      .fourp-trt-total-display{display:flex;align-items:center;gap:6px}
      .fourp-trt-total-display b{font-size:18px}
      .fourp-trt-total-display .fourp-star{font-size:15px}
      .fourp-trt-list{margin-top:8px}
      .fourp-trt-line{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid #eaecf0;color:#475467;font-size:12px;line-height:1.35}
      .fourp-trt-line:last-child{border-bottom:0}
      .fourp-trt-line b{color:#17202a;text-align:right}
      .fourp-timeline-rating{display:inline-flex;align-items:center;gap:6px;margin-top:7px;padding:5px 8px;border-radius:9px;background:#fff8db;color:#775d00;font-size:12px;font-weight:850}
      .fourp-timeline-rating .fourp-star{font-size:13px}
      @media(max-width:360px){
        .fourp-rating-label-line{grid-template-columns:24px minmax(0,1fr) 58px}
        .fourp-rating-control-line{grid-template-columns:minmax(0,1fr) 58px;margin-left:33px}
        .fourp-rating-pill,.fourp-rating-button{width:58px}
        .fourp-star{font-size:18px}
      }
    `;
    document.head.appendChild(style);
  }

  const section = document.createElement('section');
  section.id = 'fourp-visit-section';
  section.className = 'fourp-section';
  section.innerHTML = `
    <div class="fourp-section-head">
      <h3 class="fourp-section-title">Рейтинг ТРТ</h3>
      <div class="fourp-total-display">
        <strong id="fourp-total-score" class="fourp-total-value">0,0</strong>
        <span id="fourp-total-stars">${fourPStarsHtml(0)}</span>
      </div>
    </div>
    <input id="fourp-place-location" type="hidden">
    <input id="fourp-place-vog" type="hidden">
    <input id="fourp-consumer-promo" type="hidden">
    <div class="fourp-rating-list">
      ${fourPRowHtml({help:'location',label:'Местоположение ТРТ',scoreId:'fourp-place-location-score',manualTarget:'fourp-place-location'})}
      ${fourPRowHtml({help:'placement',label:'Местоположение ВОГ внутри ТРТ',scoreId:'fourp-place-vog-score',manualTarget:'fourp-place-vog'})}
      ${fourPRowHtml({help:'sku',label:'Общее количество SKU в ТРТ',scoreId:'fourp-assortment-auto-score',inputHtml:'<input id="fourp-sku-count" class="fourp-compact-input" type="number" min="0" step="1" inputmode="numeric" placeholder="Например: 1200">'})}
      ${fourPRowHtml({help:'share',label:'SKU от ВОГ в ассортименте ТРТ',scoreId:'fourp-share-auto-score',inputHtml:'<input id="fourp-vog-sku-count" class="fourp-compact-input" type="number" min="0" step="1" inputmode="numeric" placeholder="Например: 200"><div id="fourp-share-percent-note" class="fourp-rating-note">Доля: 0%</div>'})}
      ${fourPRowHtml({help:'commercial',label:'Коммерческие условия',scoreId:'fourp-commercial-score',inputHtml:'<div class="fourp-system-note">Оценка поступит из системы по КУ</div>'})}
      ${fourPRowHtml({help:'motivation',label:'Мотивация',scoreId:'fourp-motivation-score',inputHtml:'<div class="fourp-double-input"><label><span class="fourp-input-caption">Всего продавцов</span><input id="fourp-seller-count" class="fourp-compact-input" type="number" min="0" step="1" inputmode="numeric" placeholder="5"></label><label><span class="fourp-input-caption">Участники VOG Club</span><input id="fourp-vog-club-count" class="fourp-compact-input" type="number" min="0" step="1" inputmode="numeric" placeholder="5"></label></div><div id="fourp-seller-percent-note" class="fourp-rating-note">Участие: 0%</div>'})}
      ${fourPRowHtml({help:'display',label:'Качество выставки ВОГ',scoreId:'fourp-consumer-promo-score',manualTarget:'fourp-consumer-promo'})}
    </div>`;

  mediaField.insertAdjacentElement('beforebegin', section);
  ensureFourPDialogs();

  section.querySelectorAll('[data-fourp-help]').forEach(button => {
    button.addEventListener('click', () => openFourPHelp(button.dataset.fourpHelp));
  });
  section.querySelectorAll('[data-fourp-manual-target]').forEach(button => {
    button.addEventListener('click', () => openFourPScorePicker(
      button.dataset.fourpManualTarget,
      button.dataset.fourpManualHelp,
    ));
  });
  ['fourp-sku-count','fourp-vog-sku-count','fourp-seller-count','fourp-vog-club-count'].forEach(id => {
    $(id)?.addEventListener('input', updateFourPVisitPreview);
    $(id)?.addEventListener('change', updateFourPVisitPreview);
  });

  updateFourPVisitPreview();
}

function fourPAssessmentFromForm() {
  return normalizeFourPAssessment({
    version: FOUR_P_VERSION,
    place: {
      locationScore: $('fourp-place-location')?.value,
      vogPlacementScore: $('fourp-place-vog')?.value,
    },
    product: {
      skuCount: $('fourp-sku-count')?.value,
      vogSkuCount: $('fourp-vog-sku-count')?.value,
    },
    promotion: {
      commercialTermsScore: null,
      sellerCount: $('fourp-seller-count')?.value,
      vogClubParticipants: $('fourp-vog-club-count')?.value,
      consumerPromoScore: $('fourp-consumer-promo')?.value,
    },
    assessedAt: new Date().toISOString(),
  });
}

function updateFourPVisitPreview() {
  if (!$('fourp-visit-section')) return;
  const assessment = fourPAssessmentFromForm();
  $('fourp-place-location-score').textContent = fourPFormatScore(assessment?.place?.locationScore);
  $('fourp-place-vog-score').textContent = fourPFormatScore(assessment?.place?.vogPlacementScore);
  $('fourp-assortment-auto-score').textContent = fourPFormatScore(assessment?.product?.assortmentScore);
  $('fourp-share-auto-score').textContent = fourPFormatScore(assessment?.product?.vogShareScore);
  $('fourp-commercial-score').textContent = fourPFormatScore(assessment?.promotion?.commercialTermsScore);
  $('fourp-motivation-score').textContent = fourPFormatScore(assessment?.promotion?.sellerMotivationScore);
  $('fourp-consumer-promo-score').textContent = fourPFormatScore(assessment?.promotion?.consumerPromoScore);
  $('fourp-total-score').textContent = fourPFormatScore(assessment?.totalScore);
  $('fourp-total-stars').innerHTML = fourPStarsHtml(assessment?.totalScore);
  $('fourp-share-percent-note').textContent = `Доля: ${assessment?.product?.vogSharePercent != null ? String(assessment.product.vogSharePercent).replace('.', ',') : '0'}%`;
  $('fourp-seller-percent-note').textContent = `Участие: ${assessment?.promotion?.sellerParticipationPercent != null ? String(assessment.promotion.sellerParticipationPercent).replace('.', ',') : '0'}%`;
}

function resetFourPVisitForm() {
  ensureFourPVisitUi();
  [
    'fourp-place-location',
    'fourp-place-vog',
    'fourp-sku-count',
    'fourp-vog-sku-count',
    'fourp-seller-count',
    'fourp-vog-club-count',
    'fourp-consumer-promo',
  ].forEach(id => { if ($(id)) $(id).value = ''; });
  updateFourPVisitPreview();
}

function populateFourPVisitForm(value) {
  ensureFourPVisitUi();
  const assessment = normalizeFourPAssessment(value);
  $('fourp-place-location').value = assessment?.place?.locationScore ?? '';
  $('fourp-place-vog').value = assessment?.place?.vogPlacementScore ?? '';
  $('fourp-sku-count').value = assessment?.product?.skuCount ?? '';
  $('fourp-vog-sku-count').value = assessment?.product?.vogSkuCount ?? '';
  $('fourp-seller-count').value = assessment?.promotion?.sellerCount ?? '';
  $('fourp-vog-club-count').value = assessment?.promotion?.vogClubParticipants ?? '';
  $('fourp-consumer-promo').value = assessment?.promotion?.consumerPromoScore ?? '';
  updateFourPVisitPreview();
}

function collectRequiredFourPAssessment() {
  const skuCount = fourPInteger($('fourp-sku-count')?.value);
  const vogSkuCount = fourPInteger($('fourp-vog-sku-count')?.value);
  const sellerCount = fourPInteger($('fourp-seller-count')?.value);
  const clubCount = fourPInteger($('fourp-vog-club-count')?.value);

  if (!fourPScore($('fourp-place-location')?.value) || !fourPScore($('fourp-place-vog')?.value) || !fourPScore($('fourp-consumer-promo')?.value)) {
    showToast('Поставьте три ручные оценки рейтинга ТРТ');
    return null;
  }
  if (skuCount == null || skuCount <= 0) {
    showToast('Укажите общее количество SKU в ТРТ');
    return null;
  }
  if (vogSkuCount == null || vogSkuCount < 0 || vogSkuCount > skuCount) {
    showToast('Количество SKU ВОГ должно быть от 0 до общего количества SKU');
    return null;
  }
  if (sellerCount == null || sellerCount <= 0) {
    showToast('Укажите общее количество продавцов');
    return null;
  }
  if (clubCount == null || clubCount < 0 || clubCount > sellerCount) {
    showToast('Участников VOG Club не может быть больше общего числа продавцов');
    return null;
  }

  const assessment = fourPAssessmentFromForm();
  if (!assessment?.complete) {
    showToast('Проверьте заполнение рейтинга ТРТ');
    return null;
  }
  return assessment;
}

function latestFourPVisitForTrt(trtId) {
  return visits
    .filter(item => String(item.trtId) === String(trtId) && normalizeFourPAssessment(item.fourP)?.complete)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0] || null;
}

function ensureFourPTrtCardUi() {
  const tab = $('tab-info');
  if (!tab || $('trt-fourp-mobile-card')) return;

  const card = document.createElement('div');
  card.id = 'trt-fourp-mobile-card';
  card.className = 'card fourp-trt-card';
  card.innerHTML = `
    <button id="trt-fourp-toggle" class="fourp-trt-toggle" type="button" aria-expanded="false">
      <span class="fourp-trt-toggle-main">
        <span class="fourp-trt-toggle-title">Рейтинг ТРТ</span>
        <span class="fourp-trt-score-block">
          <span class="fourp-trt-toggle-score">
            <span id="trt-fourp-stars">${fourPStarsHtml(0)}</span>
            <b id="trt-fourp-total">0,0</b>
          </span>
          <span id="trt-status-placeholder" class="trt-status-placeholder">АКБ</span>
        </span>
      </span>
      <span id="trt-fourp-chevron" class="fourp-trt-chevron" aria-hidden="true">
        <svg viewBox="0 0 72 24" focusable="false" aria-hidden="true">
          <path d="M4 7 L36 16 L68 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
    </button>
    <div id="trt-fourp-details-wrap" class="fourp-trt-details-wrap" hidden>
      <div id="trt-fourp-details" class="fourp-trt-list"></div>
      <div id="trt-fourp-date" class="file-note"></div>
    </div>`;

  const summaryCard = $('detail-direction')?.closest('.card');
  if (summaryCard?.parentElement) {
    summaryCard.insertAdjacentElement('afterend', card);
  } else {
    tab.prepend(card);
  }

  // Продажи идут отдельным блоком сразу после рейтинга.
  const salesValue = $('detail-size');
  const salesBox = salesValue?.closest('.info-box');
  const salesExpanded = salesBox?.nextElementSibling?.classList.contains('trt-sales-expanded')
    ? salesBox.nextElementSibling
    : null;
  if (salesBox) {
    card.insertAdjacentElement('afterend', salesBox);
    if (salesExpanded) salesBox.insertAdjacentElement('afterend', salesExpanded);
  }

  $('trt-fourp-toggle').addEventListener('click', () => {
    const wrap = $('trt-fourp-details-wrap');
    const toggle = $('trt-fourp-toggle');
    const chevron = $('trt-fourp-chevron');
    const willOpen = Boolean(wrap?.hidden);
    if (wrap) wrap.hidden = !willOpen;
    toggle?.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    chevron?.classList.toggle('open', willOpen);
  });
}

function renderFourPTrtCard() {
  ensureFourPTrtCardUi();
  const visit = latestFourPVisitForTrt(selectedTrtId);
  const assessment = normalizeFourPAssessment(visit?.fourP);
  const hasAssessment = Boolean(assessment?.complete);

  $('trt-fourp-total').textContent = fourPFormatScore(assessment?.totalScore);
  $('trt-fourp-stars').innerHTML = fourPStarsHtml(assessment?.totalScore);

  const commercialText = assessment?.promotion?.commercialTermsScore == null
    ? '—'
    : fourPFormatScore(assessment.promotion.commercialTermsScore);

  const locationScore = assessment?.place?.locationScore;
  const placementScore = assessment?.place?.vogPlacementScore;
  const skuCount = assessment?.product?.skuCount;
  const assortmentScore = assessment?.product?.assortmentScore;
  const vogSkuCount = assessment?.product?.vogSkuCount;
  const vogShare = assessment?.product?.vogSharePercent;
  const vogShareScore = assessment?.product?.vogShareScore;
  const sellerCount = assessment?.promotion?.sellerCount;
  const participants = assessment?.promotion?.vogClubParticipants;
  const motivationScore = assessment?.promotion?.sellerMotivationScore;
  const displayScore = assessment?.promotion?.consumerPromoScore;

  $('trt-fourp-details').innerHTML = `
    <div class="fourp-trt-line"><span>Местоположение ТРТ</span><b>${fourPFormatScore(locationScore)}</b></div>
    <div class="fourp-trt-line"><span>Местоположение ВОГ внутри ТРТ</span><b>${fourPFormatScore(placementScore)}</b></div>
    <div class="fourp-trt-line"><span>Общее количество SKU в ТРТ</span><b>${skuCount == null ? '—' : `${Number(skuCount).toLocaleString('ru-RU')} SKU · ${fourPFormatScore(assortmentScore)}`}</b></div>
    <div class="fourp-trt-line"><span>SKU от ВОГ в ассортименте ТРТ</span><b>${vogSkuCount == null ? '—' : `${Number(vogSkuCount).toLocaleString('ru-RU')} SKU · ${String(vogShare ?? 0).replace('.', ',')}% · ${fourPFormatScore(vogShareScore)}`}</b></div>
    <div class="fourp-trt-line"><span>Коммерческие условия</span><b>${escapeHtml(commercialText)}</b></div>
    <div class="fourp-trt-line"><span>Мотивация</span><b>${sellerCount == null ? fourPFormatScore(motivationScore) : `${participants ?? 0}/${sellerCount} · ${fourPFormatScore(motivationScore)}`}</b></div>
    <div class="fourp-trt-line"><span>Качество выставки ВОГ</span><b>${fourPFormatScore(displayScore)}</b></div>`;
  $('trt-fourp-date').textContent = hasAssessment
    ? `Последняя оценка: ${formatDateTime(visit.createdAt)}`
    : '';
  $('trt-fourp-date').hidden = !hasAssessment;

  const wrap = $('trt-fourp-details-wrap');
  const toggle = $('trt-fourp-toggle');
  const chevron = $('trt-fourp-chevron');
  if (wrap) wrap.hidden = true;
  toggle?.setAttribute('aria-expanded', 'false');
  chevron?.classList.remove('open');
}

function fourPVisitTimelineHtml(visit) {
  const assessment = normalizeFourPAssessment(visit?.fourP);
  if (!assessment?.complete) return '';
  return `<div class="fourp-timeline-rating"><span>Рейтинг ТРТ: ${fourPFormatScore(assessment.totalScore)}</span>${fourPStarsHtml(assessment.totalScore)}</div>`;
}


function visitDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isVisitEditableToday(visit) {
  return Boolean(visit && visitDateKey(visit.createdAt) === visitDateKey(new Date()));
}

function normalizedVisitResults(visit) {
  const source = Array.isArray(visit?.results)
    ? visit.results
    : [String(visit?.result || '')];

  const items = [];
  source.forEach(rawItem => {
    String(rawItem || '').split(/\s*[•;]\s*/).forEach(item => {
      const value = String(item || '').trim();
      if (value && !items.includes(value)) items.push(value);
    });
  });

  const other = String(visit?.otherResult || '').trim();
  return {items, other};
}

function visitResultSummary(visit) {
  const {items, other} = normalizedVisitResults(visit);
  return [...items, ...(other ? [other] : [])].join(' • ') || 'Результат не указан';
}

function setVisitResultSelection(items=[], other='') {
  visitResultSelection = new Set(
    (Array.isArray(items) ? items : [])
      .map(item => String(item || '').trim())
      .filter(item => VISIT_RESULT_OPTIONS.includes(item))
  );

  const unknown = (Array.isArray(items) ? items : [])
    .map(item => String(item || '').trim())
    .filter(item => item && !VISIT_RESULT_OPTIONS.includes(item));

  visitOtherResult = String(other || unknown.join(' • ')).trim();
  updateVisitResultTrigger();
}

function updateVisitResultTrigger() {
  const trigger = $('visit-result-trigger');
  if (!trigger) return;

  const values = [...visitResultSelection];
  if (visitOtherResult) values.push(visitOtherResult);

  trigger.classList.toggle('empty', values.length === 0);
  trigger.innerHTML = values.length
    ? `<span>${values.map(escapeHtml).join('</span><span>')}</span>`
    : '<span>Выберите результат</span>';
}

function renderVisitResultPicker() {
  document.querySelectorAll('[data-visit-result-option]').forEach(input => {
    input.checked = visitResultDraftSelection.has(input.value);
  });
  const otherInput = $('visit-other-result-input');
  if (otherInput) otherInput.value = visitResultDraftOther;
}

function openVisitResultPicker() {
  visitResultDraftSelection = new Set(visitResultSelection);
  visitResultDraftOther = visitOtherResult;
  renderVisitResultPicker();
  $('visit-result-picker')?.classList.add('open');
}

function closeVisitResultPicker() {
  $('visit-result-picker')?.classList.remove('open');
}

function applyVisitResultPicker() {
  visitResultSelection = new Set(visitResultDraftSelection);
  visitOtherResult = String($('visit-other-result-input')?.value || '').trim();
  updateVisitResultTrigger();
  closeVisitResultPicker();
}

function collectVisitResults() {
  const items = [...visitResultSelection];
  const otherResult = String(visitOtherResult || '').trim();
  const values = [...items, ...(otherResult ? [otherResult] : [])];

  if (!values.length) {
    showToast('Выберите хотя бы один результат визита');
    return null;
  }

  return {
    items,
    otherResult,
    result: values.join(' • '),
  };
}

function visitVoiceIdleHtml() {
  return `<svg class="visit-microphone-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm-5-3a1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V21H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-3.08A7 7 0 0 0 19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0Z"/></svg>`;
}

function visitVoiceListeningHtml() {
  return `<span class="visit-voice-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>`;
}

function setVisitVoiceButtonState(listening) {
  const button = $('visit-voice-button');
  if (!button) return;
  button.classList.toggle('listening', Boolean(listening));
  button.innerHTML = listening ? visitVoiceListeningHtml() : visitVoiceIdleHtml();
  button.title = listening ? 'Идёт распознавание речи' : 'Голосовой ввод';
  button.setAttribute('aria-label', button.title);
}

function startVisitVoiceInput() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const button = $('visit-voice-button');
  const textarea = $('visit-comment');

  if (!Recognition) {
    showToast('Голосовой ввод не поддерживается на этом устройстве');
    return;
  }

  if (visitVoiceRecognition) {
    try { visitVoiceRecognition.stop(); } catch (_) {}
    return;
  }

  const recognition = new Recognition();
  visitVoiceRecognition = recognition;
  recognition.lang = 'ru-RU';
  recognition.continuous = false;
  recognition.interimResults = true;

  let finalText = '';

  recognition.onstart = () => setVisitVoiceButtonState(true);

  recognition.onresult = event => {
    let interim = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const transcript = String(event.results[index][0]?.transcript || '').trim();
      if (event.results[index].isFinal) finalText += `${transcript} `;
      else interim += transcript;
    }
    if (button && interim) button.title = interim;
  };

  recognition.onerror = event => {
    if (event.error !== 'aborted') showToast('Не удалось распознать речь');
  };

  recognition.onend = () => {
    const recognized = finalText.trim();
    if (recognized && textarea) {
      const current = textarea.value.trim();
      textarea.value = current ? `${current} ${recognized}` : recognized;
      textarea.dispatchEvent(new Event('input', {bubbles:true}));
    }
    setVisitVoiceButtonState(false);
    visitVoiceRecognition = null;
  };

  try {
    recognition.start();
  } catch (_) {
    visitVoiceRecognition = null;
    setVisitVoiceButtonState(false);
  }
}

function visitJournalPoint(visit) {
  return trts.find(item => String(item.id) === String(visit?.trtId)) || null;
}

function journalSearchText(...records) {
  return normalizeText(records.map(record => {
    if (record === null || record === undefined) return '';
    if (typeof record === 'string' || typeof record === 'number') return String(record);
    try {
      return JSON.stringify(record);
    } catch (_) {
      return String(record);
    }
  }).join(' '));
}

function visitJournalCardHtml(visit) {
  const point = visitJournalPoint(visit);
  const assessment = normalizeFourPAssessment(visit?.fourP);
  return `
    <button class="visit-journal-card" type="button" data-visit-journal-id="${escapeHtml(visit.id)}">
      <div class="visit-journal-head">
        <div>
          <strong>${escapeHtml(point?.client || point?.holding || 'ТРТ')}</strong>
          <span>${escapeHtml(formatDateTime(visit.createdAt))}</span>
        </div>
      </div>
      <div class="visit-journal-result">${escapeHtml(visitResultSummary(visit))}</div>
      ${assessment?.complete ? `<div class="visit-journal-rating"><b>${fourPFormatScore(assessment.totalScore)}</b>${fourPStarsHtml(assessment.totalScore)}</div>` : ''}
      ${visit.comment ? `<div class="visit-journal-comment">${escapeHtml(visit.comment)}</div>` : ''}
    </button>`;
}

function renderVisitJournal() {
  const list = $('visits-journal-list');
  if (!list) return;

  const query = normalizeText($('visits-journal-search')?.value || '');
  const filter = $('visits-journal-filter')?.value || 'all';
  const now = new Date();
  const today = visitDateKey(now);
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;

  const rows = visits.filter(visit => {
    const point = visitJournalPoint(visit);
    const date = new Date(visit.createdAt);
    if (filter === 'today' && visitDateKey(date) !== today) return false;
    if (filter === 'week' && (!Number.isFinite(date.getTime()) || date.getTime() < weekAgo)) return false;
    if (!query) return true;
    return journalSearchText(
      visit,
      point,
      visitResultSummary(visit),
      visit.employee,
      visit.employeeName,
      visit.employeeId,
      currentUser?.full_name
    ).includes(query);
  });

  $('visits-journal-count').textContent = String(rows.length);
  list.innerHTML = rows.length
    ? rows.map(visitJournalCardHtml).join('')
    : '<div class="empty-state" style="margin:0;"><h3>Визитов нет</h3><p>Новые визиты появятся здесь после сохранения.</p></div>';
}

function openVisitFromJournal(visitId) {
  const visit = visits.find(item => String(item.id) === String(visitId));
  if (!visit) return;
  selectedTrtId = visit.trtId;
  openVisitModal(String(visit.id), {readOnly: !isVisitEditableToday(visit)});
}

function ensureVisitWorkflowUi() {
  if (document.body.dataset.visitWorkflowUi === '1') return;
  document.body.dataset.visitWorkflowUi = '1';
  ensureFourPVisitUi();

  const style = document.createElement('style');
  style.id = 'visit-workflow-style';
  style.textContent = `
    .bottom-nav{grid-template-columns:repeat(5,1fr)!important}
    .visit-result-trigger{width:100%;min-height:56px;border:1px solid #d0d5dd;border-radius:12px;padding:10px 40px 10px 12px;background:#fff;color:#17202a;text-align:left;position:relative;line-height:1.35}
    .visit-result-trigger::after{content:'⌄';position:absolute;right:13px;top:50%;transform:translateY(-50%);color:#667085;font-size:18px}
    .visit-result-trigger.empty{color:#98a2b3}
    .visit-result-trigger span{display:inline-flex;margin:2px 4px 2px 0;padding:6px 8px;border-radius:8px;background:#f2f4f7;color:#344054;font-size:13px;font-weight:750}
    .visit-result-trigger.empty span{padding:0;background:transparent;color:#98a2b3;font-size:15px;font-weight:500}
    .visit-result-option{display:flex;align-items:flex-start;gap:10px;padding:11px 0;border-bottom:1px solid #eaecf0;color:#17202a;font-weight:700}
    .visit-result-option input{width:20px;height:20px;margin:0;accent-color:#355a93}
    .visit-result-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}
    .visit-label-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .visit-voice-button{width:46px;height:38px;border:1px solid #b8d4a8;border-radius:10px;background:#fff;color:#355a93;display:flex;align-items:center;justify-content:center;padding:0;overflow:hidden}
    .visit-microphone-icon{width:21px;height:21px;fill:currentColor}
    .visit-voice-button.listening{background:#e7f3ee;box-shadow:0 0 0 4px rgba(23,107,77,.08)}
    .visit-voice-wave{height:22px;display:flex;align-items:center;justify-content:center;gap:3px}
    .visit-voice-wave i{display:block;width:3px;height:7px;border-radius:3px;background:#355a93;animation:visitWave .72s ease-in-out infinite}
    .visit-voice-wave i:nth-child(2){animation-delay:.10s}.visit-voice-wave i:nth-child(3){animation-delay:.20s}.visit-voice-wave i:nth-child(4){animation-delay:.30s}.visit-voice-wave i:nth-child(5){animation-delay:.40s}
    @keyframes visitWave{0%,100%{height:6px;opacity:.55}50%{height:22px;opacity:1}}
    .visit-media-button-row{display:grid!important;grid-template-columns:1fr 1fr;gap:12px}
    .visit-media-button{min-height:92px!important;border:2px solid #b8d4a8!important;border-radius:16px!important;background:#f8fff9!important;color:#355a93!important;font-size:16px!important;display:flex!important;flex-direction:column;align-items:center;justify-content:center;gap:8px}
    .visit-media-button svg{width:30px;height:30px;fill:currentColor}
    .visit-journal-list{display:grid;gap:10px}
    .visit-journal-card{width:100%;border:1px solid #e4e7ec;border-radius:15px;padding:13px;background:#fff;color:#17202a;text-align:left;box-shadow:0 1px 2px rgba(16,24,40,.04)}
    .visit-journal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
    .visit-journal-head strong{display:block;font-size:15px}
    .visit-journal-head span{display:block;margin-top:3px;color:#667085;font-size:11px}
    .visit-edit-state{flex:0 0 auto!important;margin:0!important;padding:5px 7px;border-radius:8px;background:#f2f4f7;color:#667085!important;font-size:10px!important;font-weight:800}
    .visit-edit-state.editable{background:#e7f3ee;color:#355a93!important}
    .visit-journal-result{margin-top:9px;font-size:13px;font-weight:750;line-height:1.35}
    .visit-journal-comment{margin-top:7px;color:#667085;font-size:12px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .visit-journal-rating{display:flex;align-items:center;gap:6px;margin-top:8px;color:#775d00}
    .visit-journal-rating .fourp-star{font-size:14px}
    .visit-timeline-button{width:100%;border:0;text-align:left;color:inherit;cursor:pointer}
    .visit-edit-notice{margin:0 0 12px;padding:10px 12px;border-radius:11px;background:#e7f3ee;color:#355a93;font-size:12px;font-weight:750}
  `;
  document.head.appendChild(style);

  const originalResult = $('visit-result');
  if (originalResult) {
    originalResult.hidden = true;
    originalResult.disabled = true;
    const group = originalResult.closest('.field-group');
    const label = group?.querySelector('.field-label');
    if (label) {
      label.textContent = 'Результаты визита *';
      label.htmlFor = 'visit-result-trigger';
    }
    if (!$('visit-result-trigger')) {
      const trigger = document.createElement('button');
      trigger.id = 'visit-result-trigger';
      trigger.type = 'button';
      trigger.className = 'visit-result-trigger empty';
      trigger.innerHTML = '<span>Выберите результат</span>';
      originalResult.insertAdjacentElement('afterend', trigger);
      trigger.addEventListener('click', openVisitResultPicker);
    }
  }

  if (!$('visit-result-picker')) {
    const picker = document.createElement('div');
    picker.id = 'visit-result-picker';
    picker.className = 'modal-backdrop';
    picker.innerHTML = `
      <div class="modal-sheet">
        <div class="modal-handle"></div>
        <h2 class="modal-title">Результаты визита</h2>
        <div>${VISIT_RESULT_OPTIONS.map(option => `
          <label class="visit-result-option">
            <input type="checkbox" value="${escapeHtml(option)}" data-visit-result-option>
            <span>${escapeHtml(option)}</span>
          </label>`).join('')}</div>
        <div class="field-group" style="margin-top:14px;">
          <label class="field-label" for="visit-other-result-input">Другой результат</label>
          <input id="visit-other-result-input" class="text-input" type="text" placeholder="Введите свой результат">
        </div>
        <div class="visit-result-actions">
          <button id="visit-result-cancel" class="secondary-button" type="button">Отмена</button>
          <button id="visit-result-apply" class="primary-button" type="button">Готово</button>
        </div>
      </div>`;
    document.body.appendChild(picker);

    picker.querySelectorAll('[data-visit-result-option]').forEach(input => {
      input.addEventListener('change', () => {
        if (input.checked) visitResultDraftSelection.add(input.value);
        else visitResultDraftSelection.delete(input.value);
      });
    });
    $('visit-result-cancel').addEventListener('click', closeVisitResultPicker);
    $('visit-result-apply').addEventListener('click', applyVisitResultPicker);
    picker.addEventListener('click', event => {
      if (event.target === picker) closeVisitResultPicker();
    });
  }

  const nextStep = $('visit-next-step');
  if (nextStep) {
    nextStep.value = '';
    const nextStepGroup = nextStep.closest('.field-group');
    if (nextStepGroup) nextStepGroup.hidden = true;
    else nextStep.hidden = true;
  }

  const comment = $('visit-comment');
  const commentGroup = comment?.closest('.field-group');
  const commentLabel = commentGroup?.querySelector('.field-label');
  if (commentLabel && !$('visit-voice-button')) {
    const row = document.createElement('div');
    row.className = 'visit-label-row';
    commentLabel.replaceWith(row);
    row.appendChild(commentLabel);
    const voice = document.createElement('button');
    voice.id = 'visit-voice-button';
    voice.type = 'button';
    voice.className = 'visit-voice-button';
    voice.innerHTML = visitVoiceIdleHtml();
    voice.title = 'Голосовой ввод';
    voice.setAttribute('aria-label', 'Голосовой ввод');
    row.appendChild(voice);
    voice.addEventListener('click', startVisitVoiceInput);
  }

  const photoButton = $('visit-photo-button');
  const videoButton = $('visit-video-button');
  const mediaRow = photoButton?.parentElement;
  if (mediaRow) mediaRow.classList.add('visit-media-button-row');
  if (photoButton) {
    photoButton.classList.add('visit-media-button');
    photoButton.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 3 7.2 5H4a2 2 0 0 0-2 2v12h20V7a2 2 0 0 0-2-2h-3.2L15 3H9Zm3 14a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z"/></svg><span>Фото</span>';
  }
  if (videoButton) {
    videoButton.classList.add('visit-media-button');
    videoButton.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 5h13v14H3V5Zm15 4 4-3v12l-4-3V9Z"/></svg><span>Видео</span>';
  }

  const originalVisitTitle = $('visit-modal')?.querySelector('.modal-title');
  if (originalVisitTitle && !$('visit-detail-header-host')) {
    const host = document.createElement('div');
    host.id = 'visit-detail-header-host';
    originalVisitTitle.replaceWith(host);
    mountMatchingCardHeader('visit', host, closeModals);
  }

  if (!$('screen-visits-journal')) {
    const screen = document.createElement('section');
    screen.id = 'screen-visits-journal';
    screen.className = 'screen';
    screen.innerHTML = `
      <div class="screen-inner">
        <h2 class="section-title">Визиты <span id="visits-journal-count" class="counter-pill">0</span></h2>
        <div class="list-toolbar">
          <input id="visits-journal-search" type="search" placeholder="Поиск по всем полям">
          <select id="visits-journal-filter">
            <option value="all">Все визиты</option>
            <option value="today">Сегодня</option>
            <option value="week">За 7 дней</option>
          </select>
        </div>
        <div id="visits-journal-list" class="visit-journal-list"></div>
      </div>`;
    $('screen-settings')?.insertAdjacentElement('beforebegin', screen);

    $('visits-journal-search').addEventListener('input', renderVisitJournal);
    $('visits-journal-filter').addEventListener('change', renderVisitJournal);
    $('visits-journal-list').addEventListener('click', event => {
      const card = event.target.closest('[data-visit-journal-id]');
      if (card) openVisitFromJournal(card.dataset.visitJournalId);
    });
  }

  applyUnifiedJournalSearchPlaceholders();

  const nav = document.querySelector('.bottom-nav');
  if (nav && !nav.querySelector('[data-screen="visits-journal"]')) {
    const button = document.createElement('button');
    button.className = 'nav-button';
    button.dataset.screen = 'visits-journal';
    button.type = 'button';
    button.innerHTML = `
      <svg viewBox="0 0 24 24"><path d="M6 2h9l5 5v15H6V2Zm8 1.5V8h4.5L14 3.5ZM9 12h8v-2H9v2Zm0 4h8v-2H9v2Zm0 4h6v-2H9v2Z"/></svg>
      Визиты`;
    const settingsButton = nav.querySelector('[data-screen="settings"]');
    nav.insertBefore(button, settingsButton);
  }
}

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
let editingVisitId = null;
let visitResultSelection = new Set();
let visitOtherResult = '';
let visitResultDraftSelection = new Set();
let visitResultDraftOther = '';
let visitVoiceRecognition = null;
let visitReadOnlyMode = false;

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
  $('account-role').textContent = currentUser?.role_label || currentUser?.role || '—';
  $('account-connection').textContent = authOffline ? 'Офлайн' : 'Онлайн';
  $('account-connection').className = authOffline ? 'account-offline' : 'account-online';
  $('offline-banner').classList.toggle('hidden', !authOffline);

  const isGd = String(currentUser?.role || '').toUpperCase() === 'GD';
  ['mobile-import-button', 'mobile-import-input', 'restore-backup-button', 'restore-backup-input'].forEach(id => {
    const element = $(id);
    if (element) element.hidden = !isGd;
  });
}

function showLogin(message='') {
  hideAuthBootstrap();
  $('auth-screen').classList.remove('hidden');
  document.querySelector('.app-shell').classList.add('hidden');
  $('offline-banner').classList.add('hidden');
  setLoginStatus(message);
  setLoginBusy(false);
  setTimeout(() => $('login-input')?.focus(), 50);
}

async function showApp() {
  hideAuthBootstrap();
  $('auth-screen').classList.add('hidden');
  document.querySelector('.app-shell').classList.remove('hidden');
  updateAccountUi();

  if (!appInitialized) {
    initMap();
    bindEvents();
    if (!authOffline && sessionToken) {
      await syncTrtsWithServer({
        silent:true,
      });
    }
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
        device_name:`VOG Мобильный помощник · ${navigator.platform || 'устройство'}`
      }
    });

    saveAuth(result.session_token, result.user);
    await ensureDataOwner(currentUser);
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
  await ensureDataOwner(currentUser);
  setLoginStatus('Проверяем сохранённую сессию…', true);

  try {
    const result = await apiRequest('/auth/me');
    saveAuth(storedToken, result.user);
    await ensureDataOwner(currentUser);
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


async function clearProtectedLocalStores() {
  const stores = [
    STORE_TRTS,
    STORE_VISITS,
    STORE_TASKS,
    STORE_MEDIA,
  ];
  const tx = db.transaction(
    stores,
    'readwrite',
  );
  stores.forEach(name => {
    tx.objectStore(name).clear();
  });
  await transactionComplete(tx);
}

async function protectedLocalRecordCount() {
  const collections = await Promise.all([
    getAll(STORE_TRTS),
    getAll(STORE_VISITS),
    getAll(STORE_TASKS),
    getAll(STORE_MEDIA),
  ]);
  return collections.reduce(
    (total, items) => total + items.length,
    0,
  );
}

async function ensureDataOwner(user) {
  const employeeId = String(
    user?.employee_id || user?.employeeId || ''
  ).trim();
  if (!employeeId) return;

  const previousOwner = String(
    localStorage.getItem(DATA_OWNER_KEY) || ''
  ).trim();

  const role = String(
    user?.role || ''
  ).toUpperCase();

  if (
    previousOwner
    && previousOwner !== employeeId
  ) {
    await clearProtectedLocalStores();
  } else if (
    !previousOwner
    && role !== 'GD'
    && await protectedLocalRecordCount() > 0
  ) {
    // Старый кэш без владельца нельзя показывать новому ограниченному пользователю.
    await clearProtectedLocalStores();
  }

  localStorage.setItem(
    DATA_OWNER_KEY,
    employeeId,
  );
}

async function pruneLocalDataToVisibleTrts() {
  const visibleIds = new Set(
    (await getAll(STORE_TRTS))
      .map(item => String(item.id))
  );

  for (const storeName of [
    STORE_VISITS,
    STORE_TASKS,
    STORE_MEDIA,
  ]) {
    const items = await getAll(storeName);
    for (const item of items) {
      const pointId = String(
        item.trtId || ''
      );
      if (
        !pointId
        || !visibleIds.has(pointId)
      ) {
        await deleteItem(
          storeName,
          item.id,
        );
      }
    }
  }
}

async function syncTrtsWithServer({
  silent=true,
}={}) {
  if (
    !sessionToken
    || authOffline
    || navigator.onLine === false
  ) {
    return {
      ok:false,
      offline:true,
      downloaded:0,
    };
  }

  try {
    const payload = await apiRequest(
      '/trt-map-data',
      {
        method:'GET',
        timeout:30000,
      },
    );

    const points = Array.isArray(
      payload.points
    ) ? payload.points : [];

    await replaceTrts(points);
    await pruneLocalDataToVisibleTrts();

    if (!silent) {
      showToast(
        `Доступно ТРТ: ${points.length}`
      );
    }

    return {
      ok:true,
      downloaded:points.length,
      access:payload.access || null,
    };
  } catch (error) {
    console.warn(
      'Не удалось обновить доступные ТРТ',
      error,
    );
    if (!silent) {
      showToast(
        'Не удалось обновить список ТРТ'
      );
    }
    return {
      ok:false,
      offline:Boolean(
        error.isNetworkError
      ),
      error,
      downloaded:0,
    };
  }
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
  const normalized = normalizedVisitResults(visit);
  return {
    id:String(visit.id || ''),
    trtId:String(visit.trtId || ''),
    createdAt:visit.createdAt || new Date().toISOString(),
    updatedAt:visit.updatedAt || null,
    result:visitResultSummary(visit),
    results:normalized.items,
    otherResult:normalized.other,
    nextStep:String(visit.nextStep || ''),
    comment:String(visit.comment || ''),
    fourP:normalizeFourPAssessment(visit.fourP),
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
    if (notify) {
      const message = String(error?.message || '');
      if (message.includes('Исправления невозможны')) showToast('Исправления невозможны. Создайте новый визит');
      else showToast('Визит сохранён на устройстве. Отправка на сервер повторится автоматически.');
    }
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

    const currentLocal = await getAll(STORE_VISITS);
    const localById = new Map(currentLocal.map(item => [String(item.id), item]));
    const remoteIds = new Set(remoteVisits.map(item => String(item.id)));
    const merged = remoteVisits.map(item => ({
      ...(localById.get(String(item.id)) || {}),
      ...item,
      serverSyncedAt:syncedAt
    }));

    if (merged.length) await putItems(STORE_VISITS, merged);

    for (const local of currentLocal) {
      if (local.serverSyncedAt && !remoteIds.has(String(local.id))) {
        await deleteItem(STORE_VISITS, local.id);
      }
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

    const remoteIds = new Set(remoteItems.map(item => String(item.id)));
    for (const local of currentLocal) {
      if (local.serverSyncedAt && !remoteIds.has(String(local.id))) {
        await deleteItem(STORE_MEDIA, local.id);
      }
    }

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
  const trtsResult = await syncTrtsWithServer({silent:true});
  const visitsResult = await syncVisitsWithServer({silent:true});
  const tasksResult = await syncTasksWithServer({silent:true});
  const mediaResult = await syncMediaWithServer({silent:true});

  if (!silent) {
    if (trtsResult.ok && visitsResult.ok && tasksResult.ok && mediaResult.ok) {
      showToast('Данные синхронизированы');
    } else {
      showToast('Часть данных осталась на устройстве. Синхронизация повторится автоматически.');
    }
  }

  return {
    trts:trtsResult,
    visits:visitsResult,
    tasks:tasksResult,
    media:mediaResult,
  };
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
  const ratingVisit = latestFourPVisitForTrt(trt.id);
  const rating = normalizeFourPAssessment(ratingVisit?.fourP)?.totalScore;
  return `
    <button class="trt-item trt-journal-card" type="button" data-trt-id="${escapeHtml(trt.id)}">
      <div class="trt-item-top">
        <div class="trt-item-name">${escapeHtml(trt.client || trt.holding || 'ТРТ')}</div>
        <span class="marker-dot" style="background:${colorForSize(trt.size)};flex:0 0 auto;"></span>
      </div>
      <div class="trt-item-address">${escapeHtml(trt.address || 'Адрес не указан')}</div>
      <div class="trt-journal-footer">
        <div class="trt-journal-manager">${escapeHtml(shortPersonName(trt.manager) || 'Менеджер не указан')}</div>
        <div class="trt-journal-rating" aria-label="Рейтинг ТРТ ${fourPFormatScore(rating)}">
          <b>${fourPFormatScore(rating)}</b>
        </div>
      </div>
    </button>
  `;
}

function renderPoints() {
  const query = normalizeText($('points-search').value);
  const filter = $('points-filter').value;
  let rows = trts.filter(trt => {
    const text = journalSearchText(trt);
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
  const manager = shortPersonName(trt?.manager || task.assignee || '');
  return `
    <button class="task-card task-journal-card ${task.status === 'done' ? 'status-done' : ''}" type="button" data-task-open="${escapeHtml(task.id)}">
      <div class="task-journal-head">
        <div class="task-journal-point">${escapeHtml(trt?.client || trt?.holding || 'ТРТ')}</div>
        <div class="task-journal-side">
          <span class="meta-chip ${priorityClass(task.priority)}">${escapeHtml(task.priority || 'Средний')}</span>
          <span class="task-journal-due ${isOverdue(task) ? 'overdue' : ''}">${escapeHtml(formatDate(task.dueDate))}</span>
        </div>
      </div>
      <div class="task-journal-title">${escapeHtml(task.title || 'Задача')}</div>
      <div class="task-journal-manager">${escapeHtml(manager || 'Менеджер не указан')}</div>
    </button>
  `;
}


function pointCardHeaderElement() {
  const overlay = $('detail-overlay');
  const title = $('detail-title');
  const back = $('detail-close');
  const locationButton = $('detail-location');
  if (!overlay || !title || !back) return null;

  let node = title.parentElement;
  while (node && node !== overlay) {
    if (
      node.contains(back) &&
      node.contains(title) &&
      (!locationButton || node.contains(locationButton))
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function relatedTrtIdForCard(prefix) {
  if (prefix === 'task') {
    return tasks.find(item => String(item.id) === String(selectedTaskId))?.trtId || null;
  }
  if (prefix === 'visit') return selectedTrtId || null;
  return null;
}

function openRelatedTrtOnMap(prefix, closeCard) {
  const trtId = relatedTrtIdForCard(prefix);
  const trt = trts.find(item => String(item.id) === String(trtId));
  if (!trt) return;

  if (typeof closeCard === 'function') closeCard();
  switchScreen('map');

  if (map) {
    setTimeout(() => {
      map.invalidateSize();
      map.setView([trt.lat, trt.lon], 16);
    }, 60);
  } else {
    showToast('Карта сейчас недоступна');
  }
}

function createFallbackMatchingHeader(prefix) {
  const header = document.createElement('div');
  header.className = 'shared-fullscreen-card-header shared-fullscreen-card-header-fallback';
  header.innerHTML = `
    <button id="${prefix}-header-back" class="shared-card-header-button" type="button" aria-label="Назад">←</button>
    <div class="shared-card-header-copy">
      <div id="${prefix === 'task' ? 'task-detail-title' : 'visit-modal-title'}" class="shared-card-header-title"></div>
      <div id="${prefix}-header-subtitle" class="shared-card-header-subtitle"></div>
    </div>
    <button id="${prefix}-header-location" class="shared-card-header-button" type="button" aria-label="Показать на карте">⌖</button>`;
  return header;
}

function mountMatchingCardHeader(prefix, host, closeCard) {
  if (!host) return null;

  const source = pointCardHeaderElement();
  const header = source
    ? source.cloneNode(true)
    : createFallbackMatchingHeader(prefix);

  header.classList.add('shared-fullscreen-card-header');
  header.id = `${prefix}-shared-card-header`;

  if (source) {
    const originalIds = Array.from(header.querySelectorAll('[id]'));
    originalIds.forEach(element => {
      const oldId = element.id;
      if (oldId === 'detail-close') element.id = `${prefix}-header-back`;
      else if (oldId === 'detail-title') {
        element.id = prefix === 'task' ? 'task-detail-title' : 'visit-modal-title';
      }
      else if (oldId === 'detail-address') element.id = `${prefix}-header-subtitle`;
      else if (oldId === 'detail-location') element.id = `${prefix}-header-location`;
      else element.id = `${prefix}-${oldId}`;
    });
  }

  host.replaceChildren(header);

  $(`${prefix}-header-back`)?.addEventListener('click', closeCard);
  $(`${prefix}-header-location`)?.addEventListener('click', () => {
    openRelatedTrtOnMap(prefix, closeCard);
  });

  return header;
}

function updateMatchingCardHeader(prefix, titleText, subtitleText, hasTrt=true) {
  const title = prefix === 'task' ? $('task-detail-title') : $('visit-modal-title');
  const subtitle = $(`${prefix}-header-subtitle`);
  const locationButton = $(`${prefix}-header-location`);

  if (title) title.textContent = titleText || (prefix === 'task' ? 'Задача' : 'Визит');
  if (subtitle) subtitle.textContent = subtitleText || '';
  if (locationButton) locationButton.hidden = !hasTrt;
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
        <div id="task-detail-header-host"></div>
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
        <div class="modal-actions task-detail-actions">
          <button id="task-detail-close-button" class="secondary-button" type="button">Закрыть</button>
          <button id="task-detail-open-trt-button" class="secondary-button" type="button">Открыть ТРТ</button>
          <button id="complete-task-button" class="primary-button" type="button">Выполнить</button>
        </div>
      </div>
    </div>
  `);

  mountMatchingCardHeader('task', $('task-detail-header-host'), closeTaskDetails);
  $('task-detail-close-button').addEventListener('click', closeTaskDetails);
  $('task-detail-open-trt-button').addEventListener('click', () => {
    const task = tasks.find(item => String(item.id) === String(selectedTaskId));
    if (!task?.trtId) return;
    closeTaskDetails();
    openTrt(task.trtId);
  });
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
  updateMatchingCardHeader(
    'task',
    task.title || 'Задача',
    [trt?.client || trt?.holding || 'ТРТ', trt?.address || ''].filter(Boolean).join(' · '),
    Boolean(trt)
  );
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
  const openTrtButton = $('task-detail-open-trt-button');
  if (openTrtButton) openTrtButton.hidden = !trt;
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
  container.querySelectorAll('[data-task-open]').forEach(card => {
    card.addEventListener('click', () => {
      const task = tasks.find(item => String(item.id) === String(card.dataset.taskOpen));
      const mode = task && canCurrentUserCompleteTask(task) ? 'complete' : 'view';
      openTaskDetails(card.dataset.taskOpen, mode);
    });
  });
}

function renderTasks() {
  const query = normalizeText($('tasks-search').value);
  const filter = $('tasks-filter').value;
  let rows = tasks.filter(task => {
    const trt = trts.find(item => item.id === task.trtId);
    const text = journalSearchText(task, trt);
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
  $('topbar-subtitle').textContent = trts.length ? `${trts.length} ТРТ · ${tasks.filter(t => t.status !== 'done').length} открытых задач` : 'VOG Мобильный помощник';
  updateAccountUi();
}

function renderAll() {
  renderMap();
  renderPoints();
  renderTasks();
  renderVisitJournal();
  renderStats();
  if (selectedTrtId) {
    renderSelectedTrt();
    renderSales();
    renderVisits();
    renderMedia();
    renderPointTasks();
  }
}

function shortPersonName(value) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).join(' ');
}

function replaceTrtInfoLabel(root, oldText, newText) {
  if (!root) return;
  root.querySelectorAll('label,span,dt,div').forEach(element => {
    if (element.children.length) return;
    if (String(element.textContent || '').trim().toLowerCase() === oldText.toLowerCase()) {
      element.textContent = newText;
    }
  });
}

function configureTrtInfoUi() {
  const tab = $('tab-info');
  if (!tab) return;

  tab.querySelectorAll('h2,h3,.card-title').forEach(element => {
    const title = String(element.textContent || '').trim().toLowerCase();
    if (title === 'общая информация' || title === 'дополнительная информация' || title === 'карточка трт') {
      element.hidden = true;
    }
  });

  ['detail-direction','detail-manager','detail-size'].forEach(id => {
    const value = $(id);
    if (!value) return;
    value.classList.add('trt-primary-value');
    value.parentElement?.classList.add('trt-primary-field');
  });

  const formatValue = $('detail-format');
  const formatBox = formatValue?.closest('.info-box');
  if (formatBox) formatBox.remove();

  const summaryCard = $('detail-direction')?.closest('.card');
  if (summaryCard) {
    summaryCard.classList.add('trt-summary-card');
    const grid = summaryCard.querySelector('.detail-grid');
    if (grid) grid.classList.add('trt-info-grid');
  }

  const salesValue = $('detail-size');
  const salesBox = salesValue?.closest('.info-box');
  if (salesBox) {
    const salesLabel = salesBox.querySelector('.info-label');
    if (salesLabel) salesLabel.textContent = 'ПРОДАЖИ / МЕС.';
    salesBox.classList.add('trt-sales-button');
    salesBox.setAttribute('role', 'button');
    salesBox.setAttribute('tabindex', '0');
    salesBox.setAttribute('aria-label', 'Открыть график продаж');
    if (!salesBox.querySelector('.trt-sales-chart-icon')) {
      const icon = document.createElement('span');
      icon.className = 'trt-sales-chart-icon';
      icon.innerHTML = '<svg viewBox="0 0 28 28" aria-hidden="true"><rect x="3" y="14" width="5" height="10" rx="1.5"/><rect x="11.5" y="8" width="5" height="16" rx="1.5"/><rect x="20" y="3" width="5" height="21" rx="1.5"/></svg>';
      salesBox.appendChild(icon);
    }
    if (!salesBox.querySelector('.trt-sales-chevron')) {
      const chevron = document.createElement('span');
      chevron.className = 'trt-sales-chevron';
      chevron.setAttribute('aria-hidden', 'true');
      chevron.innerHTML = '<svg viewBox="0 0 72 24" focusable="false" aria-hidden="true"><path d="M4 7 L36 16 L68 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      salesBox.appendChild(chevron);
    }
    if (!salesBox.nextElementSibling?.classList.contains('trt-sales-expanded')) {
      const expanded = document.createElement('div');
      expanded.className = 'trt-sales-expanded';
      expanded.hidden = true;
      expanded.innerHTML = '<div id="trt-sales-inline-chart"></div>';
      salesBox.insertAdjacentElement('afterend', expanded);
    }
    if (salesBox.dataset.boundSales !== '1') {
      salesBox.dataset.boundSales = '1';
      const toggleSales = () => {
        const expanded = salesBox.nextElementSibling?.classList.contains('trt-sales-expanded')
          ? salesBox.nextElementSibling
          : null;
        if (!expanded) return;
        const willOpen = expanded.hidden;
        expanded.hidden = !willOpen;
        salesBox.classList.toggle('open', willOpen);
        salesBox.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        if (willOpen) renderInlineSalesChart();
      };
      salesBox.setAttribute('aria-expanded', 'false');
      salesBox.addEventListener('click', toggleSales);
      salesBox.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleSales();
        }
      });
    }
  }

  const customIds = [
    'edit-contact','edit-phone','edit-actual-size','edit-stands',
    'edit-potential','edit-brands','edit-notes'
  ];
  customIds.forEach(id => {
    const field = $(id);
    const group = field?.closest('.field-group');
    if (group) group.hidden = true;
    else if (field) field.hidden = true;
  });

  const saveButton = $('save-trt-button');
  if (saveButton) {
    const customCard = saveButton.closest('.card');
    if (customCard && !customCard.querySelector('#detail-direction')) customCard.hidden = true;
    else saveButton.hidden = true;
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

  dataButton.remove();
  visitButton.textContent = 'Визит';
  taskButton.textContent = 'Задача';
  visitButton.setAttribute('aria-label', 'Зафиксировать визит в ТРТ');
  taskButton.setAttribute('aria-label', 'Поставить задачу по ТРТ');

  actions.classList.add('trt-work-actions');
  actions.append(visitButton, taskButton);

  if (!$('trt-actions-label')) {
    const actionLabel = document.createElement('div');
    actionLabel.id = 'trt-actions-label';
    actionLabel.className = 'trt-section-label';
    actionLabel.textContent = 'Действие в ТРТ';
    actions.insertAdjacentElement('beforebegin', actionLabel);
  }

  let archiveLabel = $('trt-archive-label');
  if (!archiveLabel) {
    archiveLabel = document.createElement('div');
    archiveLabel.id = 'trt-archive-label';
    archiveLabel.className = 'trt-section-label trt-archive-label';
    archiveLabel.textContent = 'Архив';
    tabs.insertAdjacentElement('beforebegin', archiveLabel);
  }

  const infoTab = tabs.querySelector('[data-tab="info"]');
  const salesTab = tabs.querySelector('[data-tab="sales"]');
  const visitsTab = tabs.querySelector('[data-tab="visits"]');
  const tasksTab = tabs.querySelector('[data-tab="tasks"]');
  const mediaTab = tabs.querySelector('[data-tab="media"]');

  if (infoTab) infoTab.remove();
  if (salesTab) salesTab.remove();
  if (visitsTab) visitsTab.textContent = 'Визиты';
  if (tasksTab) tasksTab.textContent = 'Задачи';

  let photoTab = mediaTab;
  if (photoTab) {
    photoTab.dataset.tab = 'photos';
    photoTab.textContent = 'Фото';
    photoTab.setAttribute('aria-label', 'Фотографии ТРТ');
  }

  let videoTab = tabs.querySelector('[data-tab="videos"]');
  if (!videoTab && photoTab) {
    videoTab = photoTab.cloneNode(true);
    videoTab.dataset.tab = 'videos';
    videoTab.textContent = 'Видео';
    videoTab.setAttribute('aria-label', 'Видео ТРТ');
  }

  tabs.classList.add('trt-archive-tabs');
  [visitsTab, tasksTab, photoTab, videoTab].forEach(tab => {
    if (tab) tabs.appendChild(tab);
  });

  if (videoTab && !videoTab.dataset.boundTab) {
    videoTab.dataset.boundTab = '1';
    videoTab.addEventListener('click', () => setDetailTab('videos'));
  }

  configureTrtInfoUi();
  ensureFourPVisitUi();
  ensureFourPTrtCardUi();
  enforceTrtCardLayoutV35();

  const version = document.querySelector('.topbar-title span');
  if (version) version.textContent = 'v3.8';
}


function enforceTrtCardLayoutV35() {
  const body = document.querySelector('#detail-overlay .detail-body');
  const summary = document.querySelector('#detail-overlay .trt-summary-card');
  const rating = document.querySelector('#detail-overlay .fourp-trt-card');
  const sales = document.querySelector('#detail-overlay .trt-sales-button');
  const salesExpanded = document.querySelector('#detail-overlay .trt-sales-expanded');
  const actionLabel = document.querySelector('#detail-overlay #trt-actions-label');
  const actions = document.querySelector('#detail-overlay .trt-work-actions');
  const archiveLabel = document.querySelector('#detail-overlay #trt-archive-label');
  const archiveTabs = document.querySelector('#detail-overlay .trt-archive-tabs');
  if (!body || !summary || !rating || !sales || !actionLabel || !actions || !archiveLabel || !archiveTabs) return;

  [summary, rating, sales, salesExpanded, actionLabel, actions, archiveLabel, archiveTabs]
    .filter(Boolean)
    .forEach(node => body.appendChild(node));

  body.classList.add('trt-layout-v35');
}

function switchScreen(name) {
  document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
  document.querySelectorAll('.nav-button').forEach(button => button.classList.toggle('active', button.dataset.screen === name));
  const screen = $('screen-' + name);
  if (!screen) return;
  screen.classList.add('active');
  if (name === 'map' && map) setTimeout(() => map.invalidateSize(), 40);
  if (name === 'visits-journal') renderVisitJournal();
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

  configureTrtInfoUi();
  $('detail-title').textContent = trt.client || trt.holding || 'ТРТ';
  $('detail-address').textContent = trt.address || '';
  $('detail-direction').textContent = trt.direction || '—';
  $('detail-manager').textContent = shortPersonName(trt.manager) || '—';
  const statusPlaceholder = $('trt-status-placeholder');
  if (statusPlaceholder) statusPlaceholder.textContent = 'АКБ';
  const salesValue = $('detail-size');
  if (salesValue) {
    salesValue.classList.add('trt-sales-value');
    salesValue.parentElement?.classList.add('trt-sales-field');
    if (Number.isFinite(Number(trt.size))) {
      salesValue.innerHTML = `
        <span class="trt-sales-number">${Math.round(Number(trt.size)).toLocaleString('ru-RU')}</span>
        ${trt.unit ? `<span class="trt-sales-unit">${escapeHtml(trt.unit)}</span>` : ''}`;
    } else {
      salesValue.textContent = '—';
    }
  }

  renderFourPTrtCard();
}

async function saveSelectedTrt() {
  const trt = selectedTrt();
  if (!trt) return;
  trt.custom = {
    ...(trt.custom || {}),
    contact:$('edit-contact')?.value.trim() || '',
    phone:$('edit-phone')?.value.trim() || '',
    actualSize:$('edit-actual-size')?.value === '' || !$('edit-actual-size') ? null : Math.round(Number($('edit-actual-size').value)),
    stands:$('edit-stands')?.value === '' || !$('edit-stands') ? null : Math.round(Number($('edit-stands').value)),
    potential:$('edit-potential')?.value || '',
    brands:$('edit-brands')?.value.trim() || '',
    notes:$('edit-notes')?.value.trim() || '',
    updatedAt:new Date().toISOString()
  };
  await putItem(STORE_TRTS, trt);
  await refreshData();
  showToast('Карточка ТРТ сохранена');
}

function setDetailTab(name) {
  const mediaName = name === 'media' ? 'photos' : name;
  document.querySelectorAll('.tab-button').forEach(button => button.classList.toggle('active', button.dataset.tab === mediaName));
  document.querySelectorAll('.tab-panel').forEach(panel => {
    const expected = (mediaName === 'photos' || mediaName === 'videos') ? 'tab-media' : `tab-${mediaName}`;
    panel.classList.toggle('active', panel.id === expected);
  });
  if (mediaName === 'sales') renderSales();
  if (mediaName === 'visits') renderVisits();
  if (mediaName === 'photos') renderMedia('photo');
  if (mediaName === 'videos') renderMedia('video');
  if (mediaName === 'tasks') renderPointTasks();
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

function renderInlineSalesChart() {
  const trt = selectedTrt();
  const container = $('trt-sales-inline-chart');
  if (!trt || !container) return;

  if (!hasSales(trt)) {
    container.innerHTML = '<div class="empty-state trt-inline-sales-empty"><h3>Продажи не загружены</h3></div>';
    return;
  }

  const unit = trt.unit || '';
  const values25 = SALES_MONTHS.map((_, index) => salesNumber(salesArray(trt, 2025)[index]));
  const values26 = SALES_MONTHS.map((_, index) => salesNumber(salesArray(trt, 2026)[index]));
  container.innerHTML = `
    <div class="sales-card-head trt-inline-sales-head">
      <div class="sales-legend"><span><i class="legend-2025"></i>2025</span><span><i class="legend-2026"></i>2026</span></div>
      <span class="sales-unit">${escapeHtml(unit)}</span>
    </div>
    ${buildSalesChartSvg(values25, values26, unit)}`;
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
      <button class="timeline-item visit-timeline-button" type="button" data-visit-edit="${escapeHtml(item.id)}">
        <div class="timeline-date">${escapeHtml(formatDateTime(item.createdAt))}${item.distanceKm != null ? ` · ${item.distanceKm.toFixed(2)} км от точки` : ''}</div>
        <div class="timeline-title">${escapeHtml(visitResultSummary(item))}</div>
        ${fourPVisitTimelineHtml(item)}
        ${item.comment ? `<div class="timeline-text">${escapeHtml(item.comment)}</div>` : ''}
        <div class="timeline-text"><b>${isVisitEditableToday(item) ? 'Нажмите, чтобы исправить визит сегодня' : 'Визит завершён'}</b></div>
      </button>
    `).join('')
    : '<div class="empty-state" style="margin:0;"><h3>Визитов пока нет</h3><p>Нажмите «Визит» во время посещения точки.</p></div>';

  $('visits-list').querySelectorAll('[data-visit-edit]').forEach(button => {
    button.addEventListener('click', () => openVisitFromJournal(button.dataset.visitEdit));
  });
}

function renderMedia(kind='all') {
  let rows = mediaItems.filter(item => item.trtId === selectedTrtId);
  if (kind === 'photo') rows = rows.filter(item => !String(item.type || '').startsWith('video/'));
  if (kind === 'video') rows = rows.filter(item => String(item.type || '').startsWith('video/'));

  const grid = $('media-grid');
  grid.innerHTML = '';
  if (!rows.length) {
    const title = kind === 'video' ? 'Видео пока нет' : kind === 'photo' ? 'Фотографий пока нет' : 'Материалов нет';
    const hint = kind === 'video' ? 'Добавьте видео этой точки.' : kind === 'photo' ? 'Добавьте фотографии этой точки.' : 'Добавьте фото или видео этой точки.';
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;margin:0;"><h3>${title}</h3><p>${hint}</p></div>`;
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

function openVisitModal(visitId=null, options={}) {
  if (visitId && typeof visitId !== 'string') visitId = null;
  if (saveVisitInProgress) {
    showToast('Предыдущий визит ещё сохраняется');
    return;
  }

  const existing = visitId
    ? visits.find(item => String(item.id) === String(visitId))
    : null;

  const readOnly = Boolean(existing && (options.readOnly || !isVisitEditableToday(existing)));
  visitReadOnlyMode = readOnly;

  if (existing) selectedTrtId = existing.trtId;
  if (!selectedTrtId) return;

  ensureVisitWorkflowUi();
  ensureFourPVisitUi();

  editingVisitId = existing ? String(existing.id) : null;
  visitFiles = [];

  const visitTrt = trts.find(item => String(item.id) === String(selectedTrtId));
  updateMatchingCardHeader(
    'visit',
    readOnly ? 'Просмотр визита' : (existing ? 'Редактирование визита' : 'Новый визит'),
    [visitTrt?.client || visitTrt?.holding || 'ТРТ', visitTrt?.address || ''].filter(Boolean).join(' · '),
    Boolean(visitTrt)
  );

  const saveButton = $('save-visit-button');
  if (saveButton) {
    saveButton.dataset.defaultText = existing ? 'Сохранить изменения' : 'Сохранить визит';
  }
  setVisitSaveBusy(false);

  if (existing) {
    const resultData = normalizedVisitResults(existing);
    setVisitResultSelection(resultData.items, resultData.other);
    if ($('visit-next-step')) $('visit-next-step').value = '';
    $('visit-comment').value = existing.comment || '';
    populateFourPVisitForm(existing.fourP);

    const existingFiles = mediaItems.filter(item => String(item.visitId) === String(existing.id)).length;
    $('visit-files-note').textContent = existingFiles
      ? `Существующие файлы: ${existingFiles}. Можно добавить новые.`
      : 'Можно добавить фото или видео';
  } else {
    setVisitResultSelection([], '');
    if ($('visit-next-step')) $('visit-next-step').value = '';
    $('visit-comment').value = '';
    const previousRatingVisit = latestFourPVisitForTrt(selectedTrtId);
    if (previousRatingVisit) {
      populateFourPVisitForm(previousRatingVisit.fourP);
      showToast('Рейтинг подтянут из прошлого визита — все поля можно изменить');
    } else {
      resetFourPVisitForm();
    }
    $('visit-files-note').textContent = 'Файлы не выбраны';
  }

  $('visit-photo-input').value = '';
  $('visit-video-input').value = '';

  let notice = $('visit-edit-notice');
  if (existing && !notice) {
    notice = document.createElement('div');
    notice.id = 'visit-edit-notice';
    notice.className = 'visit-edit-notice';
    const firstGroup = $('visit-result-trigger')?.closest('.field-group');
    firstGroup?.insertAdjacentElement('beforebegin', notice);
  }
  if (notice) {
    notice.hidden = !existing || !readOnly;
    notice.textContent = 'Исправления невозможны. Создайте новый визит';
    notice.classList.toggle('readonly', readOnly);
  }

  setVisitModalReadOnly(readOnly);
  openModal('visit-modal');
}


function setVisitModalReadOnly(readOnly) {
  const modal = $('visit-modal');
  if (!modal) return;

  modal.classList.toggle('visit-readonly', Boolean(readOnly));
  modal.querySelectorAll('input, textarea, select, button').forEach(element => {
    if (!Object.prototype.hasOwnProperty.call(element.dataset, 'originalDisabled')) {
      element.dataset.originalDisabled = element.disabled ? '1' : '0';
    }
    const isClose = element.classList.contains('modal-cancel') || element.id === 'visit-header-back' || element.id === 'visit-header-location';
    element.disabled = readOnly ? !isClose : element.dataset.originalDisabled === '1';
  });

  ['save-visit-button','visit-photo-button','visit-video-button'].forEach(id => {
    const element = $(id);
    if (element) element.hidden = Boolean(readOnly);
  });
  const note = $('visit-files-note');
  if (note) note.hidden = Boolean(readOnly);
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
  if (visitReadOnlyMode) {
    showToast('Исправления невозможны. Создайте новый визит');
    return;
  }
  if (saveVisitInProgress) return;

  const trt = selectedTrt();
  if (!trt) return;

  const resultData = collectVisitResults();
  if (!resultData) return;

  const fourP = collectRequiredFourPAssessment();
  if (!fourP) return;

  const existing = editingVisitId
    ? visits.find(item => String(item.id) === String(editingVisitId))
    : null;

  if (existing && !isVisitEditableToday(existing)) {
    alert('Исправления невозможны. Создайте новый визит');
    return;
  }

  saveVisitInProgress = true;
  setVisitSaveBusy(true);

  const files = [...visitFiles];
  visitFiles = [];
  const isEditing = Boolean(existing);
  const locationPromise = isEditing
    ? Promise.resolve(null)
    : geolocate().catch(() => null);

  const visit = isEditing
    ? {
        ...existing,
        trtId:trt.id,
        result:resultData.result,
        results:resultData.items,
        otherResult:resultData.otherResult,
        nextStep:'',
        comment:$('visit-comment').value.trim(),
        fourP,
        updatedAt:new Date().toISOString(),
        serverSyncedAt:null,
      }
    : {
        id:uuid(),
        trtId:trt.id,
        createdAt:new Date().toISOString(),
        updatedAt:new Date().toISOString(),
        result:resultData.result,
        results:resultData.items,
        otherResult:resultData.otherResult,
        nextStep:'',
        comment:$('visit-comment').value.trim(),
        fourP,
        latitude:null,
        longitude:null,
        accuracy:null,
        distanceKm:null
      };

  closeModals();

  try {
    await putItem(STORE_VISITS, visit);
    await refreshData();
    setDetailTab('visits');
    showToast(isEditing ? 'Изменения визита сохранены' : 'Визит сохранён на устройстве');
  } catch (error) {
    console.error('Не удалось сохранить визит', error);
    showToast('Не удалось сохранить визит на устройстве');
    return;
  } finally {
    saveVisitInProgress = false;
    setVisitSaveBusy(false);
    editingVisitId = null;
  }

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
    setDetailTab(Array.from(files).some(file => String(file.type || '').startsWith('video/')) ? 'videos' : 'photos');
    showToast('Материалы сохранены');
    syncMediaWithServer({silent:false});
  } catch (error) {
    console.error(error);
    showToast('Не удалось сохранить файл. Возможно, закончилась память браузера.');
  }
}

async function importMobileJson(file) {
  if (String(currentUser?.role || '').toUpperCase() !== 'GD') {
    throw new Error('Импорт справочника доступен только генеральному директору.');
  }
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
  if (String(currentUser?.role || '').toUpperCase() !== 'GD') {
    throw new Error('Восстановление общей копии доступно только генеральному директору.');
  }
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
  ensureVisitWorkflowUi();

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
  $('start-visit-button').addEventListener('click', () => openVisitModal());
  $('new-task-button').addEventListener('click', openTaskModal);
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


function applyUnifiedJournalSearchPlaceholders() {
  ['points-search', 'tasks-search', 'visits-journal-search'].forEach(id => {
    const input = $(id);
    if (input) input.placeholder = 'Поиск по всем полям';
  });
}

function ensureJournalAndAuthUi() {
  if (document.body.dataset.journalAuthUi === '1') return;
  document.body.dataset.journalAuthUi = '1';

  const style = document.createElement('style');
  style.id = 'journal-auth-ui-style';
  style.textContent = `
    #auth-bootstrap-screen{position:fixed;inset:0;z-index:12000;background:#f5f7fa;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;color:#355a93}
    #auth-bootstrap-screen.hidden{display:none}
    .auth-bootstrap-spinner{width:34px;height:34px;border:4px solid #d9eadf;border-top-color:#355a93;border-radius:50%;animation:authBootstrapSpin .8s linear infinite}
    .auth-bootstrap-title{font-size:16px;font-weight:850}
    @keyframes authBootstrapSpin{to{transform:rotate(360deg)}}

    #points-search,#tasks-search,#visits-journal-search,
    input[type="search"]{
      min-height:50px!important;
      border:0!important;
      border-radius:18px!important;
      background-color:#f0f1f3!important;
      background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='10.5' cy='10.5' r='6.5' fill='none' stroke='%232f3338' stroke-width='2.2'/%3E%3Cpath d='M15.5 15.5 21 21' fill='none' stroke='%232f3338' stroke-width='2.2' stroke-linecap='round'/%3E%3C/svg%3E")!important;
      background-repeat:no-repeat!important;
      background-position:16px center!important;
      background-size:23px 23px!important;
      padding-left:49px!important;
      padding-right:16px!important;
      font-size:16px!important;
      color:#17202a!important;
      box-shadow:none!important;
    }
    #points-search::placeholder,#tasks-search::placeholder,#visits-journal-search::placeholder,
    input[type="search"]::placeholder{color:#8c9098!important;opacity:1}

    .trt-journal-card{padding:15px!important;border-radius:16px!important}
    .trt-journal-card .trt-item-name{font-size:17px!important;line-height:1.3!important;font-weight:850!important}
    .trt-journal-card .trt-item-address{font-size:13px!important;line-height:1.4!important;margin-top:5px!important}
    .trt-journal-footer{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-top:13px}
    .trt-journal-manager{font-size:15px;font-weight:800;color:#344054;line-height:1.3}
    .trt-journal-rating{margin-left:auto;display:flex;align-items:center;color:#344054;white-space:nowrap}
    .trt-journal-rating b{font-size:18px;font-weight:900}

    .task-journal-card{display:block!important;width:100%!important;border:1px solid #e4e7ec!important;border-radius:16px!important;padding:15px!important;background:#fff!important;color:#17202a!important;text-align:left!important;box-shadow:0 1px 2px rgba(16,24,40,.05)!important}
    .task-journal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
    .task-journal-point{font-size:17px;font-weight:850;line-height:1.3;min-width:0}
    .task-journal-side{display:flex;flex-direction:column;align-items:flex-end;gap:7px;flex:0 0 auto}
    .task-journal-side .meta-chip{font-size:11px!important}
    .task-journal-due{font-size:13px;font-weight:800;color:#475467;white-space:nowrap}
    .task-journal-due.overdue{color:#b42318}
    .task-journal-title{margin-top:10px;font-size:15px;font-weight:800;line-height:1.35}
    .task-journal-manager{margin-top:10px;font-size:14px;font-weight:750;color:#667085}
    .task-detail-actions{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:8px!important}
    .task-detail-actions button{min-width:0!important;padding-left:6px!important;padding-right:6px!important}
    .shared-fullscreen-card-header{width:100%;box-sizing:border-box}
    .shared-fullscreen-card-header-fallback{display:grid;grid-template-columns:44px minmax(0,1fr) 44px;gap:8px;align-items:center;padding:2px 0 13px;border-bottom:1px solid #eaecf0;margin-bottom:14px}
    .shared-card-header-button{width:42px;height:42px;border:0;border-radius:12px;background:#f2f4f7;color:#355a93;font-size:24px;font-weight:900}
    .shared-card-header-copy{min-width:0;text-align:left}
    .shared-card-header-title{font-size:19px;font-weight:900;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .shared-card-header-subtitle{margin-top:3px;color:#667085;font-size:12px;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

    .visit-journal-list{gap:12px!important}
    .visit-journal-card{padding:15px!important;border-radius:16px!important}
    .visit-journal-head strong{font-size:17px!important;line-height:1.3!important}
    .visit-journal-head span{font-size:13px!important;margin-top:5px!important}
    .visit-journal-result{font-size:15px!important;line-height:1.4!important;font-weight:800!important}
    .visit-journal-comment{font-size:14px!important;line-height:1.45!important}
    .visit-journal-rating b{font-size:16px!important}
    .visit-journal-rating .fourp-star{font-size:16px!important}

    #task-detail-modal,#visit-modal{display:flex!important;visibility:hidden;opacity:0;pointer-events:none;align-items:stretch!important;justify-content:flex-start!important;padding:0!important;background:rgba(15,23,42,.25)!important;transition:opacity .2s ease,visibility .2s ease}
    #task-detail-modal.open,#visit-modal.open{visibility:visible;opacity:1;pointer-events:auto}
    #task-detail-modal .modal-sheet,#visit-modal .modal-sheet{
      width:100vw!important;
      max-width:none!important;
      height:100dvh!important;
      max-height:none!important;
      margin:0!important;
      border-radius:0!important;
      overflow:auto!important;
      padding:calc(14px + env(safe-area-inset-top)) 16px calc(22px + env(safe-area-inset-bottom))!important;
      box-sizing:border-box!important;
      transform:translateX(-100%);
      transition:transform .3s cubic-bezier(.22,.61,.36,1);
      box-shadow:none!important;
      will-change:transform;
    }
    #task-detail-modal.open .modal-sheet,#visit-modal.open .modal-sheet{transform:translateX(0)}
    #task-detail-modal .modal-handle,#visit-modal .modal-handle{display:none!important}
    #visit-modal.visit-readonly textarea,#visit-modal.visit-readonly input,#visit-modal.visit-readonly select{background:#f5f7fa!important;color:#344054!important;opacity:1!important}
    .visit-edit-notice.readonly{background:#fff1f0!important;color:#b42318!important}
  `;
  document.head.appendChild(style);

  let bootstrap = $('auth-bootstrap-screen');
  if (!bootstrap) {
    bootstrap = document.createElement('div');
    bootstrap.id = 'auth-bootstrap-screen';
    bootstrap.innerHTML = '<div class="auth-bootstrap-spinner"></div><div class="auth-bootstrap-title">VOG Мобильный помощник</div>';
    document.body.appendChild(bootstrap);
  }
  $('auth-screen')?.classList.add('hidden');
  document.querySelector('.app-shell')?.classList.add('hidden');
}

function hideAuthBootstrap() {
  $('auth-bootstrap-screen')?.classList.add('hidden');
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

document.addEventListener('DOMContentLoaded', () => {
  applyProductBranding();
  ensureJournalAndAuthUi();
  init();
});
