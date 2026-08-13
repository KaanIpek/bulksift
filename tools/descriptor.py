"""Canonical BulkSift card descriptor - the reference implementation.

This is deliberately built out of operations that port to TypeScript bit-for-bit.
The research prototype used cv2.resize(INTER_AREA), DCT and Lab colour, none of
which reproduce exactly in a browser or on React Native: canvas downscaling is
implementation-defined, so an index built here would silently disagree with the
matcher on device. Everything below is instead integer box-averaging over grids
that divide the canonical size exactly, plus comparisons - no float kernels, no
library-specific resampling.

Canonical card: 240 x 336 (240 = 2^4*3*5, 336 = 2^4*3*7).

Layout, 742 bits total (93 bytes):
  full 16x16 grid, horizontal diffs  16*15 = 240
  full 16x16 grid, vertical   diffs  15*16 = 240
  art  12x14 grid, horizontal diffs  14*11 = 154
  colour 6x6 grid, 3 channels vs median   = 108
"""
import numpy as np

CANON_W, CANON_H = 240, 336

# art window: the illustration box, on grid-aligned boundaries
ART_X0, ART_X1 = 30, 210     # width 180 = 12 * 15
ART_Y0, ART_Y1 = 42, 168     # height 126 = 14 * 9

FULL_GRID = 16
ART_GX, ART_GY = 12, 14
COLOR_GRID = 6

N_BITS = (FULL_GRID * (FULL_GRID - 1)) * 2 + (ART_GY * (ART_GX - 1)) + COLOR_GRID ** 2 * 3
# Rows are padded to a multiple of 4 bytes so the matcher can XOR them as
# 32-bit words instead of bytes. The padding bits are zero in both the index and
# the query, so they contribute nothing to any Hamming distance.
DESC_BYTES = (N_BITS + 7) // 8
N_BYTES = (DESC_BYTES + 3) // 4 * 4

# The strip: the bottom 36 rows of the card, full width, on a 30x4 grid.
#
# A second, separate descriptor covering only the footer - collector number,
# set symbol, rarity mark, copyright line. The main descriptor's finest cell is
# 15x21 px, which smears that whole area into four numbers, so two printings of
# one illustration land ~50 bits apart, inside camera noise. The footer is the
# only place they actually differ. Digits are unreadable at this scale and OCR
# on them was measured at 66%; the set symbol beside them is a solid graphic
# several times a digit's size, and that is what these bits keep.
STRIP_Y0, STRIP_Y1 = 300, 336
STRIP_GX, STRIP_GY = 30, 4
STRIP_BITS = STRIP_GY * (STRIP_GX - 1)
STRIP_BYTES = (STRIP_BITS + 7) // 8


def strip_bits(bgr):
    """Horizontal-difference bits over the card footer. Returns a bool array."""
    assert bgr.shape[0] == CANON_H and bgr.shape[1] == CANON_W, bgr.shape
    gray = to_gray(bgr)[STRIP_Y0:STRIP_Y1, :]
    cells = box_grid(gray, STRIP_GX, STRIP_GY)
    out = (cells[:, 1:] > cells[:, :-1]).ravel()
    assert out.size == STRIP_BITS, (out.size, STRIP_BITS)
    return out


def pack_strip(bits):
    """MSB-first packing of the strip, zero-padded to STRIP_BYTES."""
    packed = np.packbits(bits.astype(np.uint8), axis=-1, bitorder="big")
    if packed.shape[-1] == STRIP_BYTES:
        return packed
    pad = [(0, 0)] * (packed.ndim - 1) + [(0, STRIP_BYTES - packed.shape[-1])]
    return np.pad(packed, pad, constant_values=0)


def to_gray(bgr):
    """BT.601 luma, floored to an integer so both implementations agree."""
    b = bgr[:, :, 0].astype(np.float64)
    g = bgr[:, :, 1].astype(np.float64)
    r = bgr[:, :, 2].astype(np.float64)
    return np.floor(0.299 * r + 0.587 * g + 0.114 * b).astype(np.int64)


def box_grid(plane, gx, gy):
    """Exact box SUM onto a gx-by-gy grid. Requires exact divisibility.

    Sums, not means: every cell covers the same number of integer-valued pixels,
    so the comparisons that follow are identical either way - but a sum is an
    exact integer while a mean is a float whose last bit depends on the
    accumulation order. numpy sums pairwise and a TypeScript for-loop sums
    sequentially, which made 4 of 250 test cards differ by one bit on values
    that were exact ties. Integer sums remove that ambiguity entirely.
    """
    h, w = plane.shape
    assert w % gx == 0 and h % gy == 0, f"{w}x{h} not divisible by {gx}x{gy}"
    ch, cw = h // gy, w // gx
    return plane.reshape(gy, ch, gx, cw).sum(axis=(1, 3), dtype=np.int64)


def descriptor_bits(bgr):
    """bgr: uint8 HxWx3 at exactly CANON_W x CANON_H. Returns a bool array."""
    assert bgr.shape[0] == CANON_H and bgr.shape[1] == CANON_W, bgr.shape
    gray = to_gray(bgr)

    full = box_grid(gray, FULL_GRID, FULL_GRID)
    h_bits = (full[:, 1:] > full[:, :-1]).ravel()
    v_bits = (full[1:, :] > full[:-1, :]).ravel()

    art = gray[ART_Y0:ART_Y1, ART_X0:ART_X1]
    ag = box_grid(art, ART_GX, ART_GY)
    a_bits = (ag[:, 1:] > ag[:, :-1]).ravel()

    c_bits = []
    for ch in range(3):
        cg = box_grid(bgr[:, :, ch].astype(np.float64), COLOR_GRID, COLOR_GRID).ravel()
        c_bits.append(cg > np.median(cg))
    c_bits = np.concatenate(c_bits)

    out = np.concatenate([h_bits, v_bits, a_bits, c_bits])
    assert out.size == N_BITS, (out.size, N_BITS)
    return out


def pack(bits):
    """MSB-first packing, zero-padded to N_BYTES."""
    packed = np.packbits(bits.astype(np.uint8), axis=-1, bitorder="big")
    if packed.shape[-1] == N_BYTES:
        return packed
    pad = [(0, 0)] * (packed.ndim - 1) + [(0, N_BYTES - packed.shape[-1])]
    return np.pad(packed, pad, constant_values=0)


_POPCNT = np.array([bin(i).count("1") for i in range(256)], dtype=np.uint16)


def hamming_all(db, q):
    return _POPCNT[np.bitwise_xor(db, q)].sum(axis=1)
