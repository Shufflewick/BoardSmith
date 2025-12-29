import type { GameStructure, CandidateFeature } from './types.js';
import { FEATURE_TEMPLATES, type FeatureTemplate } from './feature-templates.js';

/**
 * Generate all candidate features for a game based on its structure
 */
export function generateCandidateFeatures(structure: GameStructure): CandidateFeature[] {
  const features: CandidateFeature[] = [];
  const seenIds = new Set<string>();

  for (const template of FEATURE_TEMPLATES) {
    // Check if this template applies to the game structure
    if (!templateApplies(template, structure)) {
      continue;
    }

    // Generate features from this template
    const generated = template.generate(structure);

    // Add unique features
    for (const feature of generated) {
      if (!seenIds.has(feature.id)) {
        seenIds.add(feature.id);
        features.push(feature);
      }
    }
  }

  return features;
}

/**
 * Check if a template applies to the given game structure
 */
function templateApplies(template: FeatureTemplate, structure: GameStructure): boolean {
  const req = template.requires;

  // Check element type requirements
  if (req.elementType) {
    let hasEligibleType = false;
    for (const [, info] of structure.elementTypes) {
      if (req.ownership && !info.hasOwnership) continue;
      if (req.spatial && !info.isSpatial) continue;
      if (req.booleanProperty && info.booleanProperties.length === 0) continue;
      if (req.numericProperty && info.numericProperties.length === 0) continue;
      if (req.stringProperty && info.stringProperties.length === 0) continue;
      hasEligibleType = true;
      break;
    }
    if (!hasEligibleType) return false;
  }

  // Check player score requirement
  if (req.playerScore && structure.playerInfo.numericProperties.length === 0) {
    return false;
  }

  // Check multi-player requirement
  if (req.multiPlayer && structure.playerCount < 2) {
    return false;
  }

  // Check spatial requirement
  if (req.spatial && !structure.spatialInfo.hasBoard) {
    return false;
  }

  return true;
}

/**
 * Filter features by category
 */
export function filterFeaturesByCategory(
  features: CandidateFeature[],
  categories: CandidateFeature['category'][]
): CandidateFeature[] {
  const categorySet = new Set(categories);
  return features.filter(f => categorySet.has(f.category));
}

/**
 * Get feature summary statistics
 */
export function getFeatureSummary(features: CandidateFeature[]): Record<string, number> {
  const summary: Record<string, number> = {};

  for (const feature of features) {
    summary[feature.category] = (summary[feature.category] || 0) + 1;
  }

  summary.total = features.length;
  return summary;
}

/**
 * Print features (for debugging)
 */
export function printFeatures(features: CandidateFeature[]): void {
  console.log(`\n=== Generated Features (${features.length} total) ===\n`);

  const byCategory = new Map<string, CandidateFeature[]>();
  for (const feature of features) {
    if (!byCategory.has(feature.category)) {
      byCategory.set(feature.category, []);
    }
    byCategory.get(feature.category)!.push(feature);
  }

  for (const [category, categoryFeatures] of byCategory) {
    console.log(`\n--- ${category.toUpperCase()} (${categoryFeatures.length}) ---`);
    for (const feature of categoryFeatures) {
      console.log(`  ${feature.id}: ${feature.description}`);
    }
  }
}
