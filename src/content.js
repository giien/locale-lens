const CARD_SELECTOR = '[data-component-type="s-search-result"]';
const MODULE_CLASS = 'gks-keyword-module';
const PROCESSED_ATTR = 'data-gks-processed';
const ACTIVE_BADGE_ID = 'gks-active-badge';
const MARKET_SEARCH_HOSTS = {
  US: 'www.amazon.com',
  UK: 'www.amazon.co.uk',
  DE: 'www.amazon.de',
  FR: 'www.amazon.fr',
  ES: 'www.amazon.es',
  IT: 'www.amazon.it',
  JP: 'www.amazon.co.jp',
};

let scanTimer = 0;
let analysisInFlight = false;

scanProductCards();
observePageChanges();

function observePageChanges() {
  const observer = new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanProductCards, 250);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function scanProductCards() {
  const titleNodes = collectProductTitleNodes();
  titleNodes.forEach((titleNode) => {
    if (titleNode.getAttribute(PROCESSED_ATTR) === '1') return;
    const title = extractTitle(titleNode);
    if (!title) return;

    const insertionAnchor = findTitleInsertionAnchor(titleNode);
    if (!insertionAnchor) return;

    const button = createTitleAnalyzeButton();
    const buttonRow = createTitleButtonRow(button);
    insertionAnchor.insertAdjacentElement('afterend', buttonRow);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const body = ensureKeywordModule(button);
      analyzeTitle({ title, button, body });
    });
    titleNode.setAttribute(PROCESSED_ATTR, '1');
  });
  updateActiveBadge(document.querySelectorAll('.gks-title-button').length);
}

function findTitleInsertionAnchor(titleNode) {
  return titleNode.closest?.('a[href*="/dp/"], a[href*="/gp/product/"], a[href*="/sspa/"]') || titleNode;
}

function collectProductTitleNodes() {
  const nodes = new Set();

  document.querySelectorAll(CARD_SELECTOR).forEach((card) => {
    const titleNode = card.querySelector('h2');
    if (isUsableProductTitle(titleNode)) nodes.add(titleNode);
  });

  document.querySelectorAll('h2').forEach((titleNode) => {
    if (isUsableProductTitle(titleNode)) nodes.add(titleNode);
  });

  return [...nodes];
}

function isUsableProductTitle(titleNode) {
  const title = extractTitle(titleNode);
  if (title.length < 18) return false;

  const card = titleNode.closest?.(`${CARD_SELECTOR}, [data-asin]:not([data-asin=""])`);
  const link = titleNode.querySelector?.('a[href*="/dp/"], a[href*="/gp/product/"], a[href*="/sspa/"]');
  return Boolean(card || link);
}

function extractTitle(titleNode) {
  return String(titleNode?.innerText || titleNode?.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function createTitleAnalyzeButton() {
  const button = document.createElement('button');
  button.className = 'gks-title-button';
  button.type = 'button';
  button.textContent = 'AI 分析';
  button.title = '从标题提取核心关键词并翻译成本地市场搜索表达';
  return button;
}

function createTitleButtonRow(button) {
  const row = document.createElement('div');
  row.className = 'gks-title-button-row';
  row.appendChild(button);
  return row;
}

function ensureKeywordModule(anchor) {
  const row = anchor.closest?.('.gks-title-button-row') || anchor;
  const existing = row.parentElement?.querySelector?.(`:scope > .${MODULE_CLASS}`);
  if (existing) return existing.querySelector('.gks-body');

  const root = document.createElement('section');
  root.className = MODULE_CLASS;
  root.innerHTML = `
    <div class="gks-header">
      <div>
        <div class="gks-eyebrow">Global AI Terms</div>
        <div class="gks-subtitle">从标题提取核心词，再翻译成本地搜索表达</div>
      </div>
    </div>
    <div class="gks-body">
      ${renderLoading()}
    </div>
  `;

  row.insertAdjacentElement('afterend', root);
  return root.querySelector('.gks-body');
}

async function analyzeTitle({ title, button, body }) {
  if (analysisInFlight) return;

  analysisInFlight = true;
  setAnalyzeButtonsDisabled(true);
  button.disabled = true;
  button.textContent = '分析中';
  body.innerHTML = renderLoading();

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ANALYZE_TITLE',
      payload: {
        title,
        pageUrl: location.href,
        marketplace: detectMarketplace(location.hostname),
        searchKeyword: new URLSearchParams(location.search).get('k') || '',
      },
    });

    if (!response?.ok) throw new Error(response?.error || 'AI analysis failed.');
    body.innerHTML = renderAnalysis(response.data);
    button.textContent = response.data.cached ? '已缓存' : '已分析';
  } catch (error) {
    body.innerHTML = renderError(error);
    button.textContent = '重试';
  } finally {
    analysisInFlight = false;
    setAnalyzeButtonsDisabled(false);
  }
}

