package com.huagyuu.deeplook;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
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
    private boolean splashCreated;

    private final Runnable watchdogTask = () -> {
        if (pageReady) {
            return;
        }
        diag("boot-timeout");
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

        createAndConfigureWebView(false);
        rootView.addView(webView);
        buildSplashView();
        setContentView(rootView);

        registerLaunchers();
        loadApp();

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
                                finish();
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
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                injectDownloadBridge();
                pageReady = true;
                mainHandler.removeCallbacks(watchdogTask);
                hideSplash();
                // 再确认一次真的渲染出了内容：有些机型页面已完成后仍是一整块黑屏
                mainHandler.postDelayed(() -> verifyRendered(view), 800);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                if (request.isForMainFrame()) {
                    pageReady = false;
                    diag("load-error " + error.getErrorCode() + " " + error.getDescription());
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
            public boolean onConsoleMessage(@NonNull ConsoleMessage message) {
                if (BuildConfig.DEBUG) {
                    android.util.Log.d("ChatWebView",
                            message.message() + " @" + message.sourceId() + ":" + message.lineNumber());
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

    /** 加载页面并重新武装启动看门狗 */
    private void loadApp() {
        pageReady = false;
        showSplash(null);
        mainHandler.removeCallbacks(watchdogTask);
        mainHandler.postDelayed(watchdogTask, 12000);
        webView.loadUrl(APP_URL);
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

    /** 记录启动异常，并把最近一条显示在启动层上，方便用户截图反馈 */
    private void diag(String message) {
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
        super.onPause();
        webView.onPause();
    }

    @Override
    protected void onResume() {
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
        closeDownloadStream();
        if (webView != null) {
            webView.removeJavascriptInterface(BRIDGE_NAME);
            webView.destroy();
        }
        super.onDestroy();
    }
}



