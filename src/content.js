const CARD_SELECTOR = '[data-component-type="s-search-result"]';
const MODULE_CLASS = 'gks-keyword-module';
const PROCESSED_ATTR = 'data-gks-processed';
const ACTIVE_BADGE_ID = 'gks-active-badge';
const SHOW_ACTIVE_BADGE = false;
const MARKET_SEARCH_HOSTS = {
  US: 'www.amazon.com',
  UK: 'www.amazon.co.uk',
  DE: 'www.amazon.de',
  FR: 'www.amazon.fr',
  ES: 'www.amazon.es',
  IT: 'www.amazon.it',
  JP: 'www.amazon.co.jp',
};
const MARKET_POSTAL_CODES = {
  US: { code: '10001', place: 'New York' },
  UK: { code: 'SW1A 1AA', place: 'London' },
  DE: { code: '10115', place: 'Berlin' },
  FR: { code: '75001', place: 'Paris' },
  ES: { code: '28001', place: 'Madrid' },
  IT: { code: '00118', place: 'Rome' },
  JP: { code: '100-0001', place: 'Tokyo' },
  CN: { code: '100000', place: 'Beijing' },
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
        <div class="gks-eyebrow">LocaleLens AI Terms</div>
        <div class="gks-subtitle">从标题提取核心词，再翻译成本地搜索表达</div>
      </div>
      <div class="gks-header-actions">
        <span class="gks-copy-hint">点关键词复制</span>
        <button class="gks-collapse-button" type="button" data-gks-collapse>收起</button>
      </div>
    </div>
    <div class="gks-toast" aria-live="polite"></div>
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
  if (!SHOW_ACTIVE_BADGE) {
    document.getElementById(ACTIVE_BADGE_ID)?.remove();
    return;
  }
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
      <div class="gks-research-row">
        ${renderResearchLinks(coreTerms)}
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
    <button class="gks-chip" type="button" data-gks-copy-term="${escapeHtml(item.term)}" title="${escapeHtml(item.reason || '点击复制关键词')}">
      <b>${role}</b>${escapeHtml(item.term)}
    </button>
  `;
}

function renderMarket(market) {
  const head = (market.headTerms || []).slice(0, 3);
  const longTail = (market.longTailTerms || []).slice(0, 4);
  const marketCode = normalizeMarketCode(market.market);
  const searchTerm = head[0] || longTail[0] || '';
  const searchUrl = buildAmazonSearchUrl(marketCode, searchTerm);
  const tikTokSearchUrl = buildTikTokSearchUrl(searchTerm);
  const postal = getPostalCodeForMarket(marketCode);

  return `
    <article class="gks-market">
      <div class="gks-market-head">
        <div>
          <b>${escapeHtml(market.market)}</b>
          <span>${escapeHtml(market.language || '')}</span>
        </div>
        <div class="gks-market-actions">
          ${postal ? `<button class="gks-postal-button" type="button" data-gks-copy-postal="${escapeHtml(postal.code)}" title="复制 ${escapeHtml(marketCode)} 默认邮编：${escapeHtml(postal.place)}">${escapeHtml(postal.code)}</button>` : ''}
          ${searchUrl ? `<a class="gks-open-link" href="${escapeHtml(searchUrl)}" target="_blank" rel="noopener noreferrer" data-gks-postal-code="${escapeHtml(postal?.code || '')}" title="打开 ${escapeHtml(searchTerm)} 的 ${escapeHtml(marketCode)} Amazon 搜索页。若需要邮编，会自动复制 ${escapeHtml(postal?.code || '')}">Amazon</a>` : ''}
          ${tikTokSearchUrl ? `<a class="gks-open-link gks-tiktok-link" href="${escapeHtml(tikTokSearchUrl)}" target="_blank" rel="noopener noreferrer" title="打开 TikTok 搜索：${escapeHtml(searchTerm)}">TikTok</a>` : ''}
        </div>
      </div>
      <div class="gks-term-line">${head.map(renderCopyTerm).join('')}</div>
      <div class="gks-tail-line">${longTail.map(renderCopyTerm).join('')}</div>
      ${market.localExpressionNotes ? `<p>${escapeHtml(market.localExpressionNotes)}</p>` : ''}
    </article>
  `;
}

function renderCopyTerm(term) {
  return `<button type="button" data-gks-copy-term="${escapeHtml(term)}" title="点击复制关键词">${escapeHtml(term)}</button>`;
}

function renderResearchLinks(coreTerms) {
  const terms = (coreTerms || [])
    .map((item) => item.term)
    .filter(Boolean)
    .slice(0, 4);
  if (!terms.length) return '';

  const mainTerm = terms[0];
  const links = [
    {
      label: 'TikTok Search',
      href: buildTikTokSearchUrl(mainTerm),
      title: `打开 TikTok 搜索：${mainTerm}`,
    },
    {
      label: `#${toHashTag(mainTerm)}`,
      href: buildTikTokTagUrl(mainTerm),
      title: `打开 TikTok tag：${mainTerm}`,
    },
    {
      label: 'Google Trends',
      href: buildGoogleTrendsUrl(mainTerm),
      title: `打开 Google Trends：${mainTerm}`,
    },
  ].filter((link) => link.href);

  return links.map((link) => `
    <a class="gks-research-link" href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(link.title)}">${escapeHtml(link.label)}</a>
  `).join('');
}

