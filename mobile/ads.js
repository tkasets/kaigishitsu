// AdMob 広告ユニットの設定。
//
// 開発中(__DEV__)は必ず Google のテスト広告を使う(実広告をクリックするとBAN対象)。
// 本番では下の実IDに差し替える。
//
// 【本番で必要な作業】
//  1. https://admob.google.com でアカウント作成、iOSアプリを登録
//  2. アプリの「アプリID」(ca-app-pub-XXXX~YYYY)を app.json の plugins →
//     react-native-google-mobile-ads の iosAppId に設定
//  3. 「インタースティシャル」広告ユニットを作成し、その広告ユニットID
//     (ca-app-pub-XXXX/ZZZZ)を下の PROD_INTERSTITIAL_IOS に設定
import { Platform, NativeModules } from "react-native";

// react-native-google-mobile-ads はネイティブモジュール。
// Expo Go では利用できないため、読み込めない場合は null を返して広告なしで動かす。
let GMA = null;
try {
  // ネイティブ側が存在するときだけ有効(Expo Go では RNGoogleMobileAdsModule が無い)
  if (NativeModules && NativeModules.RNGoogleMobileAdsModule) {
    GMA = require("react-native-google-mobile-ads");
  }
} catch (e) {
  GMA = null;
}

export const adsAvailable = !!GMA;

// 本番の実広告ユニットID(要差し替え)。
const PROD_INTERSTITIAL_IOS = "ca-app-pub-0000000000000000/0000000000";
const PROD_INTERSTITIAL_ANDROID = "ca-app-pub-0000000000000000/0000000000";

export function interstitialUnitId() {
  if (!GMA) return null;
  // 開発中・実IDが未設定のうちはテストIDを使う。
  if (__DEV__) return GMA.TestIds.INTERSTITIAL;
  const id = Platform.OS === "ios" ? PROD_INTERSTITIAL_IOS : PROD_INTERSTITIAL_ANDROID;
  if (id.includes("0000000000")) return GMA.TestIds.INTERSTITIAL; // 未設定ならテスト
  return id;
}

export default GMA;
