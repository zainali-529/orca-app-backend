/**
 * PDF Quote Generator — PDFKit
 *
 * Generates a professional A4 PDF quote for UK energy broker clients.
 * Returns a Buffer that can be streamed to Cloudinary or downloaded directly.
 *
 * Design:
 *   - Header: brand navy bar with Energy Broker logo text + quote number
 *   - Section: Broker details (company name, contact)
 *   - Section: Client details
 *   - Section: Tariff details (supplier, type, rates)
 *   - Section: Cost breakdown table
 *   - Section: Savings summary (highlighted)
 *   - Footer: validity period, disclaimer, terms
 */

// ── Brand colours ────────────────────────────────────────────────
const BRAND = {
  navy:      '#0D2C40',
  blue:      '#2272A6',
  blueBrt:   '#3D9DD4',
  green:     '#22A660',
  grey:      '#6B7280',
  lightGrey: '#F3F4F6',
  border:    '#E0E0E0',
  text:      '#1A1A1A',
};

// ── Page constants ───────────────────────────────────────────────
const PAGE_WIDTH  = 595.28; // A4 points
const PAGE_HEIGHT = 841.89;
const MARGIN      = 50;
const CONTENT_W   = PAGE_WIDTH - MARGIN * 2;

/**
 * Generate PDF for a quote.
 *
 * @param {object} quote - Mongoose Quote document (lean or with virtuals)
 * @param {object} brokerProfile - UserProfile document
 * @param {object} brokerUser - User document (name, email)
 * @returns {Promise<Buffer>}
 */
