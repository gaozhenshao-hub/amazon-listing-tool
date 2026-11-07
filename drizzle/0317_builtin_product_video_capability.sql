-- Align already-enabled built-in profiles with their existing product-video parser.
-- Paused/draft providers and other providers retain their administrator settings.
UPDATE acquisition_provider_profiles
SET capabilities = JSON_ARRAY_APPEND(capabilities, '$', 'product_video')
WHERE profile_key = 'builtin-amazon-images'
  AND provider_code = 'builtin.amazon.public_images'
  AND status = 'active'
  AND JSON_TYPE(capabilities) = 'ARRAY'
  AND JSON_CONTAINS(capabilities, JSON_QUOTE('image_gallery'))
  AND NOT JSON_CONTAINS(capabilities, JSON_QUOTE('product_video'));
