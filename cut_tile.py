# Turn a generated overhang tile (magenta background) into img/<name>.png for the board.
# Usage: python cut_tile.py <image> <name>     e.g. python cut_tile.py forest.webp forest
#        name ship, pirate, outpost, town or route = a sprite, just trimmed (no hexagon).
#
# Output format (what index.html expects): 256 x 444 PNG with transparency.
# The pointy-top hexagon base fills the bottom 256 x 296 px; the 148 px above it is overhang room.
import sys
import numpy as np
from PIL import Image

W, HEX_H, OVER = 256, 296, 148

src, name = sys.argv[1], sys.argv[2]
a = np.asarray(Image.open(src).convert('RGB')).astype(float)
r, g, b = a[..., 0], a[..., 1], a[..., 2]

# Magenta-ness: red and blue both high above green. Soft key for clean edges.
m = np.minimum(r, b) - g
alpha = np.clip(1 - (m - 40) / 80, 0, 1)
# De-spill: pull leftover magenta tint out of edge pixels.
spill = m > 20
cap = g + 20
a[..., 0] = np.where(spill, np.minimum(r, cap), r)
a[..., 2] = np.where(spill, np.minimum(b, cap), b)

solid = alpha > .5
rgba = np.dstack([a, alpha * 255]).clip(0, 255).astype(np.uint8)
img = Image.fromarray(rgba, 'RGBA')

if name in ('ship', 'pirate', 'outpost', 'town', 'route'):
    # Sprite (art faces right): just trim to the visible pixels, 256 px wide.
    x0, y0, x1, y1 = img.getchannel('A').point(lambda v: 255 if v > 20 else 0).getbbox()
    crop = img.crop((x0, y0, x1, y1))
    crop.resize((256, round(256 * crop.height / crop.width)), Image.LANCZOS).save(f'img/{name}.png')
    print(f'saved img/{name}.png ({x1 - x0}x{y1 - y0} source px)')
    sys.exit()

rows = np.where(solid.sum(axis=1) > 3)[0]
top, bottom = rows[0], rows[-1]
# Measure the base width low down, on the hexagon's straight sides, where no trees/peaks poke out.
band = range(int(bottom - .45 * (bottom - top)), int(bottom - .2 * (bottom - top)))
spans = [np.where(solid[y])[0] for y in band]
left = int(np.median([s[0] for s in spans if len(s)]))
right = int(np.median([s[-1] for s in spans if len(s)]))
width = right - left
hex_h = width * 2 / 3 ** .5            # regular pointy-top hexagon
hex_top = bottom - hex_h
print(f'{name}: hex base x {left}-{right}, y {hex_top:.0f}-{bottom}; art reaches y {top} '
      f'({(hex_top - top) / hex_h:.0%} of hex height above it, max {OVER / HEX_H:.0%})')

scale = W / width
over_src = OVER / scale                # source pixels of overhang room
crop = img.crop((left, round(hex_top - over_src), right + 1, bottom + 1))
crop.resize((W, HEX_H + OVER), Image.LANCZOS).save(f'img/{name}.png')
print(f'saved img/{name}.png')
