import sharp from 'sharp';

export async function prepareImage(file, config) {
  const image = sharp(file, { failOn: 'error' }).rotate().removeAlpha().toColourspace('srgb');
  if (config.image_projection === 'panorama_strip') {
    const source = await image.png().toBuffer();
    const { width, height } = await sharp(source).metadata();
    const overview = await sharp(source).resize({ width: config.max_image_edge, withoutEnlargement: true }).png().toBuffer();
    const views = [{ name: 'overview', url: `data:image/png;base64,${overview.toString('base64')}`,
      source_regions: [{ left: 0, top: 0, width, height }] }];
    const cropWidth = Math.min(config.crop_width ?? 1024, width);
    const step = Math.max(1, Math.floor(cropWidth * (1 - (config.crop_overlap ?? .25))));
    const starts = new Set();
    for (let left = 0; left < width; left += step) starts.add(Math.min(left, width - cropWidth));
    for (const left of starts) {
      const crop = await sharp(source).extract({ left, top: 0, width: cropWidth, height }).png().toBuffer();
      views.push({ name: `crop_x${left}_to_${left + cropWidth}`, url: `data:image/png;base64,${crop.toString('base64')}`,
        source_regions: [{ left, top: 0, width: cropWidth, height }] });
    }
    if (config.include_seam_crop && width > cropWidth) {
      const rightWidth = Math.floor(cropWidth / 2), leftWidth = cropWidth - rightWidth;
      const right = await sharp(source).extract({ left: width - rightWidth, top: 0, width: rightWidth, height }).png().toBuffer();
      const left = await sharp(source).extract({ left: 0, top: 0, width: leftWidth, height }).png().toBuffer();
      const seam = await sharp({ create: { width: cropWidth, height, channels: 3, background: '#000000' } })
        .composite([{ input: right, left: 0, top: 0 }, { input: left, left: rightWidth, top: 0 }]).removeAlpha().png().toBuffer();
      views.push({ name: `seam_x${width - rightWidth}_to_${width}_then_x0_to_${leftWidth}`,
        url: `data:image/png;base64,${seam.toString('base64')}`,
        source_regions: [{ left: width - rightWidth, top: 0, width: rightWidth, height }, { left: 0, top: 0, width: leftWidth, height }] });
    }
    return views;
  }
  if (config.image_projection === 'flat') {
    const buffer = await image.resize({ width: config.max_image_edge, height: config.max_image_edge, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    return [{ name: 'image', url: `data:image/png;base64,${buffer.toString('base64')}` }];
  }
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  if (info.width !== 2 * info.height) throw new Error('Equirectangular mode requires a 2:1 panorama; set image_projection to flat for ordinary images.');
  const faces = {
    front: (u, v) => [u, -v, 1], right: (u, v) => [1, -v, -u],
    back: (u, v) => [-u, -v, -1], left: (u, v) => [-1, -v, u],
    up: (u, v) => [u, 1, v], down: (u, v) => [u, -1, -v]
  };
  const size = config.face_size, views = [];
  for (const [name, direction] of Object.entries(faces)) {
    const pixels = Buffer.alloc(size * size * 3);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const [dx, dy, dz] = direction((x + .5) / size * 2 - 1, (y + .5) / size * 2 - 1);
      const norm = Math.hypot(dx, dy, dz);
      const sx = (Math.atan2(dx, dz) / (2 * Math.PI) + .5) * info.width - .5;
      const sy = Math.max(0, Math.min(info.height - 1, (.5 - Math.asin(dy / norm) / Math.PI) * info.height - .5));
      const x0 = ((Math.floor(sx) % info.width) + info.width) % info.width, x1 = (x0 + 1) % info.width;
      const y0 = Math.floor(sy), y1 = Math.min(y0 + 1, info.height - 1);
      const fx = sx - Math.floor(sx), fy = sy - y0;
      for (let c = 0; c < 3; c++) {
        const sample = (xx, yy) => data[(yy * info.width + xx) * info.channels + c];
        pixels[(y * size + x) * 3 + c] = Math.round(
          (sample(x0, y0) * (1 - fx) + sample(x1, y0) * fx) * (1 - fy) +
          (sample(x0, y1) * (1 - fx) + sample(x1, y1) * fx) * fy);
      }
    }
    const buffer = await sharp(pixels, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
    views.push({ name, url: `data:image/png;base64,${buffer.toString('base64')}` });
  }
  return views;
}
