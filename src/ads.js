let isShowingAd = false;
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
  rewarded: "ca-app-pub-5743225482205913/9637414887",
};

const IDS = TESTING ? GOOGLE_TEST_IDS : PROD_IDS;

// AdMob.initialize() must resolve before any prepare/show call, but
// window.ArrowAds has to exist synchronously before the app mounts. So the
// object is created immediately; every method just awaits this promise first.
  if (DEBUG_ALERT) { try { window.alert(msg); } catch (e) {} }
// so a banner problem is never mislabeled as an initialize failure.
// TEMPORARY — surfaces exactly what's happening on screen since there's no
// ADB access to read console logs on the test device. Remove this whole
// block once ads are confirmed working; it must never ship to real users.
/* Off again: it did its job. The rewarded ad unit id was wrong — the banner
   worked because its id was right, and every rewarded request was going to a
   unit that did not exist. With this on, the real error was visible in one tap
   instead of being flattened into "No ad available right now".

   Set it back to true the next time ads misbehave. It alerts on success as well
   as failure, which is why it cannot be left on: three dialogs on every launch. */
  if (DEBUG_ALERT) { try { window.alert(msg); } catch (e) {} }
function debugLog(msg) {
  console.log(msg);
  if (DEBUG_ALERT) { try { window.alert(msg); } catch (e) {} }
}
function debugError(label, e) {
  const msg = label + ": " + (e?.message || e?.toString?.() || JSON.stringify(e));
  console.error(msg);
  if (DEBUG_ALERT) { try { window.alert(msg); } catch (e) {} }
  if (DEBUG_ALERT) { try { window.alert(msg); } catch (e) {} }
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

/* The retry has to stop. It used to schedule another attempt ten seconds after
   every failure, and that attempt did the same on failure — so where ads simply
   do not fill in a region, which is the case this retry exists for, it became a
   network request every ten seconds for as long as the app stayed open, with no
   cap and no backoff. A failed tap could also start a second chain alongside
   the first, because `warming` is already null again by the time the timer
   fires, and each chain then retried for ever on its own.

   Five attempts, backing off, and only one chain at a time. A player who taps
   Watch ad resets the count, because that is a fresh reason to try. */
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
        // 10s, 20s, 40s, 80s — then stop until the player asks again
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
      /* All three guarded, not just the first. The first line was written to
         survive RewardAdPluginEvents being undefined; the next two were not, so
         in exactly that case the second line throws while the array is still
         being built. Promise.allSettled never runs, the first listener has
         already been registered and its handle is never collected — so it is
         never removed either, and it leaks, one per attempt. */
      const EV = RewardAdPluginEvents || {};
      const results = await Promise.allSettled([
        AdMob.addListener(EV.Rewarded || 'onRewarded', () => settleOnce(true)),
        AdMob.addListener(EV.Dismissed || 'onRewardedVideoAdDismissed', () => settleOnce(false)),
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

    /* Coming back to the app ends the ad.

       Backing out of a rewarded ad is the one case none of the three listeners
       covers: the plugin's Dismissed event does not arrive, so nothing settles
       and the button sits on "Loading ad…" until a timeout an entire minute
       later. The player's only way out is to restart the game.

       A rewarded ad always hides the app, so the app becoming visible again is
       the ad being over. Three things this gets right that the obvious version
       does not:

         - it listens for VISIBLE, not hidden. Hidden fires as the ad opens,
           which is the middle of a working ad, not the end of one.
         - it settles the promise. Clearing the in-flight guard instead would
           leave this one still hanging and let a second ad start on top of it.
         - it waits a moment first. Some plugins deliver the reward event just
           after focus returns, and answering instantly would rob a player who
           watched the whole thing. A real event still wins; this only speaks
           when nothing else does.

       It arms only once the ad has actually taken the screen, so a player who
       switches apps before the ad opens is not counted as having dismissed it. */
    let wentAway = false;
    let backGrace = null;
    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.hidden) { wentAway = true; return; }
      if (!wentAway || settled) return;
      clearTimeout(backGrace);
      backGrace = setTimeout(() => settleOnce(false), 1200);
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

    /* The whole sequence is bounded, not just the waiting.

       The sixty-second timer below only settles `earned` — and `earned` is read
       on the line after the show call. So if showRewardVideoAd() itself never
       resolves, which a misbehaving plugin can do, execution never reaches that
       line and the timer resolves something nobody is listening to. The tap
       hangs for good.

       Ninety seconds, deliberately long. A rewarded video runs fifteen to
       thirty, and a bound tight enough to cut one off is worse than the hang it
       prevents: the viewer sits through the whole ad and is told they earned
       nothing. This only ever fires when something is genuinely stuck. */
    let stuck;
    const giveUp = new Promise((resolve) => { stuck = setTimeout(() => resolve(null), 90000); });
    const watched = (async () => {
      await AdMob.showRewardVideoAd();
      rewardReady = false;        // showing consumes it
      return await earned;
    })();

    const raced = await Promise.race([watched, giveUp]);
    clearTimeout(stuck);
    clearTimeout(timer);
    const result = raced === null ? false : raced;
    if (raced === null) debugError("[ads] rewarded never returned, giving up", null);
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
    // the player asking is a fresh reason to try, so the attempt count resets
    warmFails = 0;
    if (warmTimer) { clearTimeout(warmTimer); warmTimer = null; }
    warmRewarded(2000);
    isShowingAd = false;
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
        /* `gaveUp` exists because Promise.race does not cancel the loser — it
           only stops waiting for it. Without the check, a prepare that answers
           after the fifteen seconds still goes on to show the ad, and it lands
           on whatever the player is doing by then: an interstitial appearing in
           the middle of a level, with nothing that caused it. */
        let gaveUp = false;

        /* And the same return-to-app rule the rewarded ad uses, for the same
           reason. Backing out of an interstitial does not always resolve the
           show call, and the next board is waiting on this — so the player
           dismisses the ad and then sits looking at a frozen screen for the
           full fifteen seconds. Coming back to the app means the ad is gone.
           Armed only once it has actually taken the screen. */
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
            new Promise((resolve) => setTimeout(() => { gaveUp = true; resolve(); }, 15000)),
          ]);
        } finally {
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
      /* The same guard the startup banner has, which this was missing. A call
         to showBanner takes time, and hideBanner() can land in the middle of
         it: the player removes ads, the banner goes away, and then this one
         finishes loading and puts it straight back. Checked before, and again
         after, because the answer can change while the await is running. */
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
