import { AdMob, BannerAdSize, BannerAdPosition, RewardAdPluginEvents } from '@capacitor-community/admob';

// Flip to false when you're ready to go live on your own ad units.
// true  -> Google's official sample ad units. These always fill, instantly,
//          on every device — use this to prove the whole pipeline works.
// false -> your real created ad units. These only fill once Google has
//          approved the app and there's real install traffic.
/* false = the real ad units below. Test ads earn nothing and serving them from
   a published app breaks AdMob's terms, so this has to be false in anything
   that reaches the Play Store. Flip it back to true while developing — that is
   what Google's sample units exist for. */
const TESTING = false;

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
/* Turned on because rewarded video is failing and the real reason is being
   thrown away. Every failure currently reaches the player as the same sentence,
   "No ad available right now", whether the cause is no fill, a bad unit id, a
   plugin mismatch or the ad simply not being ready yet — so there is nothing to
   act on. AdMob's own report shows three requests across a week at a hundred
   percent match, which is the banner: the rewarded request is not arriving at
   all. Set back to false once the cause is known. */
const DEBUG_ALERT = true;
function debugLog(msg) {
  console.log(msg);
  if (DEBUG_ALERT) { try { window.alert(msg); } catch {} }
}
function debugError(label, e) {
  const msg = label + ": " + (e?.message || e?.toString?.() || JSON.stringify(e));
  console.error(msg);
  if (DEBUG_ALERT) { try { window.alert(msg); } catch {} }
}

// Once the player removes ads we must never put the banner back — including
// the startup one, which may still be in flight when hideBanner() is called.
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
    // A persistent bottom banner, shown once at startup.
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

/* Ask for the first rewarded ad as soon as init is done, while the player is
   still on the home screen.

   Deliberately outside the block above. warmRewarded awaits initPromise, so
   calling it from inside initPromise means awaiting a promise that has not
   resolved yet — it happens to work only because the call is not awaited, and
   would deadlock the moment anyone added one. Hanging it off .then() has no
   such trap. */
initPromise.then(() => warmRewarded());

// Only one ad may be in flight at a time. Without this, tapping a button
// repeatedly starts a second/third prepare+show before the first finishes,
// which stacks ads on top of each other and lets their reward events cross
// wires. Repeat taps now quietly join the ad already running instead.
let rewardedInFlight = null;
let interstitialInFlight = null;

/* Keep one rewarded ad warm.

   The ad was only ever requested at the moment the player tapped, so a request
   that did not fill instantly became "No ad available right now" — and rewarded
   inventory is far thinner than banner inventory, especially for a new app.
   Asking early and in the background gives the request time to fill, and turns
   the tap into a show rather than a fetch.

   A prepared ad is consumed when shown, so this re-arms after every use. */
let rewardReady = false;
let warming = null;

async function warmRewarded() {
  if (rewardReady || warming) return warming;
  warming = (async () => {
    try {
      await initPromise;
      await AdMob.prepareRewardVideoAd({ adId: IDS.rewarded, isTesting: TESTING });
      rewardReady = true;
    } catch (e) {
      rewardReady = false;
      debugError("[ads] rewarded could not be prepared", e);
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
    // use the one kept warm; only wait on a fresh request if there is none
    if (!rewardReady) await warmRewarded();
    if (!rewardReady) throw new Error("no rewarded ad filled");

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
        else if (r.status === "rejected") debugError("[ads] a reward listener failed to register", r.reason);
      }
    } catch (e) {
      debugError("[ads] reward event listeners unavailable, falling back", e);
    }

    timer = setTimeout(() => settleOnce(true), 60000);
    await AdMob.showRewardVideoAd();
    rewardReady = false;          // showing consumes it
    const result = await earned;
    clearTimeout(timer);
    warmRewarded();               // start the next one now, not at the next tap
    return result;
  } catch (e) {
    clearTimeout(timer);
    /* Drop the warm flag on any failure. Without this a show that throws leaves
       rewardReady set from the earlier prepare, so the next tap skips the
       warm-up, goes straight to showing an ad that is not there, and fails the
       same way — for good. Clearing it and asking again is the only way out. */
    rewardReady = false;
    debugError("[ads] rewarded FAILED", e);
    warmRewarded();
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
        // Race against a timeout so a hung prepare/show call can never freeze
        // the "next level" tap forever — same bug class as the rewarded-ad
        // freeze, fixed the same way: give up and let the game continue.
        // Interstitials are short and this blocks the player meanwhile, so
        // the grace period is much shorter than the rewarded ad's 60s.
        await Promise.race([
          (async () => {
            await initPromise;
            await AdMob.prepareInterstitial({ adId: IDS.interstitial, isTesting: TESTING });
            await AdMob.showInterstitial();
          })(),
          new Promise((resolve) => setTimeout(resolve, 15000)),
        ]);
      } catch (e) {
        debugError("[ads] interstitial failed", e);
      } finally {
        interstitialInFlight = null;
      }
    })();
    return interstitialInFlight;
  },

  // Exposed in case you want the game to hide/show the banner around
  // specific screens later (e.g. hide during play). Not wired to anything
  // yet — showBanner() above already displays it once at startup.
  // Called by the game once ads are removed. Permanent for this session:
  // the startup banner cannot race back in after it.
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

  // Play Billing isn't wired up yet — both correctly report "not available"
  // rather than pretending to succeed.
  /* Play Billing is not wired up. These stay as stubs, and `billing` tells the
     app so — a Buy button that can only ever answer "purchases aren't set up
     yet" looks like a broken app to a player and is a fair question for a store
     reviewer. Set this to true in the same change that implements the two
     functions below, and the button comes back on its own. */
  billing: false,
  purchaseRemoveAds: async () => false,
  restorePurchases: async () => false,
};
