# 会議室レイアウター — iOSアプリ (Expo)

Web版のゲーム(React + Vite)を、1枚の自己完結HTMLに固めて WebView で表示する
Expoアプリです。**Mac なし**で、Expo のクラウド(EAS)を使って iOS ビルド・App Store 提出まで行えます。

## 仕組み

1. リポジトリ直下で `npm run build:app` を実行 → `mobile/assets/app.html` を生成
   （JS・CSS・画像すべてインラインの単一HTML。広告なし。オフライン動作）
2. このアプリ(`App.js`)が `react-native-webview` でその HTML を読み込む

`app.html` は**ビルド成果物**なので git 管理外。EAS ビルド前に必ず再生成すること。

## 前提

- **Expo アカウント**（無料）: https://expo.dev で登録
- **Apple Developer Program**（年 $99）: App Store 提出に必須。Expo でも回避不可
  - https://developer.apple.com/programs/
- `eas-cli`（インストール済みの `npx eas` を使用）

## セットアップ手順

```bash
# 0) ゲーム本体をビルド（リポジトリ直下で）
cd ..
npm run build:app
cd mobile

# 1) 依存インストール（初回のみ）
npm install

# 2) Expo にログイン
npx eas login

# 3) EAS プロジェクトを紐付け（初回のみ。projectId が app.json に書き込まれる）
npx eas init
```

## ローカル実機テスト（Windowsから今すぐ可能）

App Store 提出前に、iPhone の **Expo Go** アプリで動作確認できます。

```bash
npx expo start
# 表示されたQRコードを iPhone のカメラ/Expo Goで読み取る
```

> 注: `react-native-webview` はネイティブモジュールのため、完全な挙動確認は
> 開発ビルド（`eas build --profile development`）や本番ビルドが確実です。
> Expo Go でも WebView 自体は動作します。

## iOSクラウドビルド（Mac不要）

```bash
# シミュレータ用（Macがなくても .app が出力される。動作確認用）
npx eas build --platform ios --profile preview

# 本番用（実機/App Store 用。Apple Developer アカウントのサインインを求められる）
npx eas build --platform ios --profile production
```

初回の production ビルドで、EAS が iOS の証明書・プロビジョニングプロファイルを
**自動生成・管理**します（Apple ID でのログインが必要。Mac不要）。

## App Store への提出（Mac不要）

```bash
npx eas submit --platform ios --latest
```

App Store Connect の API キー or Apple ID を使ってアップロード。
その後は https://appstoreconnect.apple.com でメタデータ・スクショを設定し審査提出。

## 更新時のワークフロー

ゲーム内容を変えたとき:

```bash
cd .. && npm run build:app && cd mobile   # HTML再生成
# app.json の version / ios.buildNumber を上げる
npx eas build --platform ios --profile production
npx eas submit --platform ios --latest
```

## 注意点

- **広告**: アプリ内は AdSense を除外済み（規約違反・審査落ち回避）。
  収益化する場合は AdMob（`react-native-google-mobile-ads`）を別途組み込む。
- **アイコン/スプラッシュ**: `assets/icon.png` `assets/splash.png` `assets/adaptive-icon.png`
  は仮のプレースホルダー。本番前に差し替え推奨（icon は 1024×1024）。
- **Apple審査 4.2**: 「単なるWebサイトの再パッケージ」は却下対象。本アプリは
  インタラクティブなゲームなので該当しにくいが、審査コメントには実機同等の
  ゲーム性を示すこと。
