// Wing Remote v2.1 — State, Constants, LAYERS Config
// ── STATE ──────────────────────────────────────────
const state = {
  connected: false,
  recording: false,
  playing: false,
  armed: false,
  recSeconds: 0,
  recInterval: null,
  selectedChannel: 0,
  selectedStripType: 'ch',
  currentLayer: 'ch',
  channels: [],
  aux: [], buses: [], mains: [], matrix: [], dca: [],
  ws: null,
  meterAnimId: null,
};