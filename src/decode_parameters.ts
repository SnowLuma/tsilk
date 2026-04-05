/**
 * SILK v3 Decode Parameters - decodes header info from the bitstream
 * Ported from SKP_Silk_decode_parameters.c
 */
import { DecoderState, DecoderControl } from './structs';
import { decoderSetFs } from './decoder_init';
import { rangeDecode, rangeDecodeMulti, rangeCoderGetLength, rangeCoderCheckAfterDecoding } from './range_coder_dec';
import * as T from './tables';
import * as D from './defines';
import { SKP_RSHIFT, SKP_SMULBB, toInt32, SKP_SMULWB, SKP_min_32, SKP_MUL, SKP_Silk_bwexpander } from './macros';
import { decodePulses } from './decode_pulses';
import { gainsDequant } from './gain_quant';
import { NLSF_MSVQ_decode, NLSFCB } from './nlsf';
import { NLSF2A } from './nlsf_a';
import { NLSF2A_stable } from './nlsf2a_stable';
import { decodePitch } from './decode_pitch';
import { RangeCoderState } from './range_coder';


export function decodeParameters(
    psDec: DecoderState,
    psDecCtrl: DecoderControl,
    q: Int32Array,
    fullDecoding: number
): void {
    const psRC = psDec.sRC;

    // Decode sampling rate (first frame only)
    if (psDec.nFramesDecoded === 0) {
        const Ix = rangeDecode(psRC, T.SKP_Silk_SamplingRates_CDF, T.SKP_Silk_SamplingRates_offset);
        if (Ix < 0 || Ix > 3) {
            psRC.error = D.RANGE_CODER_ILLEGAL_SAMPLING_RATE;
            return;
        }
        decoderSetFs(psDec, T.SKP_Silk_SamplingRates_table[Ix]);
    }

    // Decode signal type and quantizer offset
    let Ix: number;
    let typeRcPre: [number, number] = [0, 0];
    let typeRcPost: [number, number] = [0, 0];
    if (psDec.nFramesDecoded === 0) {
        typeRcPre = [(psRC.base_Q32 | 0) >>> 0, (psRC.range_Q16 | 0) >>> 0];
        Ix = rangeDecode(psRC, T.SKP_Silk_type_offset_CDF, T.SKP_Silk_type_offset_CDF_offset);
        typeRcPost = [(psRC.base_Q32 | 0) >>> 0, (psRC.range_Q16 | 0) >>> 0];
    } else {
        typeRcPre = [(psRC.base_Q32 | 0) >>> 0, (psRC.range_Q16 | 0) >>> 0];
        Ix = rangeDecode(psRC, T.SKP_Silk_type_offset_joint_CDF[psDec.typeOffsetPrev], T.SKP_Silk_type_offset_CDF_offset);
        typeRcPost = [(psRC.base_Q32 | 0) >>> 0, (psRC.range_Q16 | 0) >>> 0];
    }
    psDecCtrl.sigtype = Ix >> 1;
    psDecCtrl.QuantOffsetType = Ix & 1;
    psDec.typeOffsetPrev = Ix;

    // Decode gains
    const GainsIndices = new Int32Array(D.NB_SUBFR);
    const gainRcPre: number[][] = Array.from({ length: D.NB_SUBFR }, () => [0, 0]);
    const gainRcPost: number[][] = Array.from({ length: D.NB_SUBFR }, () => [0, 0]);
    if (psDec.nFramesDecoded === 0) {
        gainRcPre[0] = [(psRC.base_Q32 | 0) >>> 0, (psRC.range_Q16 | 0) >>> 0];
        GainsIndices[0] = rangeDecode(psRC, T.SKP_Silk_gain_CDF[psDecCtrl.sigtype], T.SKP_Silk_gain_CDF_offset);
        gainRcPost[0] = [(psRC.base_Q32 | 0) >>> 0, (psRC.range_Q16 | 0) >>> 0];
    } else {
        gainRcPre[0] = [(psRC.base_Q32 | 0) >>> 0, (psRC.range_Q16 | 0) >>> 0];
        GainsIndices[0] = rangeDecode(psRC, T.SKP_Silk_delta_gain_CDF, T.SKP_Silk_delta_gain_CDF_offset);
        gainRcPost[0] = [(psRC.base_Q32 | 0) >>> 0, (psRC.range_Q16 | 0) >>> 0];
    }
    for (let i = 1; i < D.NB_SUBFR; i++) {
        gainRcPre[i] = [(psRC.base_Q32 | 0) >>> 0, (psRC.range_Q16 | 0) >>> 0];
        GainsIndices[i] = rangeDecode(psRC, T.SKP_Silk_delta_gain_CDF, T.SKP_Silk_delta_gain_CDF_offset);
        gainRcPost[i] = [(psRC.base_Q32 | 0) >>> 0, (psRC.range_Q16 | 0) >>> 0];
    }
    const prevInd = { value: psDec.LastGainIndex };
    gainsDequant(psDecCtrl.Gains_Q16, GainsIndices, prevInd, psDec.nFramesDecoded);
    psDec.LastGainIndex = prevInd.value;

    // Decode NLSFs using real NLSF codebook
    const psNLSF_CB = psDec.psNLSF_CB[psDecCtrl.sigtype];
    if (!psNLSF_CB) { psRC.error = D.RANGE_CODER_CDF_OUT_OF_RANGE; return; }
    const nlsfDec = decodeNLSFIndices(psRC, psNLSF_CB);
    const NLSFIndices = nlsfDec.indices;
    const pNLSF_Q15 = new Int32Array(D.MAX_LPC_ORDER);
    NLSF_MSVQ_decode(pNLSF_Q15, psNLSF_CB, NLSFIndices, psDec.LPC_order);

    // Decode NLSF interpolation factor
    psDecCtrl.NLSFInterpCoef_Q2 = rangeDecode(psRC,
        T.SKP_Silk_NLSF_interpolation_factor_CDF,
        T.SKP_Silk_NLSF_interpolation_factor_offset
    );
    if (psDec.first_frame_after_reset === 1) {
        psDecCtrl.NLSFInterpCoef_Q2 = 4;
    }

    let nlsfStableIter1 = 0;
    let nlsfStableIter0 = 0;
    let prePredCoef1Head: number[] | undefined;
    let prePredCoef0Head: number[] | undefined;
    if (fullDecoding) {
        const prePred1 = new Int16Array(D.MAX_LPC_ORDER);
        NLSF2A(prePred1, pNLSF_Q15, psDec.LPC_order);
        prePredCoef1Head = Array.from(prePred1.subarray(0, 4));

        nlsfStableIter1 = NLSF2A_stable(psDecCtrl.PredCoef_Q12[1], pNLSF_Q15, psDec.LPC_order);
        if (psDecCtrl.NLSFInterpCoef_Q2 < 4) {
            const pNLSF0_Q15 = new Int32Array(D.MAX_LPC_ORDER);
            for (let i = 0; i < psDec.LPC_order; i++) {
                pNLSF0_Q15[i] = psDec.prevNLSF_Q15[i] + SKP_RSHIFT(
                    toInt32(psDecCtrl.NLSFInterpCoef_Q2 * (pNLSF_Q15[i] - psDec.prevNLSF_Q15[i])), 2
                );
            }

            const prePred0 = new Int16Array(D.MAX_LPC_ORDER);
            NLSF2A(prePred0, pNLSF0_Q15, psDec.LPC_order);
            prePredCoef0Head = Array.from(prePred0.subarray(0, 4));

            nlsfStableIter0 = NLSF2A_stable(psDecCtrl.PredCoef_Q12[0], pNLSF0_Q15, psDec.LPC_order);
        } else {
            psDecCtrl.PredCoef_Q12[0].set(psDecCtrl.PredCoef_Q12[1]);
            nlsfStableIter0 = nlsfStableIter1;
            prePredCoef0Head = prePredCoef1Head;
        }
    }
    psDec.prevNLSF_Q15.set(pNLSF_Q15.subarray(0, psDec.LPC_order));

    // BWE after loss
    if (psDec.lossCnt) {
        SKP_Silk_bwexpander(psDecCtrl.PredCoef_Q12[0], 0, psDec.LPC_order, D.BWE_AFTER_LOSS_Q16);
        SKP_Silk_bwexpander(psDecCtrl.PredCoef_Q12[1], 0, psDec.LPC_order, D.BWE_AFTER_LOSS_Q16);
    }

    // Decode pitch lags (voiced only)
    let voicedMeta: { lagIndex: number; contourIndex: number } | null = null;
    if (psDecCtrl.sigtype === D.SIG_TYPE_VOICED) {
        voicedMeta = decodePitchParams(psDec, psDecCtrl, psRC);
    } else {
        psDecCtrl.pitchL.fill(0);
        psDecCtrl.LTPCoef_Q14.fill(0);
        psDecCtrl.PERIndex = 0;
        psDecCtrl.LTP_scale_Q14 = 0;
    }

    // Decode seed
    psDecCtrl.Seed = rangeDecode(psRC, T.SKP_Silk_Seed_CDF, T.SKP_Silk_Seed_offset);

    // Decode excitation pulses
    decodePulses(psRC, psDecCtrl, q, psDec.frame_length);

    // Decode VAD flag
    psDec.vadFlag = rangeDecode(psRC, T.SKP_Silk_vadflag_CDF, T.SKP_Silk_vadflag_offset);

    // Decode frame termination
    psDec.FrameTermination = rangeDecode(psRC, T.SKP_Silk_FrameTermination_CDF, T.SKP_Silk_FrameTermination_offset);

    // Get bytes used
    const { nBytes: nBytesUsed } = rangeCoderGetLength(psRC);
    psDec.nBytesLeft = psRC.bufferLength - nBytesUsed;
    if (psDec.nBytesLeft < 0) {
        psRC.error = D.RANGE_CODER_READ_BEYOND_BUFFER;
    }
    if (psDec.nBytesLeft === 0) {
        rangeCoderCheckAfterDecoding(psRC);
    }
}

