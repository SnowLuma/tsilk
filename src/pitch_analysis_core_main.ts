import * as D from './pitch_est_tables';
import { 
    SKP_Silk_resampler_down2, 
    SKP_Silk_resampler_down2_3, 
    SKP_Silk_resampler_down3 
} from './resampler_down';
import { 
    SKP_Silk_int16_array_maxabs, 
    SKP_Silk_inner_prod_aligned, 
    SKP_Silk_insertion_sort_decreasing_int16, 
    SKP_FIX_P_Ana_find_scaling,
    SKP_FIX_P_Ana_calc_corr_st3,
    SKP_FIX_P_Ana_calc_energy_st3
} from './pitch_analysis_core';
import { 
    SKP_ADD_SAT16, SKP_SQRT_APPROX as SKP_Silk_SQRT_APPROX, SKP_DIV32, 
    SKP_SMLAWB, SKP_SMULBB as SMULBB, SKP_SMULWB, SKP_LSHIFT as LSHIFT, 
    SKP_RSHIFT as RSHIFT, SKP_SAT16, SKP_ADD_POS_SAT32, SKP_max, SKP_min, 
    SKP_Silk_CLZ32 as CLZ32, SKP_LIMIT_32, SKP_ADD_SAT32, SKP_DIV32_16, 
    SKP_Silk_lin2log, SKP_MUL, SKP_LIMIT_int, SKP_max_int, SKP_min_int
} from './macros';

