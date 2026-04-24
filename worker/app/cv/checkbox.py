"""
Checkbox detection using fill-ratio analysis.

For each bounding box region, compute the ratio of dark pixels.
A high fill-ratio (above threshold) indicates a checked box.
"""
import cv2
import numpy as np
from dataclasses import dataclass
from typing import Optional


@dataclass
class CheckboxResult:
    checked: bool
    fill_ratio: float
    confidence: float


def detect_checkbox(
    image: np.ndarray,
    x: float,
    y: float,
    w: float,
    h: float,
    threshold: float = 0.12,
) -> CheckboxResult:
    """
    Detect if a checkbox at relative coordinates (x, y, w, h) in [0,1] is checked.

    Args:
        image: Full page image (BGR or grayscale).
        x, y, w, h: Normalized bounding box [0..1].
        threshold: Fill ratio above which box is considered checked.

    Returns:
        CheckboxResult with checked status, fill_ratio, and confidence.
    """
    img_h, img_w = image.shape[:2]

    # Convert to pixel coords
    px = int(x * img_w)
    py = int(y * img_h)
    pw = int(w * img_w)
    ph = int(h * img_h)

    # Clamp
    px = max(0, min(px, img_w - 1))
    py = max(0, min(py, img_h - 1))
    pw = max(1, min(pw, img_w - px))
    ph = max(1, min(ph, img_h - py))

    # Crop region
    region = image[py: py + ph, px: px + pw]
    if region.size == 0:
        return CheckboxResult(checked=False, fill_ratio=0.0, confidence=0.0)

    # Convert to grayscale
    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY) if len(region.shape) == 3 else region

    # Adaptive threshold to binarize
    binary = cv2.adaptiveThreshold(
        gray, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        blockSize=11,
        C=4,
    )

    total_pixels = binary.size
    dark_pixels = int(np.sum(binary > 128))
    fill_ratio = dark_pixels / total_pixels if total_pixels > 0 else 0.0

    checked = fill_ratio >= threshold

    # Confidence: distance from threshold, capped at 1.0
    margin = abs(fill_ratio - threshold)
    confidence = min(1.0, margin / (threshold * 1.5) + 0.5)

    return CheckboxResult(checked=checked, fill_ratio=round(fill_ratio, 4), confidence=round(confidence, 3))


def extract_region_image(
    image: np.ndarray,
    x: float,
    y: float,
    w: float,
    h: float,
    padding: float = 0.005,
) -> np.ndarray:
    """
    Crop a region from the image with optional padding (relative units).
    Returns the cropped BGR/grayscale region.
    """
    img_h, img_w = image.shape[:2]

    px = int((x - padding) * img_w)
    py = int((y - padding) * img_h)
    pw = int((w + 2 * padding) * img_w)
    ph = int((h + 2 * padding) * img_h)

    px = max(0, px)
    py = max(0, py)
    pw = min(pw, img_w - px)
    ph = min(ph, img_h - py)

    return image[py: py + ph, px: px + pw]
