# Heatsink Loading — Android app (Capacitor)

Native camera + Google ML Kit barcode scanning. Reuses the web UI (box list, dedup, PDF).

## Build the APK (GitHub Actions — no local tools)
1. Create a new GitHub repo and push this folder to it (branch `main`).
2. Open the repo's **Actions** tab → the **Build APK** workflow runs automatically.
3. When it finishes (green ✓), open the run → **Artifacts** → download **heatsink-debug-apk**.
4. Unzip → `app-debug.apk`. Copy to the Android phone and install (allow "install unknown apps").

## Dev
- Web assets: `www/` (index.html, app.js, jspdf.umd.min.js)
- `npx cap sync android` copies web assets into the native project.
