import { AdMob } from '@capacitor-community/admob';
const TESTING = true;
const TEST_IDS = {
  banner: "ca-app-pub-5743225482205913/5655183719",
  interstitial: "ca-app-pub-5743225482205913/2019191036",
  rewarded: "ca-app-pub-5743225482205913/9478878652",
};
const REAL_IDS = {
  banner: "YOUR_REAL_BANNER_ID",
  interstitial: "YOUR_REAL_INTERSTITIAL_ID",
  rewarded: "YOUR_REAL_REWARDED_ID",
};
const IDS = TESTING ? TEST_IDS : REAL_IDS;
window.ArrowAds = {
  ready: true,
  async showRewarded() {
    try {
      await AdMob.prepareRewardVideoAd({ adId: IDS.rewarded });
      const result = await AdMob.showRewardVideoAd();
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  },
  async showInterstitial() {
    try {
      await AdMob.prepareInterstitial({ adId: IDS.interstitial });
      await AdMob.showInterstitial();
    } catch (e) {
      console.error(e);
    }
  },
  purchaseRemoveAds: async () => false,
  restorePurchases: async () => false,
};
