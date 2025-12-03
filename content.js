/**
 * One Action Fullscreenshot - Content Script
 * 
 * このファイルはWebページ内で実行され、
 * スクロールキャプチャ、画像結合、クリップボードコピー、トースト通知を担当します。
 */

// 多重実行防止フラグ
if (typeof window.__fullscreenshot_initialized === 'undefined') {
  window.__fullscreenshot_initialized = true;

  // ========================================
  // 定数定義
  // ========================================

  const TOAST_DURATION = 3000; // トースト表示時間（ミリ秒）
  const SCROLL_DELAY = 600;    // スクロール後の待機時間（ミリ秒）- レート制限対策で長めに設定
  const MAX_RETRIES = 3;       // キャプチャ失敗時の最大リトライ回数
  const RETRY_DELAY = 500;     // リトライ時の追加待機時間（ミリ秒）

  // キャンセルフラグ
  let isCancelled = false;

  // ========================================
  // オーバーレイUI（進捗表示・キャンセルボタン）
  // ========================================

  /**
   * キャプチャ中のオーバーレイを表示
   * @returns {Object} - オーバーレイ要素と更新関数
   */
  function showCaptureOverlay() {
    // 既存のオーバーレイを削除
    const existing = document.getElementById('fullscreenshot-overlay');
    if (existing) existing.remove();

    // オーバーレイ作成（透明だがクリックをブロック）
    const overlay = document.createElement('div');
    overlay.id = 'fullscreenshot-overlay';
    overlay.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      background: transparent !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      z-index: 2147483647 !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      pointer-events: auto !important;
    `;

    // 中央ダイアログ（これだけキャプチャ時に非表示にする）
    const container = document.createElement('div');
    container.id = 'fullscreenshot-dialog';
    container.style.cssText = `
      background: rgba(30, 30, 30, 0.95) !important;
      border-radius: 16px !important;
      padding: 32px 48px !important;
      text-align: center !important;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5) !important;
    `;

    // スピナー
    const spinner = document.createElement('div');
    spinner.style.cssText = `
      width: 48px !important;
      height: 48px !important;
      border: 4px solid rgba(255, 255, 255, 0.2) !important;
      border-top-color: #4facfe !important;
      border-radius: 50% !important;
      margin: 0 auto 16px !important;
      animation: fullscreenshot-spin 1s linear infinite !important;
    `;

    // スピナーアニメーション用のスタイル追加
    const style = document.createElement('style');
    style.textContent = `
      @keyframes fullscreenshot-spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);

    // 進捗テキスト
    const progressText = document.createElement('div');
    progressText.id = 'fullscreenshot-progress';
    progressText.style.cssText = `
      color: #ffffff !important;
      font-size: 18px !important;
      font-weight: 500 !important;
      margin-bottom: 8px !important;
    `;
    progressText.textContent = 'Capturing...';

    // 進捗詳細
    const progressDetail = document.createElement('div');
    progressDetail.id = 'fullscreenshot-progress-detail';
    progressDetail.style.cssText = `
      color: rgba(255, 255, 255, 0.6) !important;
      font-size: 14px !important;
      margin-bottom: 24px !important;
    `;
    progressDetail.textContent = 'Preparing...';

    // キャンセルボタン
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
      background: transparent !important;
      border: 2px solid rgba(255, 255, 255, 0.3) !important;
      color: #ffffff !important;
      padding: 10px 32px !important;
      font-size: 14px !important;
      font-weight: 500 !important;
      border-radius: 8px !important;
      cursor: pointer !important;
      transition: all 0.2s ease !important;
    `;
    cancelBtn.onmouseover = () => {
      cancelBtn.style.background = 'rgba(255, 255, 255, 0.1)';
      cancelBtn.style.borderColor = 'rgba(255, 255, 255, 0.5)';
    };
    cancelBtn.onmouseout = () => {
      cancelBtn.style.background = 'transparent';
      cancelBtn.style.borderColor = 'rgba(255, 255, 255, 0.3)';
    };
    cancelBtn.onclick = () => {
      isCancelled = true;
      progressText.textContent = 'Cancelling...';
      cancelBtn.disabled = true;
      cancelBtn.style.opacity = '0.5';
      cancelBtn.style.cursor = 'not-allowed';
    };

    // 要素を組み立て
    container.appendChild(spinner);
    container.appendChild(progressText);
    container.appendChild(progressDetail);
    container.appendChild(cancelBtn);
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    // 進捗更新関数を返す
    return {
      element: overlay,
      dialog: container,  // 中央ダイアログへの参照（キャプチャ時に非表示にする用）
      updateProgress: (current, total) => {
        progressDetail.textContent = `${current} / ${total}`;
      },
      remove: () => {
        overlay.remove();
        style.remove();
      }
    };
  }

  // ========================================
  // トースト通知
  // ========================================

  /**
   * トースト通知を表示
   * @param {string} message - 表示するメッセージ
   * @param {string} type - 通知タイプ ('success', 'warning', 'error')
   */
  function showToast(message, type = 'success') {
    // 既存のトーストを削除
    const existingToast = document.getElementById('fullscreenshot-toast');
    if (existingToast) {
      existingToast.remove();
    }

    // トースト要素を作成
    const toast = document.createElement('div');
    toast.id = 'fullscreenshot-toast';
    
    // スタイルを設定（インラインスタイルでページのCSSに影響されないようにする）
    toast.style.cssText = `
      position: fixed !important;
      bottom: 20px !important;
      right: 20px !important;
      padding: 12px 24px !important;
      background-color: rgba(0, 0, 0, 0.85) !important;
      color: #ffffff !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      font-size: 14px !important;
      font-weight: 500 !important;
      border-radius: 8px !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
      z-index: 2147483647 !important;
      opacity: 0 !important;
      transform: translateY(10px) !important;
      transition: opacity 0.3s ease, transform 0.3s ease !important;
      pointer-events: none !important;
    `;

    // タイプに応じてアイコンを追加
    let icon = '✓';
    if (type === 'warning') {
      icon = '⚠';
      toast.style.backgroundColor = 'rgba(255, 152, 0, 0.9)';
    } else if (type === 'error') {
      icon = '✕';
      toast.style.backgroundColor = 'rgba(244, 67, 54, 0.9)';
    }

    toast.textContent = `${icon} ${message}`;

    // DOMに追加
    document.body.appendChild(toast);

    // フェードイン
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    // 指定時間後にフェードアウト
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      
      // アニメーション完了後に削除
      setTimeout(() => {
        if (toast.parentNode) {
          toast.remove();
        }
      }, 300);
    }, TOAST_DURATION);
  }

  /**
   * サブテキスト付きトースト通知を表示（成功メッセージ + 補足情報）
   * @param {string} message - メインメッセージ
   * @param {string} subtext - 補足テキスト（薄い色で表示）
   */
  function showToastWithSubtext(message, subtext) {
    // 既存のトーストを削除
    const existingToast = document.getElementById('fullscreenshot-toast');
    if (existingToast) {
      existingToast.remove();
    }

    // トースト要素を作成
    const toast = document.createElement('div');
    toast.id = 'fullscreenshot-toast';
    
    // スタイルを設定
    toast.style.cssText = `
      position: fixed !important;
      bottom: 20px !important;
      right: 20px !important;
      padding: 12px 24px !important;
      background-color: rgba(0, 0, 0, 0.85) !important;
      color: #ffffff !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      font-size: 14px !important;
      font-weight: 500 !important;
      border-radius: 8px !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
      z-index: 2147483647 !important;
      opacity: 0 !important;
      transform: translateY(10px) !important;
      transition: opacity 0.3s ease, transform 0.3s ease !important;
      pointer-events: none !important;
    `;

    // メインテキスト
    const mainSpan = document.createElement('span');
    mainSpan.textContent = `✓ ${message} `;
    
    // サブテキスト（オレンジ色で目立たせる）
    const subSpan = document.createElement('span');
    subSpan.textContent = `(${subtext})`;
    subSpan.style.cssText = `
      color: #ffaa00 !important;
      font-size: 12px !important;
    `;

    toast.appendChild(mainSpan);
    toast.appendChild(subSpan);

    // DOMに追加
    document.body.appendChild(toast);

    // フェードイン
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    // 指定時間後にフェードアウト
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      
      // アニメーション完了後に削除
      setTimeout(() => {
        if (toast.parentNode) {
          toast.remove();
        }
      }, 300);
    }, TOAST_DURATION);
  }

  // ========================================
  // スティッキー要素の処理
  // ========================================

  /**
   * position: fixed/sticky の要素を検出して返す（まだ隠さない）
   * @returns {Array} - 検出した要素と元のスタイルの配列
   */
  function detectStickyElements() {
    const stickyElements = [];
    
    // 全要素を走査
    const allElements = document.querySelectorAll('*');
    
    allElements.forEach(element => {
      // オーバーレイ自体は除外
      if (element.id === 'fullscreenshot-overlay' || element.closest('#fullscreenshot-overlay')) {
        return;
      }
      
      const computedStyle = window.getComputedStyle(element);
      const position = computedStyle.position;
      
      // fixed または sticky の要素を対象
      if (position === 'fixed' || position === 'sticky') {
        stickyElements.push({
          element,
          originalVisibility: element.style.visibility
        });
      }
    });

    return stickyElements;
  }

  /**
   * スティッキー要素を隠す
   * @param {Array} stickyElements - 要素の配列
   */
  function hideStickyElements(stickyElements) {
    stickyElements.forEach(({ element }) => {
      element.style.visibility = 'hidden';
    });
  }

  /**
   * 隠した要素を復元
   * @param {Array} stickyElements - 隠した要素の配列
   */
  function restoreStickyElements(stickyElements) {
    stickyElements.forEach(({ element, originalVisibility }) => {
      element.style.visibility = originalVisibility;
    });
  }

  // ========================================
  // スクロールキャプチャ
  // ========================================

  /**
   * ページ全体をスクロールしながらキャプチャ
   * @param {string} format - 画像フォーマット ('png' or 'jpeg')
   * @param {Object} overlay - オーバーレイオブジェクト
   * @returns {Promise<string|null>} - 結合された画像のDataURL、キャンセル時はnull
   */
  async function captureFullPage(format, overlay) {
    // 元のスクロール位置を保存
    const originalScrollX = window.scrollX;
    const originalScrollY = window.scrollY;

    // ページの総サイズを取得
    const totalHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.offsetHeight,
      document.body.clientHeight,
      document.documentElement.clientHeight
    );
    
    const totalWidth = Math.max(
      document.body.scrollWidth,
      document.documentElement.scrollWidth,
      document.body.offsetWidth,
      document.documentElement.offsetWidth,
      document.body.clientWidth,
      document.documentElement.clientWidth
    );

    // ビューポートサイズを取得
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // 必要なキャプチャ回数を計算
    const totalCaptures = Math.ceil(totalHeight / (viewportHeight - 50));

    // スティッキー要素を検出（まだ隠さない）
    const stickyElements = detectStickyElements();

    // キャプチャ画像を格納する配列
    const captures = [];
    
    try {
      // スクロール位置ごとにキャプチャ
      let currentY = 0;
      let captureIndex = 0;
      
      while (currentY < totalHeight) {
        // キャンセルチェック
        if (isCancelled) {
          return null;
        }

        captureIndex++;
        overlay.updateProgress(captureIndex, totalCaptures);

        // スクロール
        window.scrollTo(0, currentY);
        
        // スクロールが完了するまで少し待機
        await sleep(SCROLL_DELAY);

        // 最初のキャプチャ以外はスティッキー要素を隠す（ヘッダーを1枚目に残すため）
        if (captureIndex === 1) {
          // 1枚目: スティッキー要素を表示したままキャプチャ（ヘッダーが含まれる）
        } else if (captureIndex === 2) {
          // 2枚目以降: スティッキー要素を隠す
          hideStickyElements(stickyElements);
        }

        // 実際のスクロール位置を取得（ページ末尾では期待した位置にならない場合がある）
        const actualScrollY = window.scrollY;
        
        // 可視領域をキャプチャ（リトライ付き）
        let response = null;
        let lastError = null;
        
        for (let retry = 0; retry < MAX_RETRIES; retry++) {
          // キャンセルチェック
          if (isCancelled) {
            return null;
          }

          try {
            // キャプチャ直前に中央ダイアログのみ非表示（スクショに写り込まないように）
            overlay.dialog.style.visibility = 'hidden';
            
            // 少し待機してから撮影（非表示が反映されるのを待つ）
            await sleep(50);
            
            response = await sendMessage({
              action: 'captureVisibleTab',
              format: format
            });
            
            // キャプチャ後に中央ダイアログを再表示
            overlay.dialog.style.visibility = 'visible';
            
            if (response && response.success) {
              break; // 成功したらループを抜ける
            }
          } catch (e) {
            // エラー時もダイアログを再表示
            overlay.dialog.style.visibility = 'visible';
            lastError = e;
            console.warn(`Capture attempt ${retry + 1} failed:`, e.message);
          }
          
          // リトライ前に追加で待機（レート制限対策）
          if (retry < MAX_RETRIES - 1) {
            await sleep(RETRY_DELAY);
          }
        }

        if (response && response.success) {
          captures.push({
            dataUrl: response.dataUrl,
            y: actualScrollY,
            height: viewportHeight
          });
        } else {
          throw new Error(lastError ? lastError.message : 'Failed to capture visible tab');
        }

        // 次のスクロール位置を計算（少し重複させてつなぎ目を滑らかに）
        currentY += viewportHeight - 50;
        
        // 最後のキャプチャの場合
        if (currentY >= totalHeight) {
          break;
        }
      }

      // キャンセルチェック
      if (isCancelled) {
        return null;
      }

      // 画像を1枚に結合
      const mergedDataUrl = await mergeCaptures(captures, totalWidth, totalHeight, viewportWidth, format);
      
      return mergedDataUrl;

    } finally {
      // スティッキー要素を復元
      restoreStickyElements(stickyElements);
      
      // 元のスクロール位置に戻す
      window.scrollTo(originalScrollX, originalScrollY);
    }
  }

  /**
   * キャプチャ画像を1枚に結合
   * @param {Array} captures - キャプチャ画像の配列
   * @param {number} totalWidth - ページの総幅
   * @param {number} totalHeight - ページの総高さ
   * @param {number} viewportWidth - ビューポート幅
   * @param {string} format - 画像フォーマット
   * @returns {Promise<string>} - 結合された画像のDataURL
   */
  async function mergeCaptures(captures, totalWidth, totalHeight, viewportWidth, format) {
    // Canvasを作成
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Canvas サイズを設定（ビューポート幅を使用）
    canvas.width = viewportWidth;
    canvas.height = totalHeight;

    // 背景を白で塗りつぶし（透明部分対策）
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 各キャプチャ画像を描画
    for (let i = 0; i < captures.length; i++) {
      const capture = captures[i];
      const img = await loadImage(capture.dataUrl);
      
      // 描画位置を計算
      const drawY = capture.y;
      
      // 最後のキャプチャ以外は重複部分を考慮して描画
      if (i < captures.length - 1) {
        // 通常の描画
        ctx.drawImage(img, 0, drawY);
      } else {
        // 最後のキャプチャ: ページ末尾に合わせて描画
        const remainingHeight = totalHeight - capture.y;
        if (remainingHeight < capture.height) {
          // 末尾の余白を埋めるために調整
          const sourceY = capture.height - remainingHeight;
          ctx.drawImage(
            img,
            0, sourceY, img.width, remainingHeight,  // ソース領域
            0, capture.y, img.width, remainingHeight  // 描画領域
          );
        } else {
          ctx.drawImage(img, 0, drawY);
        }
      }
      
      // メモリ解放のため参照をクリア
      captures[i].dataUrl = null;
    }

    // DataURLに変換
    const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const quality = format === 'jpeg' ? 0.92 : undefined;
    const dataUrl = canvas.toDataURL(mimeType, quality);

    // Canvas をクリア（メモリ解放）
    canvas.width = 0;
    canvas.height = 0;

    return dataUrl;
  }

  /**
   * 画像を読み込む
   * @param {string} dataUrl - 画像のDataURL
   * @returns {Promise<HTMLImageElement>} - 読み込まれた画像要素
   */
  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  // ========================================
  // 出力処理
  // ========================================

  /**
   * 画像をクリップボードにコピー
   * @param {string} dataUrl - 画像のDataURL（PNG形式であること）
   * @returns {Promise<boolean>} - 成功したかどうか
   */
  async function copyToClipboard(dataUrl) {
    try {
      // DataURLからBlobを作成
      const response = await fetch(dataUrl);
      const blob = await response.blob();

      // クリップボードに書き込み（PNGのみサポート）
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': blob
        })
      ]);

      return true;
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      return false;
    }
  }

  /**
   * 画像をダウンロード
   * @param {string} dataUrl - 画像のDataURL
   * @param {string} format - 画像フォーマット
   */
  async function downloadImage(dataUrl, format) {
    // ファイル名を生成（screenshot_YYYY-MM-DD-HH-mm-ss.png）
    const now = new Date();
    const timestamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0')
    ].join('-');
    
    const extension = format === 'jpeg' ? 'jpg' : 'png';
    const filename = `screenshot_${timestamp}.${extension}`;

    // background.jsにダウンロードを依頼
    await sendMessage({
      action: 'downloadImage',
      dataUrl: dataUrl,
      filename: filename
    });
  }

  // ========================================
  // ユーティリティ関数
  // ========================================

  /**
   * 指定ミリ秒待機
   * @param {number} ms - 待機時間（ミリ秒）
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * background.jsにメッセージを送信
   * @param {Object} message - 送信するメッセージ
   * @returns {Promise<Object>} - レスポンス
   */
  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  // ========================================
  // メイン処理
  // ========================================

  /**
   * スクリーンショット撮影のメイン処理
   */
  async function startCapture() {
    // キャンセルフラグをリセット
    isCancelled = false;

    // オーバーレイを表示（進捗表示・キャンセルボタン・操作ブロック）
    const overlay = showCaptureOverlay();

    try {
      // 設定を取得
      const settingsResponse = await sendMessage({ action: 'getSettings' });
      const settings = settingsResponse.settings;
      
      const actionType = settings.actionType || 'clipboard';
      // クリップボードモードの場合は強制的にPNG（クリップボードAPIがPNGのみサポート）
      const fileFormat = (actionType === 'clipboard') ? 'png' : (settings.fileFormat || 'png');

      // フルページキャプチャを実行
      const dataUrl = await captureFullPage(fileFormat, overlay);

      // オーバーレイを削除
      overlay.remove();

      // キャンセルされた場合
      if (dataUrl === null) {
        showToast('Capture cancelled', 'warning');
        return;
      }

      // 出力処理
      if (actionType === 'clipboard') {
        // クリップボードにコピーを試みる
        const copySuccess = await copyToClipboard(dataUrl);
        
        if (copySuccess) {
          // 画像サイズを計算（Base64のDataURLから概算）
          // Base64は元のバイナリより約33%大きいので、3/4で概算
          const imageSizeBytes = Math.round((dataUrl.length * 3) / 4);
          const imageSizeMB = imageSizeBytes / (1024 * 1024);
          
          if (imageSizeMB > 4) {
            // 4MB超: Windowsクリップボード履歴に保存されない可能性を警告
            showToastWithSubtext('Copied to clipboard!', 'Too large for Win+V history');
          } else {
            showToast('Copied to clipboard!', 'success');
          }
        } else {
          // フォールバック: ダウンロードに切り替え
          await downloadImage(dataUrl, fileFormat);
          showToast('Too large to copy. Saved instead.', 'warning');
        }
      } else {
        // ダウンロード
        await downloadImage(dataUrl, fileFormat);
        showToast('Saved!', 'success');
      }

    } catch (error) {
      // オーバーレイを削除
      overlay.remove();
      
      console.error('Screenshot capture failed:', error);
      showToast('Capture failed: ' + error.message, 'error');
    }
  }

  // ========================================
  // メッセージリスナー
  // ========================================

  /**
   * background.jsからのメッセージを受信
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'startCapture') {
      // スクリーンショット撮影を開始
      startCapture();
      sendResponse({ success: true });
    }
    return true;
  });

} // end of initialization guard
