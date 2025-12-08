package com.example.weatherannounce;

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
public class AlarmPlugin extends Plugin {

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
        Intent intent = new Intent(context, AlarmReceiver.class);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerTime, pendingIntent);
        } else {
            alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerTime, pendingIntent);
        }

        Log.d("AlarmPlugin", "Alarm set for: " + triggerTime);
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
        // Capacitor 4 uses the built-in requestPermissionForAlias
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            // Android 13+ needs POST_NOTIFICATIONS
            requestPermissionForAlias("notifications", call, "permissionsCallback");
        } else {
            // Older Android versions don't need runtime permission for notifications
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
        
        // SCHEDULE_EXACT_ALARM is a normal permission (not runtime) on API 31+
        // It's granted by default unless revoked by user in settings
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
