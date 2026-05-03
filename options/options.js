const DEFAULT_SETTINGS = {
  provider: "minimax",
  providerConfigs: {},
  apiStyle: "anthropic-bearer",
  endpoint: "https://api.minimaxi.com/anthropic/v1/messages",
  model: "MiniMax-M2.7",
  apiKey: "",
  temperature: 1,
  markets: ["US", "CN", "DE", "FR", "ES", "JP"],
};

const form = document.querySelector("#settings-form");
const statusNode = document.querySelector("#status");
const providerInput = document.querySelector("#provider");
const apiStyleInput = document.querySelector("#apiStyle");
const endpointInput = document.querySelector("#endpoint");
const modelInput = document.querySelector("#model");
const apiKeyInput = document.querySelector("#apiKey");
let providerPresets = {};
let providerConfigs = {};

init();

async function init() {
  providerPresets = await loadProviderPresets();
  renderProviderOptions(providerPresets);
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  providerConfigs = isPlainObject(settings.providerConfigs) ? settings.providerConfigs : {};
  providerInput.value = settings.provider || DEFAULT_SETTINGS.provider;
  applyProviderConfig(providerInput.value, getSavedConfig(providerInput.value, settings));

  const markets = new Set(settings.markets || DEFAULT_SETTINGS.markets);
  document.querySelectorAll('input[name="market"]').forEach((input) => {
    input.checked = markets.has(input.value);
  });
}

async function loadProviderPresets() {
  const response = await chrome.runtime.sendMessage({ type: "GET_PROVIDER_PRESETS" });
  if (response?.ok) return response.data;
  return {
    minimax: {
      label: "MiniMax",
      apiStyle: "anthropic-bearer",
      endpoint: DEFAULT_SETTINGS.endpoint,
      model: DEFAULT_SETTINGS.model,
    },
    custom: {
      label: "Custom",
      apiStyle: "openai",
      endpoint: "",
      model: "",
    },
  };
}

function renderProviderOptions(presets) {
  providerInput.innerHTML = Object.entries(presets)
    .map(([value, preset]) => `<option value="${escapeHtml(value)}">${escapeHtml(preset.label || value)}</option>`)
    .join("");
}

providerInput.addEventListener("change", () => {
  applyProviderConfig(providerInput.value, getSavedConfig(providerInput.value));
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const markets = [...document.querySelectorAll('input[name="market"]:checked')].map((input) => input.value);
  const payload = {
    provider: providerInput.value,
    apiStyle: apiStyleInput.value,
    endpoint: endpointInput.value.trim(),
    model: modelInput.value.trim(),
    apiKey: normalizeApiKey(apiKeyInput.value),
    temperature: Number(document.querySelector("#temperature").value || DEFAULT_SETTINGS.temperature),
    markets,
  };

  const response = await chrome.runtime.sendMessage({
    type: "SAVE_SETTINGS",
    payload,
  });

  if (response?.ok) {
    apiKeyInput.value = payload.apiKey;
    providerConfigs = {
      ...providerConfigs,
      [providerInput.value]: {
        apiStyle: payload.apiStyle,
        endpoint: payload.endpoint,
        model: payload.model,
        apiKey: payload.apiKey,
        temperature: payload.temperature,
      },
    };
    statusNode.textContent = "已保存。回到 Amazon 页面后刷新一次即可使用。";
  } else {
    statusNode.textContent = response?.error || "保存失败。";
  }
  setTimeout(() => {
    statusNode.textContent = "";
  }, 3000);
});

function getPreset(provider) {
  return providerPresets[provider] || providerPresets.custom || {};
}

function getSavedConfig(provider, fallbackSettings = {}) {
  const preset = getPreset(provider);
  const saved = isPlainObject(providerConfigs[provider]) ? providerConfigs[provider] : {};

  if (provider === fallbackSettings.provider && !Object.keys(saved).length) {
    return {
      apiStyle: fallbackSettings.apiStyle,
      endpoint: fallbackSettings.endpoint,
      model: fallbackSettings.model,
      apiKey: fallbackSettings.apiKey,
      temperature: fallbackSettings.temperature,
    };
  }

  return {
    apiStyle: saved.apiStyle || preset.apiStyle || "openai",
    endpoint: saved.endpoint || preset.endpoint || "",
    model: saved.model || preset.model || "",
    apiKey: saved.apiKey || "",
    temperature: saved.temperature ?? DEFAULT_SETTINGS.temperature,
  };
}

function applyProviderConfig(provider, config = {}) {
  const preset = getPreset(provider);
  apiStyleInput.value = config.apiStyle || preset.apiStyle || "openai";
  endpointInput.value = config.endpoint || preset.endpoint || "";
  modelInput.value = config.model || preset.model || "";
  apiKeyInput.value = config.apiKey || "";
  document.querySelector("#temperature").value = config.temperature ?? DEFAULT_SETTINGS.temperature;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeApiKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/^Bearer\s+/i, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
