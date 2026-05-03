const DEFAULT_SETTINGS = {
  endpoint: "https://api.minimax.io/v1/chat/completions",
  model: "MiniMax-M2.7",
  apiKey: "",
  temperature: 0.2,
  markets: ["US", "CN", "DE", "FR", "ES", "JP"],
};

const form = document.querySelector("#settings-form");
const statusNode = document.querySelector("#status");

init();

async function init() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  document.querySelector("#endpoint").value = settings.endpoint || DEFAULT_SETTINGS.endpoint;
  document.querySelector("#model").value = settings.model || DEFAULT_SETTINGS.model;
  document.querySelector("#temperature").value = settings.temperature ?? DEFAULT_SETTINGS.temperature;
  document.querySelector("#apiKey").value = settings.apiKey || "";

  const markets = new Set(settings.markets || DEFAULT_SETTINGS.markets);
  document.querySelectorAll('input[name="market"]').forEach((input) => {
    input.checked = markets.has(input.value);
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const markets = [...document.querySelectorAll('input[name="market"]:checked')].map((input) => input.value);
  const payload = {
    endpoint: document.querySelector("#endpoint").value.trim(),
    model: document.querySelector("#model").value.trim(),
    apiKey: document.querySelector("#apiKey").value.trim(),
    temperature: Number(document.querySelector("#temperature").value || DEFAULT_SETTINGS.temperature),
    markets,
  };

  await chrome.storage.sync.set(payload);
  statusNode.textContent = "已保存。回到 Amazon 页面后刷新一次即可使用。";
  setTimeout(() => {
    statusNode.textContent = "";
  }, 3000);
});
