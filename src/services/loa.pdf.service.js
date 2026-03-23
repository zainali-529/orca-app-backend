/**
 * LOA PDF Generator — Fixed v4
 *
 * Fixes:
 *  1. SVG signature → PNG conversion using sharp (npm install sharp)
 *     SVG se directly PDFKit mein image embed nahi hoti —
 *     sharp se pehle PNG buffer mein convert karo, phir embed karo.
 *  2. bufferPages: true ensure karta hai complete buffer mile
 *  3. %PDF- header validation before resolve
 */

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

// ── SVG → PNG conversion ──────────────────────────────────────────
/**
 * Convert a base64 SVG/PNG/JPEG data URI to a PNG Buffer for PDFKit.
 * Returns null if conversion fails or sharp is not installed.
 */
const convertSignatureToPng = async (signatureDataUri) => {
  if (!signatureDataUri) return null;

  try {
    const sharp = require('sharp');

    const [meta, b64] = signatureDataUri.split(',');

    if (!b64 || b64.length < 50) return null;

    const inputBuffer = Buffer.from(b64, 'base64');

    if (meta.includes('svg')) {
      // SVG → PNG via sharp
      const pngBuffer = await sharp(inputBuffer)
        .resize(320, 120, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
        .png()
        .toBuffer();
      return pngBuffer;
    }

    if (meta.includes('png') || meta.includes('jpeg') || meta.includes('jpg')) {
      // Raster — resize to consistent dimensions
      const pngBuffer = await sharp(inputBuffer)
        .resize(320, 120, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
        .png()
        .toBuffer();
      return pngBuffer;
    }

    return null;
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      console.warn('[PDF] sharp not installed — signature image will be text placeholder.');
      console.warn('[PDF] Run: npm install sharp');
    } else {
      console.warn('[PDF] Signature conversion error:', err.message);
    }
    return null;
  }
};

// ── Main generator ────────────────────────────────────────────────
const generateLoaPdf = async (document, brokerProfile = null) => {
  let PDFDocument;
  try {
    PDFDocument = require('pdfkit');
  } catch {
    throw new Error('pdfkit not installed. Run: npm install pdfkit');
  }

  // Pre-convert signature BEFORE creating PDF stream
  // (async conversion must happen outside the PDFKit promise chain)
  let signaturePngBuffer = null;
  if (document.signature?.data) {
    signaturePngBuffer = await convertSignatureToPng(document.signature.data);
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size:        'A4',
      margin:      0,
      bufferPages: true,
      info: {
        Title:   `Letter of Authority — ${document.docNumber}`,
        Subject: 'Letter of Authority — UK Energy Switching',
        Author:  'Energy Broker',
      },
    });

    const chunks = [];
    doc.on('data',  (c) => chunks.push(c));
    doc.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const header = buffer.slice(0, 5).toString('ascii');
      if (header !== '%PDF-') {
        return reject(new Error(`Invalid PDF buffer — header: "${header}", size: ${buffer.length}`));
      }
      console.log(`[PDF] ${document.docNumber}: ${buffer.length} bytes`);
      resolve(buffer);
    });
    doc.on('error', reject);

    // ── Draw PDF ──────────────────────────────────────────────────
    const { signerDetails, signature, supplier, fuelType } = document;
    const brokerCompany = brokerProfile?.companyName ?? 'Energy Broker';

    const signedAt = signature?.signedAt
      ? new Date(signature.signedAt).toLocaleDateString('en-GB', {
          day: '2-digit', month: 'long', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        })
      : new Date().toLocaleDateString('en-GB');

    // HEADER
    doc.rect(0, 0, PAGE_WIDTH, 90).fill(BRAND.navy);
    doc.fillColor(BRAND.white).font('Helvetica-Bold').fontSize(20)
       .text('Letter of Authority', MARGIN, 22);

    let scopeText = 'UK Energy Switching — Client Authorisation Document';
    if (supplier || (fuelType && fuelType !== 'any')) {
      const parts = [];
      if (supplier) parts.push(supplier);
      if (fuelType && fuelType !== 'any')
        parts.push(fuelType.charAt(0).toUpperCase() + fuelType.slice(1) + ' only');
      scopeText = `Scope: ${parts.join(' · ')}`;
    }
    doc.font('Helvetica').fontSize(10).fillColor('#7AAEC8').text(scopeText, MARGIN, 48);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(BRAND.white)
       .text(document.docNumber, PAGE_WIDTH - MARGIN - 140, 22, { width: 140, align: 'right' });

    if (document.expiresAt) {
      const exp = new Date(document.expiresAt).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
      });
      doc.font('Helvetica').fontSize(9).fillColor('#7AAEC8')
         .text(`Valid until: ${exp}`, PAGE_WIDTH - MARGIN - 140, 42, { width: 140, align: 'right' });
    }

    doc.rect(0, 90, PAGE_WIDTH, 4).fill(BRAND.blue);
    let y = 110;

    // WHAT IS THIS
    sectionHeader(doc, 'WHAT IS THIS DOCUMENT?', y); y += 26;
    const scopeClause = supplier ? `specifically with ${supplier}` : 'with UK energy suppliers';
    const fuelClause  = fuelType && fuelType !== 'any' ? ` for your ${fuelType} supply` : '';
    doc.font('Helvetica').fontSize(10).fillColor(BRAND.text).text(
      `This Letter of Authority (LOA) authorises ${brokerCompany} to act on your behalf ` +
      `${scopeClause}${fuelClause}. By signing, you confirm consent to the actions listed below. ` +
      `This does NOT transfer ownership of your account or commit you to switching.`,
      MARGIN, y, { width: CONTENT_W, lineGap: 3 }
    );
    y += 70;

    // CLIENT DETAILS
    sectionHeader(doc, 'CLIENT DETAILS', y); y += 26;
    const addr = [
      signerDetails?.address?.line1,
      signerDetails?.address?.city,
      signerDetails?.address?.postcode,
    ].filter(Boolean).join(', ');

    y = tableRows(doc, [
      { label: 'Full Name',          value: signerDetails?.fullName        ?? 'N/A'          },
      { label: 'Company',            value: signerDetails?.companyName     ?? null            },
      { label: 'Email Address',      value: signerDetails?.email           ?? 'N/A'          },
      { label: 'Phone Number',       value: signerDetails?.phone           ?? 'N/A'          },
      { label: 'Address',            value: addr                           || 'N/A'          },
      { label: 'MPAN (Electricity)', value: signerDetails?.mpan            ?? 'Not provided'  },
      { label: 'MPRN (Gas)',         value: signerDetails?.mprn            ?? 'Not provided'  },
      { label: 'Current Supplier',   value: signerDetails?.currentSupplier ?? 'Not provided'  },
    ].filter(r => r.value !== null), y, MARGIN, CONTENT_W);
    y += 14;

    // SCOPE
    sectionHeader(doc, 'SCOPE OF AUTHORITY', y); y += 26;
    y = tableRows(doc, [
      { label: 'Authorised Agent', value: brokerCompany },
      { label: 'Supplier Scope',   value: supplier ?? 'All UK energy suppliers' },
      {
        label: 'Fuel Scope',
        value: fuelType === 'any'         ? 'Electricity and Gas'
             : fuelType === 'dual'        ? 'Electricity and Gas (Dual Fuel)'
             : fuelType === 'electricity' ? 'Electricity only'
             : fuelType === 'gas'         ? 'Gas only'
             : 'All energy',
      },
      { label: 'Prepared by', value: document.sentByAdmin ? 'Broker (sent to client)' : 'Client (self-initiated)' },
    ], y, MARGIN, CONTENT_W);
    y += 14;

    // AUTHORISED ACTIONS
    sectionHeader(doc, 'I AUTHORISE THE ABOVE TO:', y); y += 26;
    const actions = [
      'Obtain energy quotes on my behalf from UK energy suppliers',
      'Contact energy suppliers to obtain current rate and tariff information',
      'Initiate the energy switching process on my behalf',
      'Access meter point data (MPAN/MPRN) associated with my supply address',
      'Receive supplier correspondence on my behalf relating to energy switching',
    ];
    for (const action of actions) {
      doc.rect(MARGIN, y + 5, 6, 6).fill(BRAND.blue);
      doc.font('Helvetica').fontSize(10).fillColor(BRAND.text)
         .text(action, MARGIN + 16, y, { width: CONTENT_W - 16, lineGap: 2 });
      y += 22;
    }
    y += 10;

    // SIGNATURE BOX
    sectionHeader(doc, 'SIGNATURE', y); y += 26;
    doc.rect(MARGIN, y, CONTENT_W, 90).fill(BRAND.lightGrey);
    doc.rect(MARGIN, y, CONTENT_W, 90).stroke(BRAND.border);
    doc.font('Helvetica').fontSize(9).fillColor(BRAND.grey)
       .text('Client Signature:', MARGIN + 10, y + 8);

    // ── Embed signature image (pre-converted PNG buffer) ──────────────
    if (signaturePngBuffer && signaturePngBuffer.length > 100) {
      try {
        doc.image(signaturePngBuffer, MARGIN + 10, y + 18, {
          width:  220,
          height: 60,
          fit:    [220, 60],
        });
      } catch (imgErr) {
        console.warn('[PDF] Image embed error:', imgErr.message);
        // Fallback text
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#0D2C40')
           .text('✓ Digitally Signed', MARGIN + 10, y + 35);
      }
    } else if (signature?.data) {
      // sharp not available — show text indicator
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#0D2C40')
         .text('✓ Digitally Signed', MARGIN + 10, y + 30);
      doc.font('Helvetica').fontSize(8).fillColor(BRAND.grey)
         .text('(Digital signature stored securely)', MARGIN + 10, y + 50);
    } else {
      doc.font('Helvetica-Oblique').fontSize(11).fillColor(BRAND.grey)
         .text('[Pending signature]', MARGIN + 10, y + 38);
    }

    // Date + name on right / bottom
    doc.font('Helvetica').fontSize(9).fillColor(BRAND.grey)
       .text('Signed on:', PAGE_WIDTH - MARGIN - 160, y + 8);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(BRAND.text)
       .text(signedAt, PAGE_WIDTH - MARGIN - 160, y + 22, { width: 150 });
    doc.font('Helvetica').fontSize(9).fillColor(BRAND.grey)
       .text(signerDetails?.fullName ?? '', MARGIN + 10, y + 76, { width: 240 });
    y += 104;

    // LEGAL VALIDITY
    if (y + 100 < PAGE_HEIGHT - 90) {
      sectionHeader(doc, 'LEGAL VALIDITY', y); y += 26;
      y = tableRows(doc, [
        { label: 'Document Reference', value: document.docNumber },
        { label: 'Signed At',          value: signedAt },
        { label: 'IP Address',         value: signature?.ipAddress ?? 'Not recorded' },
        {
          label: 'Valid Until',
          value: document.expiresAt
            ? new Date(document.expiresAt).toLocaleDateString('en-GB', {
                day: '2-digit', month: 'long', year: 'numeric',
              })
            : 'N/A',
        },
      ], y, MARGIN, CONTENT_W);
    }

    // FOOTER
    const footerY = PAGE_HEIGHT - 78;
    doc.rect(0, footerY, PAGE_WIDTH, 1).fill(BRAND.border);
    doc.font('Helvetica').fontSize(7.5).fillColor(BRAND.grey).text(
      'DISCLAIMER: This LOA is valid for 6 months from signing. It authorises energy comparison and switching only. ' +
      'It does not authorise financial transactions or changes to billing details. ' +
      'You may withdraw authority at any time. Signed under the Electronic Communications Act 2000.',
      MARGIN, footerY + 8, { width: CONTENT_W, lineGap: 2 }
    );
    doc.font('Helvetica-Bold').fontSize(8).fillColor(BRAND.grey).text(
      `${brokerCompany}  ·  ${document.docNumber}  ·  ${signedAt}`,
      MARGIN, footerY + 52, { width: CONTENT_W, align: 'center' }
    );

    doc.end(); // triggers 'end' event → resolves promise
  });
};

const sectionHeader = (doc, title, y) => {
  doc.rect(MARGIN, y, CONTENT_W, 20).fill(BRAND.navy);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BRAND.white)
     .text(title, MARGIN + 10, y + 6);
};

const tableRows = (doc, rows, startY, x, width) => {
  const rowH   = 20;
  const labelW = width * 0.4;
  let y = startY;
  rows.forEach((row, i) => {
    if (!row.value) return;
    doc.rect(x, y, width, rowH).fill(i % 2 === 0 ? BRAND.white : '#F9F8F6');
    doc.font('Helvetica').fontSize(9).fillColor(BRAND.grey)
       .text(String(row.label), x + 10,     y + 6, { width: labelW - 10 });
    doc.font('Helvetica').fontSize(9).fillColor(BRAND.text)
       .text(String(row.value), x + labelW, y + 6, { width: width - labelW - 10 });
    y += rowH;
  });
  return y;
};

module.exports = { generateLoaPdf };