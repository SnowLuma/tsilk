/**
 * Decode pitch lags
 * Ported from SKP_Silk_decode_pitch.c
 */
import { PITCH_EST_MIN_LAG_MS, PITCH_EST_NB_SUBFR, SKP_Silk_CB_lags_stage2, SKP_Silk_CB_lags_stage3 } from './tables/tables_pitch';

export function decodePitch(
    lagIndex: number,
    contourIndex: number,
    pitch_lags: Int32Array,
    Fs_kHz: number
): void {
    const min_lag = PITCH_EST_MIN_LAG_MS * Fs_kHz;
    const lag = min_lag + lagIndex;

    if (Fs_kHz === 8) {
        for (let i = 0; i < PITCH_EST_NB_SUBFR; i++) {
            pitch_lags[i] = lag + SKP_Silk_CB_lags_stage2[i][contourIndex];
        }
    } else {
        for (let i = 0; i < PITCH_EST_NB_SUBFR; i++) {
            pitch_lags[i] = lag + SKP_Silk_CB_lags_stage3[i][contourIndex];
        }
    }
}
