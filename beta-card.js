'use strict';

// VOG Мобильный помощник Beta 0.3
// Exact TRT card + sales/plan layer. Loaded after beta-overrides.js.

const BETA_CARD_VERSION = 'beta-0.3-card-sales-plan';
const betaCardOriginalRenderSelectedTrt = renderSelectedTrt;

function betaCardPlan(point) {
  const card = point?._salesPlanCard || point?.salesPlanCard;
  if (!card?.available) return null;
  const plan = (Array.isArray(card.plan) ? card.plan : [])
    .concat(Array(12).fill(null))
    .slice(0, 12);
  const hasValues = plan.some(raw => {
    if (raw === null || raw === undefined || raw === '') return false;
    return Number.isFinite(Number(raw));
  });
  return hasValues ? {...card, plan} : null;
}

function betaCardSeriesAverage(series, preferredYear=new Date().getFullYear()) {
  const source = series && typeof series === 'object' ? series : {};
  const years = Object.keys(source).map(Number).filter(Number.isFinite).sort((a,b) => a-b);
  if (!years.length) return null;
  const year = Array.isArray(source[String(preferredYear)]) ? preferredYear : years[years.length - 1];
  const values = (Array.isArray(source[String(year)]) ? source[String(year)] : [])
    .slice(0, 12)
    .map(raw => raw === null || raw === undefined || raw === '' ? null : Number(raw))
    .filter(Number.isFinite);
  if (!values.length) return null;
  return {
    year,
    months: values.length,
    value: values.reduce((sum, value) => sum + value, 0) / values.length,
  };
}

