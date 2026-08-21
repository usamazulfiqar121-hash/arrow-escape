import { AdMob, BannerAdSize, BannerAdPosition } from '@capacitor-community/admob';

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
const initPromise = AdMob.initialize()
  .then(() => {
    // A persistent bottom banner, shown once at startup. Failures here
    // (e.g. a plugin version whose API shape differs) are caught below and
    // never block interstitial or rewarded ads.
    return AdMob.showBanner({
      adId: IDS.banner,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      isTesting: TESTING,
    }).catch((e) => console.error("[ads] banner failed to show", e));
  })
  .catch((e) => {
    console.error("[ads] AdMob.initialize() failed", e);
  });

window.ArrowAds = {
  ready: true,

  async showRewarded() {
    try {
      await initPromise;
      await AdMob.prepareRewardVideoAd({ adId: IDS.rewarded, isTesting: TESTING });
      await AdMob.showRewardVideoAd();
      // NOTE: this counts the ad as watched as soon as it is shown without
      // throwing — it does not yet confirm the viewer watched to completion
      // (AdMob fires a separate reward event for that). Someone could close
      // the ad early and still be credited. Fine for now while you're
      // getting ads to show at all; worth tightening before this ships.
      return true;
    } catch (e) {
      console.error("[ads] rewarded failed", e);
      return false;
    }
  },

  async showInterstitial() {
    try {
      await initPromise;
      await AdMob.prepareInterstitial({ adId: IDS.interstitial, isTesting: TESTING });
      await AdMob.showInterstitial();
    } catch (e) {
      console.error("[ads] interstitial failed", e);
    }
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
