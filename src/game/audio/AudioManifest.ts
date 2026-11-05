export type AudioKind = 'ui' | 'sfx' | 'voice' | 'announcer' | 'ambience'
// Initial mix: UI 0.6, SFX 0.8, voice 0.7, announcer 1.0, ambience 0.25.
const volume: Record<AudioKind, number> = { ui: 0.6, sfx: 0.8, voice: 0.7, announcer: 1, ambience: 0.25 }
const files = {
  'ui-cursor': ['ui', 'UI-01_cursor move.mp3'], 'ui-confirm': ['ui', 'UI-02_confirm.mp3'], 'ui-cancel': ['ui', 'UI-03_cancel.mp3'], 'ui-pause': ['ui', 'UI-04_pause.mp3'],
  'ann-round-1': ['announcer', 'ANN-01_Round 1.mp3'], 'ann-round-2': ['announcer', 'ANN-01_Round 2.mp3'], 'ann-final-round': ['announcer', 'ANN-01_Final Round.mp3'], 'ann-fight': ['announcer', 'ANN-02_Fight.mp3'],
  'ann-ko': ['announcer', 'ANN-03_KO.mp3'], 'ann-double-kill': ['announcer', 'ANN-04_Double Kill.mp3'], 'ann-times-up': ['announcer', 'ANN-05_Times Up.mp3'], 'ann-perfect': ['announcer', 'ANN-06_Perfect.mp3'], 'ann-draw': ['announcer', 'ANN-07_Draw Game.mp3'], 'ann-win': ['announcer', 'ANN-08_You Win.mp3'], 'ann-lose': ['announcer', 'ANN-08_You Lose.mp3'], 'ann-p1-wins': ['announcer', 'ANN-09_P1 Wins.mp3'], 'ann-p2-wins': ['announcer', 'ANN-09_P2 Wins.mp3'],
  'mov-miss-light': ['sfx', 'MOV-01_miss_light.mp3'], 'mov-miss-heavy': ['sfx', 'MOV-02_miss_heavy.mp3'], 'mov-jump': ['sfx', 'MOV-03_jump.mp3'],
  'hit-light': ['sfx', 'HIT-01_hit_light.flac'], 'hit-heavy': ['sfx', 'HIT-02_hit_heavy.flac'], 'hit-block': ['sfx', 'HIT-03_block.wav'], 'hit-prone': ['sfx', 'HIT-04_prone.flac'], 'hit-heavy-fx': ['sfx', 'HIT-05_heavy sfx.mp3'],
  'vo-attack-light': ['voice', 'VO-01_atk yell_light.mp3'], 'vo-attack-heavy': ['voice', 'VO-02_atk yell_heavy.mp3'], 'vo-hit-light': ['voice', 'VO-03_hit yell_light.ogg'], 'vo-hit-heavy': ['voice', 'VO-04_hit yell_heavy.ogg'], 'vo-ko': ['voice', 'VO-05_KO cry.mp3'],
  'amb-cheer': ['ambience', 'AMB-01_audience cheer.mp3'], 'amb-claps': ['ambience', 'AMB-01_claps.mp3'],
} as const satisfies Record<string, readonly [AudioKind, string]>
export type CueId = keyof typeof files
export const AUDIO_MANIFEST = Object.fromEntries(Object.entries(files).map(([id, [kind, file]]) => [id, { kind, volume: volume[kind], url: encodeURI(`/test-assets/audio/${file}`), loop: id === 'amb-cheer' }])) as Record<CueId, { kind: AudioKind; volume: number; url: string; loop: boolean }>
