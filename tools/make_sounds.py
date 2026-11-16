"""
Synthesise the scan sound, rather than shipping someone else's.

A downloaded "ka-ching" carries a licence question into a paid app for the sake
of 300 milliseconds. This generates one from first principles, so the file in
the repo has a recipe next to it and no attribution to get wrong.

A cash register's ring is a small bell: a few INHARMONIC partials - ratios that
are not whole numbers, which is what stops it sounding like an organ note - with
a fast strike and a long-ish tail. Two strikes a few tens of milliseconds apart
give the "ka-CHING" rather than a single "ding".

    python tools/make_sounds.py
"""

import math
import os
import struct
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "apps", "mobile", "assets", "sound")
RATE = 44100

# Ratios from a struck metal bar. The 2.76 and 5.40 are what make it read as
# metal instead of a flute; a harmonic stack (2.0, 3.0) sounds like a organ.
PARTIALS = [(1.0, 1.00), (2.76, 0.55), (5.40, 0.28), (8.93, 0.12)]


def strike(buf, at, freq, gain, decay):
    """Add one bell strike into the buffer, in place."""
    start = int(at * RATE)
    for i in range(start, len(buf)):
        t = (i - start) / RATE
        env = math.exp(-t / decay)
        if env < 0.0005:
            break
        v = 0.0
        for ratio, amp in PARTIALS:
            # Higher partials die faster, which is what a real bell does and is
            # most of why a synthesised one sounds cheap when they do not.
            v += amp * math.exp(-t / (decay / ratio ** 0.7)) * \
                math.sin(2 * math.pi * freq * ratio * t)
        buf[i] += gain * env * v


def write(name, buf):
    write_at(name, buf, 0.82)


def write_at(name, buf, level):
    """Write `buf` normalised so its peak sits at `level` of full scale."""
    peak = max(1e-9, max(abs(x) for x in buf))
    # Leave headroom: a sample that clips reads as a click on a phone speaker.
    scale = level / peak
    frames = b"".join(
        struct.pack("<h", int(max(-1.0, min(1.0, x * scale)) * 32767)) for x in buf
    )
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(frames)
    print(f"  {name}  {os.path.getsize(path) / 1024:.0f} KB  "
          f"{len(buf) / RATE * 1000:.0f} ms")


def main():
    print("writing sounds")

    # The scan sound. Two strikes 45 ms apart, the second a fifth above - the
    # interval a till actually rings, and short enough that a fast pile does not
    # turn into a chord.
    n = int(0.42 * RATE)
    ka = [0.0] * n
    strike(ka, 0.000, 1180.0, 0.55, 0.085)
    strike(ka, 0.045, 1770.0, 1.00, 0.230)
    write("scan.wav", ka)

    # A card that needs checking: same family, lower and single, so it reads as
    # "noted" rather than as an error. It is not an error - the card was found,
    # the price is just ambiguous.
    n = int(0.30 * RATE)
    soft = [0.0] * n
    strike(soft, 0.0, 760.0, 1.0, 0.140)
    write("check.wav", soft)

    # --- Sort mode: three piles, three sounds (apps/mobile/src/sort.ts) -----
    #
    # In a sort session the ear does the sorting, so the three cues have to be
    # told apart WITHOUT attention - by someone talking, with music on, at a
    # card a second. They therefore differ in three ways at once (pitch, number
    # of strikes, length), not one. "keep" reuses scan.wav above: it is the
    # sound people already know means "that one landed and it is worth
    # something".

    # Bulk: one low, dull, short knock. Ninety-five cards in a hundred make this
    # sound, so it is the quietest and shortest thing here (peak 0.45, 110 ms) -
    # a tick that says "counted, keep going" and can be heard four hundred times
    # without anyone reaching for the mute switch. Low enough (520 Hz) that it
    # cannot be mistaken for either bell.
    n = int(0.11 * RATE)
    tock = [0.0] * n
    strike(tock, 0.0, 520.0, 1.0, 0.030)
    write_at("bulk.wav", tock, 0.45)

    # Pull: three rising strikes, a major triad climbing above the scan bell,
    # with a long tail. It is the only cue with three attacks and the only one
    # still ringing when the next card would normally arrive - which is the
    # point: this is the one sound that should make the hands stop.
    n = int(0.80 * RATE)
    pull = [0.0] * n
    strike(pull, 0.000, 1568.0, 0.70, 0.110)   # G6
    strike(pull, 0.085, 1976.0, 0.85, 0.140)   # B6
    strike(pull, 0.170, 2349.0, 1.00, 0.380)   # D7
    write("pull.wav", pull)


if __name__ == "__main__":
    main()
