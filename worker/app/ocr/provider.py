"""
OCR interface and PaddleOCR implementation.

Provides a simple interface for extracting text from image regions.
"""
import logging
import numpy as np
from abc import ABC, abstractmethod
from typing import Optional

logger = logging.getLogger(__name__)


class OcrProvider(ABC):
    """Abstract OCR provider interface."""

    @abstractmethod
    def recognize(self, image: np.ndarray) -> tuple[str, float]:
        """
        Run OCR on an image region.

        Returns:
            (text, confidence) where confidence is [0..1].
        """
        ...


class PaddleOcrProvider(OcrProvider):
    """PaddleOCR-based text recognition."""

    def __init__(self, lang: str = "en"):
        from paddleocr import PaddleOCR
        self._ocr = PaddleOCR(
            use_angle_cls=True,
            lang=lang,
            show_log=False,
        )

    def recognize(self, image: np.ndarray) -> tuple[str, float]:
        try:
            result = self._ocr.ocr(image, cls=True)
            if not result or not result[0]:
                return ("", 0.0)

            lines = []
            confidences = []
            for line in result[0]:
                # Each item: [[box], [text, confidence]]
                if len(line) >= 2 and line[1]:
                    text, conf = line[1]
                    lines.append(text.strip())
                    confidences.append(conf)

            full_text = " ".join(lines).strip()
            avg_conf = float(np.mean(confidences)) if confidences else 0.0
            return (full_text, round(avg_conf, 3))

        except Exception as e:
            logger.error(f"PaddleOCR error: {e}")
            return ("", 0.0)


class TesseractOcrProvider(OcrProvider):
    """Tesseract-based text recognition (fallback)."""

    def recognize(self, image: np.ndarray) -> tuple[str, float]:
        try:
            import pytesseract
            import cv2

            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image

            data = pytesseract.image_to_data(
                gray,
                output_type=pytesseract.Output.DICT,
                config="--psm 6",
            )

            texts = []
            confs = []
            for i, text in enumerate(data["text"]):
                if text.strip() and data["conf"][i] > 0:
                    texts.append(text.strip())
                    confs.append(data["conf"][i] / 100.0)

            full_text = " ".join(texts).strip()
            avg_conf = float(np.mean(confs)) if confs else 0.0
            return (full_text, round(avg_conf, 3))

        except Exception as e:
            logger.error(f"Tesseract error: {e}")
            return ("", 0.0)


# Singleton — initialized lazily
_provider: Optional[OcrProvider] = None


def get_ocr_provider() -> OcrProvider:
    """
    Get the default OCR provider. Tries PaddleOCR first, falls back to Tesseract.
    """
    global _provider
    if _provider is None:
        try:
            _provider = PaddleOcrProvider()
            logger.info("Using PaddleOCR provider")
        except Exception as e:
            logger.warning(f"PaddleOCR unavailable ({e}), falling back to Tesseract")
            _provider = TesseractOcrProvider()
    return _provider
