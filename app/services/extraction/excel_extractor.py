from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd

from app.services.extraction.csv_extractor import CsvExtractor
from app.services.extraction.pdf_extractor import ExtractionResult

logger = logging.getLogger(__name__)


class ExcelExtractor:
    def __init__(self) -> None:
        self._csv = CsvExtractor()

    def extract(self, file_path: str | Path) -> ExtractionResult:
        result = ExtractionResult()
        try:
            xl = pd.ExcelFile(str(file_path))
            # Try each sheet, use the one with the most rows
            best_df: pd.DataFrame | None = None
            best_count = 0
            for sheet in xl.sheet_names:
                try:
                    df = xl.parse(sheet)
                    if len(df) > best_count:
                        best_count = len(df)
                        best_df = df
                except Exception:
                    continue

            if best_df is None:
                result.warnings.append("No readable sheet found in Excel file")
                return result

            result = self._csv._process_df(best_df)
        except Exception as e:
            logger.error(f"Excel extraction error: {e}")
            result.warnings.append(f"Extraction error: {str(e)}")
        return result


excel_extractor = ExcelExtractor()
