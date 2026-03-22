const cloudinary = require('cloudinary').v2;

/**
 * На Render часто задают одну строку CLOUDINARY_URL из дашборда.
 * Нельзя вызывать config({ cloud_name: undefined, ... }) — это затирает URL и даёт 500 при upload.
 */
if (process.env.CLOUDINARY_URL) {
  cloudinary.config({ secure: true });
} else if (
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
} else {
  console.error(
    '[Cloudinary] Задай в Render CLOUDINARY_URL или три переменные CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET'
  );
}

module.exports = cloudinary;
