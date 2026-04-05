import { SKP_SMLAWB as SMLAWB, SKP_DIV32_varQ, SKP_max_int as max_int, SKP_SAT16, SKP_RSHIFT as RSHIFT, SKP_SMLABB as SMLABB } from './macros';
import { MAX_FIND_PITCH_LPC_ORDER, FIND_PITCH_LPC_WIN_MAX, FIND_PITCH_WHITE_NOISE_FRACTION, FIND_PITCH_BANDWITH_EXPANSION } from './defines';
import { applySineWindow } from './apply_sine_window';
import { autocorr } from './autocorr';
import { schur } from './schur';
import { k2a } from './k2a';
import { EncoderState, EncoderControl } from './structs';
import { SKP_Silk_bwexpander, SKP_Silk_MA_Prediction } from './macros';

import { SKP_Silk_pitch_analysis_core } from './pitch_analysis_core_main';

export function find_pitch_lags_FIX(
    psEnc: EncoderState,
    psEncCtrl: EncoderControl,
    res: Int16Array,
    x: Int16Array,
    x_offset: number
): void {
    let psPredSt = psEnc.sPred;
    let buf_len = psEnc.la_pitch + (psEnc.frame_length << 1);
    
    let x_buf_offset = x_offset - psEnc.frame_length;
    let Wsig = new Int16Array(FIND_PITCH_LPC_WIN_MAX);
    let auto_corr = new Int32Array(MAX_FIND_PITCH_LPC_ORDER + 1);
    let rc_Q15 = new Int16Array(MAX_FIND_PITCH_LPC_ORDER);
    let A_Q24 = new Int32Array(MAX_FIND_PITCH_LPC_ORDER);
    let FiltState = new Int32Array(MAX_FIND_PITCH_LPC_ORDER);
    let A_Q12 = new Int16Array(MAX_FIND_PITCH_LPC_ORDER);

    // Calculate windowed signal
    let x_buf_ptr_offset = x_buf_offset + buf_len - psPredSt.pitch_LPC_win_length;
    let Wsig_ptr_offset = 0;
    
    applySineWindow(Wsig, Wsig_ptr_offset, x, x_buf_ptr_offset, 1, psEnc.la_pitch);

    Wsig_ptr_offset += psEnc.la_pitch;
    x_buf_ptr_offset += psEnc.la_pitch;
    
    let mid_len = psPredSt.pitch_LPC_win_length - (psEnc.la_pitch << 1);
    for (let i = 0; i < mid_len; i++) {
        Wsig[Wsig_ptr_offset + i] = x[x_buf_ptr_offset + i];
    }

    Wsig_ptr_offset += mid_len;
    x_buf_ptr_offset += mid_len;
    applySineWindow(Wsig, Wsig_ptr_offset, x, x_buf_ptr_offset, 2, psEnc.la_pitch);

    let scale = { val: 0 };
    autocorr(auto_corr, scale, Wsig, 0, psPredSt.pitch_LPC_win_length, psEnc.pitchEstimationLPCOrder + 1);

    auto_corr[0] = SMLAWB(auto_corr[0], auto_corr[0], FIND_PITCH_WHITE_NOISE_FRACTION);

    let res_nrg = schur(rc_Q15, auto_corr, psEnc.pitchEstimationLPCOrder);

    psEncCtrl.predGain_Q16 = SKP_DIV32_varQ(auto_corr[0], Math.max(res_nrg, 1), 16);

    k2a(A_Q24, rc_Q15, psEnc.pitchEstimationLPCOrder);

    for (let i = 0; i < psEnc.pitchEstimationLPCOrder; i++) {
        A_Q12[i] = SKP_SAT16(RSHIFT(A_Q24[i], 12));
    }

    SKP_Silk_bwexpander(A_Q12, 0, psEnc.pitchEstimationLPCOrder, FIND_PITCH_BANDWITH_EXPANSION);

    FiltState.fill(0);
    SKP_Silk_MA_Prediction(x, x_buf_offset, A_Q12, 0, FiltState, 0, res, 0, buf_len, psEnc.pitchEstimationLPCOrder);
    res.fill(0, 0, psEnc.pitchEstimationLPCOrder);

    let thrhld_Q15 = 14745; // 0.45 in Q15
    thrhld_Q15 = SMLABB(thrhld_Q15, -131, psEnc.pitchEstimationLPCOrder); // -0.004 in Q15 is -131
    thrhld_Q15 = SMLABB(thrhld_Q15, -12, psEnc.speech_activity_Q8); // -0.1 in Q7 is -12
    thrhld_Q15 = SMLABB(thrhld_Q15, 4915, psEnc.prev_sigtype); // 0.15 in Q15 is 4915
    thrhld_Q15 = SMLAWB(thrhld_Q15, -6554, psEncCtrl.input_tilt_Q15); // -0.1 in Q16 is -6553.6
    thrhld_Q15 = SKP_SAT16(thrhld_Q15);

    let lagIndex_contourIndex = new Int32Array([psEncCtrl.lagIndex, psEncCtrl.contourIndex]);
    let LTPCorr = new Int32Array([psEnc.LTPCorr_Q15]);

    psEncCtrl.sigtype = SKP_Silk_pitch_analysis_core(
        res, psEncCtrl.pitchL, 0, lagIndex_contourIndex, LTPCorr,
        psEnc.prevLag, psEnc.pitchEstimationThreshold_Q16,
        thrhld_Q15, psEnc.fs_kHz, psEnc.pitchEstimationComplexity, 0
    );

    psEncCtrl.lagIndex = lagIndex_contourIndex[0];
    psEncCtrl.contourIndex = lagIndex_contourIndex[1];
    psEnc.LTPCorr_Q15 = LTPCorr[0];
}