function betaCardFormat(value, unit='') {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${Math.round(number).toLocaleString('ru-RU')}${unit ? ` ${unit}` : ''}`;
}

function betaCardLatestComparableMonth(point) {
  const planCard = betaCardPlan(point);
  if (!planCard) return null;
  const year = Number(planCard.sourceYear || 2026);
  const fact = (Array.isArray(point?.sales?.[String(year)]) ? point.sales[String(year)] : [])
    .concat(Array(12).fill(null)).slice(0, 12);
  let latest = -1;
  for (let index=0; index<12; index += 1) {
    const f = fact[index];
    const p = planCard.plan[index];
    const hasFact = f !== null && f !== undefined && f !== '' && Number.isFinite(Number(f));
    const hasPlan = p !== null && p !== undefined && p !== '' && Number.isFinite(Number(p));
    if (hasFact || hasPlan) latest = index;
  }
  return latest >= 0 ? {year, monthIndex:latest, fact, planCard} : null;
}

function betaCardKpiHtml(point) {
  const comparable = betaCardLatestComparableMonth(point);
  if (!comparable) return '';
  const {year, monthIndex, fact, planCard} = comparable;
  const factRaw = fact[monthIndex];
  const planRaw = planCard.plan[monthIndex];
  const factValue = Number(factRaw);
  const planValue = Number(planRaw);
  const hasFact = factRaw !== null && factRaw !== undefined && factRaw !== '' && Number.isFinite(factValue);
  const hasPlan = planRaw !== null && planRaw !== undefined && planRaw !== '' && Number.isFinite(planValue);
  if (!hasPlan) return '';
  const completion = hasFact && planValue > 0 ? factValue / planValue * 100 : null;
  const month = SALES_MONTHS[monthIndex] || `Месяц ${monthIndex + 1}`;
  const unit = String(point?.unit || planCard.unit || '').trim();
  return `
    <div class="beta-card-kpi">
      <div><span>${escapeHtml(month)} ${year} · факт</span><b>${hasFact ? betaCardFormat(factValue, unit) : '—'}</b></div>
      <div><span>${escapeHtml(month)} ${year} · план</span><b>${betaCardFormat(planValue, unit)}</b></div>
      <div><span>Выполнение</span><b class="${completion == null ? '' : completion >= 100 ? 'good' : 'bad'}">${completion == null ? '—' : `${completion.toFixed(1).replace('.', ',')}%`}</b></div>
    </div>`;
}

function betaCardSalesPlanSvg(values25, values26, planValues) {
  const width = 760;
  const height = 360;
  const margin = {top:22,right:18,bottom:54,left:52};
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const sales25 = SALES_MONTHS.map((_,i) => salesNumber(values25?.[i]));
  const sales26 = SALES_MONTHS.map((_,i) => salesNumber(values26?.[i]));
  const plan = SALES_MONTHS.map((_,i) => {
    const raw = planValues?.[i];
    if (raw === null || raw === undefined || raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  });
  const numeric = [...sales25, ...sales26, ...plan].filter(Number.isFinite);
  const axisMax = niceSalesMax(Math.max(1, ...numeric) * 1.15);
  const groupWidth = chartWidth / SALES_MONTHS.length;
  const barWidth = Math.max(8, Math.min(16, groupWidth * .22));
  const baseY = margin.top + chartHeight;
  const yFor = value => baseY - (Number(value) / axisMax * chartHeight);

  let svg = `<svg class="sales-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" aria-label="Факт продаж и план">`;
  for (let step=0; step<=4; step += 1) {
    const value = axisMax * step / 4;
    const y = yFor(value);
    svg += `<line class="sales-grid-line" x1="${margin.left}" y1="${y}" x2="${width-margin.right}" y2="${y}"></line>`;
    svg += `<text class="sales-axis-label" x="${margin.left-8}" y="${y+4}" text-anchor="end">${Math.round(value).toLocaleString('ru-RU')}</text>`;
  }

  const planPoints = [];
  SALES_MONTHS.forEach((month,index) => {
    const center = margin.left + index * groupWidth + groupWidth / 2;
    const v25 = sales25[index];
    const v26 = sales26[index];
    if (Number.isFinite(v25)) {
      const h = v25 / axisMax * chartHeight;
      svg += `<rect x="${center-barWidth-2}" y="${baseY-h}" width="${barWidth}" height="${Math.max(0,h)}" rx="4" fill="#c9deef"></rect>`;
    }
    if (Number.isFinite(v26)) {
      const h = v26 / axisMax * chartHeight;
      svg += `<rect x="${center+2}" y="${baseY-h}" width="${barWidth}" height="${Math.max(0,h)}" rx="4" fill="#384E86"></rect>`;
    }
    if (Number.isFinite(plan[index])) planPoints.push([center, yFor(plan[index])]);
    svg += `<text class="sales-month-label" x="${center}" y="${baseY+20}" text-anchor="middle">${month}</text>`;
  });

  if (planPoints.length) {
    const path = planPoints.map((point,index) => `${index ? 'L' : 'M'} ${point[0].toFixed(1)} ${point[1].toFixed(1)}`).join(' ');
    svg += `<path d="${path}" fill="none" stroke="#d97706" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>`;
    planPoints.forEach(([x,y]) => {
      svg += `<circle cx="${x}" cy="${y}" r="3.5" fill="#fff" stroke="#d97706" stroke-width="2"></circle>`;
    });
  }
  svg += '</svg>';
  return svg;
}

function betaCardEnsureStyle() {
  if ($('beta-card-style')) return;
  const style = document.createElement('style');
  style.id = 'beta-card-style';
  style.textContent = `
    .beta-card-kpi{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:10px 0 12px}
    .beta-card-kpi>div{min-width:0;padding:9px;border:1px solid #e4e7ec;border-radius:11px;background:#f8fafc}
    .beta-card-kpi span{display:block;color:#667085;font-size:10px;font-weight:700;line-height:1.2}
    .beta-card-kpi b{display:block;margin-top:4px;color:#17202a;font-size:14px;font-weight:900;line-height:1.2;overflow-wrap:anywhere}
    .beta-card-kpi b.good{color:#067647}.beta-card-kpi b.bad{color:#b42318}
    .beta-card-chart-scroll{width:100%;overflow-x:auto;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch}
    .beta-card-chart-scroll svg{display:block;width:100%;min-width:620px;height:auto}
    .beta-card-data-note{margin:7px 0 0;color:#667085;font-size:11px;line-height:1.35}
    @media(max-width:390px){.beta-card-kpi{grid-template-columns:1fr}.beta-card-chart-scroll svg{min-width:560px}}
  `;
  document.head.appendChild(style);
}

renderSelectedTrt = function() {
  betaCardOriginalRenderSelectedTrt();
  betaCardEnsureStyle();
  const point = selectedTrt();
  if (!point) return;

  const title = $('detail-title');
  if (title && typeof betaPointName === 'function') {
    const raw = betaPointName(point);
    title.textContent = stripTrtFormatFromTitle(raw, point.format) || raw;
  }
  const direction = $('detail-direction');
  if (direction && typeof betaDirectionLabel === 'function') {
    direction.textContent = betaDirectionLabel(point.direction) || '—';
  }

  const average = betaCardSeriesAverage(point.sales);
  const salesValue = $('detail-size');
  if (salesValue && average) {
    salesValue.innerHTML = `<span class="trt-sales-number">${Math.round(average.value).toLocaleString('ru-RU')}</span>`;
    const unit = salesValue.parentElement?.querySelector('.trt-sales-unit-label');
    if (unit) unit.textContent = point.unit || '';
  }
};

renderInlineSalesChart = function() {
  betaCardEnsureStyle();
  const point = selectedTrt();
  const container = $('trt-sales-inline-chart');
  if (!point || !container) return;

  const planCard = betaCardPlan(point);
  if (!hasSales(point) && !planCard) {
    container.innerHTML = '<div class="empty-state trt-inline-sales-empty"><h3>Продажи и план не загружены</h3></div>';
    return;
  }

  const unit = String(point.unit || planCard?.unit || '');
  const s25 = SALES_MONTHS.map((_,i) => salesNumber(salesArray(point,2025)[i]));
  const s26 = SALES_MONTHS.map((_,i) => salesNumber(salesArray(point,2026)[i]));
  container.innerHTML = `
    ${betaCardKpiHtml(point)}
    <div class="sales-card-head trt-inline-sales-head">
      <div class="sales-legend"><span><i class="legend-2025"></i>2025</span><span><i class="legend-2026"></i>2026</span>${planCard ? '<span><i style="background:#d97706"></i>План</span>' : ''}</div>
      <span class="sales-unit">${escapeHtml(unit)}</span>
    </div>
    <div class="beta-card-chart-scroll">${betaCardSalesPlanSvg(s25,s26,planCard?.plan || [])}</div>`;
};

renderSales = function() {
  betaCardEnsureStyle();
  const point = selectedTrt();
  const container = $('sales-content');
  if (!point || !container) return;

  const planCard = betaCardPlan(point);
  if (!hasSales(point) && !planCard) {
    container.innerHTML = '<div class="empty-state" style="margin:0;"><h3>Продажи и план не загружены</h3></div>';
    return;
  }

  const unit = String(point.unit || planCard?.unit || '');
  const s25 = SALES_MONTHS.map((_,i) => salesNumber(salesArray(point,2025)[i]));
  const s26 = SALES_MONTHS.map((_,i) => salesNumber(salesArray(point,2026)[i]));
  const months = matchingSalesMonths(point);
  const y25 = salesSum(s25, months);
  const y26 = salesSum(s26, months);
  const yoy = y25 ? ((y26-y25)/y25)*100 : null;
  const planYear = Number(planCard?.sourceYear || 2026);

  const rows = SALES_MONTHS.map((month,index) => {
    const v25 = s25[index];
    const v26 = s26[index];
    const rawPlan = planCard?.plan?.[index];
    const planValue = Number(rawPlan);
    const hasPlan = rawPlan !== null && rawPlan !== undefined && rawPlan !== '' && Number.isFinite(planValue);
    if (v25 == null && v26 == null && !hasPlan) return '';
    return `<tr><td>${month}</td><td class="year-2025">${formatSales(v25,unit)}</td><td class="year-2026">${formatSales(v26,unit)}</td>${planCard ? `<td>${hasPlan ? betaCardFormat(planValue,unit) : '—'}</td>` : ''}</tr>`;
  }).join('');

  container.innerHTML = `
    ${betaCardKpiHtml(point)}
    <div class="sales-summary-grid">
      <div class="sales-summary-card"><span>2025</span><b>${formatSales(y25,unit)}</b></div>
      <div class="sales-summary-card"><span>2026</span><b>${formatSales(y26,unit)}</b></div>
      <div class="sales-summary-card sales-yoy ${yoy == null ? 'neutral' : yoy >= 0 ? 'positive' : 'negative'}"><span>Изменение</span><b>${yoy == null ? '—' : `${yoy>0?'+':''}${yoy.toFixed(1).replace('.',',')}%`}</b></div>
    </div>
    <div class="sales-chart-wrap">
      <div class="sales-card-head"><h3 class="card-title">Факт продаж и план</h3><span class="sales-unit">${escapeHtml(unit)}</span></div>
      <div class="sales-legend"><span><i class="legend-2025"></i>2025</span><span><i class="legend-2026"></i>2026</span>${planCard ? '<span><i style="background:#d97706"></i>План</span>' : ''}</div>
      <div class="beta-card-chart-scroll">${betaCardSalesPlanSvg(s25,s26,planCard?.plan || [])}</div>
      <div class="beta-card-data-note">Факт и план берутся из серверной read-model карточки ТРТ; мобильный клиент не пересчитывает бизнес-данные.</div>
    </div>
    <table class="sales-table"><thead><tr><th>Месяц</th><th>2025</th><th>2026</th>${planCard ? `<th>План ${planYear}</th>` : ''}</tr></thead><tbody>${rows}</tbody></table>`;
};

betaCardEnsureStyle();
