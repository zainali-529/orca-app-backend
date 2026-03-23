const { PDFDocument: PDFLibDocument } = require('pdf-lib');
const PDFKitDocument = require('pdfkit');
const axios = require('axios');

const BRAND = {
  navy:      '#0D2C40',
  blue:      '#2272A6',
  grey:      '#6B7280',
  lightGrey: '#F3F4F6',
  border:    '#E0E0E0',
  text:      '#1A1A1A',
  white:     '#FFFFFF',
};

const PAGE_WIDTH  = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN      = 50;
const CONTENT_W   = PAGE_WIDTH - MARGIN * 2;

/**
 * Convert a base64 SVG/PNG/JPEG data URI to a PNG Buffer for PDFKit.
 */
const convertSignatureToPng = async (signatureDataUri) => {
  if (!signatureDataUri) return null;
  try {
    const sharp = require('sharp');
    const [meta, b64] = signatureDataUri.split(',');
    if (!b64 || b64.length < 50) return null;
    const inputBuffer = Buffer.from(b64, 'base64');

    return await sharp(inputBuffer)
      .resize(320, 120, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toBuffer();
  } catch (err) {
    console.warn('[PDF-SIGN] Signature conversion error:', err.message);
    return null;
  }
};

/**
 * Generate a standalone signature confirmation page using PDFKit.
 */
const generateSignaturePage = async (document) => {
  const { signerDetails, signature } = document;
  
  let signaturePngBuffer = null;
  if (signature?.data) {
    signaturePngBuffer = await convertSignatureToPng(signature.data);
  }
  
  const signedAt = signature?.signedAt
    ? new Date(signature.signedAt).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : new Date().toLocaleDateString('en-GB');

  return new Promise((resolve, reject) => {
    const doc = new PDFKitDocument({ size: 'A4', margin: 0 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, PAGE_WIDTH, 80).fill(BRAND.navy);
    doc.fillColor(BRAND.white).font('Helvetica-Bold').fontSize(18)
       .text('Signature Confirmation', MARGIN, 25);
    doc.font('Helvetica').fontSize(9).fillColor('#7AAEC8')
       .text(`Document Reference: ${document.docNumber}`, MARGIN, 50);

    let y = 110;

    // Signer Details
    doc.rect(MARGIN, y, CONTENT_W, 20).fill(BRAND.navy);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(BRAND.white).text('SIGNER DETAILS', MARGIN + 10, y + 6);
    y += 26;

    const rows = [
      { label: 'Full Name',    value: signerDetails?.fullName ?? 'N/A' },
      { label: 'Company',      value: signerDetails?.companyName ?? 'N/A' },
      { label: 'Email',        value: signerDetails?.email ?? 'N/A' },
      { label: 'IP Address',   value: signature?.ipAddress ?? 'Not recorded' },
      { label: 'Signed At',    value: signedAt },
      { label: 'User Agent',   value: signature?.userAgent ?? 'N/A' },
    ];

    rows.forEach((row, i) => {
      doc.rect(MARGIN, y, CONTENT_W, 20).fill(i % 2 === 0 ? BRAND.white : '#F9F8F6');
      doc.font('Helvetica').fontSize(9).fillColor(BRAND.grey).text(row.label, MARGIN + 10, y + 6);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(BRAND.text).text(String(row.value), MARGIN + 150, y + 6);
      y += 20;
    });

    y += 30;

    // Signature Image Section
    doc.rect(MARGIN, y, CONTENT_W, 20).fill(BRAND.navy);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(BRAND.white).text('DIGITAL SIGNATURE', MARGIN + 10, y + 6);
    y += 26;

    doc.rect(MARGIN, y, CONTENT_W, 120).fill(BRAND.lightGrey).stroke(BRAND.border);
    
    if (signaturePngBuffer) {
      try {
        doc.image(signaturePngBuffer, MARGIN + 20, y + 20, {
          width:  220,
          height: 60,
          fit:    [220, 60],
        });
      } catch (imgErr) {
        doc.font('Helvetica-Bold').fontSize(14).fillColor(BRAND.navy)
           .text('✓ Digitally Signed', MARGIN + 20, y + 45);
      }
    } else {
      doc.font('Helvetica-Bold').fontSize(14).fillColor(BRAND.navy)
         .text('✓ Digitally Signed', MARGIN + 20, y + 45);
    }

    doc.font('Helvetica').fontSize(8).fillColor(BRAND.grey)
       .text(`Electronic Signature ID: ${document._id}`, MARGIN + 20, y + 90);
    doc.font('Helvetica').fontSize(7).fillColor(BRAND.grey)
       .text('This signature is legally binding under the Electronic Communications Act 2000.', MARGIN + 20, y + 105);

    y += 150;

    // Legal Declaration
    doc.font('Helvetica-Bold').fontSize(10).fillColor(BRAND.text).text('Legal Declaration', MARGIN, y);
    y += 15;
    doc.font('Helvetica').fontSize(9).fillColor(BRAND.text).text(
      'By signing this document, the signer confirms they have reviewed the attached document ' +
      'and agree to its terms and conditions. The digital signature provided is a true ' +
      'representation of the signer\'s intent to execute the document.',
      MARGIN, y, { width: CONTENT_W, lineGap: 3 }
    );

    doc.end();
  });
};

/**
 * Append a signature page to an existing PDF buffer.
 */
const appendSignatureToPdf = async (existingPdfBuffer, document) => {
  try {
    // 1. Generate signature page
    const sigPageBuffer = await generateSignaturePage(document);

    // 2. Load both PDFs in pdf-lib
    const mainPdf = await PDFLibDocument.load(existingPdfBuffer);
    const sigPdf  = await PDFLibDocument.load(sigPageBuffer);

    // 3. Merge pages
    const mergedPdf = await PDFLibDocument.create();
    
    // Copy pages from original
    const mainPages = await mergedPdf.copyPages(mainPdf, mainPdf.getPageIndices());
    mainPages.forEach(page => mergedPdf.addPage(page));

    // Copy page from signature PDF
    const sigPages = await mergedPdf.copyPages(sigPdf, sigPdf.getPageIndices());
    sigPages.forEach(page => mergedPdf.addPage(page));

    // 4. Save and return buffer
    const pdfBytes = await mergedPdf.save();
    return Buffer.from(pdfBytes);
  } catch (err) {
    console.error('[PDF-SIGN] Error appending signature page:', err.message);
    throw err;
  }
};

module.exports = { appendSignatureToPdf };
