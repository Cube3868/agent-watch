"""Synthesizes the launch film's music bed: a calm pad in D, with a soft bell on each scene change.
Original, generated from sine waves, so it is free to publish.  python launch/bed.py -> launch/out/bed.wav"""
import wave
from pathlib import Path

import numpy as np

SR = 48000
DUR = 27.5
CUTS = [3.4, 9.8, 14.6, 19.6, 23.7]  # scene changes in film.html
OUT = Path(__file__).parent / "out" / "bed.wav"

n = int(SR * DUR)
t = np.arange(n) / SR
mix = np.zeros((n, 2))


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def env(start, length, attack=1.4, release=1.8):
    e = np.zeros(n)
    i0, i1 = int(start * SR), min(n, int((start + length + release) * SR))
    tt = t[i0:i1] - start
    a = np.clip(tt / attack, 0, 1)
    r = np.clip((start + length + release - t[i0:i1]) / release, 0, 1)
    e[i0:i1] = np.sin(a * np.pi / 2) * np.minimum(1, r)
    return e


# Dmaj9, Bm9, Gmaj9, A6/9 — each ~5.5 s, overlapping
chords = [[50, 57, 62, 64, 66, 69], [47, 54, 59, 61, 62, 66], [43, 50, 59, 62, 66, 69], [45, 52, 57, 59, 61, 66], [50, 57, 62, 64, 66, 69]]
for ci, notes in enumerate(chords):
    start, length = ci * 5.5, 5.0
    e = env(start, length)
    for k, m in enumerate(notes):
        f = hz(m)
        for side, det in ((0, 0.9985), (1, 1.0015)):
            tone = np.sin(2 * np.pi * f * det * t) + 0.25 * np.sin(2 * np.pi * 2 * f * det * t + 0.3)
            mix[:, side] += tone * e * (0.11 if k else 0.16)

# soft bells on the cuts
for i, c in enumerate(CUTS):
    f = hz([81, 78, 83, 81, 86][i])
    i0 = int(c * SR)
    tt = t[i0:] - c
    bell = (np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(2 * np.pi * 2.76 * f * tt)) * np.exp(-tt * 2.2) * 0.09
    mix[i0:, 0] += bell * 0.9
    mix[i0:, 1] += bell * 1.1

# room: convolve with a short decaying noise tail
rng = np.random.default_rng(7)
ir_len = int(2.2 * SR)
ir = rng.standard_normal((ir_len, 2)) * np.exp(-np.arange(ir_len) / SR * 3.2)[:, None] * 0.015
wet = np.zeros_like(mix)
size = 1 << int(np.ceil(np.log2(n + ir_len)))
for ch in range(2):
    wet[:, ch] = np.fft.irfft(np.fft.rfft(mix[:, ch], size) * np.fft.rfft(ir[:, ch], size), size)[:n]
out = mix * 0.75 + wet * 0.6

fade = np.clip((DUR - t) / 2.5, 0, 1) * np.clip(t / 0.8, 0, 1)
out *= fade[:, None]
out /= np.max(np.abs(out)) / 0.5  # peak about -6 dBFS, quiet bed

OUT.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(OUT), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((out * 32767).astype("<i2").tobytes())
print(f"wrote {OUT}")
