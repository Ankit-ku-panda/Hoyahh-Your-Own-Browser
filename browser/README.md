# Hoyahh · personal desktop edition

A Chromium/Electron desktop browser with tabs, back/forward/reload, an address-and-search bar, and a Material You / MYNT-inspired new-tab dashboard. This is an early personal browser, not Chrome or Tor Browser. It has not undergone a security audit or live Windows leak testing.

## Run on Windows

1. Close the previous Hoyahh window, run `docker compose down` in your existing project folder, and replace the project files with this ZIP's `Hoyahh` contents. Keep your existing `.env`.
2. Open Docker Desktop with Linux containers enabled.
3. Double-click **start-browser.bat** in the project root. The first run downloads Electron 44.3.0 from the official GitHub release and verifies its SHA-256 against that release's checksum file. Allow several minutes. No Node.js or Tor Browser installation is needed. Windows x64 and ARM64 are supported by the launcher.
4. Let Tor connect, then click **Check Tor**. A successful check uses the desktop tab session's proxy, not just the search backend's status.
5. Search from the new tab or address bar. Clicking a result opens the full website in a new Hoyahh tab. Type a hostname in the address bar to visit it directly through Tor.
6. Close the desktop window, then run **stop.bat** to stop the Docker services.

If the runtime download is blocked, setup reports the error and does not launch an unchecked download. Try again after GitHub release downloads are accessible. Runtime installation and Docker downloads use the computer's normal connection.

## Customize

Click **Customize**, the toolbar menu, or **Ctrl+,**. You can change name, colors, local font family, font size, corner radius, layout, clock format, widget visibility, wallpaper, shortcuts, and custom CSS. Shortcuts accept one `Name | https://website` per line; line order controls their order. Save changes to apply. Local notes save when their field loses focus.

Import/export transfers the built-in homepage settings, including notes and wallpaper. Your customization JSON is stored in Electron's user-data directory (normally `%APPDATA%\Veil Browser`). The earlier profile folder name is retained so existing settings keep working. These saved items are separate from browsing-data clearing. Keep exported files private if they contain personal notes.

Custom CSS styles the shell and built-in homepage, not visited websites. Remote CSS, image URLs, and fonts are blocked in the shell. Choose local wallpaper files instead. Custom CSS is temporarily disabled while settings is open, so Ctrl+, can recover from a style that hides controls. Reset appearance keeps your notes and shortcuts.

The source is included: `browser/ui/browser.css`, `browser/ui/browser.js`, `browser/ui/index.html`, and `browser/main.cjs`. Edit it and rerun the launcher to copy changes into the runtime. There is no paid customization tier. Technical size bounds and security restrictions remain; this is not literally unlimited customization.

## MYNT and extensions

The default homepage is our own implementation inspired by Material You and [MYNT](https://github.com/prem-k-r/materialYouNewTab). The third-party MYNT extension is not bundled or represented as tested.

For an extension you trust, obtain and extract its source, then choose **Customize → Load unpacked extension** and select the folder containing `manifest.json`. The browser shows the requested permissions before loading. Extensions that declare a new-tab override appear in the **New-tab page** dropdown. Choose one and save, then open a new tab. The Home toolbar button always opens Hoyahh's built-in dashboard, so you can recover from a broken extension. Extension settings/popups open in a tab; there is no Chrome-style extension action toolbar.

[Electron supports only a subset of Chrome extension APIs](https://www.electronjs.org/docs/latest/api/extensions-api). CRX files and Chrome Web Store installation are unsupported. MYNT's features may fail or require adaptation; loading its folder does not certify compatibility. Its network requests use the same restricted Tor session. Extensions are third-party code that may read page contents or transmit data; Tor does not prevent that.

## Privacy boundaries

- Remote tabs use a fixed SOCKS5 proxy at `127.0.0.1:9060`, awaited before any tab loads. The proxy bypass list explicitly removes Chromium's implicit loopback bypass. There is no DIRECT fallback. The optional `compose.browser.yaml` publishes the Docker Tor SOCKS port only on loopback.
- The local search UI uses a separate session allowing only `http://127.0.0.1:8787`. The shell cannot make network requests. Neither local surface navigates to remote pages; result clicks are passed through a narrow, sender-validated IPC method that creates a remote tab.
- Chromium DNS resolution is disabled except for the loopback proxy endpoint. SOCKS5 resolves destination hostnames through Tor. QUIC is disabled and WebRTC is set to `disable_non_proxied_udp`. These are application-level controls; this Windows process is **not** enclosed by a system firewall or the Docker internal network. A Chromium vulnerability, unsupported protocol, or configuration defect is outside this protection. Live DNS/WebRTC/fail-closed checks are still required before relying on it for sensitive use.
- Node integration is disabled, Chromium sandbox and context isolation enabled, TLS certificate checking retained, and remote pages receive no privileged preload. Permissions for camera, microphone, geolocation, notifications, screen capture, and devices are denied. Arbitrary external-app protocols and local/IP-literal destinations are blocked. Public HTTP navigation is upgraded to HTTPS; insecure subresources are blocked. `.onion` hostnames can use HTTP through Tor; availability is not guaranteed.
- A failed Tor check blocks new externally requested navigations. Checks are repeated after 60 seconds when a new address/result is opened. Page-internal navigation still uses the fixed proxy. The badge describes the last check, not continuous verification or a guarantee that every connection uses the same exit.
- Website JavaScript, images, styles, cookies, and ordinary forms work in remote tabs. They create a fingerprint and can identify you through logins or page behavior. This custom browser does **not** provide Tor Browser's fingerprint uniformity and other hardening. It cannot make you untraceable.
- Website storage and cache are cleared at startup, via **Close tabs & clear browsing data**, and at clean exit. A persistent Electron session is necessary for extension loading; crashes and forced termination can leave records on disk until next startup. Clearing is not secure erasure. Extensions may write their own data. The browser does not deliberately save a visited-URL history or restore tabs.
- Downloads, password management, Chrome Sync, DRM playback, notification permissions, and automatic browser updates are not implemented. Some sites block Tor, require unsupported APIs, or fail under the restrictions. Downloads are blocked rather than opened outside Hoyahh. Existing third-party browser tabs and other apps do not use this proxy automatically.

Closing Hoyahh's web search session clears only that search view. Use the desktop **Close tabs & clear browsing data** control to clear website sessions. Logging into a personal account can identify you even when Tor conceals your IP.

## Development and verification

The package is pinned to Electron 44.3.0, listed as stable on the [Electron releases page](https://releases.electronjs.org/) when prepared. Update both `package.json`/lockfile and `setup-browser.ps1` together when adopting a newer audited release. No updater contacts a service in the background.

For development with Node.js installed: run `npm ci` and `npm start` from `browser/` after starting the Docker stack with `compose.browser.yaml`. `npm test` checks routing policy and mocked browser lifecycle boundaries. Root Python tests cover search, reader, and relay behavior. Tests use local mocks; no real Tor, Windows GUI, extension compatibility, or browser leak audit has been completed here.

Before relying on the desktop build: verify that the browser's Tor check succeeds, a known HTTPS site renders, search-result clicks stay in Hoyahh, and new visits fail when the Tor container is stopped. Check WebRTC and DNS behavior on your machine. This manual verification does not establish anonymity.
