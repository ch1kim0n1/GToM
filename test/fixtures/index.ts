/**
 * Test fixtures for GToM
 */

export const mockVulnerability = {
  id: 'vuln-1',
  name: 'Test Vulnerability',
  description: 'A test vulnerability',
  severity: 'high',
  status: 'open',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

export const mockAuthenticityAssessment = {
  id: 'auth-1',
  target: 'test-target',
  score: 0.75,
  confidence: 0.8,
  factors: {},
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

export const mockTheoryOfMindModel = {
  id: 'tom-1',
  name: 'Test ToM Model',
  version: '1.0.0',
  parameters: {},
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};
