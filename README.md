# Hoyahh

**For the new desktop browser, double-click `start-browser.bat`.** It opens your own Chromium browser with tabs, full clickable websites, and a customizable MYNT-inspired new-tab page. Open Docker Desktop first. The first run downloads and checksum-verifies the official Electron runtime; Node.js and Tor Browser are not required.

Read [browser/README.md](browser/README.md) for upgrade steps, appearance controls, extension loading, and the desktop privacy boundaries. This is an early personal browser, not an audited anonymity browser. Built-in customization includes colors, wallpaper, clock, layout, shortcuts, notes, and CSS. The original MYNT extension is not bundled; a compatible unpacked extension can optionally supply the new-tab page.

**Two launch modes:** `start-browser.bat` opens full websites in Hoyahh desktop tabs. `start.bat` opens the search app in your existing browser with a Tor-backed text reader. The sections below describe the search/text-reader mode unless they explicitly mention the desktop browser. The desktop browser executes website JavaScript and has different storage and fingerprinting risks.

## Search and text-reader edition

Local search and an in-app text reader with Tor-routed requests, mandatory route checks, and no saved queries or page history. This reduces IP exposure to search providers. It cannot make you untraceable.

## Windows: upgrade and start

1. Stop the old version with its `stop.bat` or run `docker compose down` in its folder. Do not use `--volumes`; preserve Tor guard state.
2. Extract this ZIP into your existing Hoyahh folder and replace matching files. Keep all files together. The ZIP contains no `.env`, so your existing secret is preserved.
3. Open Docker Desktop, using Linux containers, and wait for it to be ready.
4. Double-click `start.bat`. It creates a local secret if needed, builds the app and Tor container, and starts four services: `app`, `gateway`, `searxng`, and `tor`. First setup downloads software and can take several minutes. Tor configuration is validated during its image build.
5. The launcher checks the app and SearXNG for direct TCP internet access and external DNS resolution. If either check fails, it stops Hoyahh. These are smoke checks, not a complete leak audit.
6. Open `http://127.0.0.1:8787` if the browser does not open automatically. Click **Check Tor connection**. Tor can take a few minutes to connect.
7. Search only after the check succeeds. Every search performs a fresh check too.
8. Click a result title to open it inside Hoyahh. Links within the reading view also load through Tor. Use **Back a page** or **Return to results** to navigate. You do not need Tor Browser for this reading view.
9. Run `stop.bat` when finished. Closing the browser does not stop Docker.

The launch script rebuilds the gateway when you update source files. You do not need Python installed on Windows because Docker runs it. The start script stops the previous Compose stack before building to avoid leaving an older direct-connect version running during an upgrade.

## Linux or macOS

With Docker and Compose installed and running:

```sh
sh start.sh
```

Then use `http://127.0.0.1:8787`, check Tor, and click a result title to read it inside Hoyahh. Stop with:

```sh
docker compose down
```

## How the routing works

The browser sends a POST request through a fixed-destination local TCP relay to the Python app. After a Tor check succeeds, the app asks SearXNG for results. SearXNG uses `socks5h://tor:9050`, including remote destination-name resolution. The Tor client connects to the Tor network; providers see Tor exit connections.

Both the app and SearXNG attach only to an internal Docker network. The Tor container has its own internet-connected network. A separate browser relay (`gateway`) joins the internal network and a normal bridge so Docker Desktop can publish its port. Its only forwarding destination is `app:8787`; it has no user-selectable target or search-provider client. The app and SearXNG specify a local DNS upstream that cannot answer public names; Docker still resolves their internal service names. There is no direct-search fallback setting in the interface.

In search/text-reader mode, Tor's SOCKS and status ports are not published on your computer. Only the relay's `127.0.0.1:8787` is published. Desktop mode additionally publishes Tor SOCKS at `127.0.0.1:9060` using `compose.browser.yaml`; status remains internal. The app and SearXNG themselves have no published ports. This remains a local app, not an authenticated public service. Do not expose it with port forwarding or a public tunnel.

The built-in route check fetches the fixed HTTPS endpoint `https://check.torproject.org/api/ip` through Tor using curl's SOCKS hostname option. It requires a successful response with `IsTor: true` and a valid public exit IP. No search terms go to this checker. An unavailable checker blocks searches even if Tor itself might work.

