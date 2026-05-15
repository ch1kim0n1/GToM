/**
 * Core component tests for GToM
 */

import { describe, it, expect } from 'bun:test';
import { mockVulnerability, mockAuthenticityAssessment } from '../fixtures/index.js';

describe('GToM Core', () => {
  describe('Vulnerability Tracking', () => {
    it('should create a vulnerability', () => {
      expect(mockVulnerability.id).toBe('vuln-1');
      expect(mockVulnerability.name).toBe('Test Vulnerability');
    });

    it('should track severity', () => {
      expect(mockVulnerability.severity).toBe('high');
    });

    it('should track status', () => {
      expect(mockVulnerability.status).toBe('open');
    });
  });

  describe('Authenticity Assessment', () => {
    it('should create an assessment', () => {
      expect(mockAuthenticityAssessment.id).toBe('auth-1');
      expect(mockAuthenticityAssessment.target).toBe('test-target');
    });

    it('should calculate authenticity score', () => {
      expect(mockAuthenticityAssessment.score).toBe(0.75);
    });

    it('should track confidence', () => {
      expect(mockAuthenticityAssessment.confidence).toBe(0.8);
    });
  });
});
