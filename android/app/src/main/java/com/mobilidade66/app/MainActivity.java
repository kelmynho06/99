package com.mobilidade66.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FloatingBubblePlugin.class);
        super.onCreate(savedInstanceState);

        SharedPreferences prefs = getSharedPreferences("mobilidade66_ota", Context.MODE_PRIVATE);
        String savedOtaUrl = prefs.getString("ota_web_url", "");
        if (this.bridge != null && this.bridge.getWebView() != null) {
            final String localUrl = this.bridge.getLocalUrl();
            this.bridge.setWebViewClient(new BridgeWebViewClient(this.bridge) {
                @Override
                public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    if (request != null && request.isForMainFrame()) {
                        String reqUrl = request.getUrl() != null ? request.getUrl().toString() : "";
                        if (!reqUrl.startsWith(localUrl)) {
                            view.post(() -> view.loadUrl(localUrl));
                            return;
                        }
                    }
                    super.onReceivedError(view, request, error);
                }

                @Override
                public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                    if (request != null && request.isForMainFrame() && errorResponse != null && errorResponse.getStatusCode() >= 400) {
                        String reqUrl = request.getUrl() != null ? request.getUrl().toString() : "";
                        if (!reqUrl.startsWith(localUrl)) {
                            view.post(() -> view.loadUrl(localUrl));
                            return;
                        }
                    }
                    super.onReceivedHttpError(view, request, errorResponse);
                }
            });

            if (savedOtaUrl != null && (savedOtaUrl.startsWith("https://") || savedOtaUrl.startsWith("http://"))) {
                this.bridge.getWebView().post(() -> this.bridge.getWebView().loadUrl(savedOtaUrl));
            }
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        FloatingBubbleService.setAppForeground(this, true);
    }

    @Override
    public void onResume() {
        super.onResume();
        FloatingBubbleService.setAppForeground(this, true);
    }

    @Override
    public void onStop() {
        super.onStop();
        if (!isChangingConfigurations()) {
            FloatingBubbleService.setAppForeground(this, false);
        }
    }
}