The displayed IP belongs to this probe connection. Search providers and pages loaded in the reader may use different Tor exits. The timestamp is the last successful check, not a guarantee of continuous connectivity or anonymity. The internal-network restriction is intended to block direct egress if Tor fails after the check. Verify this on your Docker installation.

## What is protected, and what is not

| Activity | Protection or limit |
| --- | --- |
| Search-provider connections | Configured to use Tor exits instead of your public IP. Providers still receive your search terms. |
| Search destination DNS | Configured for resolution through the Tor SOCKS proxy. |
| Tor failure or failed verification | New searches are blocked; no automatic direct fallback. |
| Result visits inside Hoyahh | HTTPS page requests and destination DNS use the Tor proxy. Only extracted text and link targets return to the interface. |
| Addresses opened outside Hoyahh | Regular browser visits are not routed by Hoyahh. |
| Other apps on your computer | Their traffic is not routed through this Tor container. |
| Local search history | No query database, app cookies, localStorage, or sessionStorage. |
| Logs | Gateway request logs and Docker log capture are disabled. |
| Clipboard | Copying a result places its URL in your system clipboard. Clipboard history or cloud sync may retain it. Clear session does not clear the clipboard. |
| Tor state | A Docker volume retains guard/network state, not query history. It is deliberately kept across restarts. |
| ISP/network observer | Can generally see that you use Tor. Bridges are not included or configured. |
| Personal logins and identifying queries | Can identify you even when your IP is hidden. |
| Browser extensions, malware, device monitoring | Can observe data before Tor protects the network connection. |
| Container/image installation | Docker/package downloads happen outside Tor and reveal your connection to registries or mirrors. |

Tor does not provide perfect anonymity. The reading view does not turn Chrome into Tor Browser or protect other tabs. Device monitoring and browser extensions can still see locally displayed content. A copied URL opened outside Hoyahh uses that application's connection. These broader limitations are described in the Tor Project's best-practices guide below.

Hoyahh's Clear session button and Escape shortcut clear the visible query, results, reading view, and in-memory reader navigation trail. They do not securely erase memory, swap, downloads, browser history on destination sites, or third-party records. Cancelling the browser request cannot retract a query already sent.

## Reading websites inside Hoyahh

Click any result title. The app checks Tor, fetches the page through the Tor service, and displays extracted text and links. Link targets stay in memory and are submitted in POST bodies, not the browser URL. The browser never receives the original remote page HTML or its resource tags.

This is a text reader, not a full browser. It does not run page JavaScript, load images/fonts/media, replay cookies, submit forms, or support sign-in. Page layout is simplified. Some text or links may be omitted. A site may reject automated readers or Tor traffic. There is no direct fallback.

Only public HTTPS hostnames on port 443 are accepted. Ordinary HTTP links are upgraded to HTTPS, and fail if HTTPS is unavailable. Local/private addresses, IP-literal targets, credentials, special ports, and onion-service URLs are not supported in this reader. Redirects are checked individually and capped. Tor is also configured to reject internal-address destinations.

Each request downloads at most 2 MiB, with a total redirect/fetch budget of about 50 seconds plus the route check. Output is limited to 120,000 characters and 500 text blocks. Pages requiring compressed responses may be rejected. Files such as PDFs and videos are not supported. Nothing is fetched automatically from links or page assets; another page is requested only when you click its link.

No cookie jar or browser session is forwarded. In-memory source content is discarded after extraction, and the app does not save page history to disk. The local reader navigation trail and displayed page remain in memory until you return to results or clear the session. Clearing does not securely erase RAM, swap, or records outside Hoyahh.

The Tor service's fetch command explicitly uses curl's SOCKS hostname proxy and validates TLS certificates. The verifier remains a separate fixed-destination check. Implementation reference: https://curl.se/docs/manpage.html

## When only one provider returns results

The current configuration explicitly enables DuckDuckGo, Google, Bing, Brave, and Wikipedia, with a 25-second timeout for each. Wikipedia is configured to return ordinary result-list entries because Hoyahh does not render SearXNG information boxes. Other default category engines are preserved.

This requests more sources; it does not guarantee that any provider accepts Tor traffic or returns results. No proxy or isolation setting is relaxed.