const generateQuotePdf = (quote, brokerProfile, brokerUser) => {
  return new Promise((resolve, reject) => {
    let PDFDocument;
    try {
      PDFDocument = require('pdfkit');
    } catch {
      return reject(new Error('pdfkit not installed. Run: npm install pdfkit'));
    }

    const doc    = new PDFDocument({ size: 'A4', margin: 0, info: {
      Title:    `Energy Quote ${quote.quoteNumber}`,
      Author:   `${brokerUser.firstName} ${brokerUser.lastName}`,
      Subject:  'Energy Tariff Quote',
      Keywords: 'energy, quote, tariff, UK',
    }});

    const chunks = [];
    doc.on('data',  (c) => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const { client, tariff, pricing } = quote;
    const brokerName    = `${brokerUser.firstName} ${brokerUser.lastName}`;
    const brokerCompany = brokerProfile?.companyName ?? 'Energy Broker';
    const brokerEmail   = brokerUser.email;
    const brokerPhone   = brokerUser.phone ?? brokerProfile?.businessPhone ?? '';

    // ── HEADER BAR ──────────────────────────────────────────────
    doc
      .rect(0, 0, PAGE_WIDTH, 90)
      .fill(BRAND.navy);

    doc
      .fillColor('#FFFFFF')
      .font('Helvetica-Bold')
      .fontSize(22)
      .text('⚡ Energy Broker', MARGIN, 24);

    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#7AAEC8')
      .text('Professional Energy Comparison & Quotation', MARGIN, 50);

    // Quote number top-right
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#FFFFFF')
      .text(quote.quoteNumber, PAGE_WIDTH - MARGIN - 120, 28, { width: 120, align: 'right' });

    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#7AAEC8')
      .text(`Generated: ${new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}`, PAGE_WIDTH - MARGIN - 120, 48, { width: 120, align: 'right' });

    // ── BLUE ACCENT BAR ─────────────────────────────────────────
    doc
      .rect(0, 90, PAGE_WIDTH, 5)
      .fill(BRAND.blue);

    let y = 115;

    // ── STATUS BADGE ────────────────────────────────────────────
    const statusColor = {
      draft:    '#696969',
      sent:     BRAND.blue,
      accepted: BRAND.green,
      rejected: '#B74700',
      expired:  '#B74700',
    }[quote.status] ?? BRAND.grey;

    doc
      .rect(MARGIN, y, 70, 20)
      .fill(statusColor);
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#FFFFFF')
      .text(quote.status.toUpperCase(), MARGIN + 5, y + 6, { width: 60, align: 'center' });

    // Validity
    if (quote.validUntil) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(BRAND.grey)
        .text(`Valid until: ${new Date(quote.validUntil).toLocaleDateString('en-GB', { day:'2-digit', month:'long', year:'numeric' })}`, MARGIN + 80, y + 5);
    }

    y += 35;

    // ── TWO COLUMN: BROKER | CLIENT ─────────────────────────────
    const colW = (CONTENT_W - 20) / 2;

    // Broker card
    doc
      .rect(MARGIN, y, colW, 90)
      .fill(BRAND.lightGrey);

    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(BRAND.navy)
      .text('BROKER / AGENT', MARGIN + 12, y + 12);

    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(BRAND.text)
      .text(brokerName, MARGIN + 12, y + 26);

    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(BRAND.text)
      .text(brokerCompany, MARGIN + 12, y + 42);

    if (brokerEmail) {
      doc
        .fontSize(9)
        .fillColor(BRAND.grey)
        .text(brokerEmail, MARGIN + 12, y + 56);
    }
    if (brokerPhone) {
      doc
        .fontSize(9)
        .fillColor(BRAND.grey)
        .text(brokerPhone, MARGIN + 12, y + 68);
    }

    // Client card
    const colX = MARGIN + colW + 20;
    doc
      .rect(colX, y, colW, 90)
      .fill(BRAND.lightGrey);

    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(BRAND.navy)
      .text('PREPARED FOR', colX + 12, y + 12);

    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(BRAND.text)
      .text(client.name, colX + 12, y + 26);

    if (client.company) {
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(BRAND.text)
        .text(client.company, colX + 12, y + 42);
    }

    if (client.email) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(BRAND.grey)
        .text(client.email, colX + 12, y + (client.company ? 56 : 42));
    }

    if (client.mpan || client.mprn) {
      const meterY = y + (client.company ? 68 : 56);
      const meterText = [
        client.mpan  ? `MPAN: ${client.mpan}` : null,
        client.mprn  ? `MPRN: ${client.mprn}` : null,
      ].filter(Boolean).join('  |  ');
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(BRAND.grey)
        .text(meterText, colX + 12, meterY);
    }

    y += 110;

    // ── TARIFF DETAILS ──────────────────────────────────────────
    sectionHeader(doc, 'TARIFF DETAILS', y);
    y += 28;

    // Supplier row
    const tariffRows = [
      { label: 'Supplier',          value: tariff.supplier },
      { label: 'Tariff Name',       value: tariff.tariffName },
      { label: 'Tariff Type',       value: capitalize(tariff.tariffType) },
      { label: 'Fuel Type',         value: capitalize(tariff.fuelType) },
      { label: 'Contract Length',   value: tariff.contractLengthMonths > 0 ? `${tariff.contractLengthMonths} months` : 'No fixed term' },
      { label: 'Exit Fee',          value: tariff.exitFee > 0 ? `£${tariff.exitFee} per fuel` : 'No exit fee' },
      { label: 'Green Energy',      value: tariff.isGreen ? '✓ Yes — renewable' : 'Standard' },
      { label: 'Data Source',       value: tariff.dataLabel ?? 'Indicative rate' },
    ];

    if (tariff.cashback > 0) {
      tariffRows.push({ label: 'Cashback', value: `£${tariff.cashback}`, highlight: true });
    }

    y = tableRows(doc, tariffRows, y, MARGIN, CONTENT_W);
    y += 12;

    // ── UNIT RATES ──────────────────────────────────────────────
    sectionHeader(doc, 'UNIT RATES (incl. 5% VAT)', y);
    y += 28;

    const rateRows = [];

    if (tariff.electricity?.unitRate) {
      rateRows.push({ label: '⚡ Electricity Unit Rate',   value: `${tariff.electricity.unitRate}p per kWh` });
      rateRows.push({ label: '⚡ Electricity Standing Charge', value: `${tariff.electricity.standingCharge}p per day` });
    }
    if (tariff.gas?.unitRate) {
      rateRows.push({ label: '🔥 Gas Unit Rate',          value: `${tariff.gas.unitRate}p per kWh` });
      rateRows.push({ label: '🔥 Gas Standing Charge',    value: `${tariff.gas.standingCharge}p per day` });
    }

    y = tableRows(doc, rateRows, y, MARGIN, CONTENT_W);
    y += 12;

    // ── COST ESTIMATE ───────────────────────────────────────────
    sectionHeader(doc, 'ESTIMATED ANNUAL COSTS', y);
    y += 28;

    const costRows = [];

    if (pricing.annualElectricityKwh) {
      costRows.push({ label: 'Annual Electricity Usage', value: `${pricing.annualElectricityKwh.toLocaleString()} kWh` });
    }
    if (pricing.annualGasKwh) {
      costRows.push({ label: 'Annual Gas Usage',         value: `${pricing.annualGasKwh.toLocaleString()} kWh` });
    }
    if (pricing.electricityAnnualCost) {
      costRows.push({ label: 'Electricity Annual Cost',  value: `£${pricing.electricityAnnualCost.toLocaleString()}` });
    }
    if (pricing.gasAnnualCost) {
      costRows.push({ label: 'Gas Annual Cost',          value: `£${pricing.gasAnnualCost.toLocaleString()}` });
    }

    costRows.push({ label: 'Total Annual Cost',  value: `£${pricing.totalAnnualCost.toLocaleString()}`, highlight: true });
    costRows.push({ label: 'Monthly Average',    value: `£${pricing.monthlyAverage?.toLocaleString() ?? '—'}` });

    y = tableRows(doc, costRows, y, MARGIN, CONTENT_W);
    y += 12;

    // ── SAVINGS HIGHLIGHT BOX ────────────────────────────────────
    if (pricing.annualSaving && pricing.annualSaving > 0) {
      const boxH = 56;
      doc
        .rect(MARGIN, y, CONTENT_W, boxH)
        .fill(BRAND.green);

      doc
        .font('Helvetica-Bold')
        .fontSize(13)
        .fillColor('#FFFFFF')
        .text('💰 Estimated Annual Saving', MARGIN + 16, y + 10);

      doc
        .font('Helvetica-Bold')
        .fontSize(20)
        .fillColor('#FFFFFF')
        .text(`£${Math.round(pricing.annualSaving).toLocaleString()} per year`, PAGE_WIDTH / 2, y + 10, { width: CONTENT_W / 2 - 16, align: 'right' });

      if (pricing.monthlySaving) {
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor('rgba(255,255,255,0.85)')
          .text(`= £${Math.round(pricing.monthlySaving).toLocaleString()} per month`, MARGIN + 16, y + 34);
      }

      y += boxH + 12;
    }

    // ── NOTES ──────────────────────────────────────────────────
    if (quote.notes) {
      sectionHeader(doc, 'BROKER NOTES', y);
      y += 28;
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(BRAND.text)
        .text(quote.notes, MARGIN, y, { width: CONTENT_W, lineGap: 4 });
      y += doc.heightOfString(quote.notes, { width: CONTENT_W }) + 16;
    }

    // ── FOOTER ─────────────────────────────────────────────────
    const footerY = PAGE_HEIGHT - 80;

    doc
      .rect(0, footerY, PAGE_WIDTH, 1)
      .fill(BRAND.border);

    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(BRAND.grey)
      .text(
        'DISCLAIMER: This quote is for indicative purposes only. Rates are based on current market data and may vary. ' +
        'Actual costs depend on your exact usage patterns and may change due to Ofgem price cap adjustments. ' +
        'Live Octopus rates sourced directly from their API; all other rates based on Ofgem price cap estimates. ' +
        'This document does not constitute a binding contract. Contact your energy supplier to confirm final rates.',
        MARGIN,
        footerY + 10,
        { width: CONTENT_W, lineGap: 2 }
      );

    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(BRAND.grey)
      .text(
        `${brokerCompany}  ·  ${brokerEmail}  ·  Quote ${quote.quoteNumber}  ·  Valid until ${
          quote.validUntil
            ? new Date(quote.validUntil).toLocaleDateString('en-GB')
            : 'N/A'
        }`,
        MARGIN,
        footerY + 48,
        { width: CONTENT_W, align: 'center' }
      );

    // Page number
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(BRAND.grey)
      .text('Page 1 of 1', PAGE_WIDTH - MARGIN - 60, footerY + 48);

    doc.end();
  });
};

