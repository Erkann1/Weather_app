package com.example.weatherannounce;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import android.Manifest;
import android.content.pm.PackageManager;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AlarmPlugin.class);
        super.onCreate(savedInstanceState);

        // Ekranı uyandırma ve kilit ekranında gösterme ayarları (Legacy & Modern)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            
            android.app.KeyguardManager keyguardManager = (android.app.KeyguardManager) getSystemService(android.content.Context.KEYGUARD_SERVICE);
            if (keyguardManager != null) {
                keyguardManager.requestDismissKeyguard(this, null);
            }
        } else {
            // Deprecated flags for older Android versions
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD |
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        // Cancel the alarm notification (ID 1) so it doesn't linger
        android.app.NotificationManager notificationManager = (android.app.NotificationManager) getSystemService(android.content.Context.NOTIFICATION_SERVICE);
        notificationManager.cancel(1);
    }

    @CapacitorPlugin(
        name = "AlarmPlugin",
        permissions = {
            @Permission(
                alias = "notifications",
                strings = { Manifest.permission.POST_NOTIFICATIONS }
            ),
            @Permission(
                alias = "schedule_exact_alarm",
                strings = { Manifest.permission.SCHEDULE_EXACT_ALARM }
            )
        }
    )
    public static class AlarmPlugin extends Plugin {

        @PluginMethod
        public void setAlarm(PluginCall call) {
            Double timestamp = call.getDouble("timestamp");
            if (timestamp == null) {
                call.reject("Timestamp is required");
                return;
            }

            long triggerTime = timestamp.longValue();
            
            Context context = getContext();
            AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            
            // Android 12+ (API 31+) requires SCHEDULE_EXACT_ALARM permission
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                if (!alarmManager.canScheduleExactAlarms()) {
                    Log.e("AlarmPlugin", "SCHEDULE_EXACT_ALARM permission not granted!");
                    // Open settings to let user grant permission
                    try {
                        Intent intent = new Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
                        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        context.startActivity(intent);
                    } catch (Exception e) {
                        Log.e("AlarmPlugin", "Failed to open settings", e);
                    }
                    call.reject("SCHEDULE_EXACT_ALARM izni gerekli. Lütfen ayarlardan 'Alarmlar ve hatırlatıcılar' iznini verin.");
                    return;
                }
            }
            
            Intent intent = new Intent(context, AlarmReceiver.class);
            PendingIntent pendingIntent = PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            // Use setAlarmClock for most reliable alarm - wakes device and effectively bypasses doze
            Intent showIntent = new Intent(context, MainActivity.class);
            showIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent showPendingIntent = PendingIntent.getActivity(context, 0, showIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
                AlarmManager.AlarmClockInfo alarmClockInfo = new AlarmManager.AlarmClockInfo(triggerTime, showPendingIntent);
                alarmManager.setAlarmClock(alarmClockInfo, pendingIntent);
                Log.d("AlarmPlugin", "✓ AlarmClock set for: " + new java.util.Date(triggerTime));
            } else {
                alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerTime, pendingIntent);
                Log.d("AlarmPlugin", "✓ Exact alarm set for: " + new java.util.Date(triggerTime));
            }

            call.resolve();
        }

        @PluginMethod
        public void cancelAlarm(PluginCall call) {
            Context context = getContext();
            AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            Intent intent = new Intent(context, AlarmReceiver.class);
            PendingIntent pendingIntent = PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            alarmManager.cancel(pendingIntent);
            Log.d("AlarmPlugin", "Alarm cancelled");
            call.resolve();
        }

        @PluginMethod
        public void requestPermissions(PluginCall call) {
            Log.d("AlarmPlugin", "requestPermissions called");
            
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                // Android 13+ needs POST_NOTIFICATIONS
                if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) 
                        != PackageManager.PERMISSION_GRANTED) {
                    Log.d("AlarmPlugin", "Requesting POST_NOTIFICATIONS");
                    // Use plugin's requestPermissions which handles the alias
                    requestPermissionForAlias("notifications", call, "permissionsCallback");
                } else {
                    Log.d("AlarmPlugin", "POST_NOTIFICATIONS already granted");
                    com.getcapacitor.JSObject result = new com.getcapacitor.JSObject();
                    result.put("notifications", "granted");
                    result.put("schedule_exact_alarm", "granted");
                    call.resolve(result);
                }
            } else {
                com.getcapacitor.JSObject result = new com.getcapacitor.JSObject();
                result.put("notifications", "granted");
                result.put("schedule_exact_alarm", "granted");
                call.resolve(result);
            }
        }

        @PermissionCallback
        private void permissionsCallback(PluginCall call) {
            com.getcapacitor.JSObject result = new com.getcapacitor.JSObject();
            if (getPermissionState("notifications") == PermissionState.GRANTED) {
                result.put("notifications", "granted");
            } else {
                result.put("notifications", "denied");
            }
            result.put("schedule_exact_alarm", "granted");
            call.resolve(result);
        }

        @PluginMethod
        public void checkPermissions(PluginCall call) {
            com.getcapacitor.JSObject result = new com.getcapacitor.JSObject();
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                PermissionState state = getPermissionState("notifications");
                result.put("notifications", state != null ? state.toString().toLowerCase() : "prompt");
            } else {
                result.put("notifications", "granted");
            }
            result.put("schedule_exact_alarm", "granted");
            call.resolve(result);
        }
    }
}
