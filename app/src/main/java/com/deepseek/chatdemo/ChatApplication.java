package com.deepseek.chatdemo;

import android.app.Application;

/**
 * 只负责在进程启动时尽早关闭调试用的 WebView 相关开关，
 * 页面初始化逻辑都放在 MainActivity 里。
 */
public class ChatApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        // 允许 WebView 在调试构建里读取本地文件用于排查（不影响发布构建的行为）
        if (BuildConfig.DEBUG) {
            android.webkit.WebView.setWebContentsDebuggingEnabled(true);
        }
    }
}