// Helper: decode pitch parameters
function decodePitchParams(psDec: DecoderState, psDecCtrl: DecoderControl, psRC: any): { lagIndex: number; contourIndex: number } {
    const Ixs = new Int32Array(D.NB_SUBFR);
    // Pitch lag index
    if (psDec.fs_kHz === 8) {
        Ixs[0] = rangeDecode(psRC, T.SKP_Silk_pitch_lag_NB_CDF, T.SKP_Silk_pitch_lag_NB_CDF_offset);
    } else if (psDec.fs_kHz === 12) {
        Ixs[0] = rangeDecode(psRC, T.SKP_Silk_pitch_lag_MB_CDF, T.SKP_Silk_pitch_lag_MB_CDF_offset);
    } else if (psDec.fs_kHz === 16) {
        Ixs[0] = rangeDecode(psRC, T.SKP_Silk_pitch_lag_WB_CDF, T.SKP_Silk_pitch_lag_WB_CDF_offset);
    } else {
        const SWB_CDF = T.buildSWBPitchLagCDF();
        Ixs[0] = rangeDecode(psRC, SWB_CDF, T.SKP_Silk_pitch_lag_SWB_CDF_offset);
    }
    // Contour index
    if (psDec.fs_kHz === 8) {
        Ixs[1] = rangeDecode(psRC, T.SKP_Silk_pitch_contour_NB_CDF, T.SKP_Silk_pitch_contour_NB_CDF_offset);
    } else {
        Ixs[1] = rangeDecode(psRC, T.SKP_Silk_pitch_contour_CDF, T.SKP_Silk_pitch_contour_CDF_offset);
    }
    decodePitch(Ixs[0], Ixs[1], psDecCtrl.pitchL, psDec.fs_kHz);

    // Decode LTP gains
    psDecCtrl.PERIndex = rangeDecode(psRC, T.SKP_Silk_LTP_per_index_CDF, T.SKP_Silk_LTP_per_index_CDF_offset);
    const cbk_ptr = getLTPVqPtr(psDecCtrl.PERIndex);

    for (let k = 0; k < D.NB_SUBFR; k++) {
        const ltpIx = rangeDecode(psRC, T.SKP_Silk_LTP_gain_CDF_ptrs[psDecCtrl.PERIndex], T.SKP_Silk_LTP_gain_CDF_offsets[psDecCtrl.PERIndex]);
        for (let i = 0; i < D.LTP_ORDER; i++) {
            psDecCtrl.LTPCoef_Q14[k * D.LTP_ORDER + i] = cbk_ptr[ltpIx * D.LTP_ORDER + i];
        }
    }
    // Decode LTP scaling
    const ltpScaleIx = rangeDecode(psRC, T.SKP_Silk_LTPscale_CDF, T.SKP_Silk_LTPscale_offset);
    psDecCtrl.LTP_scale_Q14 = T.SKP_Silk_LTPScales_table_Q14[ltpScaleIx];

    return { lagIndex: Ixs[0], contourIndex: Ixs[1] };
}

