# Anlock ⚡

> **Zero-Knowledge Biometric PC Unlock & Remote Control**  
> Unlock Windows 10/11 login screens and UAC prompts using your phone's native fingerprint/face biometric scanner—powered by **100% Free Cloud Relay (Supabase Realtime)** and **Local E2EE (Wi-Fi/Bluetooth)**.

---

## ✨ Highlights

- **True Liquid Glass UI/UX**: Built with an optical physics design system—specular highlights, fluid refraction, dynamic caustics, and an **Electric Cyan** aesthetic (no generic glassmorphism or bloated cards).
- **Dual Client Support (PWA + APK)**: 
  - Open instantly on any mobile browser (Chrome/Brave) via PWA without installing anything.
  - Native biometric scan via **WebAuthn (`navigator.credentials.get`)**.
  - Can be built into a standalone Android `.apk` via Capacitor.
- **100% Free Cloud Mode ($0 Server Cost)**:
  - Powered by **Supabase Realtime WebSockets** (generous free tier, zero hosting fees).
  - Works across any distance (e.g. laptop in Bengaluru, phone on 5G in Delhi).
  - No port forwarding or VPN needed—both devices connect outbound.
- **End-to-End Encrypted (AES-256-GCM)**:
  - **Zero-Knowledge Architecture**: The PC generates a 64-character random password key during pairing, encrypts the local password, and stores only ciphertext on the PC.
  - The phone holds the key; the PC holds the locked password.
  - The secret key travels in the URL fragment (`#hash`) which is never sent to any server.
- **Remote PC Lock**:
  - In addition to unlocking, tap **"Lock PC Remotely"** from your phone to immediately trigger `LockWorkStation()` on your Windows computer.

---

## 🏛️ System Architecture

```
                          ┌─────────────────────────────────────┐
                          │         Android Smartphone          │
                          │      (Anlock PWA / Android APK)     │
                          │   • WebAuthn Biometric Prompt       │
                          │   • Hardware Keystore Storage       │
                          │   • True Liquid Glass Interface     │
                          └──────────────────┬──────────────────┘
                                             │
               ┌─────────────────────────────┴─────────────────────────────┐
               ▼                                                           ▼
    [Local Wi-Fi / Bluetooth]                                   [Supabase Realtime Relay]
  (UDP Broadcast / Direct TCP)                                (100% Free WebSockets E2EE)
               │                                                           │
               └─────────────────────────────┬─────────────────────────────┘
                                             ▼
                          ┌─────────────────────────────────────┐
                          │            Windows PC               │
                          │   (Holds AES-Encrypted PW Store)    │
                          └──────────────────┬──────────────────┘
                                             │
                   ┌─────────────────────────┴─────────────────────────┐
                   ▼                                                   ▼
         Windows Lock Screen                                  UAC Admin Prompt
     (AnlockCredentialProvider.dll)                        (Admin Elevation Hook)
```

---

## 📂 Repository Structure

- [`anlock/web/`](file:///c:/Users/varun/OneDrive/Desktop/projects/fingerprint/anlock/web) – Progressive Web App (PWA) client with True Liquid Glass styling and Supabase Realtime integration.
  - `index.html` – Liquid Glass viewport, optical sensor button, and telemetry drawer.
  - `style.css` – Optical specular refraction, cyan caustics, and responsive layout.
  - `app.js` – WebAuthn biometric scanner, Supabase WebSocket client, and remote PC lock trigger.
  - `manifest.json` – PWA installation configuration for "Add to Home Screen".
  - `sw.js` – Service Worker for offline caching and Web Push notifications.
- [`pcbu-desktop/`](file:///c:/Users/varun/OneDrive/Desktop/projects/fingerprint/pcbu-desktop) – Reference upstream implementation.

---

## 🚀 Running the Web Client Locally

To preview the Liquid Glass interface:

```bash
cd anlock/web
python -m http.server 5173
```

Then open `http://localhost:5173/` in your browser.

---

## 🛡️ Security Guarantees

1. **Passwords Never Leave the PC**: The computer never transmits the actual password over the network.
2. **Phone Never Knows the Password**: The phone only receives and signs the random decryption key.
3. **Replay Protection**: Each unlock request requires a cryptographically random, one-time nonce challenge and timestamp verification.
4. **Zero Cloud Knowledge**: All payloads traveling through Supabase are AES-256 encrypted using the pairing key negotiated directly out-of-band via QR code.
