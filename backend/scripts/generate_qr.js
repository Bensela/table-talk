const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

// Configuration
const BASE_URL = 'https://tabletalk.app/t';
const OUTPUT_DIR = path.join(__dirname, '../qrcodes');
const TABLES = [
  'table-001', 'table-002', 'table-003', 'table-004', 'table-005',
  'table-006', 'table-007', 'table-008', 'table-009', 'table-010'
];

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)){
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

console.log(`Generating ${TABLES.length} QR codes...`);

const generate = async () => {
  for (const tableId of TABLES) {
    const url = `${BASE_URL}/${tableId}`;
    const filepath = path.join(OUTPUT_DIR, `${tableId}.png`);
    
    try {
      await QRCode.toFile(filepath, url, {
        width: 1000, // High res for print
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        },
        errorCorrectionLevel: 'H'
      });
      console.log(`✅ Generated: ${tableId}.png -> ${url}`);
    } catch (err) {
      console.error(`❌ Error generating ${tableId}:`, err);
    }
  }
  console.log('Done! Check the "qrcodes" directory.');
};

generate();
