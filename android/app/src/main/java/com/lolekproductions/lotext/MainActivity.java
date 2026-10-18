// The app's one screen: Capacitor's web view, with LoTextNative registered on its bridge.

package com.lolekproductions.lotext;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LoTextNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
