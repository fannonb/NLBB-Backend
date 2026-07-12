update storage.buckets
set public = true
where id in (
  'provider-avatars',
  'provider-covers',
  'provider-gallery',
  'user-avatars'
);
