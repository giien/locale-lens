# LocaleLens

Chrome Manifest V3 prototype for Amazon cross-market keyword research.

## What it does

- Adds a compact `AI 分析` button below Amazon search-result product titles.
- Sends the product title to a MiniMax/OpenAI-compatible chat endpoint only when the user clicks `AI 分析`.
- Asks the model to extract ecommerce keywords and localize them for US, CN, DE, FR, ES, and JP markets.
- Renders head terms, long-tail terms, and local expression notes under the title.
- Adds an `打开` link for supported Amazon marketplaces, opening the localized head term on the target Amazon search URL.

## Local install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select this folder:

   `/Volumes/Rtl9210/globaltrans/global-keyword-extension`

5. Click the extension icon or open the extension options page and save your model provider API key.
6. Refresh an Amazon search page and click `AI 分析` below a product title.

Clicking the extension icon opens a small popup where you can configure a model provider. The default view only asks for provider and API key; endpoint, model, and API style live under `高级设置`.
Each provider keeps its own endpoint, model, API style, and API key, so switching providers will restore that provider's saved configuration instead of reusing another provider's key.
Use `测试连接` in the popup to send a tiny smoke-test request before running a full Amazon title analysis.

## Model providers

LocaleLens includes presets for:

- MiniMax
- MiniMax OpenAI-compatible
- OpenAI
- OpenRouter
- DeepSeek
- Qwen / Alibaba DashScope
- Groq
- Google Gemini OpenAI-compatible endpoint
- Anthropic / Claude Messages API
- SiliconFlow
- Custom OpenAI-compatible or Anthropic-style endpoint

Most providers use the OpenAI-compatible `chat/completions` format. Anthropic uses the native Messages API format. MiniMax also provides an Anthropic-compatible endpoint using Bearer authentication.

## MiniMax defaults

- Default endpoint: `https://api.minimaxi.com/anthropic/v1/messages`
- OpenAI-compatible endpoint: `https://api.minimaxi.com/v1/chat/completions`
- Model: `MiniMax-M2.7`

MiniMax supports OpenAI-compatible chat completions at `/v1/chat/completions` and recommends Anthropic-compatible access in its AI SDK provider docs.
