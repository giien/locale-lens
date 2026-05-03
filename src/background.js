const DEFAULT_SETTINGS = {
  provider: "minimax",
  endpoint: "https://api.minimax.io/v1/chat/completions",
  model: "MiniMax-M2.7",
  apiKey: "",
  temperature: 0.2,
  markets: ["US", "CN", "DE", "FR", "ES", "JP"],
};

const MARKET_LABELS = {
  US: "United States / English",
  CN: "China / Chinese",
  DE: "Germany / German",
  FR: "France / French",
  ES: "Spain & LatAm / Spanish",
  JP: "Japan / Japanese",
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ANALYZE_TITLE") {
    analyzeTitle(message.payload)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (message?.type === "GET_SETTINGS") {
    getSettings().then((settings) => sendResponse({ ok: true, data: redactSettings(settings) }));
    return true;
  }

  if (message?.type === "SAVE_SETTINGS") {
    saveSettings(message.payload)
      .then((settings) => sendResponse({ ok: true, data: redactSettings(settings) }))
      .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (message?.type === "OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

async function analyzeTitle(payload) {
  const title = String(payload?.title || "").trim();
  if (!title) throw new Error("Missing product title.");

  const settings = await getSettings();
  settings.apiKey = normalizeApiKey(settings.apiKey);

  if (!settings.apiKey) {
    throw new Error("MiniMax API Key is not configured. Open extension options first.");
  }
  validateHeaderSafeApiKey(settings.apiKey);

  const cacheKey = `analysis:${settings.provider}:${settings.model}:${hashText(title)}`;
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey]) return { ...cached[cacheKey], cached: true };

  const analysis = await callOpenAICompatible(settings, {
    title,
    pageUrl: payload?.pageUrl || "",
    searchKeyword: payload?.searchKeyword || "",
    marketplace: payload?.marketplace || "US",
  });

  await chrome.storage.local.set({ [cacheKey]: analysis });
  return analysis;
}

async function callOpenAICompatible(settings, context) {
  const apiKey = normalizeApiKey(settings.apiKey);
  validateHeaderSafeApiKey(apiKey);
  const markets = settings.markets.map((market) => `${market}: ${MARKET_LABELS[market] || market}`).join("\n");
  const prompt = [
    "You are an Amazon and TikTok cross-border ecommerce keyword research expert.",
    "Analyze the Amazon product title and return localized search terms for product research.",
    "",
    "Rules:",
    "1. Do not translate word by word. Use expressions local shoppers would search.",
    "2. Extract product type, head terms, long-tail terms, attribute terms, and use-case terms.",
    "3. Keep output concise. Prefer high-intent ecommerce keywords.",
    "4. For Spanish, consider both Spain and broad Spanish-speaking ecommerce usage.",
    "5. For Japanese, prefer natural Japanese ecommerce search phrases.",
    "6. Return valid JSON only. No markdown.",
    "",
    "Markets:",
    markets,
    "",
    "JSON schema:",
    JSON.stringify({
      sourceTitle: "string",
      productType: "string",
      coreTerms: [
        {
          term: "portable blender",
          role: "head | long_tail | attribute | use_case",
          reason: "short Chinese reason",
        },
      ],
      markets: [
        {
          market: "US",
          language: "English",
          headTerms: ["term"],
          longTailTerms: ["term"],
          localExpressionNotes: "short Chinese note",
        },
      ],
    }),
    "",
    `Amazon marketplace: ${context.marketplace}`,
    `Current search keyword: ${context.searchKeyword || "(none)"}`,
    `Product title: ${context.title}`,
  ].join("\n");

  const response = await fetch(settings.endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: Number(settings.temperature ?? 0.2),
      messages: [
        {
          role: "system",
          content: "You produce compact, valid JSON for ecommerce keyword localization.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`AI request failed (${response.status}): ${body.slice(0, 240)}`);
  }

  const payload = JSON.parse(body);
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI response did not contain message content.");

  const parsed = parseJsonContent(content);
  return normalizeAnalysis(parsed, context.title);
}

function parseJsonContent(content) {
  const withoutThinking = String(content).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const withoutFence = withoutThinking.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(withoutFence);
  } catch (_error) {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(withoutFence.slice(start, end + 1));
    }
    throw new Error("AI response was not valid JSON.");
  }
}

function normalizeAnalysis(analysis, fallbackTitle) {
  const coreTerms = Array.isArray(analysis.coreTerms) ? analysis.coreTerms.slice(0, 8) : [];
  const markets = Array.isArray(analysis.markets) ? analysis.markets.slice(0, 8) : [];

  return {
    sourceTitle: String(analysis.sourceTitle || fallbackTitle),
    productType: String(analysis.productType || ""),
    coreTerms: coreTerms.map((item) => ({
      term: String(item.term || "").trim(),
      role: normalizeRole(item.role),
      reason: String(item.reason || "").trim(),
    })).filter((item) => item.term),
    markets: markets.map((item) => ({
      market: String(item.market || "").trim(),
      language: String(item.language || "").trim(),
      headTerms: toStringList(item.headTerms).slice(0, 4),
      longTailTerms: toStringList(item.longTailTerms).slice(0, 6),
      localExpressionNotes: String(item.localExpressionNotes || "").trim(),
    })).filter((item) => item.market && (item.headTerms.length || item.longTailTerms.length)),
    generatedAt: new Date().toISOString(),
  };
}

function normalizeRole(role) {
  const allowed = new Set(["head", "long_tail", "attribute", "use_case"]);
  return allowed.has(role) ? role : "head";
}

function toStringList(value) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    markets: Array.isArray(stored.markets) && stored.markets.length ? stored.markets : DEFAULT_SETTINGS.markets,
  };
}

async function saveSettings(payload) {
  const apiKey = normalizeApiKey(payload?.apiKey || "");
  if (apiKey) validateHeaderSafeApiKey(apiKey);

  const settings = {
    provider: "minimax",
    endpoint: String(payload?.endpoint || DEFAULT_SETTINGS.endpoint).trim(),
    model: String(payload?.model || DEFAULT_SETTINGS.model).trim(),
    apiKey,
    temperature: clamp(Number(payload?.temperature ?? DEFAULT_SETTINGS.temperature), 0, 1),
    markets: Array.isArray(payload?.markets) && payload.markets.length ? payload.markets : DEFAULT_SETTINGS.markets,
  };
  await chrome.storage.sync.set(settings);
  return settings;
}

function redactSettings(settings) {
  return {
    ...settings,
    apiKey: settings.apiKey ? "********" : "",
    hasApiKey: Boolean(settings.apiKey),
  };
}

function normalizeError(error) {
  return error?.message || String(error || "Unknown error");
}

function normalizeApiKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/^Bearer\s+/i, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function validateHeaderSafeApiKey(apiKey) {
  if (!/^[\x21-\x7E]+$/.test(apiKey)) {
    throw new Error("API Key 里包含中文、全角符号、换行或不可见字符。请重新复制纯 API Key，不要带 Bearer。");
  }
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return DEFAULT_SETTINGS.temperature;
  return Math.min(max, Math.max(min, value));
}

function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
