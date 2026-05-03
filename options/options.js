const DEFAULT_SETTINGS = {
  provider: "minimax",
  apiStyle: "openai",
  endpoint: "https://api.minimaxi.com/v1/chat/completions",
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

init();

async function init() {
  providerPresets = await loadProviderPresets();
  renderProviderOptions(providerPresets);
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  providerInput.value = settings.provider || DEFAULT_SETTINGS.provider;
  apiStyleInput.value = settings.apiStyle || getPreset(providerInput.value).apiStyle || DEFAULT_SETTINGS.apiStyle;
  endpointInput.value = settings.endpoint || getPreset(providerInput.value).endpoint || DEFAULT_SETTINGS.endpoint;
  modelInput.value = settings.model || getPreset(providerInput.value).model || DEFAULT_SETTINGS.model;
  document.querySelector("#temperature").value = settings.temperature ?? DEFAULT_SETTINGS.temperature;
  apiKeyInput.value = settings.apiKey || "";

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
      label: "MiniMax OpenAI-compatible",
      apiStyle: "openai",
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
  const preset = getPreset(providerInput.value);
  apiStyleInput.value = preset.apiStyle || "openai";
  endpointInput.value = preset.endpoint || "";
  modelInput.value = preset.model || "";
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
