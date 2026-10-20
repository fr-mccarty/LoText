// The app's one screen: Capacitor's web view, with LoTextNative registered on its bridge.

package com.lolekproductions.lotext;

import android.content.res.Configuration;
import android.os.Bundle;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LoTextNativePlugin.class);
        super.onCreate(savedInstanceState);
    }

    // The manifest keeps the activity alive through a light/dark switch (uiMode), so the bars'
    // icons must be recoloured here. Capacitor's SystemBars tries, but after its first pass it
    // remembers the theme it resolved rather than "follow the theme", and reapplies the old one:
    // dark icons on the dark page. This runs after it.
    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        boolean light = (newConfig.uiMode & Configuration.UI_MODE_NIGHT_MASK) != Configuration.UI_MODE_NIGHT_YES;
        Window window = getWindow();
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(window, window.getDecorView());
        bars.setAppearanceLightStatusBars(light);
        bars.setAppearanceLightNavigationBars(light);
    }
}
