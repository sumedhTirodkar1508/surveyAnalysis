"""
Checkbox detection via adaptive fill-ratio analysis.

Algorithm:
  1. Crop the bbox from the (optionally translated) page image.
  2. Shrink inward by BORDER_SHRINK_RATIO to exclude the thick printed border.
     Larger shrink (default 0.30) is essential because the survey checkboxes
     have very thick rounded borders that bleed 3-5 px into the inner region
     even after 20 % shrink.  30 % clears the border reliably.
  3. Compute a "net fill ratio":
       a. Apply Otsu threshold on the inner region → dark-pixel fill ratio.
       b. Apply the SAME threshold logic on the corresponding template bbox
          (if a template image is provided) → baseline fill ratio.
       c. net_fill = scan_fill - baseline_fill
     The baseline accounts for the portion of the inner region that is
     ALWAYS dark due to the checkbox border geometry regardless of whether
     the box is checked.  Checked boxes add net_fill ≥ NET_THRESHOLD on top.
  4. Without a template baseline, fall back to scan_fill ≥ INNER_THRESHOLD.

Threshold guidance:
  NET_THRESHOLD  = 0.08  (net fill above baseline → checked)
  INNER_THRESHOLD = 0.25  (raw fill without template reference)
"""
import os
import cv2
import numpy as np
from dataclasses import dataclass
from typing import Optional

# Fraction of bbox dimension to strip on each side before measuring fill.
# 0.30 → keeps the inner 40 % of each dimension; clears 3-5 px borders at 200 DPI.
BORDER_SHRINK_RATIO: float = float(os.getenv("CHECKBOX_BORDER_SHRINK", "0.30"))

# Raw fill-ratio threshold used when NO template baseline is available.
INNER_THRESHOLD: float = float(os.getenv("CHECKBOX_FILL_THRESHOLD", "0.25"))

# Net fill-ratio threshold (scan - template baseline) used when a template IS
# available.  Positive net fill means the box has content beyond the border.
NET_THRESHOLD: float = float(os.getenv("CHECKBOX_NET_THRESHOLD", "0.08"))


@dataclass
class CheckboxResult:
    checked: bool
    fill_ratio: float   # raw fill ratio measured on inner region of scan
    net_fill: float     # scan_fill - template_baseline (0 if no template)
    confidence: float   # 0–1 distance from threshold


def _inner_fill(image: np.ndarray, px: int, py: int, pw: int, ph: int) -> float:
    """
    Extract the inner region of a bbox and compute its Otsu fill ratio.
    Returns fill ratio in [0, 1].
    """
    region = image[py: py + ph, px: px + pw]
    if region.size == 0:
        return 0.0

    sx = max(1, int(pw * BORDER_SHRINK_RATIO))
    sy = max(1, int(ph * BORDER_SHRINK_RATIO))
    inner = region[sy: ph - sy, sx: pw - sx]
    if inner.size == 0:
        inner = region

    gray = (
        cv2.cvtColor(inner, cv2.COLOR_BGR2GRAY)
        if len(inner.shape) == 3
        else inner.copy()
    )

    if gray.size < 4:
        return 0.0

    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return float(np.sum(binary > 0)) / binary.size


def detect_checkbox(
    image: np.ndarray,
    x: float,
    y: float,
    w: float,
    h: float,
    template_image: Optional[np.ndarray] = None,
    dx_px: int = 0,
    dy_px: int = 0,
    threshold: Optional[float] = None,
) -> "CheckboxResult":
    """
    Detect whether the checkbox at normalized bbox (x, y, w, h) is checked.

    Args:
        image:          Full page scan image (BGR or grayscale).
        x, y, w, h:    Normalized bbox in [0, 1] — template coordinate system.
        template_image: Optional template page image.  When provided, a
                        baseline fill ratio is computed and subtracted to
                        remove border contamination.
        dx_px, dy_px:  Per-page pixel offset of template bboxes relative to
                       the scan.  Positive dx means the scan content is
                       dx pixels to the RIGHT of the template bbox — we
                       subtract dx to shift the bbox LEFT in scan pixels.
                       Computed by find_page_translation().
        threshold:      Override NET_THRESHOLD (with template) or
                        INNER_THRESHOLD (without).

    Returns:
        CheckboxResult with checked, fill_ratio, net_fill, confidence.
    """
    img_h, img_w = image.shape[:2]

    # ── Pixel coords in scan space (apply per-page offset) ───────────
    # Template bbox → scan bbox: shift by -dx (left if dx>0) and -dy.
    px_tmpl = int(x * img_w)
    py_tmpl = int(y * img_h)
    pw = max(2, int(w * img_w))
    ph = max(2, int(h * img_h))

    px_scan = px_tmpl - dx_px
    py_scan = py_tmpl - dy_px

    # Clamp scan bbox
    px_scan = max(0, min(px_scan, img_w - 1))
    py_scan = max(0, min(py_scan, img_h - 1))
    pw_scan = min(pw, img_w - px_scan)
    ph_scan = min(ph, img_h - py_scan)

    if pw_scan < 2 or ph_scan < 2:
        return CheckboxResult(checked=False, fill_ratio=0.0, net_fill=0.0, confidence=0.0)

    # ── Scan fill ratio ───────────────────────────────────────────────
    scan_fill = _inner_fill(image, px_scan, py_scan, pw_scan, ph_scan)

    # ── Template baseline fill (border-only contribution) ─────────────
    baseline_fill = 0.0
    if template_image is not None:
        t_h, t_w = template_image.shape[:2]
        px_t = max(0, min(px_tmpl, t_w - 1))
        py_t = max(0, min(py_tmpl, t_h - 1))
        pw_t = min(pw, t_w - px_t)
        ph_t = min(ph, t_h - py_t)
        if pw_t >= 2 and ph_t >= 2:
            baseline_fill = _inner_fill(template_image, px_t, py_t, pw_t, ph_t)

    net_fill = scan_fill - baseline_fill

    # ── Detection decision ────────────────────────────────────────────
    if template_image is not None:
        thr = threshold if threshold is not None else NET_THRESHOLD
        checked = net_fill >= thr
        margin = abs(net_fill - thr)
        confidence = min(1.0, margin / max(abs(thr), 1e-6))
    else:
        thr = threshold if threshold is not None else INNER_THRESHOLD
        checked = scan_fill >= thr
        margin = abs(scan_fill - thr)
        confidence = min(1.0, margin / max(thr, 1e-6))

    return CheckboxResult(
        checked=checked,
        fill_ratio=round(scan_fill, 4),
        net_fill=round(net_fill, 4),
        confidence=round(confidence, 3),
    )


def extract_region_image(
    image: np.ndarray,
    x: float,
    y: float,
    w: float,
    h: float,
    padding: float = 0.005,
    dx_px: int = 0,
    dy_px: int = 0,
) -> np.ndarray:
    """
    Crop a region from the image with optional padding.
    dx_px / dy_px apply the same per-page offset as detect_checkbox.
    """
    img_h, img_w = image.shape[:2]

    px = int((x - padding) * img_w) - dx_px
    py = int((y - padding) * img_h) - dy_px
    pw = int((w + 2 * padding) * img_w)
    ph = int((h + 2 * padding) * img_h)

    px = max(0, px)
    py = max(0, py)
    pw = min(pw, img_w - px)
    ph = min(ph, img_h - py)

    return image[py: py + ph, px: px + pw]
