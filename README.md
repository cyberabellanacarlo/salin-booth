# SALIN Souvenir Booth

A browser photo booth for **SALIN Eco Souvenir Bar** (Tagum). Guests take a selfie on one tablet, write a short message, and pin it to a souvenir wall. No App Store install is needed. It works in iPad Safari and Android Chrome.

This folder is a static site. The live booth is at **https://cyberabellanacarlo.github.io/salin-booth/** (https is required for the camera). The source is [cyberabellanacarlo/salin-booth](https://github.com/cyberabellanacarlo/salin-booth).

## Open it on the tablet

1. On the event iPad, open **https://cyberabellanacarlo.github.io/salin-booth/** in Safari. Then add it to the Home Screen from the Share menu, and open it from that icon.
2. To try it on your computer, serve this folder (do not open `index.html` as a file, or the camera may not start):

       python3 -m http.server 8000

   Then visit `http://localhost:8000`.

## How guests use it

1. **Booth** — front camera, with a mirrored preview like a selfie. Tap **Take a photo** for a 3-2-1 countdown and a soft shutter sound. The saved photo is un-mirrored (the usual camera behavior). **Switch camera** flips to the back camera. **See the board** opens the wall.
2. **Message** — type up to 80 characters, then **Pin it!** (or **Retake**). On an iPad the on-screen keyboard covers about the bottom 40%; the photo, message box, and **Pin it!** stay in the remaining visible area.
3. The photo is placed in the SALIN instant-photo frame (olive, cream, gold, flower corners, SA·LIN logo) with the message under the picture.
4. The **Souvenir Wall** opens on the same screen. The new polaroid drops in with a slight tilt and a gold pin. After about 6 seconds, or when someone taps **Next guest**, the booth returns for the next person.

There is no Share or Download button for guests. Photos stay on this tablet (and, if you turn it on, in your Drive).

## Host admin

Press and hold the **SA·LIN logo** for about one second, then enter the PIN. The first PIN is **1234**. You can change it in admin; it is stored only on this tablet.

The header shows a live count: **✓ N photos saved**, and if cloud backup is on, **· M backed up ☁**.

- **Export all (backup so far)** — download a ZIP of every framed photo already taken, any time during the event.
- **Save to Photos** — on an iPad, opens the share sheet so you can save framed photos to the Photos app (in batches of 20 if there are many). If the share sheet is not available, use Export all instead.
- **Pick photos** — choose a subset, then export or save those only.
- **Switch camera** — host only, in this menu. Guests cannot flip the camera.
- **Start new event** — walk through export, PIN, type CLEAR, then set the new event name and date. This wipes photos on this tablet only (not the app cache, and not Google Drive).
- **Setup tips** — iPad Guided Access, Android app pinning, Add to Home Screen, and export reminders. See also [SETUP.md](SETUP.md).
- **Cloud backup** — optional silent copy to your Google Drive. See [drive-backup/SALIN-Drive-Setup.md](drive-backup/SALIN-Drive-Setup.md). The Web App URL and secret are stored only on this tablet, never in the project files.
- Nothing in this menu is shown to guests.

## Project layout

- `index.html`, `styles.css`, `js/` — the booth and wall
- `js/storage.js` — IndexedDB photos, settings, and the backup queue (can be swapped later)
- `js/frame.js` — draws Kirby's 1080×1350 souvenir frame onto a canvas
- `assets/` — logo, flower corners, bundled fonts (Kalam Bold, Cormorant Garamond)
- `samples/` — clearly fake placeholder pictures, used only for demos and tests
- `drive-backup/` — Apps Script (`Code.gs`) and the setup guide for Drive backup
- `refs/` — Kirby's original frame and tablet-board HTML

## Design

Colors: olive `#2F3A26`, cream `#F1ECE2`, card `#FBF9F4`, gold `#B08D57`, board `#EFE8DA`. Messages use Kalam Bold; labels use Cormorant Garamond. The wall follows Kirby's tablet board (cream grid, gold pins, tilted mini frames, new rows scroll down). Each pin is randomly tilted between −3° and 3°.

Made for a 13-inch iPad in landscape first (4:3 wall, four snap columns, extra rows scroll). It also fits 1024×768 and 1280×800 landscape, 800×1280 portrait, and phones. Layout uses the visual viewport so Safari’s toolbar and the Home Screen standalone app both work, and so the message step stays above the keyboard. Safe-area insets are respected.

On the wall, snaps fill the screen (no letterboxed side bands). Two rows fit in the visible 4:3 area; more rows scroll down. Compliment text is at least 28px, messages under snaps are at least 18px, and the main buttons (**Take a photo**, **Pin it!**, **Next guest**) are at least 64px tall.


## Keeping photos safe

On first open, the booth asks the browser to keep its storage (`navigator.storage.persist()`). Host admin shows **Photos protected ✓** when that worked, or **Add to Home Screen for best protection** if you should install the Home Screen icon. A confirm prompt appears if you try to close the tab while photos are still on the tablet. The service worker is versioned and updates the app files without wiping IndexedDB photos.

The event name and date are shared with Cloud backup (one place). The date is printed on each souvenir, directly under **SOUVENIR ALBUM**. ZIP downloads are named `SALIN-<event-slug>-YYYY-MM-DD.zip`.

Live compliments on the camera (not saved into the photo) use on-device face detection bundled in `assets/mediapipe/` — no CDN.