export function SKP_Silk_pitch_analysis_core(
    signal: Int16Array,             // I    Signal of length PITCH_EST_FRAME_LENGTH_MS*Fs_kHz
    pitch_out: Int32Array,          // O    4 pitch lag values
    pitch_out_offset: number,
    lagIndex_contourIndex: Int32Array, // O    [lagIndex, contourIndex]
    LTPCorr_Q15: Int32Array,        // I/O  Normalized correlation
    prevLag: number,                // I    Last lag of previous frame
    search_thres1_Q16: number,      // I    First stage threshold for lag candidates
    search_thres2_Q15: number,      // I    Final threshold for lag candidates
    Fs_kHz: number,                 // I    Sample frequency (kHz)
    complexity: number,             // I   Complexity setting
    forLJC: number                  // I     1 if this function is called from LJC code
): number {
    let signal_8kHz = new Int16Array(D.PITCH_EST_MAX_FRAME_LENGTH_ST_2);
    let signal_4kHz = new Int16Array(D.PITCH_EST_MAX_FRAME_LENGTH_ST_1);
    let scratch_mem = new Int32Array(3 * D.PITCH_EST_MAX_FRAME_LENGTH);
    let filt_state = new Int32Array(D.PITCH_EST_MAX_DECIMATE_STATE_LENGTH);
    let i: number, k: number, d: number, j: number;
    let C = new Array(D.PITCH_EST_NB_SUBFR).fill(0).map(() => new Int16Array((D.PITCH_EST_MAX_LAG >> 1) + 5));
    let cross_corr: number, normalizer: number, energy: number, shift: number;
    let d_srch = new Int32Array(D.PITCH_EST_D_SRCH_LENGTH);
    let d_comp = new Int16Array((D.PITCH_EST_MAX_LAG >> 1) + 5);
    let Cmax: number, length_d_srch: number, length_d_comp: number;
    let sum: number, threshold: number, temp32: number;
    
    let frame_length = D.PITCH_EST_FRAME_LENGTH_MS * Fs_kHz;
    let frame_length_4kHz = D.PITCH_EST_FRAME_LENGTH_MS * 4;
    let frame_length_8kHz = D.PITCH_EST_FRAME_LENGTH_MS * 8;
    let sf_length = frame_length >> 3;
    let sf_length_8kHz = frame_length_8kHz >> 3;
    let min_lag = D.PITCH_EST_MIN_LAG_MS * Fs_kHz;
    let min_lag_4kHz = D.PITCH_EST_MIN_LAG_MS * 4;
    let min_lag_8kHz = D.PITCH_EST_MIN_LAG_MS * 8;
    let max_lag = D.PITCH_EST_MAX_LAG_MS * Fs_kHz;
    let max_lag_4kHz = D.PITCH_EST_MAX_LAG_MS * 4;
    let max_lag_8kHz = D.PITCH_EST_MAX_LAG_MS * 8;

    /* Resample from input sampled at Fs_kHz to 8 kHz */
    if (Fs_kHz === 16) {
        SKP_Silk_resampler_down2(filt_state, 0, signal_8kHz, 0, signal, 0, frame_length);
    } else if (Fs_kHz === 12) {
        let R23 = new Int32Array(6);
        SKP_Silk_resampler_down2_3(R23, 0, signal_8kHz, 0, signal, 0, D.PITCH_EST_FRAME_LENGTH_MS * 12);
    } else if (Fs_kHz === 24) {
        let filt_state_fix = new Int32Array(8);
        SKP_Silk_resampler_down3(filt_state_fix, 0, signal_8kHz, 0, signal, 0, 24 * D.PITCH_EST_FRAME_LENGTH_MS);
    } else {
        signal_8kHz.set(signal.subarray(0, frame_length_8kHz));
    }

    /* Decimate again to 4 kHz */
    filt_state.fill(0);
    SKP_Silk_resampler_down2(filt_state, 0, signal_4kHz, 0, signal_8kHz, 0, frame_length_8kHz);

    /* Low-pass filter */
    for (i = frame_length_4kHz - 1; i > 0; i--) {
        signal_4kHz[i] = SKP_ADD_SAT16(signal_4kHz[i], signal_4kHz[i - 1]);
    }

    /* Inner product is calculated with different lengths, so scale for the worst case */
    let max_sum_sq_length = Math.max(sf_length_8kHz, frame_length_4kHz >> 1);
    shift = SKP_FIX_P_Ana_find_scaling(signal_4kHz, 0, frame_length_4kHz, max_sum_sq_length);
    if (shift > 0) {
        for (i = 0; i < frame_length_4kHz; i++) {
            signal_4kHz[i] = RSHIFT(signal_4kHz[i], shift);
        }
    }

    // --- STAGE 1: 4kHz correlation search ---
    let target_offset = frame_length_4kHz >> 1;
    for (k = 0; k < 2; k++) {
        let basis_offset = target_offset - min_lag_4kHz;

        cross_corr = SKP_Silk_inner_prod_aligned(signal_4kHz, target_offset, signal_4kHz, basis_offset, sf_length_8kHz);
        normalizer = SKP_Silk_inner_prod_aligned(signal_4kHz, basis_offset, signal_4kHz, basis_offset, sf_length_8kHz);
        normalizer = SKP_ADD_SAT32(normalizer, Math.imul(sf_length_8kHz, 4000));

        temp32 = SKP_DIV32(cross_corr, SKP_Silk_SQRT_APPROX(normalizer) + 1);
        C[k][min_lag_4kHz] = SKP_SAT16(temp32);

        for (d = min_lag_4kHz + 1; d <= max_lag_4kHz; d++) {
            basis_offset--;
            cross_corr = SKP_Silk_inner_prod_aligned(signal_4kHz, target_offset, signal_4kHz, basis_offset, sf_length_8kHz);
            normalizer += Math.imul(signal_4kHz[basis_offset], signal_4kHz[basis_offset]) - 
                          Math.imul(signal_4kHz[basis_offset + sf_length_8kHz], signal_4kHz[basis_offset + sf_length_8kHz]);
            
            temp32 = SKP_DIV32(cross_corr, SKP_Silk_SQRT_APPROX(normalizer) + 1);
            C[k][d] = SKP_SAT16(temp32);
        }
        target_offset += sf_length_8kHz;
    }

    /* Combine two subframes into single correlation measure and apply short-lag bias */
    for (i = max_lag_4kHz; i >= min_lag_4kHz; i--) {
        sum = C[0][i] + C[1][i];
        sum = RSHIFT(sum, 1);
        sum = SKP_SMLAWB(sum, sum, LSHIFT(-i, 4));
        C[0][i] = SKP_SAT16(sum);
    }

    length_d_srch = 4 + 2 * complexity;
    SKP_Silk_insertion_sort_decreasing_int16(C[0], min_lag_4kHz, d_srch, 0, max_lag_4kHz - min_lag_4kHz + 1, length_d_srch);

    target_offset = frame_length_4kHz >> 1;
    energy = SKP_Silk_inner_prod_aligned(signal_4kHz, target_offset, signal_4kHz, target_offset, frame_length_4kHz >> 1);
    energy = SKP_ADD_POS_SAT32(energy, 1000);
    Cmax = C[0][min_lag_4kHz];
    threshold = Math.imul(Cmax, Cmax); // Q-2
    
    if (RSHIFT(energy, 4 + 2) > threshold) {                            
        pitch_out.fill(0, pitch_out_offset, pitch_out_offset + D.PITCH_EST_NB_SUBFR);
        LTPCorr_Q15[0] = 0;
        lagIndex_contourIndex[0] = 0;
        lagIndex_contourIndex[1] = 0;
        return 1;
    }

    threshold = SKP_SMULWB(search_thres1_Q16, Cmax);
    for (i = 0; i < length_d_srch; i++) {
        if (C[0][min_lag_4kHz + i] > threshold) {
            d_srch[i] = (d_srch[i] + min_lag_4kHz) << 1;
        } else {
            length_d_srch = i;
            break;
        }
    }

    for (i = min_lag_8kHz - 5; i < max_lag_8kHz + 5; i++) {
        d_comp[i] = 0;
    }
    for (i = 0; i < length_d_srch; i++) {
        d_comp[d_srch[i]] = 1;
    }

    /* Convolution */
    for (i = max_lag_8kHz + 3; i >= min_lag_8kHz; i--) {
        d_comp[i] += d_comp[i - 1] + d_comp[i - 2];
    }

    length_d_srch = 0;
    for (i = min_lag_8kHz; i < max_lag_8kHz + 1; i++) {    
        if (d_comp[i + 1] > 0) {
            d_srch[length_d_srch] = i;
            length_d_srch++;
        }
    }

    /* Convolution */
    for (i = max_lag_8kHz + 3; i >= min_lag_8kHz; i--) {
        d_comp[i] += d_comp[i - 1] + d_comp[i - 2] + d_comp[i - 3];
    }

    length_d_comp = 0;
    for (i = min_lag_8kHz; i < max_lag_8kHz + 4; i++) {    
        if (d_comp[i] > 0) {
            d_comp[length_d_comp] = i - 2;
            length_d_comp++;
        }
    }

    // --- STAGE 2: operating at 8 kHz ---
    shift = SKP_FIX_P_Ana_find_scaling(signal_8kHz, 0, frame_length_8kHz, sf_length_8kHz);
    if (shift > 0) {
        for (i = 0; i < frame_length_8kHz; i++) {
            signal_8kHz[i] = RSHIFT(signal_8kHz[i], shift);
        }
    }

    for (k = 0; k < D.PITCH_EST_NB_SUBFR; k++) {
        C[k].fill(0);
    }

    target_offset = frame_length_4kHz;
    let lz: number, lshift: number, energy_basis: number, energy_target: number;
    for (k = 0; k < D.PITCH_EST_NB_SUBFR; k++) {
        energy_target = SKP_Silk_inner_prod_aligned(signal_8kHz, target_offset, signal_8kHz, target_offset, sf_length_8kHz);
        for (j = 0; j < length_d_comp; j++) {
            d = d_comp[j];
            let basis_offset = target_offset - d;
        
            cross_corr   = SKP_Silk_inner_prod_aligned(signal_8kHz, target_offset, signal_8kHz, basis_offset, sf_length_8kHz);
            energy_basis = SKP_Silk_inner_prod_aligned(signal_8kHz, basis_offset, signal_8kHz, basis_offset, sf_length_8kHz);
            if (cross_corr > 0) {
                energy = SKP_max(energy_target, energy_basis);
                lz = CLZ32(cross_corr);
                lshift = SKP_LIMIT_32(lz - 1, 0, 15);
                temp32 = SKP_DIV32(LSHIFT(cross_corr, lshift), RSHIFT(energy, 15 - lshift) + 1);
                temp32 = SKP_SMULWB(cross_corr, temp32);
                temp32 = SKP_ADD_SAT32(temp32, temp32);
                lz = CLZ32(temp32);
                lshift = SKP_LIMIT_32(lz - 1, 0, 15);
                energy = SKP_min(energy_target, energy_basis);
                C[k][d] = SKP_DIV32(LSHIFT(temp32, lshift), RSHIFT(energy, 15 - lshift) + 1);
            } else {
                C[k][d] = 0;
            }
        }
        target_offset += sf_length_8kHz;
    }

    let CC = new Int32Array(D.PITCH_EST_NB_CBKS_STAGE2_EXT);
    let CCmax: number = -2147483648;
    let CCmax_b: number = -2147483648;
    let CBimax = 0, CBimax_new = 0, CBimax_old = 0, lag = -1, lag_new = -1;
    let CCmax_new = -2147483648, CCmax_new_b = -2147483648;

    let prevLag_log2_Q7 = 0;
    if (prevLag > 0) {
        if (Fs_kHz === 12) prevLag = SKP_DIV32_16(LSHIFT(prevLag, 1), 3);
        else if (Fs_kHz === 16) prevLag = RSHIFT(prevLag, 1);
        else if (Fs_kHz === 24) prevLag = SKP_DIV32_16(prevLag, 3);
        prevLag_log2_Q7 = SKP_Silk_lin2log(prevLag);
    }

    let corr_thres_Q15 = RSHIFT(SMULBB(search_thres2_Q15, search_thres2_Q15), 13);
    let nb_cbks_stage2 = (Fs_kHz === 8 && complexity > 0) ? D.PITCH_EST_NB_CBKS_STAGE2_EXT : D.PITCH_EST_NB_CBKS_STAGE2;

    for (k = 0; k < length_d_srch; k++) {
        d = d_srch[k];
        for (j = 0; j < nb_cbks_stage2; j++) {
            CC[j] = 0;
            for (i = 0; i < D.PITCH_EST_NB_SUBFR; i++) {
                CC[j] += C[i][d + D.SKP_Silk_CB_lags_stage2[i][j]];
            }
        }
        
        CCmax_new = -2147483648;
        CBimax_new = 0;
        for (i = 0; i < nb_cbks_stage2; i++) {
            if (CC[i] > CCmax_new) {
                CCmax_new = CC[i];
                CBimax_new = i;
            }
        }

        let lag_log2_Q7 = SKP_Silk_lin2log(d);
        if (forLJC) {
            CCmax_new_b = CCmax_new;
        } else {
            CCmax_new_b = CCmax_new - RSHIFT(SMULBB(D.PITCH_EST_NB_SUBFR * D.PITCH_EST_SHORTLAG_BIAS_Q15, lag_log2_Q7), 7);
        }

        if (prevLag > 0) {
            let delta_lag_log2_sqr_Q7 = lag_log2_Q7 - prevLag_log2_Q7;
            delta_lag_log2_sqr_Q7 = RSHIFT(SMULBB(delta_lag_log2_sqr_Q7, delta_lag_log2_sqr_Q7), 7);
            let prev_lag_bias_Q15 = RSHIFT(SMULBB(D.PITCH_EST_NB_SUBFR * D.PITCH_EST_PREVLAG_BIAS_Q15, LTPCorr_Q15[0]), 15);
            prev_lag_bias_Q15 = SKP_DIV32(SKP_MUL(prev_lag_bias_Q15, delta_lag_log2_sqr_Q7), delta_lag_log2_sqr_Q7 + (1 << 6));
            CCmax_new_b -= prev_lag_bias_Q15;
        }

        if (CCmax_new_b > CCmax_b && CCmax_new > corr_thres_Q15 && D.SKP_Silk_CB_lags_stage2[0][CBimax_new] <= min_lag_8kHz) {
            CCmax_b = CCmax_new_b;
            CCmax = CCmax_new;
            lag = d;
            CBimax = CBimax_new;
        }
    }

    if (lag === -1) {
        pitch_out.fill(0, pitch_out_offset, pitch_out_offset + D.PITCH_EST_NB_SUBFR);
        LTPCorr_Q15[0] = 0;
        lagIndex_contourIndex[0] = 0;
        lagIndex_contourIndex[1] = 0;
        return 1;
    }

    if (Fs_kHz > 8) {
        shift = SKP_FIX_P_Ana_find_scaling(signal, 0, frame_length, sf_length);
        let input_signal_ptr: Int16Array;
        let input_signal_offset: number;
        if (shift > 0) {
            input_signal_ptr = new Int16Array(scratch_mem.buffer, 0, frame_length);
            for (i = 0; i < frame_length; i++) {
                input_signal_ptr[i] = RSHIFT(signal[i], shift);
            }
            input_signal_offset = 0;
        } else {
            input_signal_ptr = signal;
            input_signal_offset = 0;
        }

        CBimax_old = CBimax;
        if (Fs_kHz === 12) lag = RSHIFT(SMULBB(lag, 3), 1);
        else if (Fs_kHz === 16) lag = LSHIFT(lag, 1);
        else lag = SMULBB(lag, 3);
        
        lag = SKP_LIMIT_int(lag, min_lag, max_lag);
        let start_lag = SKP_max_int(lag - 2, min_lag);
        let end_lag = SKP_min_int(lag + 2, max_lag);
        lag_new = lag;
        CBimax = 0;

        let SQRT_CCmax = CCmax > 0 ? SKP_Silk_SQRT_APPROX(LSHIFT(CCmax, 13)) : 0;
        LTPCorr_Q15[0] = SQRT_CCmax;
        
        CCmax = -2147483648;
        for (k = 0; k < D.PITCH_EST_NB_SUBFR; k++) {
            pitch_out[pitch_out_offset + k] = lag + 2 * D.SKP_Silk_CB_lags_stage2[k][CBimax_old];
        }

        let crosscorr_st3 = new Int32Array(D.PITCH_EST_NB_SUBFR * D.PITCH_EST_NB_CBKS_STAGE3_MAX * D.PITCH_EST_NB_STAGE3_LAGS);
        let energies_st3  = new Int32Array(D.PITCH_EST_NB_SUBFR * D.PITCH_EST_NB_CBKS_STAGE3_MAX * D.PITCH_EST_NB_STAGE3_LAGS);

        SKP_FIX_P_Ana_calc_corr_st3(crosscorr_st3, input_signal_ptr, input_signal_offset, start_lag, sf_length, complexity);
        SKP_FIX_P_Ana_calc_energy_st3(energies_st3, input_signal_ptr, input_signal_offset, start_lag, sf_length, complexity);

        let lag_counter = 0;
        let contour_bias = SKP_DIV32_16(D.PITCH_EST_FLATCONTOUR_BIAS_Q20, lag);
        let cbk_size = D.SKP_Silk_cbk_sizes_stage3[complexity];
        let cbk_offset = D.SKP_Silk_cbk_offsets_stage3[complexity];

        for (d = start_lag; d <= end_lag; d++) {
            for (j = cbk_offset; j < cbk_offset + cbk_size; j++) {
                cross_corr = 0;
                energy = 0;
                for (k = 0; k < D.PITCH_EST_NB_SUBFR; k++) {
                    let idx = (k * D.PITCH_EST_NB_CBKS_STAGE3_MAX * D.PITCH_EST_NB_STAGE3_LAGS) + (j * D.PITCH_EST_NB_STAGE3_LAGS) + lag_counter;
                    energy += RSHIFT(energies_st3[idx], 2);
                    cross_corr += RSHIFT(crosscorr_st3[idx], 2);
                }
                if (cross_corr > 0) {
                    lz = CLZ32(cross_corr);
                    lshift = SKP_LIMIT_32(lz - 1, 0, 13);
                    CCmax_new = SKP_DIV32(LSHIFT(cross_corr, lshift), RSHIFT(energy, 13 - lshift) + 1);
                    CCmax_new = SKP_SAT16(CCmax_new);
                    CCmax_new = SKP_SMULWB(cross_corr, CCmax_new);
                    
                    if (CCmax_new > RSHIFT(2147483647, 3)) CCmax_new = 2147483647;
                    else CCmax_new = LSHIFT(CCmax_new, 3);

                    let diff = j - RSHIFT(D.PITCH_EST_NB_CBKS_STAGE3_MAX, 1);
                    diff = SKP_MUL(diff, diff);
                    diff = 32767 - RSHIFT(SKP_MUL(contour_bias, diff), 5); // Q15
                    CCmax_new = LSHIFT(SKP_SMULWB(CCmax_new, diff), 1);
                } else {
                    CCmax_new = 0;
                }

                if (CCmax_new > CCmax && (d + D.SKP_Silk_CB_lags_stage3[0][j]) <= max_lag) {
                    CCmax = CCmax_new;
                    lag_new = d;
                    CBimax = j;
                }
            }
            lag_counter++;
        }

        for (k = 0; k < D.PITCH_EST_NB_SUBFR; k++) {
            pitch_out[pitch_out_offset + k] = lag_new + D.SKP_Silk_CB_lags_stage3[k][CBimax];
        }
        lagIndex_contourIndex[0] = lag_new - min_lag;
        lagIndex_contourIndex[1] = CBimax;
    } else {
        CCmax = SKP_max(CCmax, 0);
        LTPCorr_Q15[0] = CCmax > 0 ? SKP_Silk_SQRT_APPROX(LSHIFT(CCmax, 13)) : 0;
        for (k = 0; k < D.PITCH_EST_NB_SUBFR; k++) {
            pitch_out[pitch_out_offset + k] = lag + D.SKP_Silk_CB_lags_stage2[k][CBimax];
        }
        lagIndex_contourIndex[0] = lag - min_lag_8kHz;
        lagIndex_contourIndex[1] = CBimax;
    }
    
    return 0; // Voiced
}
