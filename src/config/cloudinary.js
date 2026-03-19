/**
 * Cloudinary Configuration
 *
 * Used for storing generated PDF quotes.
 *
 * Setup:
 *   1. Create free account at cloudinary.com
 *   2. Add to .env:
 *        CLOUDINARY_CLOUD_NAME=your_cloud_name
 *        CLOUDINARY_API_KEY=your_api_key
 *        CLOUDINARY_API_SECRET=your_api_secret
 *
 * PDFs are stored in the 'energy-broker/quotes' folder.
 * Cloudinary auto-generates a secure HTTPS URL for each upload.
 */

let cloudinary = null;
let isConfigured = false;

const init = () => {
  if (isConfigured) return cloudinary;

  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY    ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    console.warn('⚠  Cloudinary credentials not set — PDF upload disabled');
    console.warn('   Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET to .env');
    return null;
  }

  try {
    const { v2 } = require('cloudinary');
    v2.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key:    process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure:     true,
    });
    cloudinary = v2;
    isConfigured = true;
    console.log('Cloudinary configured ✓');
    return cloudinary;
  } catch (err) {
    console.warn('Cloudinary init failed:', err.message);
    return null;
  }
};

/**
 * Upload a PDF buffer to Cloudinary.
 *
 * @param {Buffer} buffer - PDF buffer from PDFKit
 * @param {string} filename - e.g. 'EB-2025-000001'
 * @returns {{ url: string, publicId: string } | null}
 */
const uploadPdf = async (buffer, filename) => {
  const cloud = init();
  if (!cloud) return null;

  return new Promise((resolve, reject) => {
    const uploadStream = cloud.uploader.upload_stream(
      {
        folder:        'energy-broker/quotes',
        public_id:     filename,
        resource_type: 'raw',        // PDFs are 'raw' in Cloudinary
        format:        'pdf',
        overwrite:     true,
        tags:          ['quote', 'pdf'],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({
          url:      result.secure_url,
          publicId: result.public_id,
        });
      }
    );

    uploadStream.end(buffer);
  });
};

/**
 * Delete a PDF from Cloudinary by publicId.
 *
 * @param {string} publicId - Cloudinary public_id
 */
const deletePdf = async (publicId) => {
  const cloud = init();
  if (!cloud || !publicId) return;

  try {
    await cloud.uploader.destroy(publicId, { resource_type: 'raw' });
    console.log(`Cloudinary: deleted ${publicId}`);
  } catch (err) {
    console.warn('Cloudinary delete failed:', err.message);
  }
};

/**
 * Get Cloudinary instance (for advanced use).
 */
const getCloudinary = () => init();

module.exports = { uploadPdf, deletePdf, getCloudinary, init };
