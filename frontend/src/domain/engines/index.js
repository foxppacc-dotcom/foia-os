// FOIA OS v2 — Domain Engine Index
// Central export for all business domain engines
// Pure business logic layer — No React, No Express, No SQL, No HTTP

export { DomainEngine, deriveLegacyStatus, validateLinearTransition } from './engine';

export { InvestigationEngine } from './InvestigationEngine';
export { EvidenceEngine } from './EvidenceEngine';
export { AgencyRequestEngine } from './AgencyRequestEngine';
export { CommunicationEngine } from './CommunicationEngine';
export { DriveEngine } from './DriveEngine';
export { ProductionEngine } from './ProductionEngine';
export { ActivityEngine, ACTION_TYPES } from './ActivityEngine';
export { AcquisitionEngine } from './AcquisitionEngine';
export { InformationRequirementEngine } from './InformationRequirementEngine';
export { OperationalDecisionEngine } from './OperationalDecisionEngine';

// ═══════════════════════════════════════════════════════════
// ORCHESTRATION EXAMPLES
// These show how engines chain together for business workflows.
// Each example is a pure function — takes data, returns data.
// ═══════════════════════════════════════════════════════════

export function orchestrateEvidenceVerification(evidence, investigator, context = {}) {
  // 1. EvidenceEngine validates and executes the transition
  const transition = EvidenceEngine.executeTransition(
    evidence.evidence_stage || 'identified',
    'verified',
    { hasDocument: context.hasDocument || false }
  );
  if (!transition.success) return { error: transition.error };

  // 2. ActivityEngine records the event
  const activity = ActivityEngine.record({
    type: 'evidence_stage_changed',
    detail: `${evidence.record_type}: → verified`,
    evidenceId: evidence.id,
    userId: investigator.id,
    userName: investigator.name,
    investigationId: evidence.case_id,
  });

  // 3. InvestigationEngine checks if all evidence is resolved
  const allResolved = EvidenceEngine.isInvestigationResolved(context.allEvidence || []);
  let stageTransition = null;
  if (allResolved) {
    stageTransition = InvestigationEngine.executeTransition(
      context.currentStage || 'collection',
      'verification'
    );
  }

  return {
    evidence: { ...evidence, evidence_stage: 'verified' },
    activity,
    investigationUpdate: stageTransition,
    allResolved,
  };
}

export function orchestrateDocumentUpload(file, evidenceItem, investigator, context = {}) {
  // 1. DriveEngine determines the correct folder
  const folderPath = DriveEngine.getEvidenceFolder(evidenceItem?.record_type || 'document');
  const drivePath = DriveEngine.generatePath(evidenceItem?.record_type || 'document', file.name);

  // 2. EvidenceEngine handles the auto-transition
  const transition = EvidenceEngine.executeTransition(
    evidenceItem?.evidence_stage || 'identified',
    'received',
    {}
  );

  // 3. InvestigationEngine checks for stage progression
  const progress = EvidenceEngine.getProgress(context.allEvidence || []);
  let autoStage = null;
  if (progress.percent >= 70) {
    autoStage = InvestigationEngine.getAutoTransition('progress_threshold_met');
  }

  // 4. ActivityEngine records the event
  const activity = ActivityEngine.record({
    type: 'document_uploaded',
    detail: `${file.name} → ${drivePath}`,
    documentId: context.documentId,
    evidenceId: evidenceItem?.id,
    userId: investigator.id,
    userName: investigator.name,
    investigationId: context.investigationId,
  });

  return {
    drivePath,
    folderPath,
    evidenceTransition: transition.success ? transition : null,
    investigationProgression: autoStage,
    activity,
  };
}

export function orchestrateAgencyCommunication(comm, context = {}) {
  // 1. CommunicationEngine validates
  const validation = CommunicationEngine.validate(comm);
  if (!validation.valid) return { error: validation.errors };

  // 2. AgencyRequestEngine updates request status
  const requestUpdate = context.requestId
    ? AgencyRequestEngine.transition(context.requestStatus || 'sent', 'awaiting_response')
    : null;

  // 3. EvidenceEngine checks if this communication triggers auto-transition
  let evidenceTransition = null;
  if (comm.direction === 'inbound' && context.evidenceId) {
    evidenceTransition = EvidenceEngine.getAutoTransition('email_received');
  }

  // 4. ActivityEngine records
  const activity = ActivityEngine.record({
    type: comm.direction === 'outbound' ? 'communication_sent' : 'communication_received',
    detail: `${comm.subject || 'No subject'} - ${comm.recipient || comm.sender}`,
    investigationId: comm.investigationId,
    requestId: comm.requestId,
    evidenceId: comm.evidenceId,
    userId: context.userId,
    userName: context.userName,
  });

  // 5. InvestigationEngine checks for follow-up scheduling
  const followUp = AgencyRequestEngine.calculateNextFollowUp(comm.sentAt || new Date().toISOString());

  return {
    requestUpdate: requestUpdate?.success ? requestUpdate : null,
    evidenceTransition,
    activity,
    nextFollowUp: followUp,
    timelineEntry: CommunicationEngine.createTimelineEntry(comm),
  };
}
