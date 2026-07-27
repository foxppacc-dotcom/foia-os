/**
 * Module Registry — Future: lazy-loadable feature modules.
 *
 * Each module registers itself with metadata so the domain layer
 * knows about all available modules without direct imports.
 *
 * Currently used for debugging and module discovery only.
 */

const registeredModules = new Map();

export function registerModule(name, metadata = {}) {
  registeredModules.set(name, {
    name,
    hooks: metadata.hooks || [],
    services: metadata.services || [],
    components: metadata.components || [],
    registeredAt: Date.now(),
  });
}

export function getModule(name) {
  return registeredModules.get(name);
}

export function getAllModules() {
  return Array.from(registeredModules.values());
}

// Register known modules
registerModule('case', {
  hooks: ['useCaseData', 'useChecklist', 'useDocuments', 'useAssignments'],
  services: ['caseApi', 'documentApi'],
  components: ['CaseHeader', '6 tabs', 'SectionCard', 'Row', 'FilePreview'],
});

registerModule('request', {
  hooks: ['useRequests'],
  services: ['requestApi'],
  components: [],
  constants: ['statuses', 'classification options'],
});
