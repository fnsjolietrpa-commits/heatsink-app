package com.fns.heatsink;

import android.Manifest;
import android.annotation.SuppressLint;
import android.graphics.Color;
import android.media.Image;
import android.util.Base64;
import android.util.Size;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.FocusMeteringResult;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.MeteringPoint;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.LifecycleOwner;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;

import java.nio.ByteBuffer;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "CameraXCam",
    permissions = {
        @Permission(strings = { Manifest.permission.CAMERA }, alias = "camera")
    }
)
public class CameraXPlugin extends Plugin {

    private FrameLayout overlay;
    private PreviewView previewView;
    private TextView detectedLabel;
    private TextView counterLabel;
    private ProcessCameraProvider cameraProvider;
    private Camera camera;
    private ImageCapture imageCapture;
    private BarcodeScanner scanner;
    private ExecutorService camExec;
    private String lastBarcode = null;
    private int shotCount = 0;
    private int frameCount = 0;
    private boolean torchOn = false;
    private boolean scanOnly = false;
    private String pendingValue = null;
    private int confirmCount = 0;
    private boolean closing = false;
    private String barcodePhoto = null;
    private int bpW = 0, bpH = 0;

    @PluginMethod
    public void open(PluginCall call) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "onCamPerm");
            return;
        }
        doOpen(call);
    }

    @PermissionCallback
    private void onCamPerm(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) {
            doOpen(call);
        } else {
            call.reject("Camera permission denied");
        }
    }

    private void doOpen(PluginCall call) {
        lastBarcode = null;
        shotCount = 0;
        frameCount = 0;
        torchOn = false;
        pendingValue = null;
        confirmCount = 0;
        closing = false;
        barcodePhoto = null;
        bpW = 0; bpH = 0;
        scanOnly = Boolean.TRUE.equals(call.getBoolean("scanOnly", false));
        camExec = Executors.newSingleThreadExecutor();
        scanner = BarcodeScanning.getClient(
            new BarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_CODE_128)
                .build()
        );
        getActivity().runOnUiThread(() -> buildOverlayAndStart(call));
        call.resolve(new JSObject().put("started", true));
    }

    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v,
            getContext().getResources().getDisplayMetrics());
    }

    @SuppressLint("ClickableViewAccessibility")
    private void buildOverlayAndStart(PluginCall keepAliveIgnored) {
        ViewGroup root = (ViewGroup) getActivity().getWindow().getDecorView();

        overlay = new FrameLayout(getContext());
        overlay.setLayoutParams(new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        overlay.setBackgroundColor(Color.BLACK);

        previewView = new PreviewView(getContext());
        previewView.setLayoutParams(new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        previewView.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
        overlay.addView(previewView);

        // detected barcode label (top)
        detectedLabel = new TextView(getContext());
        detectedLabel.setText(scanOnly ? "Scan barcode / Escanear codigo" : "Aim at barcode");
        detectedLabel.setTextColor(Color.WHITE);
        detectedLabel.setTextSize(16);
        detectedLabel.setPadding(dp(14), dp(12), dp(14), dp(12));
        detectedLabel.setBackgroundColor(Color.parseColor("#AA000000"));
        FrameLayout.LayoutParams dlp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        dlp.gravity = Gravity.TOP;
        detectedLabel.setLayoutParams(dlp);
        overlay.addView(detectedLabel);

        // close (top-left, below label)
        Button closeBtn = new Button(getContext());
        closeBtn.setText("X Close");
        closeBtn.setAllCaps(false);
        FrameLayout.LayoutParams clp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        clp.gravity = Gravity.TOP | Gravity.START;
        clp.topMargin = dp(60);
        clp.leftMargin = dp(10);
        closeBtn.setLayoutParams(clp);
        closeBtn.setOnClickListener(v -> closeCamera());
        overlay.addView(closeBtn);

        // torch (top-right, below label)
        Button torchBtn = new Button(getContext());
        torchBtn.setText("Torch");
        torchBtn.setAllCaps(false);
        FrameLayout.LayoutParams tlp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        tlp.gravity = Gravity.TOP | Gravity.END;
        tlp.topMargin = dp(60);
        tlp.rightMargin = dp(10);
        torchBtn.setLayoutParams(tlp);
        torchBtn.setOnClickListener(v -> {
            if (camera != null) {
                torchOn = !torchOn;
                camera.getCameraControl().enableTorch(torchOn);
            }
        });
        overlay.addView(torchBtn);

        if (!scanOnly) {
            // counter (above shutter)
            counterLabel = new TextView(getContext());
            counterLabel.setText("Shots: 0");
            counterLabel.setTextColor(Color.WHITE);
            counterLabel.setTextSize(15);
            counterLabel.setPadding(dp(12), dp(8), dp(12), dp(8));
            counterLabel.setBackgroundColor(Color.parseColor("#88000000"));
            FrameLayout.LayoutParams cnt = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            cnt.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
            cnt.bottomMargin = dp(120);
            counterLabel.setLayoutParams(cnt);
            overlay.addView(counterLabel);

            // shutter (bottom-center)
            Button shutter = new Button(getContext());
            shutter.setText("Capture");
            shutter.setAllCaps(false);
            shutter.setTextColor(Color.BLACK);
            shutter.setTextSize(18);
            FrameLayout.LayoutParams slp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            slp.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
            slp.bottomMargin = dp(36);
            shutter.setLayoutParams(slp);
            shutter.setOnClickListener(v -> capturePhoto());
            overlay.addView(shutter);
        }

        // tap-to-focus on preview
        previewView.setOnTouchListener((v, event) -> {
            if (event.getAction() == MotionEvent.ACTION_UP && camera != null) {
                MeteringPoint pt = previewView.getMeteringPointFactory()
                    .createPoint(event.getX(), event.getY());
                FocusMeteringAction action = new FocusMeteringAction.Builder(pt).build();
                camera.getCameraControl().startFocusAndMetering(action);
                v.performClick();
                return true;
            }
            return true;
        });

        root.addView(overlay);
        startCameraProvider();
    }

    private void startCameraProvider() {
        final ListenableFuture<ProcessCameraProvider> future =
            ProcessCameraProvider.getInstance(getContext());
        future.addListener(() -> {
            try {
                cameraProvider = future.get();
                bindUseCases();
            } catch (Exception e) {
                setLabel("Camera init error: " + e.getMessage());
            }
        }, ContextCompat.getMainExecutor(getContext()));
    }

    @SuppressLint("UnsafeOptInUsageError")
    private void bindUseCases() {
        cameraProvider.unbindAll();

        int rotation = previewView.getDisplay() != null
            ? previewView.getDisplay().getRotation() : 0;

        Preview preview = new Preview.Builder().build();
        preview.setSurfaceProvider(previewView.getSurfaceProvider());

        imageCapture = new ImageCapture.Builder()
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
            .setTargetRotation(rotation)
            .build();

        ImageAnalysis analysis = new ImageAnalysis.Builder()
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setTargetResolution(new Size(1280, 720))
            .build();
        analysis.setAnalyzer(camExec, this::analyze);

        CameraSelector selector = CameraSelector.DEFAULT_BACK_CAMERA;
        try {
            camera = cameraProvider.bindToLifecycle(
                (LifecycleOwner) getActivity(), selector, preview, imageCapture, analysis);
        } catch (Exception e) {
            setLabel("Bind error: " + e.getMessage());
        }
    }

    @SuppressLint("UnsafeOptInUsageError")
    private void analyze(@NonNull ImageProxy proxy) {
        Image media = proxy.getImage();
        if (media == null) { proxy.close(); return; }
        frameCount++;
        final int fc = frameCount;
        InputImage input = InputImage.fromMediaImage(media, proxy.getImageInfo().getRotationDegrees());
        scanner.process(input)
            .addOnSuccessListener(barcodes -> {
                if (barcodes != null && !barcodes.isEmpty()) {
                    String v = barcodes.get(0).getRawValue();
                    if (v != null) {
                        boolean changed = !v.equals(lastBarcode);
                        lastBarcode = v;
                        setLabel("OK  " + v);
                        if (changed) {
                            JSObject ev = new JSObject();
                            ev.put("value", v);
                            ev.put("format", "CODE_128");
                            notifyListeners("barcode", ev);
                        }
                        if (scanOnly && !closing) {
                            if (v.equals(pendingValue)) { confirmCount++; }
                            else { pendingValue = v; confirmCount = 1; }
                            if (confirmCount >= 2) {
                                closing = true;
                                setLabel("Captured: " + v);
                                getActivity().runOnUiThread(this::captureThenClose);
                            }
                        }
                    }
                } else if (lastBarcode == null && fc % 10 == 0) {
                    setLabel("Scanning...  (" + fc + ")");
                }
            })
            .addOnFailureListener(e -> {
                if (lastBarcode == null && fc % 10 == 0) setLabel("Scan err: " + e.getMessage());
            })
            .addOnCompleteListener(t -> proxy.close());
    }

    private void capturePhoto() {
        if (imageCapture == null) return;
        // Lock focus at center first to reduce blur, then take the shot.
        if (camera != null && previewView != null
                && previewView.getWidth() > 0 && previewView.getHeight() > 0) {
            try {
                MeteringPoint center = previewView.getMeteringPointFactory()
                    .createPoint(previewView.getWidth() / 2f, previewView.getHeight() / 2f);
                FocusMeteringAction action = new FocusMeteringAction.Builder(center).build();
                ListenableFuture<FocusMeteringResult> f =
                    camera.getCameraControl().startFocusAndMetering(action);
                f.addListener(this::doTake, ContextCompat.getMainExecutor(getContext()));
                return;
            } catch (Exception ignored) {}
        }
        doTake();
    }

    // scanOnly: grab the barcode frame as the first photo, then close.
    // A decoded barcode already implies acceptable focus, so capture immediately
    // (no focus wait -> no risk of hanging on the scan screen).
    private void captureThenClose() {
        if (imageCapture == null) { closeCamera(); return; }
        imageCapture.takePicture(camExec, new ImageCapture.OnImageCapturedCallback() {
            @Override
            public void onCaptureSuccess(@NonNull ImageProxy image) {
                try {
                    ByteBuffer buffer = image.getPlanes()[0].getBuffer();
                    byte[] bytes = new byte[buffer.remaining()];
                    buffer.get(bytes);
                    bpW = image.getWidth();
                    bpH = image.getHeight();
                    barcodePhoto = Base64.encodeToString(bytes, Base64.NO_WRAP);
                } catch (Exception ignored) {}
                image.close();
                getActivity().runOnUiThread(CameraXPlugin.this::closeCamera);
            }
            @Override
            public void onError(@NonNull ImageCaptureException e) {
                getActivity().runOnUiThread(CameraXPlugin.this::closeCamera);
            }
        });
    }

    private void doTake() {
        if (imageCapture == null) return;
        imageCapture.takePicture(camExec, new ImageCapture.OnImageCapturedCallback() {
            @Override
            public void onCaptureSuccess(@NonNull ImageProxy image) {
                try {
                    ByteBuffer buffer = image.getPlanes()[0].getBuffer();
                    byte[] bytes = new byte[buffer.remaining()];
                    buffer.get(bytes);
                    int w = image.getWidth();
                    int h = image.getHeight();
                    image.close();
                    String b64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
                    shotCount++;
                    final int n = shotCount;
                    getActivity().runOnUiThread(() -> counterLabel.setText("Shots: " + n));
                    JSObject ev = new JSObject();
                    ev.put("base64", b64);
                    ev.put("width", w);
                    ev.put("height", h);
                    ev.put("bytes", bytes.length);
                    ev.put("barcode", lastBarcode == null ? "" : lastBarcode);
                    notifyListeners("captured", ev);
                } catch (Exception e) {
                    setLabel("Capture error: " + e.getMessage());
                }
            }

            @Override
            public void onError(@NonNull ImageCaptureException e) {
                setLabel("Capture failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        closeCamera();
        call.resolve();
    }

    private void closeCamera() {
        getActivity().runOnUiThread(() -> {
            try {
                if (cameraProvider != null) cameraProvider.unbindAll();
            } catch (Exception ignored) {}
            try {
                if (overlay != null) {
                    ViewGroup root = (ViewGroup) getActivity().getWindow().getDecorView();
                    root.removeView(overlay);
                }
            } catch (Exception ignored) {}
            overlay = null;
            camera = null;
            JSObject ev = new JSObject();
            ev.put("count", shotCount);
            ev.put("barcode", lastBarcode == null ? "" : lastBarcode);
            if (barcodePhoto != null) {
                ev.put("photo", barcodePhoto);
                ev.put("width", bpW);
                ev.put("height", bpH);
            }
            notifyListeners("closed", ev);
        });
        if (camExec != null) { camExec.shutdown(); camExec = null; }
        if (scanner != null) { try { scanner.close(); } catch (Exception ignored) {} scanner = null; }
    }

    private void setLabel(String s) {
        if (detectedLabel == null) return;
        getActivity().runOnUiThread(() -> {
            if (detectedLabel != null) detectedLabel.setText(s);
        });
    }
}
