import { AdMob, BannerAdSize, BannerAdPosition, RewardAdPluginEvents } from '@capacitor-community/admob';

const TESTING = false;

const GOOGLE_TEST_IDS = {
  banner: "ca-app-pub-3940256099942544/6300978111",
  interstitial: "ca-app-pub-3940256099942544/1033173712",
  rewarded: "ca-app-pub-3940256099942544/5224354917",
};

const PROD_IDS = {
  banner: "ca-app-pub-5743225482205913/5655183719",
  interstitial: "ca-app-pub-5743225482205913/2019191036",
  rewarded: "ca-app-pub-5743225482205913/9637414887",
};

const IDS = TESTING ? GOOGLE_TEST_IDS : PROD_IDS;

const DEBUG_ALERT = false;
function debugLog(msg) {
  console.log(msg);
  if (DEBUG_ALERT) { try { window.alert(msg); } catch {} }
}
function debugError(label, e) {
  const msg = label + ": " + (e?.message || e?.toString?.() || JSON.stringify(e));
  console.error(msg);
  if (DEBUG_ALERT) { try { window.alert(msg); } catch {} }
}

let bannerSuppressed = false;

const initPromise = (async () => {
  try {
    await AdMob.initialize();
    debugLog("[ads] initialize OK");
  } catch (e) {
    debugError("[ads] initialize FAILED", e);
  }
  try {
    if (bannerSuppressed) return;
    await AdMob.showBanner({
      adId: IDS.banner,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      isTesting: TESTING,
    });
    if (bannerSuppressed) { try { await AdMob.hideBanner(); } catch {} }
    else debugLog("[ads] banner OK");
  } catch (e) {
    debugError("[ads] banner FAILED", e);
  }
})();

initPromise.then(() => warmRewarded());

let rewardedInFlight = null;
let interstitialInFlight = null;

let rewardReady = false;
let warming = null;
let rewardRetryTimer = null;

async function warmRewarded(delayMs = 0) {
  if (rewardReady || warming) return warming;
  if (rewardRetryTimer) { clearTimeout(rewardRetryTimer); rewardRetryTimer = null; }
  warming = (async () => {
    try {
      await initPromise;
      if (delayMs > 0) { await new Promise(r => setTimeout(r, delayMs)); }
      await AdMob.prepareRewardVideoAd({ adId: IDS.rewarded, isTesting: TESTING });
      rewardReady = true;
    } catch (e) {
      rewardReady = false;
      debugError("[ads] rewarded could not be prepared", e);
      rewardRetryTimer = setTimeout(() => warmRewarded(), 10000);
    } finally {
      warming = null;
    }
  })();
  return warming;
}

async function runRewarded() {
  const handles = [];
  const cleanup = async () => {
    for (const h of handles) { try { await h?.remove?.(); } catch {} }
  };
  let timer;
  try {
    await initPromise;
    if (!rewardReady) await warmRewarded();
    if (!rewardReady) throw new Error("no rewarded ad filled");

    let settle;
    const earned = new Promise((resolve) => { settle = resolve; });
    let settled = false;
    const settleOnce = (v) => { if (!settled) { settled = true; settle(v); } };

    try {
      const results = await Promise.allSettled([
        AdMob.addListener(RewardAdPluginEvents.Rewarded, () => settleOnce(true)),
        AdMob.addListener(RewardAdPluginEvents.Dismissed, () => settleOnce(false)),
        AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => settleOnce(false)),
      ]);
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) handles.push(r.value);
        else if (r.status === "rejected") debugError("[ads] a reward listener failed to register", r.reason);
      }
    } catch (e) {
      debugError("[ads] reward event listeners unavailable, falling back", e);
    }

    timer = setTimeout(() => settleOnce(true), 60000);
    rewardReady = false;
    await AdMob.showRewardVideoAd();
    rewardReady = false;
    const result = await earned;
    clearTimeout(timer);
    warmRewarded();
    return result;
  } catch (e) {
    clearTimeout(timer);
    rewardReady = false;
    debugError("[ads] rewarded FAILED", e);
    warmRewarded(2000);
    return false;
  } finally {
    await cleanup();
  }
}

window.ArrowAds = {
  ready: true,

  showRewarded() {
    if (rewardedInFlight) return rewardedInFlight;
    rewardedInFlight = (async () => {
      try {
        return await runRewarded();
      } finally {
        rewardedInFlight = null;
      }
    })();
    return rewardedInFlight;
  },

  showInterstitial() {
    if (interstitialInFlight) return interstitialInFlight;
    interstitialInFlight = (async () => {
      let timedOut = false;
      try {
        await Promise.race([
          (async () => {
            await initPromise;
            await AdMob.prepareInterstitial({ adId: IDS.interstitial, isTesting: TESTING });
            if (!timedOut) await AdMob.showInterstitial();
          })(),
          new Promise((resolve) => setTimeout(() => { timedOut = true; resolve(); }, 15000)),
        ]);
      } catch (e) {
        debugError("[ads] interstitial failed", e);
      } finally {
        interstitialInFlight = null;
      }
    })();
    return interstitialInFlight;
  },

  async hideBanner() {
    bannerSuppressed = true;
    try { await AdMob.hideBanner(); } catch (e) { debugError("[ads] hideBanner failed", e); }
  },
  async showBannerAgain() {
    bannerSuppressed = false;
    try {
      await initPromise;
      await AdMob.showBanner({
        adId: IDS.banner,
        adSize: BannerAdSize.ADAPTIVE_BANNER,
        position: BannerAdPosition.BOTTOM_CENTER,
        isTesting: TESTING,
      });
    } catch (e) { debugError("[ads] showBannerAgain failed", e); }
  },

  billing: false,
  purchaseRemoveAds: async () => false,
  restorePurchases: async () => false,
};
