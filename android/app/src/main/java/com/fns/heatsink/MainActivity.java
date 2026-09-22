package com.fns.heatsink;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CameraXPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
