// Origem: exile-leveling (https://github.com/HeartofPhos/exile-leveling), commit b7b2dd0,
// arquivo common/src/route-processing/patterns.ts. Licença MIT, Copyright (c) 2025 HeartofPhos.
// O texto da licença está em leveling/terceiros/exile-leveling/LICENSE.
// Copiado sem mudanças (só este cabeçalho foi acrescentado).

export interface Pattern<T> {
  regex: RegExp;
  processor: (match: RegExpExecArray, context: T) => boolean;
}

export function matchPatterns<T>(
  text: string,
  patterns: Pattern<T>[],
  context: T
) {
  let currentIndex = 0;
  do {
    const lastIndex = matchAny<T>(text, currentIndex, patterns, context);

    if (lastIndex !== null) {
      currentIndex = lastIndex;
    } else {
      return false;
    }
  } while (currentIndex < text.length);

  return true;
}

function matchAny<T>(
  text: string,
  lastIndex: number,
  patterns: Pattern<T>[],
  context: T
) {
  for (const pattern of patterns) {
    pattern.regex.lastIndex = lastIndex;
    const match = pattern.regex.exec(text);

    if (match && match.index === lastIndex) {
      const continueParsing = pattern.processor(match, context);
      if (!continueParsing) return null;

      return pattern.regex.lastIndex;
    }
  }

  return null;
}