function getLTPVqPtr(perIndex: number): Int16Array {
    if (perIndex === 0) return T.SKP_Silk_LTP_gain_vq_0_Q14;
    if (perIndex === 1) return T.SKP_Silk_LTP_gain_vq_1_Q14;
    return T.SKP_Silk_LTP_gain_vq_2_Q14;
}

/** Decode NLSF indices using real codebook CDFs and middle indices */
function decodeNLSFIndices(psRC: RangeCoderState, cb: NLSFCB): {
    indices: number[];
    stageBasePre: number[];
    stageRangePre: number[];
} {
    const indices: number[] = new Array(cb.nStages);
    const stageBasePre: number[] = new Array(cb.nStages);
    const stageRangePre: number[] = new Array(cb.nStages);
    for (let s = 0; s < cb.nStages; s++) {
        stageBasePre[s] = (psRC.base_Q32 | 0) >>> 0;
        stageRangePre[s] = (psRC.range_Q16 | 0) >>> 0;
        const cdfStart = cb.CDF_start_offsets[s];
        const midIdx = cb.CDF_middle_idx[s];
        // Range decode using the CDF subarray starting at cdfStart
        const cdfSlice = cb.CDF.subarray(cdfStart);
        indices[s] = rangeDecode(psRC, cdfSlice, midIdx);
    }
    return { indices, stageBasePre, stageRangePre };
}
