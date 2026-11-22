package com.huagyuu.deeplook;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.TypedValue;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.EdgeToEdge;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatDelegate;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;

import org.json.JSONObject;

/**
 * 套壳容器：用 WebViewAssetLoader 把 app/src/main/assets/web 下的静态站映射到
 * https://appassets.androidplatform.net/（安全来源，localStorage / IndexedDB / 麦克风都可用），
 * 并补齐网页在 Android 上缺失的能力：文件选择、ZIP 下载、语音权限、返回键、外部链接跳转。
 */
public class MainActivity extends AppCompatActivity {

    /** 静态站入口；与 assets/web/index.html 对应 */
    private static final String APP_URL =
            "https://appassets.androidplatform.net/assets/web/index.html";
    /** 注入到页面的桥接对象名，供下载拦截脚本回调 */
    private static final String BRIDGE_NAME = "DeepSeekAndroid";

    /** 调试构建才显示启动层、加载进度与诊断信息；正式版保持干净的启动体验 */
    private static final boolean DIAG_BUILD = BuildConfig.DEBUG;

    private WebView webView;
    private WebViewAssetLoader assetLoader;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingPermission;
    /** 录音前由页面发起的权限申请 id，授权结果回传给页面 */
    private String pendingMicRequestId;
    private ActivityResultLauncher<Intent> fileChooserLauncher;
    private ActivityResultLauncher<Intent> legacyDownloadLauncher;
    private ActivityResultLauncher<String> audioPermissionLauncher;
    /** 拍照：相机把照片写进 cache/camera，结果再回传给页面 */
    private ActivityResultLauncher<Intent> cameraLauncher;
    private Uri pendingPhotoUri;
    private File pendingPhotoFile;

    /** 旧系统（Android 9 及以下）走系统保存界面时，等用户选好目标位置再写入 */
    private File pendingDownloadFile;
    private String pendingDownloadName;

    /** 启动占位层：加载完成前盖住 WebView，异常时提供重试入口和诊断文字 */
    private FrameLayout rootView;
    private LinearLayout splashView;
    private TextView splashStatus;
    private boolean pageReady;
    /** 空白页修复只做一次，避免反复重载 */
    private boolean repairedOnce;
    /** 冷启动看门狗：超时逐级升级（重载 → 兼容渲染 → 停止并提示） */
    private int bootAttempt;
    private int loadProgress;
    private String lastBootReason;
    /** 兼容模式：WebView 用软件渲染（部分机型硬件合成会黑屏），持久化到下次启动 */
    private boolean compatSoftware;
    private boolean splashCreated;
    /** 调试版常驻诊断条：每秒刷新原生状态 + 页面内诊断 */
    private TextView diagPanel;
    private final List<String> consoleLines = new ArrayList<>();
    private String lastPageDiag = "js=pending";
    /** 生命周期计数：区分「冷启动黑屏」和「从后台回来黑屏」 */
    private int pauseCount;
    private int resumeCount;
    private int pageFinishedCount;
    private int loadCount;
    private String redTestState = "red=-";