// ── Helper: section header bar ─────────────────────────────────
const sectionHeader = (doc, title, y) => {
  doc
    .rect(MARGIN, y, CONTENT_W, 22)
    .fill(BRAND.navy);

  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor('#FFFFFF')
    .text(title, MARGIN + 10, y + 7);
};

// ── Helper: alternating table rows ────────────────────────────
const tableRows = (doc, rows, startY, x, width) => {
  const rowH  = 22;
  const labelW = width * 0.45;
  let y = startY;

  rows.forEach((row, i) => {
    const bg = row.highlight
      ? '#EDF5FB'
      : i % 2 === 0 ? '#FFFFFF' : '#F9F8F6';

    doc.rect(x, y, width, rowH).fill(bg);

    // Label
    doc
      .font(row.highlight ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(9.5)
      .fillColor(BRAND.grey)
      .text(row.label, x + 10, y + 7, { width: labelW - 10 });

    // Value
    doc
      .font(row.highlight ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(9.5)
      .fillColor(row.highlight ? BRAND.blue : BRAND.text)
      .text(String(row.value), x + labelW, y + 7, { width: width - labelW - 10, align: 'right' });

    y += rowH;
  });

  return y;
};

// ── Helper: capitalize first letter ──────────────────────────
const capitalize = (str) =>
  str ? str.charAt(0).toUpperCase() + str.slice(1) : '';

module.exports = { generateQuotePdf };
