// Metro 設定: WebView に require で読み込むため .html をアセットとして扱う。
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push("html");

module.exports = config;
