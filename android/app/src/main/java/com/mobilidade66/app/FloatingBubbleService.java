package com.mobilidade66.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.IBinder;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;
import androidx.core.app.NotificationCompat;

public class FloatingBubbleService extends Service {

    public static final String PREFS_NAME = "mobilidade66_bubble_prefs";
    public static final String KEY_ENABLED = "enabled";
    public static final String KEY_HAS_ACTIVE_RIDE = "has_active_ride";
    private static final String KEY_LAST_X = "last_x";
    private static final String KEY_LAST_Y = "last_y";

    private static final String CHANNEL_ID = "mobilidade66_bubble_channel";
    private static final int NOTIFICATION_ID = 6601;

    private static final String ACTION_SHOW = "com.mobilidade66.app.ACTION_SHOW_BUBBLE";
    private static final String ACTION_HIDE = "com.mobilidade66.app.ACTION_HIDE_BUBBLE";

    private WindowManager windowManager;
    private FrameLayout bubbleContainer;
    private FrameLayout dismissContainer;
    private TextView dismissCircle;
    private WindowManager.LayoutParams bubbleParams;
    private WindowManager.LayoutParams dismissParams;
    private View statusDot;

    private int screenWidth;
    private int screenHeight;
    private int bubbleSizePx;
    private int dismissSizePx;
    private int marginPx;
    private int touchSlop;
    private boolean isShowing = false;
    private boolean dismissVisible = false;
    private boolean isOverDismiss = false;

    public static boolean isFeatureEnabled(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getBoolean(KEY_ENABLED, true);
    }

