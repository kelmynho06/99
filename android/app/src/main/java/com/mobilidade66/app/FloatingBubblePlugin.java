package com.mobilidade66.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.content.pm.PackageInfoCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FloatingBubble")
public class FloatingBubblePlugin extends Plugin {

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        Context ctx = getContext();
        boolean overlay = Settings.canDrawOverlays(ctx);
        boolean batteryIgnored = isIgnoringBatteryOptimizations(ctx);
        boolean enabled = FloatingBubbleService.isFeatureEnabled(ctx);

        JSObject res = new JSObject();
        res.put("overlay", overlay);
        res.put("batteryIgnored", batteryIgnored);
        res.put("enabled", enabled);
        call.resolve(res);
    }

    @PluginMethod
    public void requestOverlayPermission(PluginCall call) {
        Context ctx = getContext();
        if (Settings.canDrawOverlays(ctx)) {
            JSObject res = new JSObject();
            res.put("overlay", true);
            call.resolve(res);
            return;
        }
        try {
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + ctx.getPackageName())
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
        } catch (Exception e) {
            try {
                Intent fallback = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(fallback);
            } catch (Exception ignored) {
            }
        }
        JSObject res = new JSObject();
        res.put("overlay", Settings.canDrawOverlays(ctx));
        call.resolve(res);
    }

    @PluginMethod
    public void requestBatteryOptimization(PluginCall call) {
        Context ctx = getContext();
        if (isIgnoringBatteryOptimizations(ctx)) {
            JSObject res = new JSObject();
            res.put("batteryIgnored", true);
            call.resolve(res);
            return;
        }
        try {
            Intent intent = new Intent(
                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:" + ctx.getPackageName())
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
        } catch (Exception e) {
            try {
                Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(fallback);
            } catch (Exception ignored) {
            }
        }
        JSObject res = new JSObject();
        res.put("batteryIgnored", isIgnoringBatteryOptimizations(ctx));
        call.resolve(res);
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        FloatingBubbleService.setFeatureEnabled(getContext(), enabled);
        JSObject res = new JSObject();
        res.put("enabled", enabled);
        call.resolve(res);
    }

    @PluginMethod
    public void setActiveRide(PluginCall call) {
        boolean hasActiveRide = Boolean.TRUE.equals(call.getBoolean("hasActiveRide", false));
        FloatingBubbleService.setHasActiveRide(getContext(), hasActiveRide);
        call.resolve();
    }

    @PluginMethod
    public void hide(PluginCall call) {
        FloatingBubbleService.hideBubble(getContext());
        call.resolve();
    }

    @PluginMethod
    public void getAppVersion(PluginCall call) {
        Context ctx = getContext();
        String versionName = "1.2.2";
        long versionCode = 3;
        try {
            PackageInfo pInfo = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            if (pInfo.versionName != null && !pInfo.versionName.isEmpty()) {
                versionName = pInfo.versionName;
            }
            versionCode = PackageInfoCompat.getLongVersionCode(pInfo);
        } catch (Exception ignored) {
        }
        JSObject res = new JSObject();
        res.put("versionName", versionName);
        res.put("versionCode", versionCode);
        call.resolve(res);
    }

    @PluginMethod
    public void openExternalUrl(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || url.trim().isEmpty()) {
            call.reject("URL inválida");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url.trim()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void applyWebUpdate(PluginCall call) {
        String url = call.getString("url", "");
        String clean = url == null ? "" : url.trim();
        if (!clean.startsWith("https://") && !clean.startsWith("http://")) {
            JSObject res = new JSObject();
            res.put("applied", false);
            call.resolve(res);
            return;
        }
        Context ctx = getContext();
        ctx.getSharedPreferences("mobilidade66_ota", Context.MODE_PRIVATE)
            .edit()
            .putString("ota_web_url", clean)
            .apply();

        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(clean));
        }

        JSObject res = new JSObject();
        res.put("applied", true);
        call.resolve(res);
    }

    private boolean isIgnoringBatteryOptimizations(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        try {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            return pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
        } catch (Exception e) {
            return false;
        }
    }
}
