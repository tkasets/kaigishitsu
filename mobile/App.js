import { useCallback, useState } from "react";
import { StyleSheet, View, Text, ActivityIndicator, Platform } from "react-native";
import { WebView } from "react-native-webview";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import GMA, { adsAvailable, bannerUnitId } from "./ads";

// ゲーム本体は Vite で 1 枚に固めた自己完結 HTML(assets/app.html)。
// npm run build:app（リポジトリ直下）で生成され、ここで WebView に読み込む。
const GAME_HTML = require("./assets/app.html");

// 標準的なバナー広告の高さ。実広告が読み込まれるまで(SDK未対応・審査中で広告が
// 配信されない・在庫なし等)は下のプレースホルダーでこの高さのヘッダー領域を確保し、
// 「広告なしで何も表示されない」状態にしない。実広告が読み込まれたらそちらに差し替わる。
const BANNER_HEIGHT = 50;

// バナー広告本体 + プレースホルダー。GMA.BannerAd は読み込みが完了するまで
// 内部的に幅・高さ0で描画される(=読み込み前は何も見えない)ため、読み込み完了
// (onAdLoaded)するまではダミーの広告スペースを重ねて表示しておく。
function AdBanner({ unitId }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <View style={styles.bannerWrap}>
      {unitId && (
        <GMA.BannerAd
          unitId={unitId}
          size={GMA.BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
          requestOptions={{ requestNonPersonalizedAdsOnly: true }}
          onAdLoaded={() => setLoaded(true)}
          onAdFailedToLoad={() => setLoaded(false)}
        />
      )}
      {!loaded && (
        <View style={styles.placeholder} pointerEvents="none">
          <Text style={styles.placeholderText}>広告スペース</Text>
        </View>
      )}
    </View>
  );
}

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

// ゲーム側(app.html)からのメッセージでヘッダーのバナー広告を出し分けるブリッジ。
// ゲームはレイアウト画面にいる間だけ {type:'banner', show:true} を postMessage し、
// ホーム画面・結果画面では {type:'banner', show:false} を送る。
export default function App() {
  const [loading, setLoading] = useState(true);
  const [showBanner, setShowBanner] = useState(false);

  const onMessage = useCallback((event) => {
    let msg = null;
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch (e) {
      return;
    }
    if (msg && msg.type === "banner") setShowBanner(!!msg.show);
  }, []);

  const unitId = adsAvailable ? bannerUnitId() : null;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={["top", "bottom", "left", "right"]}>
        <StatusBar style="dark" />
        {showBanner && <AdBanner unitId={unitId} />}
        <WebView
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
  bannerWrap: {
    width: "100%",
    minHeight: BANNER_HEIGHT,
    alignItems: "center",
    backgroundColor: "#ffffff",
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F5F5F3",
    borderBottomWidth: 1,
    borderColor: "#E0E0DC",
  },
  placeholderText: {
    fontSize: 11,
    letterSpacing: 1,
    color: "#B4B4AE",
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
