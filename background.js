/**
 * One Action Fullscreenshot - Background Service Worker
 * 
 * このファイルはChrome拡張機能のService Workerとして動作し、
 * アイコンクリックやショートカットキーのイベントを処理します。
 */

// ========================================
// 定数定義
// ========================================

// デフォルト設定値
const DEFAULT_SETTINGS = {
  actionType: 'clipboard', // 'clipboard' または 'download'
  fileFormat: 'png'        // 'png' または 'jpeg'
};

// ========================================
// イベントリスナー
// ========================================

/**
 * 拡張機能アイコンクリック時のハンドラ
 * ショートカットキー（_execute_action）も同じハンドラで処理される
 */
chrome.action.onClicked.addListener(async (tab) => {
  // chrome:// や edge:// などの特殊ページでは動作しない
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('chrome-extension://')) {
    console.log('Cannot capture this page type');
    return;
  }

  try {
    // content.jsをタブに注入して実行
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    // スクリーンショット撮影を開始するメッセージを送信
    chrome.tabs.sendMessage(tab.id, { action: 'startCapture' });
  } catch (error) {
    console.error('Failed to inject content script:', error);
  }
});

/**
 * コンテンツスクリプトからのメッセージを処理
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 非同期処理のためtrueを返す
  handleMessage(message, sender, sendResponse);
  return true;
});

/**
 * メッセージハンドラ（非同期処理用）
 */
async function handleMessage(message, sender, sendResponse) {
  try {
    switch (message.action) {
      case 'captureVisibleTab':
        // 現在表示されている領域をキャプチャ
        const dataUrl = await captureVisibleTab(sender.tab.id, message.format);
        sendResponse({ success: true, dataUrl });
        break;

      case 'downloadImage':
        // 画像をダウンロード
        await downloadImage(message.dataUrl, message.filename);
        sendResponse({ success: true });
        break;

      case 'getSettings':
        // 設定を取得
        const settings = await getSettings();
        sendResponse({ success: true, settings });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }
  } catch (error) {
    console.error('Message handler error:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// ========================================
// キャプチャ関連関数
// ========================================

/**
 * 現在表示されているタブの可視領域をキャプチャ
 * @param {number} tabId - タブID
 * @param {string} format - 画像フォーマット ('png' or 'jpeg')
 * @returns {Promise<string>} - Base64エンコードされた画像データURL
 */
async function captureVisibleTab(tabId, format = 'png') {
  // タブが属するウィンドウを取得
  const tab = await chrome.tabs.get(tabId);
  
  const options = {
    format: format === 'jpeg' ? 'jpeg' : 'png',
    quality: format === 'jpeg' ? 92 : undefined
  };

  // 可視領域をキャプチャ
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, options);
  return dataUrl;
}

/**
 * 画像をダウンロード
 * @param {string} dataUrl - Base64エンコードされた画像データURL
 * @param {string} filename - 保存するファイル名
 */
async function downloadImage(dataUrl, filename) {
  await chrome.downloads.download({
    url: dataUrl,
    filename: filename,
    saveAs: false
  });
}

// ========================================
// 設定関連関数
// ========================================

/**
 * ユーザー設定を取得
 * @returns {Promise<Object>} - 設定オブジェクト
 */
async function getSettings() {
  const result = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return result;
}

// ========================================
// 初期化
// ========================================

// 拡張機能インストール時の初期設定
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // デフォルト設定を保存
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
    console.log('One Action Fullscreenshot installed with default settings');
  }
});

