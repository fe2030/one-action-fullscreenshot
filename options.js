/**
 * One Action Fullscreenshot - Options Page Script
 * 
 * 設定の読み込み、保存、UIの更新を担当
 */

// ========================================
// 定数
// ========================================

const DEFAULT_SETTINGS = {
  actionType: 'clipboard',
  fileFormat: 'png'
};

// ========================================
// DOM要素の取得
// ========================================

const actionClipboard = document.getElementById('action-clipboard');
const actionDownload = document.getElementById('action-download');
const formatPng = document.getElementById('format-png');
const formatJpeg = document.getElementById('format-jpeg');
const saveStatus = document.getElementById('save-status');
const formatSection = document.getElementById('format-section');
const formatNotice = document.getElementById('format-notice');

// ========================================
// 設定の読み込み
// ========================================

/**
 * 保存された設定を読み込んでUIに反映
 */
async function loadSettings() {
  try {
    const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    
    // Action Type
    if (settings.actionType === 'download') {
      actionDownload.checked = true;
    } else {
      actionClipboard.checked = true;
    }
    
    // File Format
    if (settings.fileFormat === 'jpeg') {
      formatJpeg.checked = true;
    } else {
      formatPng.checked = true;
    }
    
    // フォーマットセクションの状態を更新
    updateFormatSectionState();
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

// ========================================
// 設定の保存
// ========================================

/**
 * 現在のUI状態を設定として保存
 */
async function saveSettings() {
  try {
    const settings = {
      actionType: actionDownload.checked ? 'download' : 'clipboard',
      fileFormat: formatJpeg.checked ? 'jpeg' : 'png'
    };
    
    await chrome.storage.sync.set(settings);
    
    // 保存成功を表示
    showSaveStatus();
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

/**
 * 保存成功のステータスを表示
 */
function showSaveStatus() {
  saveStatus.textContent = '✓ Settings saved';
  saveStatus.classList.add('visible');
  
  // 2秒後に非表示
  setTimeout(() => {
    saveStatus.classList.remove('visible');
  }, 2000);
}

/**
 * File Format セクションの有効/無効を切り替え
 * クリップボードモードの場合は無効化（PNGのみサポート）
 */
function updateFormatSectionState() {
  const isClipboardMode = actionClipboard.checked;
  
  if (isClipboardMode) {
    // クリップボードモード: フォーマット選択を無効化
    formatSection.classList.add('disabled');
    formatNotice.classList.add('visible');
    // PNGを選択状態に（視覚的に）
    formatPng.checked = true;
  } else {
    // ダウンロードモード: フォーマット選択を有効化
    formatSection.classList.remove('disabled');
    formatNotice.classList.remove('visible');
  }
}

// ========================================
// イベントリスナー
// ========================================

/**
 * 設定変更時に自動保存
 */
function setupEventListeners() {
  // Action Type の変更
  actionClipboard.addEventListener('change', () => {
    updateFormatSectionState();
    saveSettings();
  });
  actionDownload.addEventListener('change', () => {
    updateFormatSectionState();
    saveSettings();
  });
  
  // File Format の変更
  formatPng.addEventListener('change', saveSettings);
  formatJpeg.addEventListener('change', saveSettings);
}

// ========================================
// 初期化
// ========================================

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupEventListeners();
});

