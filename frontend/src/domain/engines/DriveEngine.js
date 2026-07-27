// FOIA OS v2 — DriveEngine
// Pure business logic for Google Drive folder structure and file lifecycle.

import { DomainEngine } from './engine';

const STORAGE_STAGES = ['uploaded', 'stored_on_drive', 'verified', 'linked', 'available'];

const FOLDER_HIERARCHY = [
  '01_Requests',
  '02_Agency_Responses',
  '03_Evidence/CCTV',
  '03_Evidence/Body_Cam',
  '03_Evidence/Dash_Cam',
  '03_Evidence/Audio',
  '03_Evidence/Photos',
  '03_Evidence/Documents',
  '04_Emails',
  '05_Notes',
  '06_Final_Package',
];

const EVIDENCE_FOLDER_MAP = {
  cctv: '03_Evidence/CCTV',
  body_cam: '03_Evidence/Body_Cam',
  dash_cam: '03_Evidence/Dash_Cam',
  audio: '03_Evidence/Audio',
  photo: '03_Evidence/Photos',
  document: '03_Evidence/Documents',
  email: '04_Emails',
};

const FOLDER_LABELS = {
  '01_Requests': { ar: 'الطلبات', en: 'Requests' },
  '02_Agency_Responses': { ar: 'ردود الجهات', en: 'Agency Responses' },
  '03_Evidence/CCTV': { ar: 'كاميرات CCTV', en: 'CCTV' },
  '03_Evidence/Body_Cam': { ar: 'كاميرات الجسد', en: 'Body Cam' },
  '03_Evidence/Dash_Cam': { ar: 'كاميرات السيارات', en: 'Dash Cam' },
  '03_Evidence/Audio': { ar: 'تسجيلات صوتية', en: 'Audio' },
  '03_Evidence/Photos': { ar: 'صور', en: 'Photos' },
  '03_Evidence/Documents': { ar: 'مستندات', en: 'Documents' },
  '04_Emails': { ar: 'البريد الإلكتروني', en: 'Emails' },
  '05_Notes': { ar: 'ملاحظات', en: 'Notes' },
  '06_Final_Package': { ar: 'الحزمة النهائية', en: 'Final Package' },
};

class DriveEngineClass extends DomainEngine {
  constructor() {
    super('DriveEngine');
  }

  getFolderHierarchy() { return [...FOLDER_HIERARCHY]; }

  getLabel(folder, lang = 'ar') {
    return FOLDER_LABELS[folder]?.[lang] || folder;
  }

  getEvidenceFolder(evidenceType) {
    return EVIDENCE_FOLDER_MAP[evidenceType] || '03_Evidence/Documents';
  }

  getStorageStages() { return [...STORAGE_STAGES]; }

  validateTransition(current, target) {
    const idx = STORAGE_STAGES.indexOf(current);
    const targetIdx = STORAGE_STAGES.indexOf(target);
    if (idx === -1 || targetIdx === -1) {
      return { valid: false, error: 'Invalid storage stage' };
    }
    if (targetIdx < idx) {
      return { valid: false, error: 'Storage stage cannot go backward' };
    }
    return { valid: true };
  }

  generatePath(evidenceType, filename) {
    const folder = this.getEvidenceFolder(evidenceType);
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${folder}/${safeName}`;
  }

  isAvailable(storageStage) {
    return storageStage === 'available' || storageStage === 'linked';
  }

  getFolderForCommunication(type) {
    if (type === 'email') return '04_Emails';
    if (type === 'letter') return '01_Requests';
    return '05_Notes';
  }

  // Build the complete folder structure for a new investigation
  buildFolderMap(rootFolderId) {
    const map = {};
    for (const folder of FOLDER_HIERARCHY) {
      map[folder] = null; // Will be populated with Drive folder IDs after creation
    }
    return { rootFolderId, folders: map };
  }
}

export const DriveEngine = new DriveEngineClass();
