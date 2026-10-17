// Quick connectivity check without starting the web server:
//   npm run testprint
import { readPrinterStatus, sendToPrinter } from '../lib/printer.js';
import { renderTestSlip } from '../lib/todo.js';

const status = await readPrinterStatus();
console.log('status:', status);

if (!status.reachable) {
  console.error('\nPrinter is not reachable. Check PRINTER_HOST in config.js or your .env.');
  process.exit(1);
}

await sendToPrinter(renderTestSlip());
console.log('\nTest slip sent.');
