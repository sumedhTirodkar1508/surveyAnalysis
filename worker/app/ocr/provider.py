"""
OCR interface — Tesseract implementation.

PaddleOCR requires paddlepaddle which has no ARM Mac wheel and therefore
cannot be used in this environment. Tesseract is used as the primary engine.
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


class TesseractOcrProvider(OcrProvider):
    """Tesseract-based text recognition."""

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
    """Get the OCR provider (Tesseract)."""
    global _provider
    if _provider is None:
        _provider = TesseractOcrProvider()
        logger.info("Using Tesseract OCR provider")
    return _provider
