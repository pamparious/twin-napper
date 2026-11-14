import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

function crc32(buffer) {
  let crc = ~0
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, checksum])
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < size; x += 1) {
      const pixel = row + 1 + x * 4
      const inLeft = circle(x, y, size * 0.36, size * 0.56, size * 0.16)
      const inRight = circle(x, y, size * 0.64, size * 0.56, size * 0.16)
      const [r, g, b] = inLeft ? [255, 255, 255] : inRight ? [255, 214, 10] : [10, 132, 255]
      raw[pixel] = r
      raw[pixel + 1] = g
      raw[pixel + 2] = b
      raw[pixel + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function circle(x, y, cx, cy, radius) {
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
}

for (const size of [180, 192, 512]) {
  const name = size === 180 ? 'public/apple-touch-icon.png' : `public/icon-${size}.png`
  writeFileSync(name, png(size))
}
