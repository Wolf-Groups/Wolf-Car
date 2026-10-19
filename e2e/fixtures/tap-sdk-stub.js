// Stands in for Tap's Card SDK (window.CardSDK) in the browser tests: no
// network, no iframe, no card form. Injected with page.addInitScript before
// any page script runs, so loadTapSdk() finds it and never loads Tap's file.
// tokenize() answers with the token the fake payment gateway accepts.
window.CardSDK = {
  renderTapCard(containerId, config) {
    window.__tapCfg = config;
    if (typeof config.onReady === "function") setTimeout(() => config.onReady(), 0);
    return {
      unmount() {
        window.__tapCfg = undefined;
      },
    };
  },
  tokenize() {
    const cfg = window.__tapCfg;
    if (cfg && typeof cfg.onSuccess === "function") cfg.onSuccess({ id: "tok_fake_ok", card: { last_four: "0010", brand: "VISA" } });
  },
};