    private final Runnable watchdogTask = new Runnable() {
        @Override
        public void run() {
            if (pageReady) {
                return;
            }
            bootAttempt++;
            lastBootReason = "timeout";
            if (DIAG_BUILD) {
                pushConsole("boot-timeout p=" + loadProgress + " rdy=" + (pageReady ? 1 : 0));
                if (splashCreated && splashView != null) {
                    splashStatus.setText("加载超时 p=" + loadProgress + "（点这里手动重试）");
                }
                return;
            }
            if (bootAttempt == 1) {
                diag("boot-timeout-1");
                if (splashCreated && splashView != null) {
                    splashView.setVisibility(View.VISIBLE);
                    splashStatus.setText(getString(R.string.splash_retrying, 1, loadProgress)
                            + "\nwv=" + webViewVersion());
                }
                if (webView != null) {
                    webView.clearCache(false);
                    webView.loadUrl(bootUrl());
                }
                mainHandler.postDelayed(this, 6000);
            } else if (bootAttempt == 2) {
                diag("boot-timeout-2-compat");
                setCompatSoftware(true);
                recreateWebView(true);
                mainHandler.postDelayed(this, 8000);
            } else {
                diag("boot-timeout-3");
                if (splashCreated && splashView != null) {
                    splashView.setVisibility(View.VISIBLE);
                    splashStatus.setText(getString(R.string.splash_failed, "boot-timeout")
                            + "\nwv=" + webViewVersion());
                    appendDiagSummary();
                }
            }
        }
    };

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM);
        EdgeToEdge.enable(this);
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
                .setAppearanceLightStatusBars(!isDarkMode());
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
                .setAppearanceLightNavigationBars(!isDarkMode());

        assetLoader = new WebViewAssetLoader.Builder()
                .setDomain("appassets.androidplatform.net")
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        rootView = new FrameLayout(this);
        rootView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        rootView.setFitsSystemWindows(false);
        // 只有状态栏、导航栏与输入法区域留白：键盘弹出时把 WebView 抬起来，避免输入框被遮挡。
        // 使用边到边（decorFitsSystemWindows=false）后系统不会自动 adjustResize，必须自己处理 IME inset。
        ViewCompat.setOnApplyWindowInsetsListener(rootView, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return insets;
        });

        SharedPreferences bootPrefs = getSharedPreferences("boot", MODE_PRIVATE);
        // 装上新版本时先回到硬件渲染：软件渲染只是个别机型黑屏的兜底，不能永久粘住
        if (bootPrefs.getInt("version", 0) != BuildConfig.VERSION_CODE) {
            bootPrefs.edit()
                    .putBoolean("software", false)
                    .putInt("version", BuildConfig.VERSION_CODE)
                    .apply();
        }
        compatSoftware = bootPrefs.getBoolean("software", false);
        createAndConfigureWebView(compatSoftware);
        rootView.addView(webView);
        if (DIAG_BUILD) {
            buildSplashView();
            buildDiagPanel();
        }
        setContentView(rootView);

        registerLaunchers();
        loadApp();
        if (DIAG_BUILD) {
            mainHandler.postDelayed(diagTick, 800);
        }

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                // 先问页面：设置页 / 移动端抽屉是否消费这次返回，再决定网页后退或退出
                webView.evaluateJavascript(
                        "(window.__deeplookBack && window.__deeplookBack()) ? '1' : '0'",
                        value -> {
                            if (value != null && value.contains("1")) {
                                return;
                            }
                            if (webView.canGoBack()) {
                                webView.goBack();
                            } else {
                                // 和 Home 键一样退到后台：保留 WebView 与页面状态，
                                // 再次点图标进来是秒回原会话，不会重新加载；
                                // 真正退出交给最近任务划掉或系统回收。
                                if (!moveTaskToBack(true)) {
                                    finish();
                                }
                            }
                        });
            }
        });
    }

    private boolean isDarkMode() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
    }

    private void registerLaunchers() {
        fileChooserLauncher = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(), result -> {
                    Uri[] uris = null;
                    if (result.getResultCode() == RESULT_OK && result.getData() != null) {
                        Intent data = result.getData();
                        if (data.getClipData() != null) {
                            int count = data.getClipData().getItemCount();
                            uris = new Uri[count];
                            for (int i = 0; i < count; i++) {
                                uris[i] = data.getClipData().getItemAt(i).getUri();
                            }
                        } else if (data.getData() != null) {
                            uris = new Uri[]{data.getData()};
                        }
                    }
                    if (fileCallback != null) {
                        fileCallback.onReceiveValue(uris);
                        fileCallback = null;
                    }
                });

        legacyDownloadLauncher = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(), result -> {
                    if (result.getResultCode() == RESULT_OK && result.getData() != null
                            && pendingDownloadFile != null) {
                        Uri target = result.getData().getData();
                        if (target != null) {
                            try (OutputStream out = getContentResolver().openOutputStream(target)) {
                                if (out != null) {
                                    copy(pendingDownloadFile, out);
                                    toastOnUi(R.string.download_saved_toast,
                                            pendingDownloadName == null ? "" : pendingDownloadName);
                                }
                            } catch (IOException e) {
                                toastOnUi(R.string.download_failed);
                            }
                        }
                        pendingDownloadFile.delete();
                    }
                    pendingDownloadFile = null;
                    pendingDownloadName = null;
                });

        cameraLauncher = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(), result -> {
                    Uri uri = null;
                    File photo = pendingPhotoFile;
                    if (result.getResultCode() == RESULT_OK && pendingPhotoUri != null
                            && photo != null && photo.exists() && photo.length() > 0) {
                        uri = pendingPhotoUri;
                    }
                    pendingPhotoUri = null;
                    pendingPhotoFile = null;
                    if (fileCallback != null) {
                        fileCallback.onReceiveValue(uri == null ? null : new Uri[]{uri});
                        fileCallback = null;
                    }
                });

        audioPermissionLauncher = registerForActivityResult(
                new ActivityResultContracts.RequestPermission(), granted -> {
                    String micRequestId = pendingMicRequestId;
                    pendingMicRequestId = null;
                    if (micRequestId != null) {
                        notifyMicPermission(micRequestId, granted);
                    }
                    if (pendingPermission != null) {
                        if (granted) {
                            pendingPermission.grant(pendingPermission.getResources());
                        } else {
                            pendingPermission.deny();
                            Toast.makeText(this, R.string.permission_denied_microphone, Toast.LENGTH_LONG).show();
                        }
                        pendingPermission = null;
                    } else if (!granted && micRequestId == null) {
                        Toast.makeText(this, R.string.permission_denied_microphone, Toast.LENGTH_LONG).show();
                    }
                });
    }

    /**
     * 页面在调用 getUserMedia 前先请求麦克风权限：避免 WebView 的 PermissionRequest
     * 被系统权限弹窗打断后直接失败。结果通过 window.__deeplookMicPermission 回调。
     */
    void requestMicrophonePermission(String requestId) {
        mainHandler.post(() -> {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                    == PackageManager.PERMISSION_GRANTED) {
                notifyMicPermission(requestId, true);
                return;
            }
            pendingMicRequestId = requestId;
            audioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO);
        });
    }

    private void notifyMicPermission(String requestId, boolean granted) {
        if (webView == null || requestId == null) {
            return;
        }
        String safeId = requestId.replace("\\", "\\\\").replace("'", "\\'");
        webView.evaluateJavascript(
                "window.__deeplookMicPermission && window.__deeplookMicPermission('"
                        + safeId + "'," + granted + ")",
                null);
    }

    /** 创建并配置 WebView；software=true 时用软件渲染（部分机型硬件渲染会黑屏） */
    private WebView createAndConfigureWebView(boolean software) {
        WebView view = new WebView(this);
        // 关掉网页里的触感反馈：按住说话/长按按钮时不要震动
        view.setHapticFeedbackEnabled(false);
        view.setLongClickable(false);
        view.setOnLongClickListener(v -> true);
        view.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        view.setBackgroundColor(ContextCompat.getColor(this, R.color.chat_background));
        if (software) {
            view.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
        }
        webView = view;
        configureWebView();
        return view;
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(false);
        // 静态站与接口都在 HTTPS 下，禁止把资源降级到 HTTP
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(
                    @NonNull WebView view, @NonNull WebResourceRequest request) {
                WebResourceResponse response = assetLoader.shouldInterceptRequest(request.getUrl());
                if (response != null) {
                    // 资源是打包进 APK 的，禁止 WebView 缓存，避免更新后旧页面引用已删除的 hash 文件
                    response.setResponseHeaders(
                            Collections.singletonMap("Cache-Control", "no-cache, no-store"));
                }
                return response != null ? response : super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(
                    @NonNull WebView view, @NonNull WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme();
                if ("appassets.androidplatform.net".equals(uri.getHost())) {
                    // 站内链接（含单页应用路由）继续交给 WebView
                    return false;
                }
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    openExternally(uri);
                    return true;
                }
                // 未知协议（mailto、intent 等）一律交给系统处理
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException ignored) {
                    // 没有可处理的应用时保持页面不动
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                if (splashCreated && splashView != null && !pageReady) {
                    splashStatus.setText(getString(R.string.splash_loading, loadProgress));
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                injectDownloadBridge();
                pageReady = true;
                pageFinishedCount++;
                bootAttempt = 0;
                mainHandler.removeCallbacks(watchdogTask);
                hideSplash();
                // 再确认一次真的渲染出了内容：有些机型页面已完成后仍是一整块黑屏
                mainHandler.postDelayed(() -> verifyRendered(view), 800);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                String detail = "res-error " + error.getErrorCode() + " "
                        + error.getDescription() + " " + shorten(request.getUrl().toString(), 60);
                if (request.isForMainFrame()) {
                    pageReady = false;
                    diag("load-error " + error.getErrorCode() + " " + error.getDescription());
                }
                if (DIAG_BUILD) {
                    pushConsole(detail);
                }
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // 渲染进程被系统回收：自己重建 WebView，避免整个应用被杀或停在黑屏
                diag("renderer-gone crash=" + detail.didCrash());
                mainHandler.post(() -> {
                    showSplash(getString(R.string.splash_crashed));
                    recreateWebView(false);
                });
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = callback;
                if (params.isCaptureEnabled() && launchCamera()) {
                    return true;
                }
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                // accept 里给的是扩展名列表（.pdf,.png,…），转换成 MIME 类型才能被系统选择器识别
                String[] mimeTypes = toMimeTypes(params.getAcceptTypes());
                if (mimeTypes.length > 0) {
                    intent.setType("*/*");
                    intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes);
                } else {
                    intent.setType("*/*");
                }
                try {
                    fileChooserLauncher.launch(intent);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    callback.onReceiveValue(null);
                }
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                List<String> requested = new ArrayList<>();
                for (String resource : request.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                        requested.add(resource);
                    }
                }
                if (!requested.isEmpty()) {
                    if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO)
                            == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    } else {
                        pendingPermission = request;
                        audioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO);
                    }
                } else {
                    request.deny();
                }
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingPermission == request) {
                    pendingPermission = null;
                }
            }

            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                super.onProgressChanged(view, newProgress);
                loadProgress = newProgress;
                if (pageReady || !splashCreated || splashView == null) {
                    return;
                }
                if (bootAttempt > 0) {
                    splashStatus.setText(getString(R.string.splash_retrying, bootAttempt, newProgress)
                            + "\nwv=" + webViewVersion());
                } else {
                    splashStatus.setText(getString(R.string.splash_loading, newProgress));
                }
            }

            @Override
            public boolean onConsoleMessage(@NonNull ConsoleMessage message) {
                if (BuildConfig.DEBUG) {
                    android.util.Log.d("ChatWebView",
                            message.message() + " @" + message.sourceId() + ":" + message.lineNumber());
                }
                if (DIAG_BUILD) {
                    String line = message.messageLevel() + ":" + message.message()
                            + " @" + message.sourceId() + ":" + message.lineNumber();
                    pushConsole(line);
                }
                return true;
            }
        });

        // 普通 http 下载回落到系统下载器；blob/data 下载由注入脚本走桥接
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(intent);
                } catch (ActivityNotFoundException e) {
                    Toast.makeText(this, R.string.download_failed, Toast.LENGTH_SHORT).show();
                }
            } else {
                Toast.makeText(this, R.string.download_failed, Toast.LENGTH_SHORT).show();
            }
        });

        webView.addJavascriptInterface(new AndroidBridge(this), BRIDGE_NAME);
    }

    /** 用系统相机拍照；没有可用相机应用时返回 false，退回文件选择器 */
    private boolean launchCamera() {
        try {
            File dir = new File(getCacheDir(), "camera");
            if (!dir.exists() && !dir.mkdirs()) {
                return false;
            }
            File photo = new File(dir, "photo_" + System.currentTimeMillis() + ".jpg");
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", photo);
            Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, uri);
            intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (intent.resolveActivity(getPackageManager()) == null) {
                return false;
            }
            pendingPhotoUri = uri;
            pendingPhotoFile = photo;
            cameraLauncher.launch(intent);
            return true;
        } catch (Exception e) {
            pendingPhotoUri = null;
            pendingPhotoFile = null;
            return false;
        }
    }

    /** 把 accept 扩展名列表转换成系统文件选择器认识的 MIME 类型 */
    private static String[] toMimeTypes(String[] acceptTypes) {
        if (acceptTypes == null || acceptTypes.length == 0) {
            return new String[0];
        }
        List<String> types = new ArrayList<>();
        for (String raw : acceptTypes) {
            if (raw == null) {
                continue;
            }
            for (String part : raw.split(",")) {
                String value = part.trim().toLowerCase();
                if (value.isEmpty()) {
                    continue;
                }
                if (value.startsWith(".")) {
                    String mime = mimeOfExtension(value.substring(1));
                    if (mime != null && !types.contains(mime)) {
                        types.add(mime);
                    }
                } else if (value.contains("/")) {
                    if (!types.contains(value)) {
                        types.add(value);
                    }
                }
            }
        }
        return types.toArray(new String[0]);
    }
    private static String mimeOfExtension(String extension) {
        switch (extension) {
            case "pdf": return "application/pdf";
            case "png": return "image/png";
            case "jpg":
            case "jpeg":
            case "jfif":
            case "pjpeg": return "image/jpeg";
            case "gif": return "image/gif";
            case "webp": return "image/webp";
            case "bmp":
            case "dib": return "image/bmp";
            case "svg":
            case "svgz": return "image/svg+xml";
            case "tif":
            case "tiff": return "image/tiff";
            case "avif": return "image/avif";
            case "ico": return "image/x-icon";
            case "apng": return "image/apng";
            case "txt": return "text/plain";
            case "md": return "text/markdown";
            case "csv": return "text/csv";
            case "tsv": return "text/tab-separated-values";
            case "html": return "text/html";
            case "json": return "application/json";
            case "xml": return "application/xml";
            case "zip": return "application/zip";
            case "doc": return "application/msword";
            case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            case "ppt": return "application/vnd.ms-powerpoint";
            case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
            case "xls": return "application/vnd.ms-excel";
            case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            default: return null;
        }
    }

    /**
     * 站内页面里导出 ZIP 只用 blob URL + a[download]，WebView 不会触发系统下载。
     * 《保存》把 blob 读成 base64 分片交给原生写入 Downloads，逐片大小控制在 WebView 调用上限内。
     */
    private void injectDownloadBridge() {
        String script = "(function(){"
                + "if(window.__deepSeekDownloadBridge){return;}"
                + "window.__deepSeekDownloadBridge=true;"
                + "var origCreate=URL.createObjectURL;"
                + "var blobs={};"
                + "URL.createObjectURL=function(obj){var url=origCreate.call(URL,obj);"
                + "try{blobs[url]=obj;}catch(e){} return url;};"
                + "var origRevoke=URL.revokeObjectURL;"
                + "URL.revokeObjectURL=function(url){delete blobs[url];return origRevoke.call(URL,url);};"
                + "var origClick=HTMLAnchorElement.prototype.click;"
                + "HTMLAnchorElement.prototype.click=function(){"
                + "try{"
                + "var href=this.href||'';"
                + "var name=this.getAttribute('download')||'download';"
                + "var blob=blobs[href];"
                + "if(blob&&window." + BRIDGE_NAME + "){"
                + "var reader=new FileReader();"
                + "reader.onload=function(){"
                + "var text=String(reader.result||'');"
                + "var comma=text.indexOf(',');"
                + "var base64=comma>=0?text.slice(comma+1):'';"
                + "var chunk=200000;"
                + "var total=Math.ceil(base64.length/chunk);"
                + "window." + BRIDGE_NAME + ".beginDownload(name);"
                + "for(var i=0;i<total;i++){"
                + "window." + BRIDGE_NAME + ".appendDownload(base64.substr(i*chunk,chunk),i===total-1);"
                + "}"
                + "};"
                + "reader.readAsDataURL(blob);"
                + "return;"
                + "}"
                + "}catch(e){}"
                + "return origClick.apply(this,arguments);"
                + "};"
                + "})();";
        webView.evaluateJavascript(script, null);
    }

    private void openExternally(Uri uri) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (ActivityNotFoundException ignored) {
            // 无浏览器可用时忽略
        }
    }

    // ---------------- 应用更新 ----------------

    private static final String UPDATE_RELEASE_URL =
            "https://api.github.com/repos/HuaGyuu/deeplook/releases/latest";

    private File pendingUpdateFile;
    private boolean updateChecking;
    private boolean updateDownloading;

    /** 请求 GitHub 最新 Release，结果通过 window.__deeplookUpdate('check', …) 回调页面。 */
    void checkForUpdate() {
        if (updateChecking) {
            return;
        }
        updateChecking = true;
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                URL url = new URL(UPDATE_RELEASE_URL);
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(15000);
                connection.setRequestProperty("Accept", "application/vnd.github+json");
                connection.setRequestProperty("User-Agent", "deeplook-android");
                int code = connection.getResponseCode();
                InputStream input = code >= 200 && code < 300
                        ? connection.getInputStream() : connection.getErrorStream();
                String body = readText(input);
                if (code >= 200 && code < 300) {
                    notifyUpdateCheck(true, body, null);
                } else {
                    notifyUpdateCheck(false, null, "HTTP " + code);
                }
            } catch (Exception e) {
                notifyUpdateCheck(false, null, e.getMessage());
            } finally {
                if (connection != null) {
                    connection.disconnect();
                }
                updateChecking = false;
            }
        }).start();
    }

    private static String readText(@Nullable InputStream input) throws IOException {
        if (input == null) {
            return "";
        }
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(input, StandardCharsets.UTF_8))) {
            char[] buffer = new char[4096];
            int read;
            while ((read = reader.read(buffer)) != -1) {
                builder.append(buffer, 0, read);
            }
        }
        return builder.toString();
    }

    private void notifyUpdateCheck(boolean ok, @Nullable String body, @Nullable String message) {
        mainHandler.post(() -> {
            if (webView == null) {
                return;
            }
            StringBuilder payload = new StringBuilder("{\"ok\":").append(ok);
            if (body != null) {
                payload.append(",\"body\":").append(JSONObject.quote(body));
            }
            if (message != null) {
                payload.append(",\"message\":").append(JSONObject.quote(message));
            }
            payload.append('}');
            webView.evaluateJavascript(
                    "window.__deeplookUpdate && window.__deeplookUpdate('check',"
                            + payload + ")", null);
        });
    }

    /** 下载 APK 到 cache/updates，然后拉起系统安装器。 */
    void downloadUpdate(String urlString, String version) {
        if (updateDownloading) {
            return;
        }
        updateDownloading = true;
        notifyUpdateDownload("downloading", 0, null);
        new Thread(() -> {
            HttpURLConnection connection = null;
            InputStream input = null;
            FileOutputStream output = null;
            File target = null;
            try {
                File dir = new File(getCacheDir(), "updates");
                if (!dir.exists() && !dir.mkdirs()) {
                    throw new IOException("cannot create update dir");
                }
                target = new File(dir, sanitizeFileName(
                        "deeplook-" + (version == null ? "latest" : version) + ".apk"));
                URL url = new URL(urlString);
                connection = (HttpURLConnection) url.openConnection();
                connection.setConnectTimeout(20000);
                connection.setReadTimeout(30000);
                connection.setInstanceFollowRedirects(true);
                connection.setRequestProperty("User-Agent", "deeplook-android");
                int code = connection.getResponseCode();
                if (code < 200 || code >= 300) {
                    throw new IOException("HTTP " + code);
                }
                long total = connection.getContentLengthLong();
                input = connection.getInputStream();
                output = new FileOutputStream(target);
                byte[] buffer = new byte[8192];
                long downloaded = 0;
                int lastPercent = -1;
                int read;
                while ((read = input.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                    downloaded += read;
                    if (total > 0) {
                        int percent = (int) (downloaded * 100 / total);
                        if (percent != lastPercent) {
                            lastPercent = percent;
                            notifyUpdateDownload("downloading", percent, null);
                        }
                    }
                }
                output.flush();
                output.close();
                output = null;
                input.close();
                input = null;
                if (total > 0 && downloaded < total) {
                    throw new IOException("incomplete download");
                }
                pendingUpdateFile = target;
                target = null;
                mainHandler.post(this::installPendingUpdate);
            } catch (Exception e) {
                if (target != null) {
                    target.delete();
                }
                notifyUpdateDownload("error", 0, e.getMessage());
            } finally {
                try {
                    if (output != null) {
                        output.close();
                    }
                } catch (IOException ignored) {
                }
                try {
                    if (input != null) {
                        input.close();
                    }
                } catch (IOException ignored) {
                }
                if (connection != null) {
                    connection.disconnect();
                }
                updateDownloading = false;
            }
        }).start();
    }

    private void notifyUpdateDownload(String status, int percent, @Nullable String message) {
        mainHandler.post(() -> {
            if (webView == null) {
                return;
            }
            StringBuilder payload = new StringBuilder("{\"status\":")
                    .append(JSONObject.quote(status))
                    .append(",\"percent\":").append(percent);
            if (message != null) {
                payload.append(",\"message\":").append(JSONObject.quote(message));
            }
            payload.append('}');
            webView.evaluateJavascript(
                    "window.__deeplookUpdate && window.__deeplookUpdate('download',"
                            + payload + ")", null);
        });
    }

    private void installPendingUpdate() {
        File file = pendingUpdateFile;
        if (file == null || !file.exists()) {
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getPackageManager().canRequestPackageInstalls()) {
            notifyUpdateDownload("permission", 0, null);
            try {
                Intent intent = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
            } catch (ActivityNotFoundException e) {
                notifyUpdateDownload("error", 0, "cannot open install permission settings");
            }
            return;
        }
        try {
            Uri apkUri = FileProvider.getUriForFile(
                    this, getPackageName() + ".fileprovider", file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                    | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
            pendingUpdateFile = null;
            notifyUpdateDownload("installing", 100, null);
        } catch (Exception e) {
            notifyUpdateDownload("error", 0, e.getMessage());
        }
    }

    // ---------------- 下载桥接 ----------------

    private File downloadTempFile;
    private OutputStream downloadStream;

    // ---------------- 从下载链接导入历史记录 ----------------

    /** 临时下载文件：导入完成后删除 */
    private File historyImportFile;
    private Thread historyImportThread;
    private volatile boolean historyImportCancelled;
    private volatile boolean historyImportRunning;

    /** 分片回传页面时的原始字节数（base64 后约 4/3） */
    private static final int IMPORT_CHUNK_BYTES = 384 * 1024;

// ---------------- TTS 播放：AudioTrack 走媒体音量 ----------------

    private final java.util.concurrent.ExecutorService ttsExecutor =
            java.util.concurrent.Executors.newSingleThreadExecutor();
    private volatile AudioTrack ttsTrack;
    private volatile boolean ttsCancelled;
    private volatile boolean ttsPlaying;
    private volatile long ttsFramesWritten;
    private volatile long ttsBytesQueued;
    /** 服务端返回的采样率（24k） */
    private volatile int ttsInRate = 24000;
    /** 设备原生输出采样率（一般 48k）：先重采样再喂给 AudioTrack，避免系统低质量重采样带来杂音 */
    private volatile int ttsOutRate = 48000;
    private volatile int ttsBufferSize;
    private volatile int ttsUnderruns;
    private volatile int ttsDumpCount;
    private volatile int ttsOutDumpCount;
    /** 播放前如果音频模式不是 NORMAL（录音/通话残留），先切回 NORMAL，播完还原 */
    private volatile int ttsPreviousMode = -1;

    // 重采样状态：只在 ttsExecutor 单线程里访问
    private byte ttsByteCarry;
    private boolean ttsHasByteCarry;
    private short[] ttsInSamples = new short[16384];
    private int ttsInCount;
    private double ttsPhase;
    private long ttsInTotal;

    /** 开始一段语音合成播放：USAGE_MEDIA / CONTENT_TYPE_SPEECH，音量跟随媒体 */
    void ttsStart(int sampleRate) {
        ttsInRate = sampleRate > 0 ? sampleRate : 24000;
        int nativeRate = AudioTrack.getNativeOutputSampleRate(AudioManager.STREAM_MUSIC);
        ttsOutRate = nativeRate > 0 ? nativeRate : 48000;
        ttsCancelled = false;
        ttsFramesWritten = 0;
        ttsBytesQueued = 0;
        prepareTtsDump();
        ttsExecutor.execute(() -> {
            releaseTtsTrack();
            enterMediaMode();
            final int rate = ttsOutRate;
            try {
                int minBuffer = AudioTrack.getMinBufferSize(
                        rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
                // 缓冲约 1 秒（每秒 rate*2 字节）：留足余量，避免写入时把缓冲塞满
                int bufferSize = Math.max(minBuffer > 0 ? minBuffer * 2 : 0, rate * 2);
                ttsBufferSize = bufferSize;
                AudioTrack track;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    AudioAttributes attributes = new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build();
                    AudioFormat format = new AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(rate)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .build();
                    track = new AudioTrack(attributes, format, bufferSize,
                            AudioTrack.MODE_STREAM, AudioManager.AUDIO_SESSION_ID_GENERATE);
                } else {
                    track = new AudioTrack(AudioManager.STREAM_MUSIC, rate,
                            AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT,
                            bufferSize, AudioTrack.MODE_STREAM);
                }
                track.setVolume(1f);
                // 有些机型会丢弃 play() 之前写入的数据，导致开头被吃掉：
                // 先垫 100ms 静音并立即起播，之后所有真实数据都在播放状态下写入。
                int leadBytes = Math.max(2, rate * 2 * 100 / 1000);
                byte[] silence = new byte[leadBytes];
                int leadWritten = 0;
                while (leadWritten < leadBytes) {
                    int w = track.write(silence, leadWritten, leadBytes - leadWritten);
                    if (w <= 0) {
                        break;
                    }
                    leadWritten += w;
                }
                track.play();
                ttsTrack = track;
                ttsPlaying = true;
                ttsFramesWritten += leadWritten / 2L;
                resetResampler();
                ttsLog("start in=" + ttsInRate + " out=" + rate + " min=" + minBuffer
                        + " buf=" + bufferSize + " state=" + track.getState());
            } catch (Exception e) {
                ttsTrack = null;
                ttsLog("start failed " + e);
            }
        });
    }

    /** 追加一段 base64 的 16-bit 小端单声道 PCM（24k），内部重采样到设备采样率再播放 */
    void ttsWrite(String base64Chunk) {
        if (ttsCancelled || base64Chunk == null || base64Chunk.isEmpty()) {
            return;
        }
        final byte[] data;
        try {
            data = Base64.decode(base64Chunk, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            return;
        }
        appendTtsDump(data);
        ttsExecutor.execute(() -> {
            AudioTrack track = ttsTrack;
            if (track == null || ttsCancelled) {
                return;
            }
            try {
                feedSamples(track, data);
            } catch (Exception e) {
                ttsLog("write exception " + e);
            }
        });
    }

    /** 写完后调用：等缓冲区播完再释放，并通知页面播放结束 */
    void ttsEnd() {
        ttsExecutor.execute(() -> {
            flushRemainder();
            AudioTrack track = ttsTrack;
            if (track != null && !ttsCancelled) {
                try {
                    // 等待时长按音频实际长度算，避免异常状态下死等
                    long maxWait = Math.min(60000L,
                            ttsFramesWritten * 1000L / Math.max(1, ttsOutRate) + 4000L);
                    long deadline = System.currentTimeMillis() + maxWait;
                    while (!ttsCancelled && System.currentTimeMillis() < deadline) {
                        long played = track.getPlaybackHeadPosition() & 0xFFFFFFFFL;
                        if (played >= ttsFramesWritten - ttsOutRate / 20L) {
                            break;
                        }
                        Thread.sleep(40);
                    }
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
            }
            AudioTrack finished = ttsTrack;
            if (finished != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                ttsUnderruns = finished.getUnderrunCount();
            }
            long expected = ttsInRate > 0 ? ttsInTotal * ttsOutRate / ttsInRate : 0;
            ttsLog("end in=" + ttsInTotal + " out=" + ttsFramesWritten + " expect=" + expected
                    + " bytes=" + ttsBytesQueued + " underruns=" + ttsUnderruns);
            releaseTtsTrack();
            notifyTtsEnded();
        });
    }

    /** 立即打断：马上静音（pause+flush），再异步释放，避免延迟 */
    void ttsCancel() {
        ttsCancelled = true;
        AudioTrack track = ttsTrack;
        if (track != null) {
            try {
                track.pause();
                track.flush();
            } catch (Exception ignored) {
                // 已经停止时忽略
            }
        }
        ttsExecutor.execute(this::releaseTtsTrack);
    }

    /** 录音结束后立即把音频模式切回普通，避免后续播放被通话链路影响 */
    void resetAudioMode() {
        try {
            AudioManager manager = (AudioManager) getSystemService(AUDIO_SERVICE);
            if (manager != null && manager.getMode() != AudioManager.MODE_NORMAL) {
                manager.setMode(AudioManager.MODE_NORMAL);
                ttsLog("reset audio mode -> NORMAL");
            }
        } catch (Exception ignored) {
            // 忽略
        }
    }

    /** 播放期间保持 MODE_NORMAL，避免录音/通话模式下的语音处理链（AGC、降噪）作用在媒体播放上 */
    private void enterMediaMode() {
        try {
            AudioManager manager = (AudioManager) getSystemService(AUDIO_SERVICE);
            if (manager == null) {
                return;
            }
            int mode = manager.getMode();
            if (mode != AudioManager.MODE_NORMAL) {
                ttsPreviousMode = mode;
                manager.setMode(AudioManager.MODE_NORMAL);
                // 录音/通话刚结束时通路还在切换，等它稳定，避免开头的声音走听筒听不到
                try {
                    Thread.sleep(400);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                }
                ttsLog("audio mode " + mode + " -> NORMAL (waited 400ms)");
            } else {
                ttsPreviousMode = -1;
            }
        } catch (Exception ignored) {
            // 模式切换失败不影响播放
        }
    }

    private void restoreAudioMode() {
        int previous = ttsPreviousMode;
        ttsPreviousMode = -1;
        if (previous == -1) {
            return;
        }
        try {
            AudioManager manager = (AudioManager) getSystemService(AUDIO_SERVICE);
            if (manager != null) {
                manager.setMode(previous);
            }
        } catch (Exception ignored) {
            // 还原失败忽略
        }
    }

    private void resetResampler() {
        ttsHasByteCarry = false;
        ttsInCount = 0;
        ttsPhase = 0;
        ttsInTotal = 0;
    }

    /** 字节流 → 样本 → 重采样 → 写入 AudioTrack */
    private void feedSamples(AudioTrack track, byte[] data) {
        int offset = 0;
        if (ttsHasByteCarry && data.length > 0) {
            int low = ttsByteCarry & 0xFF;
            int high = data[0] & 0xFF;
            appendSample((short) ((high << 8) | low));
            ttsHasByteCarry = false;
            offset = 1;
        }
        for (int i = offset; i + 1 < data.length; i += 2) {
            appendSample((short) (((data[i + 1] & 0xFF) << 8) | (data[i] & 0xFF)));
        }
        if ((data.length - offset) % 2 == 1) {
            ttsByteCarry = data[data.length - 1];
            ttsHasByteCarry = true;
        }
        resampleAndPlay(track, false);
    }

    /** 收尾：把最后一个样本也用上，避免尾部丢音；短音频没到预缓冲阈值也要播出来 */
    private void flushRemainder() {
        AudioTrack track = ttsTrack;
        if (track == null) {
            return;
        }
        resampleAndPlay(track, true);
        if (!ttsPlaying && ttsFramesWritten > 0) {
            try {
                track.play();
                ttsPlaying = true;
                ttsLog("play on flush frames=" + ttsFramesWritten);
            } catch (Exception e) {
                ttsLog("play on flush failed " + e);
            }
        }
    }

    private void appendSample(short sample) {
        if (ttsInCount >= ttsInSamples.length) {
            short[] grown = new short[ttsInSamples.length * 2];
            System.arraycopy(ttsInSamples, 0, grown, 0, ttsInCount);
            ttsInSamples = grown;
        }
        ttsInSamples[ttsInCount++] = sample;
        ttsInTotal++;
    }

    private void resampleAndPlay(AudioTrack track, boolean flushTail) {
        if (ttsInCount < 2) {
            return;
        }
        // 以「输入样本」为单位的步长：输出采样率越高，步长越小（<1 表示插值补点）
        double step = (double) ttsInRate / (double) ttsOutRate;
        double position = ttsPhase;
        int maxOut = (int) Math.ceil((ttsInCount - position) / step) + 2;
        byte[] out = new byte[maxOut * 2];
        int outCount = 0;
        int index = 0;
        while (true) {
            index = (int) Math.floor(position);
            int limit = flushTail ? ttsInCount : ttsInCount - 1;
            if (index + 1 >= limit) {
                break;
            }
            double frac = position - index;
            double value = ttsInSamples[index] * (1 - frac) + ttsInSamples[index + 1] * frac;
            short sample = (short) Math.max(-32768, Math.min(32767, Math.round(value)));
            out[outCount * 2] = (byte) (sample & 0xFF);
            out[outCount * 2 + 1] = (byte) ((sample >> 8) & 0xFF);
            outCount++;
            position += step;
        }
        int keepFrom = Math.min(index, ttsInCount - 1);
        int keep = ttsInCount - keepFrom;
        System.arraycopy(ttsInSamples, keepFrom, ttsInSamples, 0, keep);
        ttsInCount = keep;
        ttsPhase = Math.max(0, position - keepFrom);
        if (outCount == 0) {
            return;
        }
        int length = outCount * 2;
        int threshold = Math.max(4096, (int) (ttsOutRate * 0.6));
        // 只有这次写入会快填满缓冲时才先起播，其余情况先攒够预缓冲再播，避免开头空播
        if (!ttsPlaying && ttsBytesQueued + length > ttsBufferSize - 8192) {
            track.play();
            ttsPlaying = true;
            ttsLog("play early buffered=" + ttsBytesQueued);
        }
        int offset = 0;
        while (offset < length) {
            int written = track.write(out, offset, length - offset);
            if (written <= 0) {
                ttsLog("write failed " + written + " at " + offset + "/" + length);
                break;
            }
            offset += written;
            ttsFramesWritten += written / 2L;
            ttsBytesQueued += written;
        }
        appendTtsOutDump(out, offset);
        if (offset < length) {
            ttsLog("write truncated " + offset + "/" + length);
        }
        if (!ttsPlaying && ttsBytesQueued >= threshold) {
            // 预缓冲约 0.3 秒再起播：既不断音，也不丢开头
            track.play();
            ttsPlaying = true;
            ttsLog("play buffered=" + ttsBytesQueued);
        }
    }

    /** 收到的 PCM 原样落盘（cache/tts-raw.pcm），用于排查音质问题 */
    private void prepareTtsDump() {
        try {
            File file = new File(getCacheDir(), "tts-raw.pcm");
            //noinspection ResultOfMethodCallIgnored
            file.delete();
            File outFile = new File(getCacheDir(), "tts-out.pcm");
            //noinspection ResultOfMethodCallIgnored
            outFile.delete();
            ttsOutDumpCount = 0;
        } catch (Exception ignored) {
        }
        ttsDumpCount = 0;
    }

    private void appendTtsDump(byte[] data) {
        // 只保留前 3 秒（24kHz 单声道，约 144KB），避免日志过大
        if (ttsDumpCount >= 144 * 1024) {
            return;
        }
        int length = Math.min(data.length, 144 * 1024 - ttsDumpCount);
        try (FileOutputStream out = new FileOutputStream(
                new File(getCacheDir(), "tts-raw.pcm"), true)) {
            out.write(data, 0, length);
            ttsDumpCount += length;
        } catch (IOException ignored) {
        }
    }

    /** 重采样后的输出也落盘（cache/tts-out.pcm），用于核对时长与音质 */
    private void appendTtsOutDump(byte[] data, int length) {
        if (ttsOutDumpCount >= 384 * 1024) {
            return;
        }
        int size = Math.min(length, 384 * 1024 - ttsOutDumpCount);
        try (FileOutputStream out = new FileOutputStream(
                new File(getCacheDir(), "tts-out.pcm"), true)) {
            out.write(data, 0, size);
            ttsOutDumpCount += size;
        } catch (IOException ignored) {
        }
    }

    /** 播放诊断：写到 cache/tts.log，方便 adb run-as 读取 */
    private void ttsLog(String message) {
        android.util.Log.d("DeepLookTts", message);
        try {
            File file = new File(getCacheDir(), "tts.log");
            if (file.length() > 32 * 1024) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
            String line = new SimpleDateFormat("HH:mm:ss.SSS", Locale.US).format(new Date())
                    + " " + message + "\n";
            byte[] bytes = line.getBytes(StandardCharsets.UTF_8);
            try (FileOutputStream out = new FileOutputStream(file, true)) {
                out.write(bytes);
            }
            // 同时写一份到外部目录，正式版也能用 adb 直接拉取排查
            try {
                File external = new File(getExternalFilesDir(null), "tts.log");
                if (external.length() > 64 * 1024) {
                    //noinspection ResultOfMethodCallIgnored
                    external.delete();
                }
                try (FileOutputStream out = new FileOutputStream(external, true)) {
                    out.write(bytes);
                }
            } catch (Exception ignored) {
                // 外部目录不可写时忽略
            }
        } catch (IOException ignored) {
            // 写不了日志不影响播放
        }
    }

    private void releaseTtsTrack() {
        AudioTrack track = ttsTrack;
        ttsTrack = null;
        ttsPlaying = false;
        ttsBytesQueued = 0;
        resetResampler();
        if (track != null) {
            try {
                if (track.getPlayState() == AudioTrack.PLAYSTATE_PLAYING) {
                    track.stop();
                }
            } catch (Exception ignored) {
            }
            try {
                track.release();
            } catch (Exception ignored) {
            }
        }
        restoreAudioMode();
    }

    private void notifyTtsEnded() {
        mainHandler.post(() -> {
            if (webView != null) {
                webView.evaluateJavascript(
                        "window.__deeplookTtsEnded && window.__deeplookTtsEnded()", null);
            }
        });
    }

    /** 从下载链接导入：原生下载到 cache，再分片回传给页面做导入 */
    void importHistoryFromUrl(@Nullable String urlString) {
        if (historyImportRunning) {
            postImportEvent("{\"type\":\"error\",\"message\":\"busy\"}");
            return;
        }
        if (urlString == null) {
            postImportEvent("{\"type\":\"error\",\"message\":\"invalid-url\"}");
            return;
        }
        String url = urlString.trim();
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            postImportEvent("{\"type\":\"error\",\"message\":\"invalid-url\"}");
            return;
        }
        historyImportRunning = true;
        historyImportCancelled = false;
        historyImportThread = new Thread(() -> runHistoryImport(url));
        historyImportThread.start();
    }

    void cancelHistoryImport() {
        historyImportCancelled = true;
        postImportEvent("{\"type\":\"error\",\"message\":\"cancelled\"}");
    }

    void deleteHistoryImport() {
        File file = historyImportFile;
        historyImportFile = null;
        if (file != null && file.exists()) {
            // 删除失败不影响使用，下次导入会覆盖同名文件
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
    }

    private void runHistoryImport(String urlString) {
        File target = null;
        HttpURLConnection connection = null;
        InputStream input = null;
        FileOutputStream output = null;
        try {
            File dir = new File(getCacheDir(), "history-import");
            if (!dir.exists() && !dir.mkdirs()) {
                throw new IOException("cannot create import dir");
            }
            target = new File(dir, "history.zip");
            if (target.exists()) {
                //noinspection ResultOfMethodCallIgnored
                target.delete();
            }
            connection = (HttpURLConnection) new URL(urlString).openConnection();
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(30000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("User-Agent", "deeplook-android");
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) {
                throw new IOException("HTTP " + code);
            }
            long total = connection.getContentLengthLong();
            input = connection.getInputStream();
            output = new FileOutputStream(target);
            byte[] buffer = new byte[16384];
            long received = 0;
            int lastPercent = -1;
            int read;
            while ((read = input.read(buffer)) != -1) {
                if (historyImportCancelled) {
                    throw new IOException("cancelled");
                }
                output.write(buffer, 0, read);
                received += read;
                if (total > 0) {
                    int percent = (int) (received * 100 / total);
                    if (percent != lastPercent) {
                        lastPercent = percent;
                        postImportEvent("{\"type\":\"download\",\"status\":\"downloading\",\"percent\":"
                                + percent + ",\"received\":" + received + ",\"total\":" + total + "}");
                    }
                }
            }
            output.flush();
            output.close();
            output = null;
            input.close();
            input = null;
            if (total > 0 && received < total) {
                throw new IOException("incomplete download");
            }
            long size = target.length();
            historyImportFile = target;
            postImportEvent("{\"type\":\"download\",\"status\":\"done\",\"size\":" + size + "}");
            streamImportFile(target);
        } catch (Exception e) {
            if (target != null && target.exists()) {
                //noinspection ResultOfMethodCallIgnored
                target.delete();
            }
            String message = historyImportCancelled ? "cancelled" : String.valueOf(e.getMessage());
            postImportEvent("{\"type\":\"error\",\"message\":" + JSONObject.quote(message) + "}");
        } finally {
            try {
                if (output != null) {
                    output.close();
                }
            } catch (IOException ignored) {
            }
            try {
                if (input != null) {
                    input.close();
                }
            } catch (IOException ignored) {
            }
            if (connection != null) {
                connection.disconnect();
            }
            historyImportRunning = false;
        }
    }

    /** 分片读取文件并以 base64 回传，页面拼成 Blob 后走原有导入流程 */
    private void streamImportFile(File file) {
        try (java.io.FileInputStream in = new java.io.FileInputStream(file)) {
            byte[] buffer = new byte[IMPORT_CHUNK_BYTES];
            long total = file.length();
            long sent = 0;
            int seq = 0;
            int lastPercent = -1;
            int read;
            while ((read = in.read(buffer)) != -1) {
                if (historyImportCancelled) {
                    return;
                }
                byte[] slice = read == buffer.length ? buffer : java.util.Arrays.copyOf(buffer, read);
                final String base64 = Base64.encodeToString(slice, Base64.NO_WRAP);
                final int index = seq++;
                mainHandler.post(() -> {
                    if (webView != null) {
                        webView.evaluateJavascript(
                                "window.__deeplookImportChunk && window.__deeplookImportChunk("
                                        + index + ",'" + base64 + "')", null);
                    }
                });
                sent += read;
                if (total > 0) {
                    int percent = (int) (sent * 100 / total);
                    if (percent != lastPercent) {
                        lastPercent = percent;
                        postImportEvent("{\"type\":\"read\",\"status\":\"reading\",\"percent\":"
                                + percent + "}");
                    }
                }
            }
            postImportEvent("{\"type\":\"read\",\"status\":\"done\",\"chunks\":" + seq
                    + ",\"size\":" + total + "}");
        } catch (Exception e) {
            postImportEvent("{\"type\":\"error\",\"message\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}");
        }
    }

    private void postImportEvent(String json) {
        mainHandler.post(() -> {
            if (webView == null) {
                return;
            }
            webView.evaluateJavascript(
                    "window.__deeplookImportEvent && window.__deeplookImportEvent(" + json + ")", null);
        });
    }

    void beginDownload(@Nullable String name) {
        closeDownloadStream();
        String safeName = sanitizeFileName(name == null || name.isEmpty() ? "download.zip" : name);
        try {
            File dir = new File(getCacheDir(), "downloads");
            if (!dir.exists() && !dir.mkdirs()) {
                throw new IOException("cannot create cache dir");
            }
            downloadTempFile = new File(dir, safeName);
            downloadStream = new FileOutputStream(downloadTempFile);
        } catch (IOException e) {
            downloadTempFile = null;
            downloadStream = null;
            toastOnUi(R.string.download_failed);
        }
    }

    void appendDownload(String base64Chunk, boolean last) {
        if (downloadStream == null || downloadTempFile == null) {
            return;
        }
        try {
            byte[] bytes = Base64.decode(base64Chunk, Base64.DEFAULT);
            downloadStream.write(bytes);
            if (last) {
                downloadStream.flush();
                closeDownloadStream();
                saveDownloadedFile(downloadTempFile);
            }
        } catch (IllegalArgumentException | IOException e) {
            closeDownloadStream();
            toastOnUi(R.string.download_failed);
        }
    }

    private void closeDownloadStream() {
        if (downloadStream != null) {
            try {
                downloadStream.close();
            } catch (IOException ignored) {
                // 关闭失败不影响后续提示
            }
            downloadStream = null;
        }
    }

    /** 优先写入公共 Downloads（分区存储下用 MediaStore），失败时退回应用专属目录 */
    private void saveDownloadedFile(File file) {
        String name = file.getName();
        pendingDownloadFile = file;
        pendingDownloadName = name;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, name);
            values.put(MediaStore.Downloads.MIME_TYPE, guessMime(name));
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            Uri target = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (target != null) {
                try (OutputStream out = getContentResolver().openOutputStream(target)) {
                    if (out != null) {
                        copy(file, out);
                        toastOnUi(R.string.download_saved_toast, name);
                        file.delete();
                        pendingDownloadFile = null;
                        pendingDownloadName = null;
                        return;
                    }
                } catch (IOException e) {
                    getContentResolver().delete(target, null, null);
                }
            }
        } else if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != PackageManager.PERMISSION_GRANTED) {
            // Android 9 及以下需要存储权限，交给系统保存界面处理，用户可选择目录
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(guessMime(name));
            intent.putExtra(Intent.EXTRA_TITLE, name);
            try {
                legacyDownloadLauncher.launch(intent);
                return;
            } catch (ActivityNotFoundException ignored) {
                // 没有文件管理器时退回应用目录
            }
        } else {
            File dir = new File(Environment.getExternalStoragePublicDirectory(
                    Environment.DIRECTORY_DOWNLOADS), name);
            try {
                copy(file, new FileOutputStream(dir));
                toastOnUi(R.string.download_saved_toast, name);
                file.delete();
                pendingDownloadFile = null;
                pendingDownloadName = null;
                return;
            } catch (IOException ignored) {
                // 退回应用专属目录
            }
        }

        // 兜底：留在应用专属目录并提示路径
        File fallback = new File(getExternalFilesDir(null), name);
        try {
            copy(file, new FileOutputStream(fallback));
            toastOnUi(R.string.download_saved_fallback_toast, fallback.getAbsolutePath());
            file.delete();
        } catch (IOException e) {
            toastOnUi(R.string.download_failed);
        }
        pendingDownloadFile = null;
        pendingDownloadName = null;
    }

    private static void copy(File source, OutputStream out) throws IOException {
        try (java.io.InputStream in = new java.io.FileInputStream(source)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
            out.flush();
        } finally {
            out.close();
        }
    }

    private static String guessMime(String name) {
        String lower = name.toLowerCase();
        if (lower.endsWith(".zip")) return "application/zip";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".md")) return "text/markdown";
        if (lower.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    private static String sanitizeFileName(String name) {
        String cleaned = name.replaceAll("[\\\\/:*?\"<>|\\r\\n]", "_").trim();
        return cleaned.isEmpty() ? "download.zip" : cleaned;
    }

    private void toastOnUi(int resId, Object... args) {
        String text = getString(resId, args);
        mainHandler.post(() -> Toast.makeText(this, text, Toast.LENGTH_LONG).show());
    }

    /** 带唯一查询串的入口地址：避免历史缓存条目影响首屏 */
    private String bootUrl() {
        return APP_URL + "?boot=" + System.currentTimeMillis();
    }

    /** 加载页面并重新武装启动看门狗 */
    private void loadApp() {
        loadCount++;
        pageReady = false;
        loadProgress = 0;
        showSplash(null);
        mainHandler.removeCallbacks(watchdogTask);
        mainHandler.postDelayed(watchdogTask, DIAG_BUILD ? 5000 : 15000);
        webView.loadUrl(bootUrl());
    }

    /** 点重试：普通重载；软件渲染修复过就不再重复 */
    private void retryLoad() {
        if (webView == null) {
            recreateWebView(false);
            return;
        }
        loadApp();
    }

    /** 销毁当前 WebView 并重建（渲染进程崩溃 / 黑屏修复时用） */
    private void recreateWebView(boolean software) {
        pageReady = false;
        WebView old = webView;
        webView = null;
        if (old != null) {
            old.removeJavascriptInterface(BRIDGE_NAME);
            rootView.removeView(old);
            old.destroy();
        }
        createAndConfigureWebView(software);
        rootView.addView(webView, 0);
        loadApp();
    }

    /** 页面完成但没渲染出内容时，切软件渲染重载一次 */
    private void verifyRendered(WebView target) {
        if (target != webView || webView == null) {
            return;
        }
        webView.evaluateJavascript(
                "(function(){var r=document.getElementById('root');return r&&r.childElementCount>0?'ok':'empty';})()",
                value -> {
                    if (value != null && value.contains("empty")) {
                        diag("blank-page");
                        if (DIAG_BUILD) {
                            // 调试版保留失败现场：只记录，不自动重载，方便截图定位
                            pushConsole("blank-page root=0");
                            return;
                        }
                        if (!repairedOnce) {
                            repairedOnce = true;
                            recreateWebView(true);
                        }
                    }
                });
    }

    /** 启动占位层：logo + 状态文字，整块可点重试；有异常时显示诊断码 */
    private void buildSplashView() {
        float density = getResources().getDisplayMetrics().density;
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setGravity(Gravity.CENTER);
        column.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        column.setBackgroundColor(ContextCompat.getColor(this, R.color.chat_background));
        column.setClickable(true);
        column.setOnClickListener(v -> retryLoad());
        // 长按切换兼容模式（软件渲染）：自动恢复失败时给用户一个手动出口
        column.setOnLongClickListener(v -> {
            boolean next = !compatSoftware;
            setCompatSoftware(next);
            splashStatus.setText(next ? R.string.splash_compat_on : R.string.splash_compat_off);
            recreateWebView(next);
            showSplash(next ? getString(R.string.splash_compat_on) : getString(R.string.splash_compat_off));
            return true;
        });

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        int size = (int) (88 * density);
        LinearLayout.LayoutParams logoParams = new LinearLayout.LayoutParams(size, size);
        column.addView(logo, logoParams);

        TextView title = new TextView(this);
        title.setText(R.string.app_name);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        title.setTextColor(ContextCompat.getColor(this, R.color.brand_primary));
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        titleParams.topMargin = (int) (16 * density);
        column.addView(title, titleParams);

        splashStatus = new TextView(this);
        splashStatus.setText(R.string.splash_starting);
        splashStatus.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        splashStatus.setTextColor(ContextCompat.getColor(this, R.color.splash_hint));
        splashStatus.setGravity(Gravity.CENTER);
        splashStatus.setMaxLines(4);
        splashStatus.setPadding((int) (24 * density), 0, (int) (24 * density), 0);
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        statusParams.topMargin = (int) (10 * density);
        column.addView(splashStatus, statusParams);

        splashView = column;
        splashCreated = true;
        rootView.addView(splashView);
    }

    private void showSplash(@Nullable String status) {
        if (!splashCreated || splashView == null) {
            return;
        }
        splashView.setVisibility(View.VISIBLE);
        if (status != null) {
            splashStatus.setText(status);
        }
    }

    private void hideSplash() {
        if (!splashCreated || splashView == null) {
            return;
        }
        splashView.setVisibility(View.GONE);
    }

    private void pushConsole(String line) {
        String text = line.replaceAll("\\s+", " ");
        if (text.length() > 160) {
            text = text.substring(0, 160);
        }
        consoleLines.add(text);
        if (consoleLines.size() > 4) {
            consoleLines.remove(0);
        }
    }

    /** 调试版诊断条：贴在屏幕底部，黑屏时也能看到状态 */
    private void buildDiagPanel() {
        float density = getResources().getDisplayMetrics().density;
        TextView panel = new TextView(this);
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.gravity = Gravity.BOTTOM;
        panel.setLayoutParams(params);
        panel.setBackgroundColor(0xD9000000);
        panel.setTextColor(0xFF9BFF9B);
        panel.setTextSize(TypedValue.COMPLEX_UNIT_SP, 9);
        panel.setTypeface(android.graphics.Typeface.MONOSPACE);
        panel.setPadding((int) (8 * density), (int) (6 * density),
                (int) (8 * density), (int) (6 * density));
        panel.setText("diag（点=红屏自检，长按=切换兼容渲染）");
        panel.setOnClickListener(v -> runRedTest());
        // 长按切换软件渲染并重载：如果重载后界面出来了，就是硬件渲染的问题
        panel.setOnLongClickListener(v -> {
            boolean next = !compatSoftware;
            setCompatSoftware(next);
            redTestState = next ? "sw=on" : "sw=off";
            recreateWebView(next);
            showSplash(next ? "已切到软件渲染，正在重载…" : "已切回硬件渲染，正在重载…");
            return true;
        });
        diagPanel = panel;
        rootView.addView(panel);
    }

    private final Runnable diagTick = new Runnable() {
        @Override
        public void run() {
            if (!DIAG_BUILD || isFinishing() || isDestroyed()) {
                return;
            }
            refreshDiagPanel();
            mainHandler.postDelayed(this, 1000);
        }
    };

    private void refreshDiagPanel() {
        TextView panel = diagPanel;
        if (panel == null) {
            return;
        }
        StringBuilder native_ = new StringBuilder();
        native_.append("p=").append(loadProgress)
                .append(" rdy=").append(pageReady ? 1 : 0)
                .append(" att=").append(bootAttempt)
                .append(" sw=").append(compatSoftware ? 1 : 0)
                .append(" splash=").append(splashView == null ? 0
                        : (splashView.getVisibility() == View.VISIBLE ? 1 : 0))
                .append(" night=").append(isDarkMode() ? 1 : 0)
                .append(" ev p").append(pauseCount)
                .append(" r").append(resumeCount)
                .append(" f").append(pageFinishedCount)
                .append(" l").append(loadCount)
                .append(" ").append(redTestState)
                .append(" wv=").append(webViewVersion());
        if (webView != null) {
            native_.append("\nurl=").append(shorten(webView.getUrl(), 60))
                    .append(" title=").append(shorten(webView.getTitle(), 30))
                    .append(" h=").append(webView.getContentHeight());
        }
        StringBuilder text = new StringBuilder(native_);
        text.append('\n').append(lastPageDiag);
        if (!consoleLines.isEmpty()) {
            text.append('\n').append("c=").append(consoleLines.get(consoleLines.size() - 1));
        }
        panel.setText(text.toString());

        WebView target = webView;
        if (target == null) {
            return;
        }
        target.evaluateJavascript(
                "(window.__deeplookDiagReport ? window.__deeplookDiagReport() : 'bundle-not-run')",
                value -> {
                    if (value == null) {
                        lastPageDiag = "js=null";
                        return;
                    }
                    try {
                        // evaluateJavascript 返回 JSON 字符串，去掉首尾引号并反转义
                        String raw = new org.json.JSONArray("[" + value + "]").optString(0);
                        lastPageDiag = raw == null || raw.isEmpty() ? "js=empty" : raw;
                    } catch (Exception e) {
                        lastPageDiag = "js=parse-fail " + shorten(value, 60);
                    }
                    if (diagPanel != null) {
                        diagPanel.setText(native_.toString() + '\n' + lastPageDiag
                                + (consoleLines.isEmpty() ? ""
                                : '\n' + "c=" + consoleLines.get(consoleLines.size() - 1)));
                    }
                });
    }

    /** 红屏自检：在页面里铺一层纯红。看得到红色 = WebView 绘制正常，问题在页面样式；看不到 = 绘制/合成异常 */
    private void runRedTest() {
        WebView target = webView;
        if (target == null) {
            return;
        }
        redTestState = "red=on";
        if (splashCreated && splashView != null) {
            splashView.setVisibility(View.VISIBLE);
            splashStatus.setText("红屏自检：现在屏幕应该是纯红色（5 秒）\n看得到红色说明绘制正常");
        }
        target.evaluateJavascript(
                "(window.__deeplookRedTest ? window.__deeplookRedTest(true) : 'no-hook')", null);
        mainHandler.postDelayed(() -> {
            WebView current = webView;
            if (current != null) {
                current.evaluateJavascript(
                        "(window.__deeplookRedTest ? window.__deeplookRedTest(false) : 'no-hook')", null);
            }
            redTestState = "red=off";
            if (splashCreated && splashView != null) {
                splashView.setVisibility(View.GONE);
            }
        }, 5000);
    }

    private static String shorten(@Nullable String text, int limit) {
        if (text == null) {
            return "-";
        }
        String flat = text.replaceAll("\\s+", " ");
        return flat.length() <= limit ? flat : flat.substring(0, limit) + "…";
    }

    /** 记录兼容模式（软件渲染）选择 */
    private void setCompatSoftware(boolean software) {
        compatSoftware = software;
        try {
            getSharedPreferences("boot", MODE_PRIVATE).edit()
                    .putBoolean("software", software).apply();
        } catch (Exception ignored) {
            // 写不了偏好也不影响本次生效
        }
    }

    /** 当前 WebView 提供方与版本，黑屏排查时能区分是应用问题还是系统 WebView 问题 */
    private String webViewVersion() {
        try {
            android.content.pm.PackageInfo info = WebViewCompat.getCurrentWebViewPackage(this);
            if (info == null) {
                return "unknown";
            }
            String name = info.packageName == null ? "?" : info.packageName.replace("com.", "");
            return name + "/" + info.versionName;
        } catch (Exception e) {
            return "unknown";
        }
    }

    /** 把诊断日志（最多 4 行）贴到提示文字下面 */
    private void appendDiagSummary() {
        if (!splashCreated || splashView == null) {
            return;
        }
        try {
            File file = new File(getCacheDir(), "deeplook-diag.log");
            StringBuilder builder = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                    new java.io.FileInputStream(file), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    builder.append(line).append('\n');
                }
            }
            String all = builder.toString().trim();
            String tail = all.length() > 260 ? all.substring(all.length() - 260) : all;
            splashStatus.setText(splashStatus.getText() + "\n\n" + tail);
        } catch (IOException ignored) {
            // 没有日志时保持原样
        }
    }

    /** 记录启动异常，并把最近一条显示在启动层上，方便用户截图反馈 */
    private void diag(String message) {
        if (!DIAG_BUILD) {
            return;
        }
        try {
            File file = new File(getCacheDir(), "deeplook-diag.log");
            if (file.length() > 64 * 1024) {
                file.delete();
            }
            String line = new SimpleDateFormat("MM-dd HH:mm:ss", Locale.US).format(new Date())
                    + " " + message + "\n";
            try (FileOutputStream out = new FileOutputStream(file, true)) {
                out.write(line.getBytes(StandardCharsets.UTF_8));
            }
        } catch (IOException ignored) {
            // 诊断日志写不了不影响启动
        }
        if (splashCreated && splashView != null) {
            splashView.setVisibility(View.VISIBLE);
            splashStatus.setText(getString(R.string.splash_diag, message));
        }
    }

    @Override
    protected void onPause() {
        pauseCount++;
        super.onPause();
        webView.onPause();
    }

    @Override
    protected void onResume() {
        resumeCount++;
        super.onResume();
        webView.onResume();
        // 从「安装未知应用」设置页返回后，继续拉起安装器
        if (pendingUpdateFile != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && getPackageManager().canRequestPackageInstalls()) {
            mainHandler.postDelayed(this::installPendingUpdate, 400);
        }
    }

    @Override
    protected void onDestroy() {
        ttsCancel();
        ttsExecutor.shutdownNow();
        historyImportCancelled = true;
        mainHandler.removeCallbacks(diagTick);
        closeDownloadStream();
        if (webView != null) {
            webView.removeJavascriptInterface(BRIDGE_NAME);
            webView.destroy();
        }
        super.onDestroy();
    }
}



