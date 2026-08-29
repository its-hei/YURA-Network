(() => {
  "use strict";

  const output = document.getElementById("networkHits");
  if (!output) return;

  const COUNTER_URL =
    "https://yura-network.goatcounter.com/counter/TOTAL.json";

  function formatHits(value) {
    const raw = String(value ?? "").replace(/\D/g, "");
    if (!raw) return "000000";
    return raw.padStart(6, "0");
  }

  async function refreshHits() {
    try {
      const response = await fetch(
        `${COUNTER_URL}?t=${Date.now()}`,
        {
          cache: "no-store",
          mode: "cors"
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      output.textContent = formatHits(data && data.count);
      output.dataset.state = "live";
    } catch (error) {
      // Important: NETWORK HITS must never be able to break
      // commands or ranking if GoatCounter is blocked/unavailable.
      output.textContent = "000000";
      output.dataset.state = "waiting";
      console.warn("[YURA] NETWORK HITS unavailable:", error);
    }
  }

  window.setTimeout(refreshHits, 1500);
  window.setInterval(refreshHits, 5 * 60 * 1000);
})();
