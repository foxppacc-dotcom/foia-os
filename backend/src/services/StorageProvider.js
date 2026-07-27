/**
 * StorageProvider — Abstract storage layer.
 * Google Drive is the first provider. Future providers (S3, Azure Blob)
 * implement the same interface.
 */
class StorageProvider {
  async upload(file, metadata) { throw new Error('Not implemented'); }
  async uploadChunk(file, offset, total, metadata) { throw new Error('Not implemented'); }
  async createResumableSession(fileName, mimeType, folderId) { throw new Error('Not implemented'); }
  async download(fileId) { throw new Error('Not implemented'); }
  async delete(fileId) { throw new Error('Not implemented'); }
  async getSignedUrl(fileId, expiryMs) { throw new Error('Not implemented'); }
  async createFolder(name, parentId) { throw new Error('Not implemented'); }
  async createFolderHierarchy(caseId, template) { throw new Error('Not implemented'); }
  async listFolder(folderId) { throw new Error('Not implemented'); }
  async search(query) { throw new Error('Not implemented'); }
  async getMetadata(fileId) { throw new Error('Not implemented'); }
}

module.exports = StorageProvider;
