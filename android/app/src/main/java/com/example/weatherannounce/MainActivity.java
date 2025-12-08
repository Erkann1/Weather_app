package com.example.weatherannounce;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AlarmPlugin.class);
        super.onCreate(savedInstanceState);

        // Ekranı uyandırma ve kilit ekranında gösterme ayarları
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD |
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
    }

    @Override
    public void onResume() {
        super.onResume();
        // Cancel the alarm notification (ID 1) so it doesn't linger
        android.app.NotificationManager notificationManager = (android.app.NotificationManager) getSystemService(android.content.Context.NOTIFICATION_SERVICE);
        notificationManager.cancel(1);
    }
}
