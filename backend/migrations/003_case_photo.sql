-- Case photo: shown prominently on the case header and on its Pipeline
-- cards. Stored on Google Drive like every other case file (via
-- caseFileStorage.saveCaseFile), same as case_documents attachments --
-- photo_url is the same-origin /api/gdrive/image/:fileId proxy URL (Drive's
-- own webViewLink/webContentLink can't be embedded directly in an <img>,
-- see gdrive.js's existing imageProxyHandler and its comment for why).
ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS photo_drive_file_id text;
