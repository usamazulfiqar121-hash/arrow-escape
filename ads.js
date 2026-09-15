let rewardedInFlight = false;
let interstitialInFlight = false;

export async function warmRewarded() {
    try {
        if (typeof AdMob !== 'undefined' && AdMob.prepareRewardVideoAd) {
            await AdMob.prepareRewardVideoAd({ adId: 'your_rewarded_ad_unit_id' });
        }
    } catch (e) {
        console.warn('Ad warm failed:', e);
    }
}

export async function runRewarded() {
    if (rewardedInFlight) return false;
    rewardedInFlight = true;

    let listeners = [];
    try {
        const adPromise = new Promise(async (resolve, reject) => {
            let rewardEarned = false;

            const l1 = await AdMob.addListener('onRewardedVideoAdReward', () => {
                rewardEarned = true;
            });
            listeners.push(l1);

            const l2 = await AdMob.addListener('onRewardedVideoAdDismissed', () => {
                resolve(rewardEarned);
            });
            listeners.push(l2);

            await AdMob.showRewardVideoAd();
        });

        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Rewarded ad timeout')), 60000)
        );

        const result = await Promise.race([adPromise, timeoutPromise]);
        return result;
    } catch (e) {
        console.error('Rewarded ad error:', e);
        return false;
    } finally {
        await Promise.allSettled(listeners.map(l => l.remove && l.remove()));
        listeners = [];
        rewardedInFlight = false;
        warmRewarded();
    }
}

export async function runInterstitial() {
    if (interstitialInFlight) return;
    interstitialInFlight = true;

    try {
        const adPromise = AdMob.showInterstitialAd();
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Interstitial timeout')), 15000)
        );
        await Promise.race([adPromise, timeoutPromise]);
    } catch (e) {
        console.warn('Interstitial error:', e);
    } finally {
        interstitialInFlight = false;
    }
}
