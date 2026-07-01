const multer = require('multer');

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB Limit
});

/**
 * Middleware wrapper to handle multer uploading and customize error handling
 * (like limiting file size to 5MB)
 * @param {string} fieldName - Form field name for file upload
 */
const uploadSingleImage = (fieldName) => {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ 
              success: false, 
              message: 'File is too large. Maximum size is 5MB.' 
            });
          }
          return res.status(400).json({ success: false, message: err.message });
        }
        return res.status(500).json({ success: false, message: err.message });
      }
      next();
    });
  };
};

module.exports = {
  upload,
  uploadSingleImage
};
