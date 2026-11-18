package com.deepseek.chatdemo;

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
}