After a search, open **Provider status**. It lists sources represented on the returned page and the safe error categories reported by SearXNG, such as timeout, CAPTCHA, access denied, or rate limiting. Raw exception text is not exposed because it can contain query text or URLs. A missing provider is not automatically classified as blocked: it may return no results or be excluded by the selected category, filters, or query syntax.

To check broad coverage, choose **Web** and **Any time**, then search for a plain topic such as `Python programming language` without engine-selection prefixes. If only DuckDuckGo returns results, share the Provider status messages rather than your private query.

Bing is disabled and Wikipedia defaults to infobox output in the upstream settings examined for this revision: https://github.com/searxng/searxng/blob/master/searx/settings.yml
Google's engine documents CAPTCHA responses: https://docs.searxng.org/dev/engines/online/google.html

## Features

- Web, News, and Science search through SearXNG.
- Date and Safe Search filters, subject to provider support.
- In-memory results and pagination.
- No external fonts, images, favicons, or autocomplete requests.
- Clickable result titles open a Tor-routed reading view inside Hoyahh.
- Links within read pages also open in Hoyahh, with Back and Return to results controls.
- Several common tracking parameters stripped from result URLs.
- Tor connection check with last-check time and probe exit IP.
- No public search instance or direct-provider fallback.

Tor can make searches slower and trigger more provider blocks or CAPTCHAs. Some filters/providers may return few or no results. Hoyahh is a SearXNG metasearch interface, not an independent web index.

## Troubleshooting

**Docker is not running:** Start Docker Desktop and rerun the launcher. Official Windows installation instructions: https://docs.docker.com/desktop/setup/install/windows-install/

**Isolation check failed:** The launcher stops the stack. Read its message. A direct connection or public DNS response means the intended isolation did not hold; do not remove the checks or add a normal internet network to SearXNG. If an interpreter or startup error prevented testing, that also counts as unverified. Update Docker Desktop, inspect the startup error, and retry. A custom Compose override can defeat the included network configuration.

**Tor could not be verified:** Wait a few minutes and click the check button again. Your network may block Tor, or the Tor check service may be unavailable. The app deliberately blocks searching in either case. To restart the Tor client:

```sh
docker compose restart tor
```

**Tor works but search fails:** An upstream engine may block Tor exits or SearXNG may still be starting. Try another category, fewer words, or no date filter. Do not disable the proxy to fix this.

**A search is slow:** Each search includes a Tor check and can take up to about 90 seconds. The UI keeps searches out of the address bar and does not save them.

**Service exited:** Check `docker compose ps -a`. All four services should run. The `gateway` row should show `127.0.0.1:8787->8787/tcp`. Logs are disabled. Run `diagnose.bat` for container status, Tor configuration validation, SearXNG settings validation, and a host connection check. To diagnose startup without submitting searches, temporarily remove the four `logging` blocks and run `docker compose up --build`. Restore them and recreate the stack before private searches. Never share query-bearing logs.

**A page does not open:** The reader accepts public HTTPS HTML and plain-text pages only. Sites requiring JavaScript, login, CAPTCHA, or unsupported file formats can fail. There is no direct-connection fallback. You can return to results and choose another source.

**Copy failed:** The result address is selected so you can copy it manually. Copying is optional; click the title to read within Hoyahh. Opening a copied address in a regular browser tab is outside Hoyahh's Tor routing.

## Verify on your computer

The launcher runs `network_check.py` inside both app and SearXNG. It probes direct connections to two public IP addresses on port 443, checks that public DNS cannot resolve, and confirms the internal Tor service name resolves. Passing only shows those probes were blocked on that run, not that every possible leak has been excluded.

For a non-sensitive outage check:

1. Confirm Tor, then search for an ordinary public topic.
2. Run `docker compose stop tor`.
3. Submit a new search. It must say **Search blocked** and show no fresh results.
4. Run `docker compose start tor`, wait for bootstrap, and check the connection again.

Do not deliberately remove Docker isolation on a machine where you use private queries.

## Files and customization

