package com.example.weatherannounce;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import android.util.Log;
import android.os.PowerManager;
import android.app.KeyguardManager;
import android.view.WindowManager;

public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Log.d("AlarmReceiver", "========== ALARM TRIGGERED ==========");

        PowerManager powerManager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        
        // Acquire FULL_WAKE_LOCK with screen bright - hold for 60 seconds to ensure screen stays on
        PowerManager.WakeLock wakeLock = powerManager.newWakeLock(
                PowerManager.FULL_WAKE_LOCK | 
                PowerManager.ACQUIRE_CAUSES_WAKEUP | 
                PowerManager.ON_AFTER_RELEASE | 
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK,
                "WeatherAnnounce:AlarmWakeLock"
        );
        wakeLock.acquire(60000); // Hold for 60 seconds
        Log.d("AlarmReceiver", "WakeLock acquired for 60 seconds");

        // Additional: Try to wake screen directly if supported
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT_WATCH) {
                if (!powerManager.isInteractive()) {
                    Log.d("AlarmReceiver", "Screen is OFF, attempting to turn ON");
                    // WakeLock with ACQUIRE_CAUSES_WAKEUP should handle this
                } else {
                    Log.d("AlarmReceiver", "Screen is already ON");
                }
            }
        } catch (Exception e) {
            Log.e("AlarmReceiver", "Error checking screen state", e);
        }

        // Create full screen intent
        Intent fullScreenIntent = new Intent(context, MainActivity.class);
        fullScreenIntent.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK | 
                Intent.FLAG_ACTIVITY_CLEAR_TOP | 
                Intent.FLAG_ACTIVITY_SINGLE_TOP | 
                Intent.FLAG_ACTIVITY_REORDER_TO_FRONT |
                Intent.FLAG_ACTIVITY_NO_USER_ACTION |
                Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS
        );
        fullScreenIntent.putExtra("FROM_ALARM", true);
        Log.d("AlarmReceiver", "Launching MainActivity");
        
        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
                context, 
                0,
                fullScreenIntent, 
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String channelId = "alarm_channel";
        createNotificationChannel(context, channelId);

        NotificationCompat.Builder notificationBuilder = new NotificationCompat.Builder(context, channelId)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle("Gelen Arama")
                .setContentText("Hava Durumu Anonsu")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL) // Critical for bypassing DND
                .setFullScreenIntent(fullScreenPendingIntent, true)
                .setAutoCancel(true)
                .setOngoing(false)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        NotificationManager notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        notificationManager.notify(1, notificationBuilder.build());
        Log.d("AlarmReceiver", "Notification posted with full screen intent");
        
        // Force start activity directly (this should work even when screen is off)
        try {
            context.startActivity(fullScreenIntent);
            Log.d("AlarmReceiver", "Activity launch initiated");
        } catch (Exception e) {
            Log.e("AlarmReceiver", "Failed to launch activity", e);
        }
        
        Log.d("AlarmReceiver", "========== ALARM PROCESSING COMPLETE ==========");
    }

    private void createNotificationChannel(Context context, String channelId) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            CharSequence name = "Alarm Channel";
            String description = "Channel for Alarm Notifications";
            int importance = NotificationManager.IMPORTANCE_HIGH;
            NotificationChannel channel = new NotificationChannel(channelId, name, importance);
            channel.setDescription(description);
            
            NotificationManager notificationManager = context.getSystemService(NotificationManager.class);
            notificationManager.createNotificationChannel(channel);
        }
    }
}
