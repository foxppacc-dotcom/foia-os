import { useState, useCallback } from 'react';
import { uploadDocument, deleteDocument } from '../services/documentApi';
import { ModuleBridge } from '../../../domain/services/ModuleBridge';
import { detectFileType } from '../utils';

export function useDocuments(caseId, onUpdate) {
  const [newDoc, setNewDoc] = useState({ file: null, original_name: '', file_type: 'document', description: '' });
  const [previewFile, setPreviewFile] = useState(null);

  const addDocument = useCallback(async () => {
    if (!newDoc.file) return;
    try {
      const data = await uploadDocument(caseId, newDoc.file, newDoc.original_name, newDoc.file_type, newDoc.description);
      if (data.success) {
        setNewDoc({ file: null, original_name: '', file_type: 'document', description: '' });
        onUpdate(true); ModuleBridge.notifyCaseChanged(caseId, 'document.uploaded');
      } else alert('❌ ' + (data.error || 'فشل الرفع'));
    } catch (e) { alert('❌ ' + e.message); }
  }, [caseId, newDoc, onUpdate]);

  const removeDocument = useCallback(async (docId) => {
    if (!confirm('حذف الملف؟')) return;
    try { await deleteDocument(caseId, docId); onUpdate(true); ModuleBridge.notifyCaseChanged(caseId, 'document.deleted'); }
    catch (e) { alert('❌ ' + e.message); }
  }, [caseId, onUpdate]);

  return { newDoc, setNewDoc, previewFile, setPreviewFile, addDocument, removeDocument, detectFileType };
}
