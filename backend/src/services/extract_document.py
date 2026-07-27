#!/usr/bin/env python3
"""
FOIA OS Document Extractor
Extracts text from PDFs, images, and DOCX files using OCR.
Called by the Node.js backend via child_process.
"""

import sys
import os

def extract_pdf(path):
    """Extract text from PDF using pymupdf"""
    try:
        import pymupdf
        doc = pymupdf.open(path)
        text = ""
        for page in doc:
            text += page.get_text()
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
