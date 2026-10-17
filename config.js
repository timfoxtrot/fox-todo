// Printer + server settings. Override any of these with environment variables.
export const config = {
  // The Rongta's JK-E02 ethernet module. Factory default is 192.168.1.87.
  printerHost: process.env.PRINTER_HOST || '192.168.1.87',
  printerPort: Number(process.env.PRINTER_PORT || 9100),

  // Characters per line at font A. 80mm paper = 48, 58mm paper = 32.
  columns: Number(process.env.PRINTER_COLUMNS || 48),

  // Listening on 0.0.0.0 so phones and other machines on the LAN can reach it.
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 3000),

  // Socket timeouts, ms.
  connectTimeout: Number(process.env.CONNECT_TIMEOUT || 5000),
  statusTimeout: Number(process.env.STATUS_TIMEOUT || 4000),

  // Keep the last N printed items for the history panel.
  historyLimit: Number(process.env.HISTORY_LIMIT || 200),

  // Dot width the logo is resized to before dithering. 80mm paper prints at
  // 576 dots across, so 300 sits at roughly half the receipt's width.
  logoWidth: Number(process.env.LOGO_WIDTH || 300),
};

// Categories a todo can be printed under. Each needs a PNG logo at
// public/logos/<logo>, served to the browser for the picker and read
// server-side to build the printed receipt header. A category with no logo
// file yet just prints its name without an image.
//
// `lighten` (0-255, optional) brightens the image before dithering — bump it
// if a logo's flat colors (especially green/red) print as a dense, heavy
// black fill on thermal paper. Leave it off and solid black linework still
// prints solid black; it only pulls lighter tones toward white.
export const CATEGORIES = [
  { key: 'aidatim', label: 'Aida & Tim', logo: 'AT.png' },
  { key: 'gswc', label: 'GSWC', logo: 'gswc.png' },
  { key: 'giaa', label: 'GIAA', logo: 'giaa.png' },
  { key: 'gmha', label: 'GMHA', logo: 'gmha.png' },
];

// Optional logo for a plain "TO DO" slip (no category picked). Drop a PNG at
// public/logos/<logo> to use one; leave the file missing and it just prints
// "TO DO" as text, same as before this existed.
export const DEFAULT_LOGO = { logo: 'default.png', lighten: 120 };
