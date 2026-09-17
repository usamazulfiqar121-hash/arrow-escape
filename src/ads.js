import { AdMob, BannerAdSize, BannerAdPosition, RewardAdPluginEvents } from '@capacitor-community/admob';

// Flip to false when you're ready to go live on your own ad units.
// true  -> Google's official sample ad units.
// false -> your real created ad units.
const TESTING = false;

const GOOGLE_TEST_IDS = {
  banner:       "ca-app-pub-3940256099942544/6300978111",
  interstitial: "ca-app-pub-3940256099942544/1033173712",
  rewarded:     "ca-app-pub-3940256099942544/5224354917",
};

const PROD_IDS = {
  banner:       "ca-app-pub-5743225482205913/5655183719",
  interstitial: "ca-app-pub-5743225482205913/2019191036",
  rewarded:     "ca-app-pub-5743225482205913/9637414887",
};

const IDS = TESTING ? GOOGLE_TEST_IDS : PROD_IDS;

// DEBUG_ALERT is ON so every ad step pops a message on your phone.
// Turn it back to false once you've confirmed ads are working.
const DEBUG_ALERT = true;
function debugLog(msg) {
  console.log(msg);
  if (DEBUG_ALERT) { try { window.alert(msg); } catch (e) {} }
}
function debugError(label, e) {
  const msg = label + ": " + (e?.message || e?.toString?.() || JSON.stringify(e));
  console.error(msg);
  if (DEBUG_ALERT) { try { window.alert(msg); } catch (e) {} }
}

// Once the player removes ads we must never put the banner back — including
// the startup one, which may still be in flight when hideBanner() is called.
let bannerSuppressed = false;

let initDone = false;

const initPromise = (async () => {
  try {
    await AdMob.initialize();
    initDone = true;
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

const WARM_TRIES = 5;
let warmFails = 0;
let warmTimer = null;

async function warmRewarded(delayMs = 0) {
  if (rewardReady || warming) return warming;
  warming = (async () => {
    try {
      await initPromise;
      if (delayMs > 0) { await new Promise(r => setTimeout(r, delayMs)); }
      await AdMob.prepareRewardVideoAd({ adId: IDS.rewarded, isTesting: TESTING });
      rewardReady = true;
      warmFails = 0;
    } catch (e) {
      rewardReady = false;
      warmFails++;
      debugError("[ads] rewarded could not be prepared (attempt " + warmFails + ")", e);
      if (warmFails < WARM_TRIES && !warmTimer) {
        const wait = 10000 * Math.pow(2, warmFails - 1);
        warmTimer = setTimeout(() => { warmTimer = null; warmRewarded(); }, wait);
      }
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

    let earnedReward = false;
    try {
      const EV = RewardAdPluginEvents || {};
      const results = await Promise.allSettled([
        AdMob.addListener(EV.Rewarded || 'onRewarded', () => {
          earnedReward = true;
          settleOnce(true);
        }),
        AdMob.addListener(EV.Dismissed || 'onRewardedVideoAdDismissed', () => {
          setTimeout(() => settleOnce(earnedReward), 250);
        }),
        AdMob.addListener(EV.FailedToShow || 'onRewardedVideoAdFailedToShow', () => settleOnce(false)),
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

    let wentAway = false;
    let backGrace = null;
    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.hidden) { wentAway = true; return; }
      if (!wentAway || settled) return;
      clearTimeout(backGrace);
      backGrace = setTimeout(() => settleOnce(earnedReward), 1200);
    };
    try {
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", onVisibility);
        handles.push({ remove: async () => {
          clearTimeout(backGrace);
          document.removeEventListener("visibilitychange", onVisibility);
        } });
      }
    } catch (e) { debugError("[ads] could not watch for the app returning", e); }

    let stuck;
    const giveUp = new Promise((resolve) => { stuck = setTimeout(() => resolve(null), 90000); });
    const watched = (async () => {
      await AdMob.showRewardVideoAd();
      rewardReady = false;
      return await earned;
    })();

    const raced = await Promise.race([watched, giveUp]);
    clearTimeout(stuck);
    clearTimeout(timer);
    const result = raced === null ? false : raced;
    if (raced === null) debugError("[ads] rewarded never returned, giving up", null);
    warmRewarded();
    return result;
  } catch (e) {
    clearTimeout(timer);
    rewardReady = false;
    debugError("[ads] rewarded FAILED", e);
    warmFails = 0;
    if (warmTimer) { clearTimeout(warmTimer); warmTimer = null; }
    warmRewarded(2000);
    return false;
  } finally {
    await cleanup();
  }
}

window.ArrowAds = {
  get ready() { return initDone; },

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
      try {
        let gaveUp = false;
        let giveUpTimer = null;

        let away = false, backTimer = null, onVis = null;
        const backHome = new Promise((resolve) => {
          onVis = () => {
            if (typeof document === "undefined") return;
            if (document.hidden) { away = true; return; }
            if (!away) return;
            clearTimeout(backTimer);
            backTimer = setTimeout(resolve, 400);
          };
          try {
            if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
          } catch {}
        });

        try {
          await Promise.race([
            (async () => {
              await initPromise;
              await AdMob.prepareInterstitial({ adId: IDS.interstitial, isTesting: TESTING });
              if (gaveUp) return;
              await AdMob.showInterstitial();
            })(),
            backHome,
            new Promise((resolve) => {
              giveUpTimer = setTimeout(() => { gaveUp = true; resolve(); }, 15000);
            }),
          ]);
        } finally {
          clearTimeout(giveUpTimer);
          clearTimeout(backTimer);
          try {
            if (onVis && typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
          } catch {}
        }
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
      if (bannerSuppressed) return;
      await AdMob.showBanner({
        adId: IDS.banner,
        adSize: BannerAdSize.ADAPTIVE_BANNER,
        position: BannerAdPosition.BOTTOM_CENTER,
        isTesting: TESTING,
      });
      if (bannerSuppressed) { try { await AdMob.hideBanner(); } catch {} }
    } catch (e) { debugError("[ads] showBannerAgain failed", e); }
  },

  billing: false,
  purchaseRemoveAds: async () => false,
  restorePurchases: async () => false,
};

