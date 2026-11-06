# Usage: python cut_checker.py <image> <out.png>   e.g. python cut_checker.py bandits.jpg img/bandits.png
# Remove a baked-in "transparency" checkerboard (40x40 squares, ~254 / ~201 grey) from a generated sprite.
# A pixel is background if it matches the checker colour expected at its position; grey art rarely does.
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import label, binary_opening, binary_closing

src, out = sys.argv[1], sys.argv[2]
img = Image.open(src).convert('RGB')
a = np.asarray(img).astype(int)
v, H, W = a.mean(2), a.shape[0], a.shape[1]
sq = W / 40
ys, xs = np.mgrid[0:H, 0:W]
# Row phase read from the left margin (always background): generators don't always keep the grid regular.
row_dark = v[:, 3:int(sq) - 3].mean(1) < 228
dark = row_dark[:, None] ^ ((xs // sq).astype(int) % 2 == 1)
flip = np.flatnonzero(np.diff(row_dark.astype(int)))  # y where the row phase changes
ydist = np.min(np.abs(ys[:, :1] - flip[None, :]), axis=1, keepdims=True) if len(flip) else np.full((H, 1), 99)
near = (np.minimum(xs % sq, sq - xs % sq) < 2.5) | (ydist < 3)  # JPEG blur at square edges
neutral = a.max(2) - a.min(2) < 12
# Rows where the grid is irregular (square height off): phase is unreliable there, take any light neutral pixel.
loose = np.zeros((H, 1), bool)
for f0, f1 in zip(flip, flip[1:]):
    if abs(f1 - f0 - sq) > 2: loose[max(f0 - 3, 0):f1 + 4] = True
match = neutral & ((np.abs(v - np.where(dark, 201, 254)) < 7) | (near & (v >= 192)) | (loose & (v >= 194)) | (v >= 232))  # art never gets this bright
match = binary_opening(match, np.ones((3, 3)))  # drop speckles that happen to match on the art

lab, n = label(match)
sizes = np.bincount(lab.ravel())
edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
keep = np.zeros(n + 1, bool); keep[edge] = True; keep[sizes > 600] = True  # big enclosed patches (between legs) too
keep[0] = False
fg = binary_closing(~keep[lab], np.ones((5, 5)))  # heal small nicks along the outline
fl, _ = label(fg)
fg = fl == np.argmax(np.bincount(fl.ravel())[1:]) + 1  # just the figure: drop stray leftover squares

alpha = Image.fromarray((fg * 255).astype(np.uint8), 'L').filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1))
rgba = img.copy(); rgba.putalpha(alpha)
crop = rgba.crop(alpha.point(lambda t: 255 if t > 20 else 0).getbbox())
crop.resize((256, round(256 * crop.height / crop.width)), Image.LANCZOS).save(out)
print('saved', out, crop.size)
