/**
 * Decoder initialization and sampling rate setup
 */
import { DecoderState } from './structs';
import * as T from './tables';
import { buildNLSFCB } from './nlsf_codebooks';
import { CNG_Reset } from './cng';

export function decoderSetFs(psDec: DecoderState, fs_kHz: number): void {
    if (psDec.fs_kHz !== fs_kHz) {
        psDec.fs_kHz = fs_kHz;
        psDec.frame_length = 20 * fs_kHz; // FRAME_LENGTH_MS * fs_kHz
        psDec.subfr_length = psDec.frame_length / 4; // NB_SUBFR = 4

        if (fs_kHz === 8) {
            psDec.LPC_order = 10;
            psDec.HP_A = T.SKP_Silk_Dec_A_HP_8;
            psDec.HP_B = T.SKP_Silk_Dec_B_HP_8;
        } else if (fs_kHz === 12) {
            psDec.LPC_order = 16;
            psDec.HP_A = T.SKP_Silk_Dec_A_HP_12;
            psDec.HP_B = T.SKP_Silk_Dec_B_HP_12;
        } else if (fs_kHz === 16) {
            psDec.LPC_order = 16;
            psDec.HP_A = T.SKP_Silk_Dec_A_HP_16;
            psDec.HP_B = T.SKP_Silk_Dec_B_HP_16;
        } else { // 24
            psDec.LPC_order = 16;
            psDec.HP_A = T.SKP_Silk_Dec_A_HP_24;
            psDec.HP_B = T.SKP_Silk_Dec_B_HP_24;
        }

        // Reset filter states
        psDec.HPState.fill(0);
        psDec.sLPC_Q14.fill(0);
        psDec.sLTP_Q16.fill(0);
        psDec.outBuf.fill(0);
        psDec.prevNLSF_Q15.fill(0);
        psDec.first_frame_after_reset = 1;
        psDec.lagPrev = 100;
        psDec.LastGainIndex = 1;
        psDec.prev_inv_gain_Q16 = 65536;
        // CNG reset
        psDec.CNG_exc_buf_Q10.fill(0);
        psDec.CNG_smth_NLSF_Q15.fill(0);
        psDec.CNG_synth_state.fill(0);
        psDec.CNG_smth_Gain_Q16 = 0;
        psDec.CNG_fs_kHz = 0;
        CNG_Reset(psDec);

        // Set NLSF codebook pointers based on LPC order
        if (psDec.LPC_order === 10) {
            psDec.psNLSF_CB[0] = buildNLSFCB(
                T.nlsf_cb0_10_nStages, T.nlsf_cb0_10_stageVectors,
                T.nlsf_cb0_10_CDF, T.nlsf_cb0_10_CDF_start_offsets,
                T.nlsf_cb0_10_CDF_middle_idx, T.nlsf_cb0_10_ndelta_min_Q15,
                T.nlsf_cb0_10_Q15, T.SKP_Silk_NLSF_MSVQ_CB0_10_rates_Q5, 10
            );
            psDec.psNLSF_CB[1] = buildNLSFCB(
                T.nlsf_cb1_10_nStages, T.nlsf_cb1_10_stageVectors,
                T.nlsf_cb1_10_CDF, T.nlsf_cb1_10_CDF_start_offsets,
                T.nlsf_cb1_10_CDF_middle_idx, T.nlsf_cb1_10_ndelta_min_Q15,
                T.nlsf_cb1_10_Q15, T.SKP_Silk_NLSF_MSVQ_CB1_10_rates_Q5, 10
            );
        } else {
            psDec.psNLSF_CB[0] = buildNLSFCB(
                T.nlsf_cb0_16_nStages, T.nlsf_cb0_16_stageVectors,
                T.nlsf_cb0_16_CDF, T.nlsf_cb0_16_CDF_start_offsets,
                T.nlsf_cb0_16_CDF_middle_idx, T.nlsf_cb0_16_ndelta_min_Q15,
                T.build_nlsf_cb0_16_Q15(), T.SKP_Silk_NLSF_MSVQ_CB0_16_rates_Q5, 16
            );
            psDec.psNLSF_CB[1] = buildNLSFCB(
                T.nlsf_cb1_16_nStages, T.nlsf_cb1_16_stageVectors,
                T.nlsf_cb1_16_CDF, T.nlsf_cb1_16_CDF_start_offsets,
                T.nlsf_cb1_16_CDF_middle_idx, T.nlsf_cb1_16_ndelta_min_Q15,
                T.build_nlsf_cb1_16_Q15(), T.SKP_Silk_NLSF_MSVQ_CB1_16_rates_Q5, 16
            );
        }
    }
}

export function initDecoder(psDec: DecoderState): void {
    psDec.fs_kHz = 0;
    psDec.prev_API_sampleRate = 0;
    psDec.frame_length = 0;
    psDec.subfr_length = 0;
    psDec.LPC_order = 0;
    psDec.first_frame_after_reset = 1;
    psDec.prev_inv_gain_Q16 = 65536;
    psDec.nFramesDecoded = 0;
    psDec.nFramesInPacket = 1;
    psDec.moreInternalDecoderFrames = 0;
    psDec.lossCnt = 0;
    psDec.inband_FEC_offset = 0;
    psDec.no_FEC_counter = 0;
}
