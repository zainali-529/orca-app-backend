/**
 * Cloudinary Config — Fixed
 *
 * Key fix: fl_attachment transformation REMOVED.
 * Cloudinary free/restricted accounts return:
 *   {"error":{"message":"Customer is marked as untrusted"}}
 * when any transformation flag is used on raw files.
 *
 * Solution: use secure_url directly — no transformations.
 * On mobile, Linking.openURL() handles PDF download correctly without fl_attachment.
 */

const cloudinaryLib = require('cloudinary').v2;

const isConfigured =
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET;

if (isConfigured) {
  cloudinaryLib.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure:     true,
  });
}

/**
 * Upload a file buffer to Cloudinary.
 *
 * @param {Buffer} buffer    - Complete file buffer
 * @param {string} publicId  - e.g. "LOA-2026-000004"
 * @param {string} folder    - Cloudinary folder
 * @returns {Promise<{ url: string, publicId: string } | null>}
 */
const uploadFile = (buffer, publicId, folder = 'energy-broker/documents') => {
  if (!isConfigured) {
    console.warn('[Cloudinary] Not configured — skipping upload');
    return Promise.resolve(null);
  }

  if (!buffer || buffer.length < 10) {
    console.error('[Cloudinary] Buffer too small:', buffer?.length);
    return Promise.resolve(null);
  }

  // Detect if it's a PDF
  const header = buffer.slice(0, 5).toString('ascii');
  const isPdf = header === '%PDF-';

  console.log(`[Cloudinary] Uploading ${publicId} (${buffer.length} bytes, isPdf: ${isPdf})`);

  return new Promise((resolve, reject) => {
    const options = {
      resource_type: isPdf ? 'raw' : 'image', // raw for PDFs, image for others
      public_id:     publicId,
      folder:        folder,
      overwrite:     true,
      type:          'upload',
      access_mode:   'public',
    };

    if (isPdf) options.format = 'pdf';

    const uploadStream = cloudinaryLib.uploader.upload_stream(
      options,
      (error, result) => {
        if (error) {
          console.error('[Cloudinary] Upload error:', error.message);
          return reject(error);
        }
        if (!result?.secure_url) {
          return reject(new Error('Cloudinary returned no URL'));
        }

        console.log(`[Cloudinary] Uploaded: ${result.secure_url}`);
        resolve({
          url:      result.secure_url,
          publicId: result.public_id,
        });
      }
    );

    const { Readable } = require('stream');
    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);
    readable.pipe(uploadStream);
  });
};

/**
 * Upload a PDF buffer to Cloudinary (Backward compat).
 */
const uploadPdf = (buffer, docNumber) => uploadFile(buffer, docNumber);

/**
 * Delete a file from Cloudinary.
 */
const deleteFile = async (publicId, resourceType = 'raw') => {
  if (!isConfigured || !publicId) return;
  try {
    await cloudinaryLib.uploader.destroy(publicId, { resource_type: resourceType });
    console.log(`[Cloudinary] Deleted: ${publicId}`);
  } catch (e) {
    console.error('[Cloudinary] Delete error:', e.message);
  }
};

/**
 * Delete a PDF from Cloudinary (Backward compat).
 */
const deletePdf = async (publicId) => deleteFile(publicId, 'raw');

module.exports = { uploadFile, uploadPdf, deleteFile, deletePdf };