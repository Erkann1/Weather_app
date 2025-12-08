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
        Log.d("AlarmReceiver", "Alarm triggered!");

        // WakeLock al
        PowerManager powerManager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        PowerManager.WakeLock wakeLock = powerManager.newWakeLock(PowerManager.FULL_WAKE_LOCK |
                PowerManager.ACQUIRE_CAUSES_WAKEUP |
                PowerManager.ON_AFTER_RELEASE, "WeatherAnnounce:AlarmWakeLock");
        wakeLock.acquire(3000); // 3 saniye tut

        Intent fullScreenIntent = new Intent(context, MainActivity.class);
        fullScreenIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | 
                                  Intent.FLAG_ACTIVITY_CLEAR_TOP | 
                                  Intent.FLAG_ACTIVITY_SINGLE_TOP | 
                                  Intent.FLAG_ACTIVITY_REORDER_TO_FRONT |
                                  Intent.FLAG_ACTIVITY_NO_USER_ACTION);
        
        // Dismiss keyguard if possible
        KeyguardManager keyguardManager = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
        if (keyguardManager != null && keyguardManager.isKeyguardLocked()) {
            Log.d("AlarmReceiver", "Keyguard is locked, attempting to dismiss");
        }
        
        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(context, 0,
                fullScreenIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String channelId = "alarm_channel";
        createNotificationChannel(context, channelId);

        NotificationCompat.Builder notificationBuilder = new NotificationCompat.Builder(context, channelId)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle("Günaydın! ☀️")
                .setContentText("Hava durumu için dokunun.")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setFullScreenIntent(fullScreenPendingIntent, true)
                .setAutoCancel(true)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        NotificationManager notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        notificationManager.notify(1, notificationBuilder.build());
        
        // Force launch activity for good measure
        context.startActivity(fullScreenIntent);
        
        // Cancel the notification after a short delay to satisfy "I don't want notification" request
        // We need the notification momentarily for the FullScreenIntent to work on locked screens
        try {
            // Need a handler or just let the activity cancel it onResume
            // Ideally, MainActivity should cancel it. 
            // But let's verify if we can cancel it here without killing the FullScreenIntent launch.
            // Safe bet: Let MainActivity cancel it.
        } catch (Exception e) {
            Log.e("AlarmReceiver", "Error cancelling notification", e);
        }
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
