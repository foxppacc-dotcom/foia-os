#!/usr/bin/env python3
"""
FOIA OS Document Extractor
Extracts text from PDFs, images, and DOCX files using OCR.
Called by the Node.js backend via child_process.
"""

import sys
import os

def ocr_page_image(page):
    """Render a page (no real text layer) to an image and OCR it -- the
    common case for a scanned/photographed letter, which pymupdf's own
    get_text() never recovers since there's no text layer to read, only a
    picture of text."""
    try:
        from PIL import Image
        import pytesseract
        import io
        # get_pixmap() allocates memory proportional to width*height of the
        # RENDERED image, driven by the page's own declared size (its
        # /MediaBox) -- the Node caller bounds wall-clock time (90s timeout)
        # and input file size (20MB), but neither bounds this: a small PDF
        # can still declare an enormous page size, and dpi=200 applied to it
        # would allocate memory in proportion, independent of file size on
        # disk. Scale dpi down (never up) so the longer rendered edge never
        # exceeds MAX_DIMENSION_PX, regardless of what the page claims --
        # ordinary letter/A4-sized pages are unaffected (well under the cap
        # at the normal 200dpi).
        MAX_DIMENSION_PX = 6000
        DEFAULT_DPI = 200
        rect = page.rect
        longest_at_default_dpi = max(rect.width / 72 * DEFAULT_DPI, rect.height / 72 * DEFAULT_DPI, 1)
        dpi = DEFAULT_DPI if longest_at_default_dpi <= MAX_DIMENSION_PX else DEFAULT_DPI * MAX_DIMENSION_PX / longest_at_default_dpi
        pix = page.get_pixmap(dpi=dpi)
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        try:
            return pytesseract.image_to_string(img, lang='ara+eng').strip()
        except Exception:
            return pytesseract.image_to_string(img, lang='eng').strip()
    except Exception as e:
        return f"[OCR Error: {e}]"

def extract_pdf(path):
    """Extract text from PDF using pymupdf; OCR fallback per page when a
    page has no real text layer (confirmed live: a page with 0 text chars
    but a real embedded image is a scanned document, not a blank page)."""
    try:
        import pymupdf
        doc = pymupdf.open(path)
        text = ""
        for page in doc:
            page_text = page.get_text().strip()
            if not page_text:
                page_text = ocr_page_image(page)
            text += page_text
            text += "\n---PAGE BREAK---\n"
        return text.strip()
    except Exception as e:
        return f"PDF Error: {e}"

def extract_image(path):
    """Extract text from image using pytesseract"""
    try:
        from PIL import Image
        import pytesseract
        img = Image.open(path)
        # Try Arabic + English OCR
        try:
            text = pytesseract.image_to_string(img, lang='ara+eng')
        except:
            text = pytesseract.image_to_string(img, lang='eng')
        return text.strip()
    except Exception as e:
        return f"Image OCR Error: {e}"

def extract_docx(path):
    """Extract text from DOCX"""
    try:
        from docx import Document
        doc = Document(path)
        text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        return text.strip()
    except Exception as e:
        return f"DOCX Error: {e}"

def main():
    if len(sys.argv) < 2:
        print("Usage: extract_document.py <file_path>")
        sys.exit(1)
    
    file_path = sys.argv[1]
    if not os.path.exists(file_path):
        print(f"File not found: {file_path}")
        sys.exit(1)
    
    ext = os.path.splitext(file_path)[1].lower()
    
    if ext == '.pdf':
        text = extract_pdf(file_path)
    elif ext in ('.png', '.jpg', '.jpeg', '.tiff', '.bmp'):
        text = extract_image(file_path)
    elif ext == '.docx':
        text = extract_docx(file_path)
    elif ext == '.txt':
        with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
            text = f.read()
    else:
        text = f"Unsupported file type: {ext}"
    
    print(text)

if __name__ == '__main__':
    main()
