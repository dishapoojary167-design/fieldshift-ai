export function classifyUsdaSoilTexture(
  sandPercent: number | null,
  siltPercent: number | null,
  clayPercent: number | null,
): string | null {
  if (
    sandPercent === null ||
    siltPercent === null ||
    clayPercent === null ||
    !Number.isFinite(sandPercent) ||
    !Number.isFinite(siltPercent) ||
    !Number.isFinite(clayPercent)
  ) {
    return null;
  }

  const total = sandPercent + siltPercent + clayPercent;
  if (total <= 0) {
    return null;
  }

  // Normalize to 100% in case of rounding drift across SoilGrids layers
  const sand = (sandPercent / total) * 100;
  const silt = (siltPercent / total) * 100;
  const clay = (clayPercent / total) * 100;

  if (clay >= 40) {
    if (sand <= 45 && silt < 40) {
      return 'Clay';
    }
    if (silt >= 40) {
      return 'Silty Clay';
    }
    return 'Sandy Clay';
  }

  if (clay >= 27) {
    if (sand <= 20) {
      return 'Silty Clay Loam';
    }
    if (sand <= 45) {
      return 'Clay Loam';
    }
    return 'Sandy Clay Loam';
  }

  if (clay >= 20) {
    if (silt < 28 && sand > 45) {
      return 'Sandy Clay Loam';
    }
    if (silt >= 50) {
      return 'Silt Loam';
    }
    return 'Loam';
  }

  if (clay < 12 && silt >= 80) {
    return 'Silt';
  }

  if (silt >= 50) {
    return 'Silt Loam';
  }

  if (clay >= 7 && silt >= 28 && silt < 50 && sand <= 52) {
    return 'Loam';
  }

  if (silt + 1.5 * clay < 15) {
    return 'Sand';
  }

  if (silt + 1.5 * clay >= 15 && silt + 2 * clay < 30) {
    return 'Loamy Sand';
  }

  return 'Sandy Loam';
}

export function describeWaterRetentionFromTexture(textureClass: string | null): string | null {
  if (!textureClass) {
    return null;
  }
  switch (textureClass) {
    case 'Sand':
    case 'Loamy Sand':
      return 'Low plant-available water holding capacity (~50–90 mm/m); rapid infiltration and high leaching sensitivity.';
    case 'Sandy Loam':
    case 'Sandy Clay Loam':
      return 'Moderate-low water holding capacity (~110–150 mm/m); drains reliably with moderate irrigation frequency needs.';
    case 'Loam':
    case 'Silt Loam':
    case 'Silt':
      return 'High plant-available water holding capacity (~170–220 mm/m); balanced aeration and moisture buffering.';
    case 'Clay Loam':
    case 'Silty Clay Loam':
      return 'Moderate-high water retention (~160–200 mm/m); slower internal drainage during sustained wet periods.';
    case 'Clay':
    case 'Silty Clay':
    case 'Sandy Clay':
      return 'High total water storage with narrow available range (~120–160 mm/m); high runoff/waterlogging risk when saturated.';
    default:
      return null;
  }
}
