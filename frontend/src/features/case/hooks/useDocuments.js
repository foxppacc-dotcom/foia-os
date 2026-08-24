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

  // Bulk delete previously called removeDocument() once per selected file --
  // each call opens its OWN blocking confirm() before its first await, so
  // selecting N files popped N sequential dialogs with no combined progress
  // or error report (dismissing dialog #3 of 10 left no way to tell which
  // of the first 10 actually got deleted). One confirm for the whole batch,
  // then delete in parallel, then report failures together.
  const removeDocuments = useCallback(async (docIds) => {
    if (!docIds.length) return;
    if (!confirm(`حذف ${docIds.length} ملف؟`)) return;
    const results = await Promise.allSettled(docIds.map(id => deleteDocument(caseId, id)));
    const failed = results.filter(r => r.status === 'rejected').length;
    onUpdate(true);
    ModuleBridge.notifyCaseChanged(caseId, 'document.deleted');
    if (failed) alert(`❌ فشل حذف ${failed} من ${docIds.length} ملف`);
  }, [caseId, onUpdate]);

  return { newDoc, setNewDoc, previewFile, setPreviewFile, addDocument, removeDocument, removeDocuments, detectFileType };
}
