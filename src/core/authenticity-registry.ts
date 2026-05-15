/**
 * Authenticity Registry for GToM
 * Manages authenticity assessments
 */

import { logger } from './logger.js';

export interface AuthenticityAssessment {
  id: string;
  target: string;
  score: number;
  confidence: number;
  factors: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export class AuthenticityRegistry {
  private assessments: Map<string, AuthenticityAssessment> = new Map();

  register(assessment: AuthenticityAssessment): void {
    this.assessments.set(assessment.id, assessment);
    logger.info('Authenticity assessment registered', { id: assessment.id, target: assessment.target });
  }

  unregister(assessmentId: string): void {
    this.assessments.delete(assessmentId);
    logger.info('Authenticity assessment unregistered', { id: assessmentId });
  }

  get(assessmentId: string): AuthenticityAssessment | undefined {
    return this.assessments.get(assessmentId);
  }

  list(): AuthenticityAssessment[] {
    return Array.from(this.assessments.values());
  }

  findByTarget(target: string): AuthenticityAssessment[] {
    return this.list().filter(a => a.target === target);
  }

  update(assessmentId: string, updates: Partial<AuthenticityAssessment>): void {
    const assessment = this.assessments.get(assessmentId);
    if (assessment) {
      const updated = { ...assessment, ...updates, updatedAt: new Date() };
      this.assessments.set(assessmentId, updated);
      logger.info('Authenticity assessment updated', { id: assessmentId });
    }
  }

  clear(): void {
    this.assessments.clear();
    logger.info('AuthenticityRegistry cleared');
  }

  count(): number {
    return this.assessments.size;
  }

  getAverageScore(): number {
    const assessments = this.list();
    if (assessments.length === 0) return 0;
    return assessments.reduce((sum, a) => sum + a.score, 0) / assessments.length;
  }
}
