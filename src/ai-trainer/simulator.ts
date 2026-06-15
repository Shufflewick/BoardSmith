import type {
  GameStructure,
  ElementTypeInfo,
  SerializableGameStructure,
} from './types.js';

/**
 * Serialize a GameStructure for worker thread communication.
 * Converts Map and Set to plain objects/arrays for structured cloning.
 */
export function serializeGameStructure(structure: GameStructure): SerializableGameStructure {
  const elementTypes: SerializableGameStructure['elementTypes'] = {};

  for (const [key, info] of structure.elementTypes) {
    const stringEnums: Record<string, string[]> = {};
    for (const [enumKey, enumValues] of Object.entries(info.stringEnums)) {
      stringEnums[enumKey] = Array.from(enumValues);
    }

    elementTypes[key] = {
      className: info.className,
      numericProperties: info.numericProperties,
      booleanProperties: info.booleanProperties,
      stringProperties: info.stringProperties,
      hasOwnership: info.hasOwnership,
      isSpatial: info.isSpatial,
      stringEnums,
    };
  }

  return {
    elementTypes,
    playerInfo: structure.playerInfo,
    spatialInfo: structure.spatialInfo,
    playerCount: structure.playerCount,
    winConditionInfo: structure.winConditionInfo,
  };
}

/**
 * Deserialize a SerializableGameStructure back to a GameStructure.
 * Converts plain objects/arrays back to Map and Set.
 */
export function deserializeGameStructure(serialized: SerializableGameStructure): GameStructure {
  const elementTypes = new Map<string, ElementTypeInfo>();

  for (const [key, info] of Object.entries(serialized.elementTypes)) {
    const stringEnums: Record<string, Set<string>> = {};
    for (const [enumKey, enumValues] of Object.entries(info.stringEnums)) {
      stringEnums[enumKey] = new Set(enumValues);
    }

    elementTypes.set(key, {
      className: info.className,
      numericProperties: info.numericProperties,
      booleanProperties: info.booleanProperties,
      stringProperties: info.stringProperties,
      hasOwnership: info.hasOwnership,
      isSpatial: info.isSpatial,
      stringEnums,
    });
  }

  return {
    elementTypes,
    playerInfo: serialized.playerInfo,
    spatialInfo: serialized.spatialInfo,
    playerCount: serialized.playerCount,
    winConditionInfo: serialized.winConditionInfo,
  };
}