| File | Purpose |
| --- | --- |
| `dist/index.html`, `dist/style.css`, `dist/app.js` | Search, clickable results, reading view, and route status |
| `server.py` | Gateway, mandatory Tor verification, input checks, privacy headers |
| `compose.yaml` | Isolated search network, Tor egress, and browser relay network |
| `gateway.py` | Fixed-destination TCP relay from Windows to the internal app |
| `diagnose.bat` | Startup/configuration diagnostics without search queries |
| `network_check.py` | Startup isolation smoke checks |
| `searxng/settings.yml` | SearXNG Tor proxy and search settings |
| `tor/Dockerfile`, `tor/torrc`, `tor/service.py` | Tor client, verifier, and internal reader endpoint |
| `tor/reader.py`, `tor/fetcher.py` | URL validation, Tor page fetching, and text extraction |
| `start.bat`, `stop.bat`, `start.sh` | Launch/stop scripts |
| `tests/` | Local mocked gateway/probe tests |

Change colors in the variables at the top of `dist/style.css`. Change visible branding in `dist/index.html`. Rebuild after changes. Leave network/proxy settings intact unless you understand and test the impact.

The launcher generates `.env` with a random secret. Do not commit it to GitHub. `.gitignore` excludes it. Tor guard state lives in the `tor_state` Docker volume; ordinary `docker compose down` preserves it. Tor guard stability is intentional and should not be reset repeatedly to chase new IP addresses.

## Update software

The package uses mutable SearXNG `latest`, Python `3.12-alpine`, and Alpine `3.23` image tags. Tor, curl, and Python in the Tor container come from Alpine's repositories. This is not a fully pinned, reproducible build.

To refresh software deliberately:

```sh
docker compose down
docker compose pull searxng
docker compose build --pull --no-cache
```

Then rerun `start.bat` or `sh start.sh` so isolation checks run. Review upstream configuration changes. Pin tested image digests for reproducibility if needed.

## Startup corrections in this revision

- Replaced Tor's rejected `SocksPolicy accept private` with explicit loopback/private IPv4 ranges.
- Changed SearXNG `extra_proxy_timeout` from the invalid float `10.0` to integer `10`.
- Used explicit `http` and `https` proxy keys for the current SearXNG networking configuration.
- Moved the Windows port mapping to a separate TCP relay. The app and SearXNG remain isolated from direct internet egress.
- Changed the Windows health probe to IPv4 with proxy bypass and added useful failure output.
- Tor's wrapper now reports failure if its Tor child exits unexpectedly, rather than misleadingly exiting with status zero.
- Added a Tor configuration check at build time and `diagnose.bat` for future startup failures.

The first two corrections match the exact startup errors reported on the user's Docker installation. The relay change addresses the observed missing Windows port mapping. The complete revised stack still needs to be run on that installation.

## Verification completed here

- 35 automated tests passed: 27 Python tests using mock upstream services/subprocess results, plus 8 Node tests covering desktop URL/proxy policy, session separation, sandbox preferences, failed Tor checks, and privileged IPC rejection.
- Tests cover rejected/failed Tor checks blocking query forwarding, unsafe URLs, request validation, cross-site rejection, response headers, suppressed logs, and absence of a direct retry in the Tor probe, real HTTP forwarding through the browser relay with privacy checks preserved, sanitization of provider errors, Tor-only page retrieval, redirect validation, unsafe-target rejection, and inert text extraction.
- Python compilation, JavaScript syntax, and static Compose/proxy invariants passed.

Docker is unavailable in the build environment. The previous search-only build was exercised on the user's computer. This desktop/reader revision's container builds/startup, live page fetching through Tor, actual IP/DNS leak behavior, Windows launcher execution, and browser visual behavior have not been verified here. This package has not received an independent security audit. Run the included startup checks and Tor connection check on your computer before relying on it.

To run local mock tests with Python 3.10 or later:

```sh
python -m unittest discover -s tests -v
```

## Sources and licenses

- SearXNG proxy configuration: https://docs.searxng.org/admin/settings/settings_outgoing.html
- Docker internal networks: https://docs.docker.com/reference/compose-file/networks/
- Tor Browser best practices: https://support.torproject.org/tor-browser/security/using-tb-safely/
- Tor guard relays: https://support.torproject.org/tor-browser/security/guard-relay/
- Tor Browser download: https://www.torproject.org/download/
- SearXNG: https://github.com/searxng/searxng

Hoyahh source files are MIT licensed. SearXNG, Tor, curl, Python, Alpine, and Docker components are downloaded separately and retain their own licenses. Hoyahh's MIT license does not relicense them.