function renderError(error) {
  const message = formatUserError(error?.message || String(error));
  return `
    <div class="gks-error">
      <b>无法完成 AI 分析</b>
      <span>${escapeHtml(message)}</span>
      <button class="gks-link-button" type="button" data-gks-open-options>打开配置页</button>
    </div>
  `;
}

document.addEventListener('click', (event) => {
  const target = event.target;
  if (target?.matches?.('[data-gks-open-options]')) {
    chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
  }

  const postalButton = target?.closest?.('[data-gks-copy-postal]');
  if (postalButton) {
    event.preventDefault();
    copyPostalCode(postalButton.dataset.gksCopyPostal, postalButton);
  }

  const copyTerm = target?.closest?.('[data-gks-copy-term]');
  if (copyTerm) {
    event.preventDefault();
    copyKeywordTerm(copyTerm.dataset.gksCopyTerm, copyTerm);
  }

  const amazonLink = target?.closest?.('a[data-gks-postal-code]');
  if (amazonLink?.dataset?.gksPostalCode) {
    copyTextToClipboard(amazonLink.dataset.gksPostalCode);
  }

  if (target?.matches?.('[data-gks-collapse]')) {
    const module = target.closest(`.${MODULE_CLASS}`);
    if (!module) return;
    const collapsed = module.classList.toggle('gks-collapsed');
    target.textContent = collapsed ? '展开' : '收起';
  }
});

async function copyKeywordTerm(term, node) {
  const ok = await copyTextToClipboard(term);
  const module = node.closest?.(`.${MODULE_CLASS}`);
  if (ok) {
    node.classList.add('gks-copied');
    setTimeout(() => node.classList.remove('gks-copied'), 900);
  }
  showModuleToast(module, ok ? `已复制：${term}` : '复制失败，请手动选择文本');
}

function showModuleToast(module, message) {
  const toast = module?.querySelector?.('.gks-toast');
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add('gks-toast-visible');
  clearTimeout(toast.gksTimer);
  toast.gksTimer = setTimeout(() => {
    toast.classList.remove('gks-toast-visible');
  }, 1400);
}

function formatUserError(message) {
  const text = String(message || '').trim();
  if (!text) return '模型没有返回可用内容，请稍后重试。';
  if (/401|403|invalid api key|authorized_error|unauthorized/i.test(text)) {
    return 'API Key 验证失败。请检查当前 Provider 的 API Key 是否完整、是否有权限，MiniMax 不要带 Bearer 前缀。';
  }
  if (/429|rate limit|quota|insufficient|balance|billing/i.test(text)) {
    return '请求太频繁或额度不足。请稍后重试，或检查服务商账户余额和限额。';
  }
  if (/404|not found/i.test(text)) {
    return '接口地址或模型名称可能不对。请打开配置页检查 Endpoint 和 Model。';
  }
  if (/400|bad request|invalid request/i.test(text)) {
    return '服务商没有接受当前请求。请检查 Provider、API Style、Endpoint 和 Model 是否匹配。';
  }
  if (/not valid json|JSON|Expected ','|Unexpected/i.test(text)) {
    return '模型回复的格式不完整。可以点“重试”，或换一个更稳定的模型再试。';
  }
  if (/failed to fetch|network|fetch/i.test(text)) {
    return '网络请求没有发出去。请检查网络、服务商 Endpoint，或稍后重试。';
  }
  if (/API Key is not configured|请先填写 API Key/i.test(text)) {
    return '还没有配置 API Key。请点击右上角插件图标保存配置后再分析。';
  }
  return text.split('\n')[0].slice(0, 180);
}

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

function getPostalCodeForMarket(marketCode) {
  return MARKET_POSTAL_CODES[marketCode] || null;
}

async function copyPostalCode(postalCode, button) {
  const ok = await copyTextToClipboard(postalCode);
  const oldText = button.textContent;
  button.textContent = ok ? '已复制' : postalCode;
  setTimeout(() => {
    button.textContent = oldText;
  }, 1200);
}

async function copyTextToClipboard(text) {
  const value = String(text || '').trim();
  if (!value) return false;

  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (_error) {
    return fallbackCopyText(value);
  }
}

function fallbackCopyText(text) {
  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', 'true');
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  document.body.appendChild(input);
  input.select();
  const ok = document.execCommand('copy');
  input.remove();
  return ok;
}

function buildTikTokSearchUrl(searchTerm) {
  const term = String(searchTerm || '').trim();
  if (!term) return '';

  const url = new URL('https://www.tiktok.com/search');
  url.searchParams.set('q', term);
  return url.toString();
}

function buildTikTokTagUrl(searchTerm) {
  const tag = toHashTag(searchTerm);
  return tag ? `https://www.tiktok.com/tag/${encodeURIComponent(tag)}` : '';
}

function buildGoogleTrendsUrl(searchTerm) {
  const term = String(searchTerm || '').trim();
  if (!term) return '';

  const url = new URL('https://trends.google.com/trends/explore');
  url.searchParams.set('q', term);
  return url.toString();
}

function toHashTag(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/[\s_-]+/g, '')
    .slice(0, 60);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
