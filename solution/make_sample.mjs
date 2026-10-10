import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = dirname(fileURLToPath(import.meta.url));
// A deliberately synthetic drawing, used for connectivity and schema testing.
// It cannot establish accuracy on real construction photography.
const drawing = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768">
<rect width="1024" height="768" fill="#ededdf"/>
<rect x="0" y="630" width="1024" height="138" fill="#918778"/>
<rect x="340" y="160" width="344" height="340" fill="#ffffff"/>
<rect x="360" y="180" width="304" height="300" fill="#3979b8"/>
<path d="M512 180V480 M360 330H664" stroke="white" stroke-width="15"/>
<text x="35" y="55" font-family="sans-serif" font-size="28" fill="#444">SYNTHETIC TEST DRAWING</text>
</svg>`;
await sharp(Buffer.from(drawing)).png().toFile(join(root, 'sample_images/sample.png'));
console.log('Created sample_images/sample.png');
