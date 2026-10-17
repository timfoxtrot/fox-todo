import { Receipt } from './escpos.js';
import { config } from '../config.js';
import { getLogoRaster, getDefaultLogoRaster, findCategory } from './logos.js';

const PRIORITY_LABEL = { low: 'LOW', normal: 'NORMAL', high: 'HIGH' };

function formatStamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

/** Build the ESC/POS bytes for one todo slip. */
export function renderTodo({ task, addedBy, priority = 'normal', notes = '', category = null, printedAt = new Date() }) {
  const { date, time } = formatStamp(printedAt);
  const r = new Receipt({ columns: config.columns });
  const cat = category ? findCategory(category) : null;

  r.init();

  // Header: the category's logo + name if one is selected, otherwise the
  // default logo (if one is configured) above plain "TO DO" text.
  r.align(1);
  if (cat) {
    const raster = getLogoRaster(cat.key);
    if (raster) r.image(raster.bytes).feed(1);
    r.bold(true).size(1, 2).text(cat.label, { scale: 1 }).size(1, 1).bold(false);
  } else {
    const raster = getDefaultLogoRaster();
    if (raster) r.image(raster.bytes).feed(1);
    r.bold(true).size(2, 2).text('TO DO', { scale: 2 }).size(1, 1).bold(false);
  }
  if (priority === 'high') r.bold(true).text('** HIGH PRIORITY **').bold(false);
  r.feed(1);

  // The task itself, double height so it reads from across the room.
  r.align(0).line('=');
  r.feed(1);
  r.align(1).bold(true).size(1, 2).text(task, { scale: 1 });
  r.size(1, 1).bold(false);
  r.feed(1);
  r.align(0).line('=');

  // Notes
  if (notes.trim()) {
    r.feed(1).align(0).text(notes.trim());
  }

  // Footer metadata
  r.feed(1);
  if (addedBy) r.columnsRow('From', addedBy);
  if (priority !== 'high') r.columnsRow('Priority', PRIORITY_LABEL[priority] || 'NORMAL');
  r.columnsRow('Printed', `${date} ${time}`);

  // A box to tick when it is done.
  r.feed(1).align(1).pre('[    ]   done').feed(1);

  r.align(0).feed(2).cut(3);
  return r.build();
}

/** A one-off slip confirming connectivity. */
export function renderTestSlip({ printedAt = new Date() } = {}) {
  const { date, time } = formatStamp(printedAt);
  const r = new Receipt({ columns: config.columns });
  r.init()
    .align(1).bold(true).size(2, 2).text('TEST', { scale: 2 })
    .size(1, 1).bold(false)
    .text('receipttodo is connected')
    .feed(1)
    .align(0)
    .columnsRow('Printer', `${config.printerHost}:${config.printerPort}`)
    .columnsRow('Columns', String(config.columns))
    .columnsRow('Printed', `${date} ${time}`)
    .feed(2)
    .cut(3);
  return r.build();
}
