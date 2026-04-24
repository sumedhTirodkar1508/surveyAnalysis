"""
Deskew and alignment utilities.

Uses OpenCV to detect and correct document skew before extraction.
"""
import cv2
import numpy as np
from typing import Optional


def deskew_image(image: np.ndarray, max_angle_deg: float = 10.0) -> np.ndarray:
    """
    Detect and correct skew in a grayscale or BGR image.
    Returns a deskewed copy of the image.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image.copy()

    # Threshold
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # Find all non-zero points
    coords = np.column_stack(np.where(thresh > 0))
    if len(coords) < 10:
        return image

    # Minimum area rectangle
    rect = cv2.minAreaRect(coords)
    angle = rect[2]

    # Clamp to ±max_angle_deg
    if abs(angle) > max_angle_deg:
        return image

    # Correct angle convention
    if angle < -45:
        angle = 90 + angle

    h, w = image.shape[:2]
    center = (w // 2, h // 2)
    M = cv2.getRotationMatrix2D(center, angle, 1.0)
    rotated = cv2.warpAffine(
        image, M, (w, h),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE
    )
    return rotated


def align_to_template(
    scan: np.ndarray,
    template: np.ndarray,
) -> Optional[np.ndarray]:
    """
    Attempt to align `scan` to `template` using feature matching (ORB + RANSAC homography).
    Returns aligned image or None if alignment fails.
    """
    gray_scan = cv2.cvtColor(scan, cv2.COLOR_BGR2GRAY) if len(scan.shape) == 3 else scan
    gray_tmpl = cv2.cvtColor(template, cv2.COLOR_BGR2GRAY) if len(template.shape) == 3 else template

    orb = cv2.ORB_create(nfeatures=2000)
    kp1, des1 = orb.detectAndCompute(gray_tmpl, None)
    kp2, des2 = orb.detectAndCompute(gray_scan, None)

    if des1 is None or des2 is None or len(kp1) < 10 or len(kp2) < 10:
        return None

    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    matches = bf.match(des1, des2)
    matches = sorted(matches, key=lambda x: x.distance)
    good_matches = matches[: min(200, len(matches))]

    if len(good_matches) < 10:
        return None

    src_pts = np.float32([kp1[m.queryIdx].pt for m in good_matches]).reshape(-1, 1, 2)
    dst_pts = np.float32([kp2[m.trainIdx].pt for m in good_matches]).reshape(-1, 1, 2)

    H, mask = cv2.findHomography(dst_pts, src_pts, cv2.RANSAC, 5.0)
    if H is None:
        return None

    h, w = template.shape[:2]
    aligned = cv2.warpPerspective(scan, H, (w, h))
    return aligned