    public static void setFeatureEnabled(Context ctx, boolean enabled) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putBoolean(KEY_ENABLED, enabled).apply();
        if (!enabled) {
            hideBubble(ctx);
        }
    }

    public static void setHasActiveRide(Context ctx, boolean hasActiveRide) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putBoolean(KEY_HAS_ACTIVE_RIDE, hasActiveRide).apply();
    }

    public static void setAppForeground(Context ctx, boolean inForeground) {
        if (inForeground) {
            hideBubble(ctx);
            return;
        }
        if (!isFeatureEnabled(ctx)) return;
        if (!Settings.canDrawOverlays(ctx)) return;
        showBubble(ctx);
    }

    public static void showBubble(Context ctx) {
        if (!Settings.canDrawOverlays(ctx)) return;
        Intent intent = new Intent(ctx, FloatingBubbleService.class);
        intent.setAction(ACTION_SHOW);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent);
            } else {
                ctx.startService(intent);
            }
        } catch (Exception ignored) {
            try {
                ctx.startService(intent);
            } catch (Exception ignoredAgain) {
            }
        }
    }

    public static void hideBubble(Context ctx) {
        Intent intent = new Intent(ctx, FloatingBubbleService.class);
        intent.setAction(ACTION_HIDE);
        try {
            ctx.stopService(intent);
        } catch (Exception ignored) {
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        touchSlop = ViewConfiguration.get(this).getScaledTouchSlop();
        float density = getResources().getDisplayMetrics().density;
        bubbleSizePx = Math.round(58 * density);
        dismissSizePx = Math.round(56 * density);
        marginPx = Math.round(12 * density);
        updateScreenBounds();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : ACTION_SHOW;
        if (ACTION_HIDE.equals(action)) {
            removeOverlayViews();
            stopSelfCleanly();
            return START_NOT_STICKY;
        }

        if (!isFeatureEnabled(this) || !Settings.canDrawOverlays(this)) {
            removeOverlayViews();
            stopSelfCleanly();
            return START_NOT_STICKY;
        }

        startMinimalForegroundNotification();
        showOverlayViews();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        removeOverlayViews();
        super.onDestroy();
    }

    private void updateScreenBounds() {
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        screenWidth = metrics.widthPixels;
        screenHeight = metrics.heightPixels;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Atalho Rápido 66 Mobilidade",
                NotificationManager.IMPORTANCE_MIN
            );
            channel.setDescription("Mantém o botão flutuante ativo apenas em segundo plano com mínimo consumo de bateria.");
            channel.setShowBadge(false);
            channel.setSound(null, null);
            channel.enableVibration(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    private void startMinimalForegroundNotification() {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        int piFlags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
            ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            : PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, openIntent, piFlags);

        Notification notif = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("66 Mobilidade em segundo plano")
            .setContentText("Toque no balão flutuante para retornar rapidamente")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(pendingIntent)
            .build();

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(NOTIFICATION_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(NOTIFICATION_ID, notif);
            }
        } catch (Exception ignored) {
        }
    }

    private void stopSelfCleanly() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Exception ignored) {
        }
        stopSelf();
    }

    private int getOverlayWindowType() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
        }
        return WindowManager.LayoutParams.TYPE_PHONE;
    }

    private void showOverlayViews() {
        if (windowManager == null) return;
        updateScreenBounds();

        if (isShowing) {
            updateActiveBadge();
            return;
        }

        // 1. Bottom X dismiss target (initially invisible until drag starts)
        dismissContainer = new FrameLayout(this);
        dismissCircle = new TextView(this);
        dismissCircle.setText("✕");
        dismissCircle.setTextColor(Color.WHITE);
        dismissCircle.setTextSize(20);
        dismissCircle.setGravity(Gravity.CENTER);
        dismissCircle.setBackground(createCircleDrawable(Color.parseColor("#E6111419"), Color.parseColor("#66FFFFFF"), 2));

        FrameLayout.LayoutParams circleLp = new FrameLayout.LayoutParams(dismissSizePx, dismissSizePx);
        dismissContainer.addView(dismissCircle, circleLp);
        dismissContainer.setVisibility(View.GONE);

        dismissParams = new WindowManager.LayoutParams(
            dismissSizePx,
            dismissSizePx,
            getOverlayWindowType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
            PixelFormat.TRANSLUCENT
        );
        dismissParams.gravity = Gravity.TOP | Gravity.START;
        dismissParams.x = (screenWidth - dismissSizePx) / 2;
        dismissParams.y = Math.max(marginPx, screenHeight - dismissSizePx - Math.round(44 * getResources().getDisplayMetrics().density));

        // 2. Draggable 66 bubble view
        bubbleContainer = new FrameLayout(this);
        float density = getResources().getDisplayMetrics().density;

        FrameLayout circleFrame = new FrameLayout(this);
        circleFrame.setBackground(createCircleDrawable(Color.parseColor("#111419"), Color.parseColor("#FFD100"), Math.round(2.5f * density)));
        circleFrame.setElevation(10 * density);
        int pad = Math.round(4 * density);
        circleFrame.setPadding(pad, pad, pad, pad);

        ImageView logoImg = new ImageView(this);
        logoImg.setImageResource(R.drawable.bubble_logo_66);
        logoImg.setScaleType(ImageView.ScaleType.CENTER_CROP);
        FrameLayout.LayoutParams imgLp = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        );
        circleFrame.addView(logoImg, imgLp);

        FrameLayout.LayoutParams frameLp = new FrameLayout.LayoutParams(bubbleSizePx, bubbleSizePx);
        bubbleContainer.addView(circleFrame, frameLp);

        // Active ride indicator dot
        int dotSize = Math.round(13 * density);
        statusDot = new View(this);
        statusDot.setBackground(createCircleDrawable(Color.parseColor("#FFD100"), Color.parseColor("#111419"), Math.round(2 * density)));
        FrameLayout.LayoutParams dotLp = new FrameLayout.LayoutParams(dotSize, dotSize, Gravity.TOP | Gravity.END);
        dotLp.topMargin = Math.round(1 * density);
        dotLp.rightMargin = Math.round(1 * density);
        bubbleContainer.addView(statusDot, dotLp);
        updateActiveBadge();

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        int defaultX = Math.max(marginPx, screenWidth - bubbleSizePx - marginPx);
        int defaultY = Math.round(screenHeight * 0.42f);
        int savedX = prefs.getInt(KEY_LAST_X, defaultX);
        int savedY = prefs.getInt(KEY_LAST_Y, defaultY);

        bubbleParams = new WindowManager.LayoutParams(
            bubbleSizePx,
            bubbleSizePx,
            getOverlayWindowType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        );
        bubbleParams.gravity = Gravity.TOP | Gravity.START;
        bubbleParams.x = clamp(savedX, marginPx, Math.max(marginPx, screenWidth - bubbleSizePx - marginPx));
        bubbleParams.y = clamp(savedY, marginPx * 2, Math.max(marginPx * 2, screenHeight - bubbleSizePx - marginPx * 4));

        attachTouchHandler(bubbleContainer);

        try {
            windowManager.addView(dismissContainer, dismissParams);
            windowManager.addView(bubbleContainer, bubbleParams);
            isShowing = true;
        } catch (Exception e) {
            removeOverlayViews();
        }
    }

    private void updateActiveBadge() {
        if (statusDot == null) return;
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        boolean activeRide = prefs.getBoolean(KEY_HAS_ACTIVE_RIDE, false);
        statusDot.setVisibility(activeRide ? View.VISIBLE : View.GONE);
    }

    private void attachTouchHandler(View target) {
        target.setOnTouchListener(new View.OnTouchListener() {
            private int initialX;
            private int initialY;
            private float initialTouchX;
            private float initialTouchY;
            private boolean moved;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                if (bubbleParams == null || windowManager == null) return false;
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        initialX = bubbleParams.x;
                        initialY = bubbleParams.y;
                        initialTouchX = event.getRawX();
                        initialTouchY = event.getRawY();
                        moved = false;
                        return true;

                    case MotionEvent.ACTION_MOVE:
                        float dx = event.getRawX() - initialTouchX;
                        float dy = event.getRawY() - initialTouchY;
                        if (!moved && Math.hypot(dx, dy) > touchSlop) {
                            moved = true;
                            showDismissTarget(true);
                        }
                        if (!moved) return true;

                        int maxX = Math.max(marginPx, screenWidth - bubbleSizePx - marginPx);
                        int maxY = Math.max(marginPx, screenHeight - bubbleSizePx - marginPx);
                        bubbleParams.x = clamp(Math.round(initialX + dx), marginPx, maxX);
                        bubbleParams.y = clamp(Math.round(initialY + dy), marginPx, maxY);
                        try {
                            windowManager.updateViewLayout(bubbleContainer, bubbleParams);
                        } catch (Exception ignored) {
                        }
                        updateDismissHoverState();
                        return true;

                    case MotionEvent.ACTION_UP:
                    case MotionEvent.ACTION_CANCEL:
                        showDismissTarget(false);
                        if (!moved) {
                            openMainApp();
                            return true;
                        }
                        if (isNearDismissTarget()) {
                            v.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
                            removeOverlayViews();
                            stopSelfCleanly();
                            return true;
                        }
                        snapToNearestEdge();
                        return true;
                }
                return false;
            }
        });
    }

    private void showDismissTarget(boolean visible) {
        if (dismissContainer == null || dismissVisible == visible) return;
        dismissVisible = visible;
        dismissContainer.setVisibility(visible ? View.VISIBLE : View.GONE);
        if (!visible) {
            isOverDismiss = false;
        }
    }

    private boolean isNearDismissTarget() {
        if (bubbleParams == null || dismissParams == null) return false;
        float bx = bubbleParams.x + bubbleSizePx / 2f;
        float by = bubbleParams.y + bubbleSizePx / 2f;
        float dx = dismissParams.x + dismissSizePx / 2f;
        float dy = dismissParams.y + dismissSizePx / 2f;
        double dist = Math.hypot(bx - dx, by - dy);
        return dist <= bubbleSizePx * 1.15;
    }

    private void updateDismissHoverState() {
        boolean near = isNearDismissTarget();
        if (near == isOverDismiss || dismissCircle == null) return;
        isOverDismiss = near;
        if (near) {
            bubbleContainer.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
            dismissCircle.setScaleX(1.22f);
            dismissCircle.setScaleY(1.22f);
            dismissCircle.setBackground(createCircleDrawable(Color.parseColor("#DC2626"), Color.WHITE, 3));
        } else {
            dismissCircle.setScaleX(1.0f);
            dismissCircle.setScaleY(1.0f);
            dismissCircle.setBackground(createCircleDrawable(Color.parseColor("#E6111419"), Color.parseColor("#66FFFFFF"), 2));
        }
    }

    private void snapToNearestEdge() {
        if (bubbleParams == null || windowManager == null) return;
        boolean snapLeft = (bubbleParams.x + bubbleSizePx / 2) < (screenWidth / 2);
        bubbleParams.x = snapLeft ? marginPx : Math.max(marginPx, screenWidth - bubbleSizePx - marginPx);
        bubbleParams.y = clamp(bubbleParams.y, marginPx * 2, Math.max(marginPx * 2, screenHeight - bubbleSizePx - marginPx * 4));
        try {
            windowManager.updateViewLayout(bubbleContainer, bubbleParams);
        } catch (Exception ignored) {
        }
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putInt(KEY_LAST_X, bubbleParams.x)
            .putInt(KEY_LAST_Y, bubbleParams.y)
            .apply();
    }

    private void openMainApp() {
        removeOverlayViews();
        Intent launch = new Intent(this, MainActivity.class);
        launch.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK |
            Intent.FLAG_ACTIVITY_SINGLE_TOP |
            Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
        );
        startActivity(launch);
        stopSelfCleanly();
    }

    private void removeOverlayViews() {
        isShowing = false;
        dismissVisible = false;
        isOverDismiss = false;
        if (windowManager != null) {
            if (bubbleContainer != null) {
                try {
                    windowManager.removeViewImmediate(bubbleContainer);
                } catch (Exception ignored) {
                }
                bubbleContainer = null;
            }
            if (dismissContainer != null) {
                try {
                    windowManager.removeViewImmediate(dismissContainer);
                } catch (Exception ignored) {
                }
                dismissContainer = null;
            }
        }
    }

    private GradientDrawable createCircleDrawable(int fillColor, int strokeColor, int strokePx) {
        GradientDrawable d = new GradientDrawable();
        d.setShape(GradientDrawable.OVAL);
        d.setColor(fillColor);
        if (strokePx > 0) {
            d.setStroke(strokePx, strokeColor);
        }
        return d;
    }

    private int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }
}
