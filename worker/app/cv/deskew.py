"""
Deskew and alignment utilities.

Uses OpenCV to detect and correct document skew, and phase correlation to
find the per-page translation offset between a scan page and its template.

Registration strategy (phase correlation):
  - Edge-detect both template and scan to focus on STRUCTURAL elements
    (printed lines, borders, text blobs) rather than handwritten marks.
  - OpenCV phaseCorrelate finds the sub-pixel (dx, dy) translation.
  - Sanity-check: reject shifts > 10 % of image dimension.
  - Apply the shift as a pixel offset to every bbox coordinate before
    extracting fill ratios.

Why phase correlation instead of ORB/SIFT homography?
  - Homography (8 DOF) can produce wildly incorrect warps when feature
    matching fails on small, repetitive form content.
  - For same-format paper forms the dominant misalignment is translation
    (scanner placement).  Phase correlation nails translation in O(n log n)
    with no feature matching.
"""
import logging
import cv2
import numpy as np
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# Maximum allowed translation as a fraction of image dimension.
MAX_SHIFT_FRACTION = 0.12   # > 12 % → probably wrong → skip


def deskew_image(image: np.ndarray, max_angle_deg: float = 5.0) -> np.ndarray:
    """
    Detect and correct skew in a BGR or grayscale image.
    Returns a deskewed copy; returns the original if skew > max_angle_deg.

    max_angle_deg is kept at 5° because minAreaRect on a document full of
    horizontal text lines can misread the angle when skew is very small.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image.copy()

    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    coords = np.column_stack(np.where(thresh > 0))
    if len(coords) < 10:
        return image

    rect = cv2.minAreaRect(coords)
    angle = rect[2]

    if abs(angle) > max_angle_deg:
        return image
    if angle < -45:
        angle = 90 + angle
    if abs(angle) < 0.3:          # negligible skew — skip interpolation blur
        return image

    h, w = image.shape[:2]
    M = cv2.getRotationMatrix2D((w // 2, h // 2), angle, 1.0)
    return cv2.warpAffine(
        image, M, (w, h),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )


def find_page_translation(
    scan: np.ndarray,
    template: np.ndarray,
) -> Optional[Tuple[float, float]]:
    """
    Find the (dx, dy) pixel translation of *scan* relative to *template*
    using phase correlation on edge-detected images.

    Returns (dx, dy) such that scan content at pixel (x, y) corresponds to
    template content at (x + dx, y + dy).  Callers should subtract (dx, dy)
    from scan bbox coordinates, or equivalently add (dx, dy) to obtain the
    position of template bboxes in the scan's coordinate system.

    Returns None if the computed shift exceeds sanity bounds.
    """
    gray_s = cv2.cvtColor(scan, cv2.COLOR_BGR2GRAY) if len(scan.shape) == 3 else scan.astype(np.uint8)
    gray_t = cv2.cvtColor(template, cv2.COLOR_BGR2GRAY) if len(template.shape) == 3 else template.astype(np.uint8)

    # Resize to same dimensions if needed (should already match at 200 DPI)
    if gray_s.shape != gray_t.shape:
        gray_s = cv2.resize(gray_s, (gray_t.shape[1], gray_t.shape[0]))

    # Downscale for speed (translation result is then scaled back up)
    scale = 0.5
    h, w = gray_t.shape
    small_t = cv2.resize(gray_t, (int(w * scale), int(h * scale)))
    small_s = cv2.resize(gray_s, (int(w * scale), int(h * scale)))

    # Edge detect to suppress handwritten content and focus on form structure.
    # Blur first to reduce scan noise.
    blurred_t = cv2.GaussianBlur(small_t, (5, 5), 1.5)
    blurred_s = cv2.GaussianBlur(small_s, (5, 5), 1.5)
    edges_t = cv2.Canny(blurred_t, 30, 100).astype(np.float32)
    edges_s = cv2.Canny(blurred_s, 30, 100).astype(np.float32)

    # Phase correlation: finds shift of src2 (edges_s) relative to src1 (edges_t)
    # result: template[y + dy, x + dx] ≈ scan[y, x]
    (dx_small, dy_small), _response = cv2.phaseCorrelate(edges_t, edges_s)

    # Scale back to full resolution
    dx = dx_small / scale
    dy = dy_small / scale

    # Sanity check
    max_dx = w * MAX_SHIFT_FRACTION
    max_dy = h * MAX_SHIFT_FRACTION
    if abs(dx) > max_dx or abs(dy) > max_dy:
        logger.debug(
            f"find_page_translation: shift ({dx:.1f}, {dy:.1f}) exceeds "
            f"limit ({max_dx:.0f}, {max_dy:.0f}), ignoring"
        )
        return None

    logger.debug(f"find_page_translation: dx={dx:.1f} dy={dy:.1f}")
    return (dx, dy)


def align_to_template(
    scan: np.ndarray,
    template: np.ndarray,
) -> Optional[np.ndarray]:
    """
    DEPRECATED — kept for compatibility.  Prefer find_page_translation() +
    per-bbox offset instead of warping the whole image.

    Attempt to align `scan` to `template` using ORB feature matching + RANSAC.
    Returns None when alignment is unreliable.
    """
    gray_scan = cv2.cvtColor(scan, cv2.COLOR_BGR2GRAY) if len(scan.shape) == 3 else scan
    gray_tmpl = cv2.cvtColor(template, cv2.COLOR_BGR2GRAY) if len(template.shape) == 3 else template

    orb = cv2.ORB_create(nfeatures=3000)
    kp1, des1 = orb.detectAndCompute(gray_tmpl, None)
    kp2, des2 = orb.detectAndCompute(gray_scan, None)

    if des1 is None or des2 is None or len(kp1) < 15 or len(kp2) < 15:
        return None

    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    matches = bf.match(des1, des2)
    matches = sorted(matches, key=lambda x: x.distance)
    good = matches[: max(15, len(matches) // 2)]
    good = [m for m in good if m.distance < 64]

    if len(good) < 15:
        return None

    src_pts = np.float32([kp1[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst_pts = np.float32([kp2[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)

    H, mask = cv2.findHomography(dst_pts, src_pts, cv2.RANSAC, 4.0)
    if H is None or mask is None:
        return None

    inlier_ratio = mask.sum() / len(mask)
    MIN_INLIER_RATIO = 0.35
    if inlier_ratio < MIN_INLIER_RATIO:
        return None

    h_img, w_img = template.shape[:2]
    tx, ty = H[0, 2], H[1, 2]
    sx = np.sqrt(H[0, 0] ** 2 + H[1, 0] ** 2)
    sy = np.sqrt(H[0, 1] ** 2 + H[1, 1] ** 2)

    if abs(tx) > w_img * 0.10 or abs(ty) > h_img * 0.10:
        return None
    if not (0.80 <= sx <= 1.20 and 0.80 <= sy <= 1.20):
        return None

    return cv2.warpPerspective(scan, H, (w_img, h_img))
