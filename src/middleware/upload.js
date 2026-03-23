const multer = require('multer');

// Memory storage is better for Cloudinary as we don't need to save files locally
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  // Allow PDFs and common image formats for bills/ID proof
  if (
    file.mimetype === 'application/pdf' ||
    file.mimetype.startsWith('image/')
  ) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF and images are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

module.exports = upload;
