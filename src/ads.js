import { AdMob, BannerAdSize, BannerAdPosition, RewardAdPluginEvents } from '@capacitor-community/admob';

// Flip to false when you're ready to go live on your own ad units.
// true  -> Google's official sample ad units. These always fill, instantly,
//          on every device — use this to prove the whole pipeline works.
// false -> your real created ad units. These only fill once Google has
//          approved the app and there's real install traffic.
const TESTING = true;

// Google's published sample ad units — safe to ship, meant to be used exactly
// like this during development. https://developers.google.com/admob/android/test-ads
const GOOGLE_TEST_IDS = {
  banner: "ca-app-pub-3940256099942544/6300978111",
  interstitial: "ca-app-pub-3940256099942544/1033173712",
  rewarded: "ca-app-pub-3940256099942544/5224354917",
};

// Your real ad units, created in AdMob for this app.
const PROD_IDS = {
  banner: "ca-app-pub-5743225482205913/5655183719",
  interstitial: "ca-app-pub-5743225482205913/2019191036",
  rewarded: "ca-app-pub-5743225482205913/9478878652",
};

const IDS = TESTING ? GOOGLE_TEST_IDS : PROD_IDS;

// AdMob.initialize() must resolve before any prepare/show call, but
// window.ArrowAds has to exist synchronously before the app mounts. So the
// object is created immediately; every method just awaits this promise first.
// initPromise itself never rejects — each step below catches its own errors
// so a banner problem is never mislabeled as an initialize failure.
// TEMPORARY — surfaces exactly what's happening on screen since there's no
// ADB access to read console logs on the test device. Remove this whole
// block once ads are confirmed working; it must never ship to real users.
const DEBUG_ALERT = false; // set true again if ads stop working and you need to see why
function debugLog(msg) {
  console.log(msg);
  if (DEBUG_ALERT) { try { window.alert(msg); } catch {} }
}
function debugError(label, e) {
  const msg = label + ": " + (e?.message || e?.toString?.() || JSON.stringify(e));
  console.error(msg);
  if (DEBUG_ALERT) { try { window.alert(msg); } catch {} }
}

const initPromise = (async () => {
  try {
    await AdMob.initialize();
    debugLog("[ads] initialize OK");
  } catch (e) {
    debugError("[ads] initialize FAILED", e);
  }
  try {
    // A persistent bottom banner, shown once at startup.
    await AdMob.showBanner({
      adId: IDS.banner,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      isTesting: TESTING,
    });
    debugLog("[ads] banner OK");
  } catch (e) {
    debugError("[ads] banner FAILED", e);
  }
})();

// Only one ad may be in flight at a time. Without this, tapping a button
// repeatedly starts a second/third prepare+show before the first finishes,
// which stacks ads on top of each other and lets their reward events cross
// wires. Repeat taps now quietly join the ad already running instead.
let rewardedInFlight = null;
let interstitialInFlight = null;

async function runRewarded() {
  const handles = [];
  const cleanup = async () => {
    for (const h of handles) { try { await h?.remove?.(); } catch {} }
  };
  let timer;
  try {
    await initPromise;
    await AdMob.prepareRewardVideoAd({ adId: IDS.rewarded, isTesting: TESTING });

    // Track whether the viewer actually earned the reward, not just
    // whether the ad opened. Listeners are registered — and confirmed
    // attached — before the ad is shown, so a fast viewer can't finish
    // before we're listening. If RewardAdPluginEvents turns out not to
    // match this plugin version, none of these three ever fire and the
    // 60s timeout falls back to the old "shown = credited" behaviour —
    // so this can only get stricter, never break rewards.
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
        else if (r.status === "rejected") console.error("[ads] a reward listener failed to register", r.reason);
      }
    } catch (e) {
      console.error("[ads] reward event listeners unavailable, falling back", e);
    }

    timer = setTimeout(() => settleOnce(true), 60000);
    await AdMob.showRewardVideoAd();
    const result = await earned;
    clearTimeout(timer);
    return result;
  } catch (e) {
    clearTimeout(timer);
    debugError("[ads] rewarded FAILED", e);
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
      try {
        await initPromise;
        await AdMob.prepareInterstitial({ adId: IDS.interstitial, isTesting: TESTING });
        await AdMob.showInterstitial();
      } catch (e) {
        console.error("[ads] interstitial failed", e);
      } finally {
        interstitialInFlight = null;
      }
    })();
    return interstitialInFlight;
  },

  // Exposed in case you want the game to hide/show the banner around
  // specific screens later (e.g. hide during play). Not wired to anything
  // yet — showBanner() above already displays it once at startup.
  async hideBanner() {
    try { await AdMob.hideBanner(); } catch (e) { console.error("[ads] hideBanner failed", e); }
  },
  async showBannerAgain() {
    try {
      await initPromise;
      await AdMob.showBanner({
        adId: IDS.banner,
        adSize: BannerAdSize.ADAPTIVE_BANNER,
        position: BannerAdPosition.BOTTOM_CENTER,
        isTesting: TESTING,
      });
    } catch (e) { console.error("[ads] showBannerAgain failed", e); }
  },

  // Play Billing isn't wired up yet — both correctly report "not available"
  // rather than pretending to succeed.
  purchaseRemoveAds: async () => false,
  restorePurchases: async () => false,
};
