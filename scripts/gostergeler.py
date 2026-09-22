"""
Tarama hattının indikatörleri.

Bu fonksiyonlar `strategies.py` içindeydi; strateji ekranları kaldırılınca o
dosya da silindi ama `screener.py` bu üç göstergeyi kullanmaya devam ediyor
(tarama anlık görüntüsü `screener.json` onlarla üretiliyor). Ortak kod kendi
modülüne alındı ki silinen bir özelliğin dosyası yalnızca "import edilebilsin"
diye ayakta tutulmasın.

  pip install numpy pandas
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def ema(a: np.ndarray, length: int) -> np.ndarray:
    return pd.Series(a).ewm(span=length, adjust=False).mean().to_numpy()


def wilder_atr(high, low, close, length):
    n = len(close)
    tr = np.empty(n)
    tr[0] = high[0] - low[0]
    pc = close[:-1]
    tr[1:] = np.maximum.reduce([high[1:] - low[1:], np.abs(high[1:] - pc), np.abs(low[1:] - pc)])
    a = np.empty(n)
    a[0] = tr[0]
    k = (length - 1) / length
    inv = 1.0 / length
    for i in range(1, n):
        a[i] = a[i - 1] * k + tr[i] * inv
    return a


def supertrend_pos(high, low, close, length, mult):
    n = len(close)
    atr = wilder_atr(high, low, close, length)
    hl2 = (high + low) / 2.0
    ub = hl2 + mult * atr
    lb = hl2 - mult * atr
    p = np.zeros(n, dtype=np.int8)
    fu, fl, d = ub[0], lb[0], 1
    p[0] = 1
    for i in range(1, n):
        fu = ub[i] if (ub[i] < fu or close[i - 1] > fu) else fu
        fl = lb[i] if (lb[i] > fl or close[i - 1] < fl) else fl
        if close[i] > fu:
            d = 1
        elif close[i] < fl:
            d = 0
        p[i] = d
    return p


def rsi_arr(close, length):
    n = len(close)
    rsi = np.full(n, np.nan)
    if n <= length:
        return rsi
    diff = np.diff(close)
    gain = np.where(diff > 0, diff, 0.0)
    loss = np.where(diff < 0, -diff, 0.0)
    ag = gain[:length].mean()
    al = loss[:length].mean()
    rsi[length] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    k = (length - 1) / length
    inv = 1.0 / length
    for i in range(length + 1, n):
        ag = ag * k + gain[i - 1] * inv
        al = al * k + loss[i - 1] * inv
        rsi[i] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    return rsi
