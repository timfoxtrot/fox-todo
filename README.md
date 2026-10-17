# Fox Todo

A small web app for printing todo items to a Rongta thermal receipt printer.
Type a task, hit print, paper comes out. Anyone on the LAN can use it from
their phone.

## Running it

```bash
npm install
npm start
```

Then open the URL it prints — `http://localhost:3000` locally, or the
`http://10.10.10.2:3000` style address from a phone on the same network.

Connectivity check without the web UI:

```bash
npm run testprint
```

## Always-on setup (Windows)

```powershell
# From PowerShell opened as Administrator:
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
```

Registers a scheduled task that starts the app at boot (no login needed) and
restarts it if it crashes, and opens the port in Windows Firewall for the
Private network profile. Logs: `data\server.log`. To remove it, run the
script again with `-Uninstall`.

## Configuration

Defaults live in `config.js`; every value can be overridden by an environment
variable.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PRINTER_HOST` | `192.168.1.87` | Printer IP address |
| `PRINTER_PORT` | `9100` | Raw ESC/POS port (JetDirect) |
| `PRINTER_COLUMNS` | `48` | Characters per line — 48 for 80mm paper, 32 for 58mm |
| `PORT` | `3000` | Web server port |
| `HOST` | `0.0.0.0` | Bind address; `0.0.0.0` exposes it to the LAN |
| `HISTORY_LIMIT` | `200` | How many printed items to retain |
| `LOGO_WIDTH` | `300` | Dot width logos are resized to (80mm paper prints 576 dots across) |

With Node 20+ you can keep these in a `.env` file (see `.env.example`) and run
`node --env-file=.env server.js`.

## Categories and logos

Todos can optionally be printed under a category, whose logo and name print at
the top of the slip instead of "TO DO". Categories are defined in `config.js`:

```js
export const CATEGORIES = [
  { key: 'aidatim', label: 'Aida & Tim', logo: 'AT.png' },
  { key: 'gswc', label: 'GSWC', logo: 'gswc.png' },
  { key: 'giaa', label: 'GIAA', logo: 'giaa.png' },
  { key: 'gmha', label: 'GMHA', logo: 'gmha.png' },
];
```

To add a logo, drop a PNG at `public/logos/<file>` matching the `logo` field
above — all four are already in place (`AT.png`, `gswc.png`, `giaa.png`,
`gmha.png`). Requirements:

- **PNG only**, 8-bit, not interlaced (the default export settings from any
  image editor). Transparency is fine — it's flattened onto white.
- Any resolution; it's automatically resized down to `LOGO_WIDTH` dots and
  dithered to black/white for the thermal head (there's no grayscale on a
  receipt printer, so fine detail or light colors can get lost — simple
  high-contrast logos print best).
- A category with no logo file yet still works; it just prints its name
  without an image, and shows a plain tile in the picker instead of a broken
  image.
- Blank margins around the subject are trimmed automatically before
  centering, so it's fine if the source PNG has extra canvas on one side.
- Flat, saturated colors (especially green/red) can dither into a dense,
  heavy black fill — luminance-based thresholding reads them as much darker
  than they look to the eye. If a logo prints too dark, add `lighten: 120`
  (0-255, higher = lighter) to its entry in `CATEGORIES`. Solid black
  linework stays solid black regardless; `lighten` only pulls lighter tones
  toward white. `DEFAULT_LOGO` uses `lighten: 120` for exactly this reason.

Logo bytes are **rasterized once and cached per server run** — restart
`npm start` after adding, replacing, or editing `config.js`'s category list
or any logo file for the change to show up.

### The "None" option

Leaving category unset prints plain "TO DO" — unless you drop a PNG at
`public/logos/default.png` (same requirements as above), in which case that
logo prints above "TO DO" too, and the picker's "None" tile shows it instead
of a blank placeholder. There's no `default.png` in place right now, so it
currently still just prints "TO DO" as text.

The whole decode → resize → dither → ESC/POS pipeline is in `lib/png.js` and
`lib/raster.js`, with no image library dependency (Node's built-in `zlib`
handles PNG's DEFLATE compression; everything else — unfiltering, box-filter
resizing, Floyd-Steinberg dithering, raster packing — is plain JS).

## This printer

The unit is a Rongta with a **JK-E02 ethernet interface module**.

- MAC `A8-01-29-24-E7-38`
- IP `192.168.1.87`, mask `255.255.255.0`, **DHCP disabled**, no gateway set
- Raw printing on TCP **9100**; a small config web UI on TCP **80**

Useful pages on the printer's own web UI:

| Page | Purpose |
| --- | --- |
| `http://192.168.1.87/port_stat.htm` | MAC, IP, mask, DHCP state |
| `http://192.168.1.87/prn_stat.htm` | Paper / cover / cutter status, test page button |
| `http://192.168.1.87/tcpip_cfg.htm` | Change IP, mask, DHCP mode |
| `http://192.168.1.87/reset_srv` | Reboot the interface module |

