import { useState, useCallback } from 'react';
import { createRequest, deleteRequest, classifyRequest } from '../services/requestApi';
import { ModuleBridge } from '../../../domain/services/ModuleBridge';

export function useRequests(caseId, onUpdate) {
  const [showAdd, setShowAdd] = useState(false);
  const [selectedAgencyId, setSelectedAgencyId] = useState('');

  const handleAdd = useCallback(async (agencyId) => {
    if (!agencyId) return;
    try { await createRequest(caseId, parseInt(agencyId)); setSelectedAgencyId(''); setShowAdd(false); onUpdate(true); ModuleBridge.notifyCaseChanged(caseId, 'request.added'); }
    catch (e) { alert('❌ ' + e.message); }
  }, [caseId, onUpdate]);

  const handleRemove = useCallback(async (reqId) => {
    if (!confirm('إزالة هذه الجهة من القضية؟')) return;
    try { await deleteRequest(caseId, reqId); onUpdate(true); ModuleBridge.notifyCaseChanged(caseId, 'request.removed'); }
    catch (e) { alert('❌ ' + e.message); }
  }, [caseId, onUpdate]);

  const handleClassify = useCallback(async (reqId, value) => {
    try { await classifyRequest(caseId, reqId, value); onUpdate(true); ModuleBridge.notifyCaseChanged(caseId, 'request.classified'); }
    catch (e) { /* silent */ }
  }, [caseId, onUpdate]);

  return { showAdd, setShowAdd, selectedAgencyId, setSelectedAgencyId, handleAdd, handleRemove, handleClassify };
}
