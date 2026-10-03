export const DATA_COLOUR = '#FF8C00';
export const EXCEEDS_COLOUR = '#836AE1';
export const UNAVAILABLE_COLOUR = '#AEAEAF';
export const SELECTION_COLOUR = '#168AAD';

export const PARAMETER_COLOURS = Object.freeze({
  DO: DATA_COLOUR,
  TN: DATA_COLOUR,
  TP: DATA_COLOUR,
  TURB: DATA_COLOUR,
  PH: DATA_COLOUR,
});

export const STATUS_COLOURS = Object.freeze({
  within: DATA_COLOUR,
  outside: EXCEEDS_COLOUR,
  unavailable: UNAVAILABLE_COLOUR,
});

// Site identity is only used while comparing sites. Colour is always paired
// with a stable symbol in the plot and a matching outline in linked views.
export const COMPARISON_COLOURS = Object.freeze([
  '#8DD3C7',
  '#BEBADA',
  '#FB8072',
  '#80B1D3',
  '#FDB462',
]);

export const comparisonColour = (state, siteId) => {
  const slot = state.comparedSites?.get(siteId);
  return Number.isInteger(slot) ? COMPARISON_COLOURS[slot] : null;
};
