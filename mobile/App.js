import { useEffect, useRef, useState, useCallback } from "react";
import { StyleSheet, View, ActivityIndicator, Platform } from "react-native";
import { WebView } from "react-native-webview";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import GMA, { adsAvailable, interstitialUnitId } from "./ads";

// ゲーム本体は Vite で 1 枚に固めた自己完結 HTML(assets/app.html)。
// npm run build:app（リポジトリ直下）で生成され、ここで WebView に読み込む。
const GAME_HTML = require("./assets/app.html");

// WebView 内でのピンチズーム・長押しメニュー・オーバースクロールを抑制し、
// ネイティブアプリらしい挙動にする注入スクリプト。
const INJECTED_JS = `
  (function () {
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });
    document.documentElement.style.webkitTouchCallout = 'none';
    document.body && (document.body.style.overscrollBehavior = 'none');
  })();
  true;
`;

// ゲーム側(app.html)からのメッセージで広告を出すためのブリッジ。
// ゲームは区切り(クリア/ホームに戻る)で {type:'show-ad'} を postMessage する。
export default function App() {
  const [loading, setLoading] = useState(true);
  const webRef = useRef(null);
  // インタースティシャル広告の状態を保持
  const adRef = useRef({ ad: null, loaded: false, pending: false });

  // WebView に広告結果を伝える。
  //  'shown' … 実広告を表示済み → ゲームはそのまま続行
  //  'none'  … 広告が無い → ゲーム側が代わりのプレースホルダーを表示
  const sendAdResult = useCallback((result) => {
    if (webRef.current) {
      webRef.current.injectJavaScript(
        `window.__kaigiAdResult && window.__kaigiAdResult(${JSON.stringify(result)}); true;`
      );
    }
  }, []);

  // 次のインタースティシャルを読み込む
  const loadInterstitial = useCallback(() => {
    if (!adsAvailable || !GMA) return;
    const unitId = interstitialUnitId();
    if (!unitId) return;
    try {
      const ad = GMA.InterstitialAd.createForAdRequest(unitId, {
        requestNonPersonalizedAdsOnly: true,
      });
      adRef.current.ad = ad;
      adRef.current.loaded = false;
      const onLoaded = () => {
        adRef.current.loaded = true;
      };
      const onClosed = () => {
        // 実広告が閉じた → 保留中なら「表示済み」を通知し、次を先読み
        if (adRef.current.pending) {
          adRef.current.pending = false;
          sendAdResult("shown");
        }
        loadInterstitial();
      };
      const onError = () => {
        // 読み込み/表示に失敗 → 保留中なら「広告なし」を通知(プレースホルダーへ)
        adRef.current.loaded = false;
        if (adRef.current.pending) {
          adRef.current.pending = false;
          sendAdResult("none");
        }
      };
      ad.addAdEventListener(GMA.AdEventType.LOADED, onLoaded);
      ad.addAdEventListener(GMA.AdEventType.CLOSED, onClosed);
      ad.addAdEventListener(GMA.AdEventType.ERROR, onError);
      ad.load();
    } catch (e) {
      // 何かあってもゲームは止めない
      adRef.current.ad = null;
      adRef.current.loaded = false;
    }
  }, [sendAdResult]);

  useEffect(() => {
    if (!adsAvailable || !GMA) return;
    let mounted = true;
    GMA.default
      ? GMA.default().initialize().then(() => mounted && loadInterstitial())
      : GMA.mobileAds().initialize().then(() => mounted && loadInterstitial());
    return () => {
      mounted = false;
    };
  }, [loadInterstitial]);

  // ゲームから広告要求が来たとき
  const handleShowAd = useCallback(() => {
    const state = adRef.current;
    if (adsAvailable && state.ad && state.loaded) {
      // 実広告を表示。閉じたら onClosed で 'shown' を通知する。
      state.pending = true;
      state.loaded = false;
      try {
        state.ad.show();
      } catch (e) {
        // 表示できなかった → プレースホルダー表示に切り替え
        state.pending = false;
        sendAdResult("none");
        loadInterstitial();
      }
    } else {
      // 広告が未準備(Expo Go / 在庫なし) → ゲーム側のプレースホルダーを表示させ、次を読み込む
      sendAdResult("none");
      loadInterstitial();
    }
  }, [sendAdResult, loadInterstitial]);

  const onMessage = useCallback(
    (event) => {
      let msg = null;
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch (e) {
        return;
      }
      if (msg && msg.type === "show-ad") handleShowAd();
    },
    [handleShowAd]
  );

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={["top", "bottom", "left", "right"]}>
        <StatusBar style="dark" />
        <WebView
          ref={webRef}
          source={GAME_HTML}
          originWhitelist={["*"]}
          style={styles.webview}
          bounces={false}
          scrollEnabled={false}
          overScrollMode="never"
          scalesPageToFit={false}
          setBuiltInZoomControls={false}
          javaScriptEnabled
          domStorageEnabled
          allowFileAccess
          allowFileAccessFromFileURLs
          allowUniversalAccessFromFileURLs
          injectedJavaScript={INJECTED_JS}
          onMessage={onMessage}
          onLoadEnd={() => setLoading(false)}
          textZoom={100}
        />
        {loading && (
          <View style={styles.loader} pointerEvents="none">
            <ActivityIndicator size="large" color="#555" />
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  webview: {
    flex: 1,
    backgroundColor: "#ffffff",
    ...(Platform.OS === "web" ? { height: "100%" } : {}),
  },
  loader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
});
