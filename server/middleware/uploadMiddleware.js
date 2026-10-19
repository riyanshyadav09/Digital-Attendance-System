const multer = require("multer");
const path = require("path");
const storage = multer.memoryStorage();

// Only allow image files
const fileFilter = (req, file, cb) => {

    const allowedMimeTypes = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp"
    ];

    const allowedExtensions = [
        ".jpg",
        ".jpeg",
        ".png",
        ".webp"
    ];

    const extension = path
        .extname(file.originalname)
        .toLowerCase();

    const isValidMimeType =
        allowedMimeTypes.includes(file.mimetype);

    const isValidExtension =
        allowedExtensions.includes(extension);


    if (isValidMimeType && isValidExtension) {
        cb(null, true);
    } else {
        const error = new Error("Only JPG, PNG, and WEBP images are allowed.");
        error.statusCode = 400;
        cb(error);
    }
};


// Multer configuration
const upload = multer({
    storage,
    fileFilter,

    limits: {
        fileSize: 5 * 1024 * 1024
    }
});


module.exports = upload;