function setAnalyzeButtonsDisabled(disabled) {
  document.querySelectorAll('.gks-title-button').forEach((button) => {
    button.disabled = disabled;
  });
}

function updateActiveBadge(count) {
  let badge = document.getElementById(ACTIVE_BADGE_ID);
  if (!badge) {
    badge = document.createElement('div');
    badge.id = ACTIVE_BADGE_ID;
    document.documentElement.appendChild(badge);
  }
  badge.textContent = count > 0 ? `GKS active · ${count}` : 'GKS active';
}

function renderLoading() {
  return `
    <div class="gks-loading">
      <span></span><span></span><span></span>
      <b>AI 正在拆解标题关键词和本地化表达</b>
    </div>
  `;
}

function renderAnalysis(analysis) {
  const coreTerms = (analysis.coreTerms || []).slice(0, 8);
  const markets = (analysis.markets || []).slice(0, 6);
  return `
    <div class="gks-core">
      ${analysis.productType ? `<div class="gks-product-type">${escapeHtml(analysis.productType)}</div>` : ''}
      <div class="gks-chip-row">
        ${coreTerms.map(renderCoreTerm).join('')}
      </div>
    </div>
    <div class="gks-market-grid">
      ${markets.map(renderMarket).join('')}
    </div>
  `;
}

function renderCoreTerm(item) {
  const role = {
    head: '大词',
    long_tail: '长尾',
    attribute: '属性',
    use_case: '场景',
  }[item.role] || '词';

  return `
    <span class="gks-chip" title="${escapeHtml(item.reason || '')}">
      <b>${role}</b>${escapeHtml(item.term)}
    </span>
  `;
}

function renderMarket(market) {
  const head = (market.headTerms || []).slice(0, 3);
  const longTail = (market.longTailTerms || []).slice(0, 4);
  const marketCode = normalizeMarketCode(market.market);
  const searchTerm = head[0] || longTail[0] || '';
  const searchUrl = buildAmazonSearchUrl(marketCode, searchTerm);

  return `
    <article class="gks-market">
      <div class="gks-market-head">
        <div>
          <b>${escapeHtml(market.market)}</b>
          <span>${escapeHtml(market.language || '')}</span>
        </div>
        ${searchUrl ? `<a class="gks-open-link" href="${escapeHtml(searchUrl)}" target="_blank" rel="noopener noreferrer" title="打开 ${escapeHtml(searchTerm)} 的 ${escapeHtml(marketCode)} 搜索页">打开</a>` : ''}
      </div>
      <div class="gks-term-line">${head.map((term) => `<span>${escapeHtml(term)}</span>`).join('')}</div>
      <div class="gks-tail-line">${longTail.map((term) => `<span>${escapeHtml(term)}</span>`).join('')}</div>
      ${market.localExpressionNotes ? `<p>${escapeHtml(market.localExpressionNotes)}</p>` : ''}
    </article>
  `;
}

function renderError(error) {
  return `
    <div class="gks-error">
      <b>无法完成 AI 分析</b>
      <span>${escapeHtml(error?.message || String(error))}</span>
      <button class="gks-link-button" type="button" data-gks-open-options>打开配置页</button>
    </div>
  `;
}

document.addEventListener('click', (event) => {
  const target = event.target;
  if (target?.matches?.('[data-gks-open-options]')) {
    chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
  }
});

function detectMarketplace(hostname) {
  if (hostname.endsWith('amazon.de')) return 'DE';
  if (hostname.endsWith('amazon.fr')) return 'FR';
  if (hostname.endsWith('amazon.es')) return 'ES';
  if (hostname.endsWith('amazon.it')) return 'IT';
  if (hostname.endsWith('amazon.co.jp')) return 'JP';
  if (hostname.endsWith('amazon.co.uk')) return 'UK';
  return 'US';
}

function normalizeMarketCode(market) {
  const code = String(market || '').trim().toUpperCase();
  if (code.includes('UNITED STATES')) return 'US';
  if (code.includes('UNITED KINGDOM')) return 'UK';
  if (code.includes('GERMANY')) return 'DE';
  if (code.includes('FRANCE')) return 'FR';
  if (code.includes('SPAIN')) return 'ES';
  if (code.includes('JAPAN')) return 'JP';
  return code;
}

function buildAmazonSearchUrl(marketCode, searchTerm) {
  const host = MARKET_SEARCH_HOSTS[marketCode];
  const term = String(searchTerm || '').trim();
  if (!host || !term) return '';

  const url = new URL(`https://${host}/s`);
  url.searchParams.set('k', term);
  return url.toString();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
