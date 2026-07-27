import { useCallback } from 'react';
import { updateChecklistItem } from '../services/caseApi';
import { ModuleBridge } from '../../../domain/services/ModuleBridge';

export function useChecklist(caseId, onUpdate) {
  const updateChecklist = useCallback(async (recordType, field, value, notes) => {
    const payload = { notes: notes || '' };
    payload[field] = value;
    try {
      await updateChecklistItem(caseId, recordType, payload);
      onUpdate(true);
      ModuleBridge.notifyCaseChanged(caseId, 'checklist.updated');
    } catch (e) { throw e; }
  }, [caseId, onUpdate]);

  // Direct save (no debounce — component handles debouncing)
  const saveNote = useCallback(async (recordType, notes) => {
    const payload = { notes: notes || '' };
    try {
      await updateChecklistItem(caseId, recordType, payload);
      onUpdate(true);
      ModuleBridge.notifyCaseChanged(caseId, 'checklist.updated');
    } catch (e) { throw e; }
  }, [caseId, onUpdate]);

  return { updateChecklist, debouncedSaveNote: saveNote };
}
