package com.huagyuu.deeplook;

import android.webkit.JavascriptInterface;

/**
 * 暴露给页面的原生桥：目前只有「导出 ZIP」需要它（blob URL 在 WebView 里无法直接下载）。
 * 分片接收 base64，避免单次跨进程调用超过 Binder 限制。
 */
final class AndroidBridge {
    private final MainActivity activity;

    AndroidBridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public void beginDownload(String name) {
        activity.beginDownload(name);
    }

    @JavascriptInterface
    public void appendDownload(String base64Chunk, boolean last) {
        activity.appendDownload(base64Chunk, last);
    }

    /** 录音前先向系统申请麦克风权限，结果通过 window.__deeplookMicPermission 回调 */
    @JavascriptInterface
    public void requestMicrophone(String requestId) {
        activity.requestMicrophonePermission(requestId);
    }

    /** 检查 GitHub 最新 Release，结果通过 window.__deeplookUpdate 回调 */
    @JavascriptInterface
    public void checkForUpdate() {
        activity.checkForUpdate();
    }

    /** 下载 APK 并拉起系统安装器 */
    @JavascriptInterface
    public void downloadUpdate(String url, String version) {
        activity.downloadUpdate(url, version);
    }

    /** 从下载链接导入历史记录：原生负责下载与分片回传，进度通过 window.__deeplookImportEvent 回调 */
    @JavascriptInterface
    public void importHistoryFromUrl(String url) {
        activity.importHistoryFromUrl(url);
    }

    /** 取消正在进行的链接导入 */
    @JavascriptInterface
    public void cancelHistoryImport() {
        activity.cancelHistoryImport();
    }

    /** 导入结束后删除临时文件 */
    @JavascriptInterface
    public void deleteHistoryImport() {
        activity.deleteHistoryImport();
    }

    /** TTS 播放：走原生 AudioTrack（媒体音量），分片写入 PCM */
    @JavascriptInterface
    public boolean isPreview() {
        return BuildConfig.APPLICATION_ID.endsWith(".preview");
    }

    @JavascriptInterface
    public void openDeepSeekLogin() {
        activity.openDeepSeekLogin();
    }

    @JavascriptInterface
    public String getAccount() {
        return activity.getAccountJson();
    }

    @JavascriptInterface
    public void logoutAccount() {
        activity.logoutAccount();
    }

    @JavascriptInterface
    public void ttsWarmUp() {
        activity.ttsWarmUp();
    }

    @JavascriptInterface
    public void ttsCooldown() {
        activity.ttsCooldown();
    }

    /** 录音结束后恢复正常音频模式 */
    @JavascriptInterface
    public void resetAudioMode() {
        activity.resetAudioMode();
    }

    @JavascriptInterface
    public void ttsStart(int sampleRate) {
        activity.ttsStart(sampleRate);
    }

    @JavascriptInterface
    public void ttsWrite(String base64Chunk) {
        activity.ttsWrite(base64Chunk);
    }

    @JavascriptInterface
    public void ttsEnd() {
        activity.ttsEnd();
    }

    @JavascriptInterface
    public void ttsCancel() {
        activity.ttsCancel();
    }
}



