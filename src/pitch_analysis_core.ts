import * as D from './pitch_est_tables';
import { 
    SKP_Silk_CLZ32 as CLZ32, SKP_Silk_CLZ16, SKP_SMULBB as SMULBB,
    SKP_ADD_SAT32, SKP_max, SKP_min, SKP_LIMIT_int 
} from './macros';

const SCRATCH_SIZE = 22;

export function SKP_Silk_int16_array_maxabs(
    vec: Int16Array | number[],
    len: number
): number {
    let max = 0;
    for (let i = 0; i < len; i++) {
        let val = Math.abs(vec[i]);
        if (val > max) max = val;
    }
    return max;
}

export function SKP_Silk_inner_prod_aligned(
    vec1: Int16Array | number[], vec1_offset: number,
    vec2: Int16Array | number[], vec2_offset: number,
    len: number
): number {
    let sum = 0;
    for (let i = 0; i < len; i++) {
        sum += Math.imul(vec1[vec1_offset + i], vec2[vec2_offset + i]);
    }
    return sum;
}

export function SKP_Silk_insertion_sort_decreasing_int16(
    a: Int16Array, a_offset: number,
    idx: Int32Array, idx_offset: number,
    L: number,
    K: number
): void {
    let i: number, j: number;
    let value: number;
    
    // Sort first K elements
    for (i = 0; i < K; i++) {
        idx[idx_offset + i] = i;
    }
    for (i = 1; i < K; i++) {
        value = a[a_offset + i];
        for (j = i - 1; j >= 0 && value > a[a_offset + j]; j--) {
            a[a_offset + j + 1] = a[a_offset + j];
            idx[idx_offset + j + 1] = idx[idx_offset + j];
        }
        a[a_offset + j + 1] = value;
        idx[idx_offset + j + 1] = i;
    }
    
    // Process remaining elements
    for (i = K; i < L; i++) {
        value = a[a_offset + i];
        if (value > a[a_offset + K - 1]) {
            for (j = K - 2; j >= 0 && value > a[a_offset + j]; j--) {
                a[a_offset + j + 1] = a[a_offset + j];
                idx[idx_offset + j + 1] = idx[idx_offset + j];
            }
            a[a_offset + j + 1] = value;
            idx[idx_offset + j + 1] = i;
        }
    }
}

export function SKP_FIX_P_Ana_find_scaling(
    signal: Int16Array, signal_offset: number,
    signal_length: number,
    sum_sqr_len: number
): number {
    let nbits: number, x_max: number;
    
    let slice = signal.subarray(signal_offset, signal_offset + signal_length);
    x_max = SKP_Silk_int16_array_maxabs(slice, signal_length);

    if (x_max < 32767) {
        nbits = 32 - CLZ32(SMULBB(x_max, x_max)); 
    } else {
        nbits = 30;
    }
    nbits += 17 - SKP_Silk_CLZ16(sum_sqr_len);

    if (nbits < 31) {
        return 0;
    } else {
        return (nbits - 30);
    }
}

export function SKP_FIX_P_Ana_calc_corr_st3(
    cross_corr_st3: Int32Array, // flat 3D array: [4][34][5]
    signal: Int16Array, signal_offset: number,
    start_lag: number,
    sf_length: number,
    complexity: number
): void {
    let cross_corr: number;
    let i: number, j: number, k: number, lag_counter: number;
    let cbk_offset: number, cbk_size: number, delta: number, idx: number;
    let scratch_mem = new Int32Array(SCRATCH_SIZE);

    cbk_offset = D.SKP_Silk_cbk_offsets_stage3[complexity];
    cbk_size   = D.SKP_Silk_cbk_sizes_stage3[complexity];

    let target_offset = signal_offset + (sf_length << 2);
    for (k = 0; k < D.PITCH_EST_NB_SUBFR; k++) {
        lag_counter = 0;

        let lag_range_start = D.SKP_Silk_Lag_range_stage3[complexity][k][0];
        let lag_range_end = D.SKP_Silk_Lag_range_stage3[complexity][k][1];

        for (j = lag_range_start; j <= lag_range_end; j++) {
            let basis_offset = target_offset - (start_lag + j);
            cross_corr = SKP_Silk_inner_prod_aligned(signal, target_offset, signal, basis_offset, sf_length);
            scratch_mem[lag_counter] = cross_corr;
            lag_counter++;
        }

        delta = lag_range_start;
        for (i = cbk_offset; i < (cbk_offset + cbk_size); i++) { 
            idx = D.SKP_Silk_CB_lags_stage3[k][i] - delta;
            for (j = 0; j < D.PITCH_EST_NB_STAGE3_LAGS; j++) {
                cross_corr_st3[(k * D.PITCH_EST_NB_CBKS_STAGE3_MAX * D.PITCH_EST_NB_STAGE3_LAGS) + (i * D.PITCH_EST_NB_STAGE3_LAGS) + j] = scratch_mem[idx + j];
            }
        }
        target_offset += sf_length;
    }
}

export function SKP_FIX_P_Ana_calc_energy_st3(
    energies_st3: Int32Array, // flat 3D array: [4][34][5]
    signal: Int16Array, signal_offset: number,
    start_lag: number,
    sf_length: number,
    complexity: number
): void {
    let energy: number;
    let k: number, i: number, j: number, lag_counter: number;
    let cbk_offset: number, cbk_size: number, delta: number, idx: number;
    let scratch_mem = new Int32Array(SCRATCH_SIZE);

    cbk_offset = D.SKP_Silk_cbk_offsets_stage3[complexity];
    cbk_size   = D.SKP_Silk_cbk_sizes_stage3[complexity];

    let target_offset = signal_offset + (sf_length << 2);
    for (k = 0; k < D.PITCH_EST_NB_SUBFR; k++) {
        lag_counter = 0;

        let basis_offset = target_offset - (start_lag + D.SKP_Silk_Lag_range_stage3[complexity][k][0]);
        energy = SKP_Silk_inner_prod_aligned(signal, basis_offset, signal, basis_offset, sf_length);
        scratch_mem[lag_counter] = energy;
        lag_counter++;

        let loops = (D.SKP_Silk_Lag_range_stage3[complexity][k][1] - D.SKP_Silk_Lag_range_stage3[complexity][k][0] + 1);
        for (i = 1; i < loops; i++) {
            energy -= SMULBB(signal[basis_offset + sf_length - i], signal[basis_offset + sf_length - i]);
            energy = SKP_ADD_SAT32(energy, SMULBB(signal[basis_offset - i], signal[basis_offset - i]));
            scratch_mem[lag_counter] = energy;
            lag_counter++;
        }

        delta = D.SKP_Silk_Lag_range_stage3[complexity][k][0];
        for (i = cbk_offset; i < (cbk_offset + cbk_size); i++) { 
            idx = D.SKP_Silk_CB_lags_stage3[k][i] - delta;
            for (j = 0; j < D.PITCH_EST_NB_STAGE3_LAGS; j++) {
                energies_st3[(k * D.PITCH_EST_NB_CBKS_STAGE3_MAX * D.PITCH_EST_NB_STAGE3_LAGS) + (i * D.PITCH_EST_NB_STAGE3_LAGS) + j] = scratch_mem[idx + j];
            }
        }
        target_offset += sf_length;
    }
}