### Why UniFi does not list it

The printer is **not on the UniFi LAN**. A trace to it goes:

```
1  10.10.10.1        (UniFi gateway)
2  192.168.1.87      (printer)
```

One hop *past* the gateway — it is plugged into the upstream router's network
(`192.168.1.0/24`, the WAN side of the UniFi gateway), not a UniFi switch port.
UniFi only lists clients on its own LAN, so it was never going to appear there.

Printing works today because the gateway NATs outbound traffic: packets from
`10.10.10.x` leave with a `192.168.1.x` source address, which the printer can
reply to directly — which matters, because the printer has **no gateway
configured** and so cannot reply to an off-subnet address on its own.

That means the current setup depends on double-NAT and the upstream router
handing out the same subnet after a reboot. To put the printer on the UniFi
LAN properly, see below.

### Moving it onto the UniFi LAN

Do it in this order, or the printer becomes unreachable mid-way:

1. Open `http://192.168.1.87/tcpip_cfg.htm` and **enable DHCP**, then save and
   reboot the module.
2. Move the ethernet cable to a UniFi switch/gateway LAN port.
3. The printer picks up a `10.10.10.x` lease and appears in UniFi as a client
   (look for MAC `A8-01-29-24-E7-38`).
4. In UniFi, give it a **fixed IP reservation** so it never moves.
5. Set `PRINTER_HOST` to that address.

If you would rather assign a static IP directly, use `tcpip_cfg.htm` to set
something outside the UniFi DHCP pool with mask `255.255.255.0` and gateway
`10.10.10.1` — but only *after* the cable is on the UniFi LAN, since changing
the IP while it is on the old network will cut you off from it.

## Layout

```
config.js            settings, env var handling, and the CATEGORIES list
server.js            Express app and JSON API
lib/escpos.js        ESC/POS byte builder, CP437 encoding, word wrapping
lib/printer.js       TCP 9100 transport, print queue, status scraping
lib/todo.js          receipt layout for a todo slip
lib/store.js         print history, persisted to data/history.json
lib/png.js           minimal PNG decoder (for logo files)
lib/raster.js        resize + dither + ESC/POS raster image packing
lib/logos.js         per-category logo loading and caching
public/              the single-page front end
public/logos/        category logo PNGs, served to the browser and read by lib/logos.js
scripts/testprint.js CLI connectivity check
```

## API

| Route | Does |
| --- | --- |
| `GET /api/status` | Reachability plus paper/cover/cutter state |
| `GET /api/categories` | Configured categories, with `logo` set to the image URL or `null` |
| `GET /api/history?limit=25` | Recently printed items |
| `POST /api/print` | `{ task, notes?, addedBy?, priority?, category? }` → prints a slip |
| `POST /api/test` | Prints a test slip |

`priority` is `low`, `normal` or `high`. `category` is one of the configured
category keys, or omitted/`null` for a plain "TO DO" slip; an unrecognized
key is silently treated as no category rather than rejected.

## Notes on the implementation

- **The print queue matters.** The JK-E02 accepts one connection at a time, so
  every job is serialized in `lib/printer.js`. Two people pressing print at the
  same moment get two clean receipts rather than one interleaved mess.
- **Text is encoded to CP437**, the printer's default code page. Smart quotes,
  em dashes and similar get transliterated; emoji are stripped rather than
  printed as garbage.
- **Status is scraped from the web UI** because port 9100 here is effectively
  write-only — there is no usable status response on it.
- **The socket is held open briefly after writing** before closing, so the last
  bytes are not lost to an immediate FIN.
- There is a light per-IP rate limit (20 prints/minute) so a page left open on
  the LAN cannot empty the paper roll.
