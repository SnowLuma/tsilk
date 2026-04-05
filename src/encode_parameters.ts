import { EncoderState, EncoderControl } from './structs';
import { rangeEncode } from './range_coder';
import * as D from './defines';
import { encodePulses } from './encode_pulses';
import { 
    SKP_Silk_SamplingRates_table,
    SKP_Silk_SamplingRates_CDF,
    SKP_Silk_type_offset_CDF,
    SKP_Silk_type_offset_joint_CDF,
    SKP_Silk_NLSF_interpolation_factor_CDF,
    SKP_Silk_LTPscale_CDF,
    SKP_Silk_LTPScales_table_Q14,
    SKP_Silk_Seed_CDF,
    SKP_Silk_vadflag_CDF
} from './tables/tables_other';
import {
    SKP_Silk_gain_CDF,
    SKP_Silk_delta_gain_CDF
} from './tables/tables_gain';
import {
    SKP_Silk_pitch_contour_NB_CDF,
    SKP_Silk_pitch_contour_CDF
} from './tables/tables_pitch';
import {
    SKP_Silk_pitch_lag_NB_CDF,
    SKP_Silk_pitch_lag_MB_CDF
} from './tables/tables_pitch_lag_nb_mb';
import { SKP_Silk_pitch_lag_WB_CDF } from './tables/tables_pitch_lag_wb';
import { buildSWBPitchLagCDF } from './tables/tables_pitch_lag_swb';
import {
    SKP_Silk_LTP_per_index_CDF,
    SKP_Silk_LTP_gain_CDF_ptrs
} from './tables/tables_ltp';
import type { NLSFCB } from './nlsf';

const SKP_Silk_pitch_lag_SWB_CDF = buildSWBPitchLagCDF();

function encodeNLSFIndices(psRC: any, cb: NLSFCB, nlsfIndices: Int32Array): void {
    for (let s = 0; s < cb.nStages; s++) {
        const cdfStart = cb.CDF_start_offsets[s];
        const cdfSlice = cb.CDF.subarray(cdfStart);
        rangeEncode(psRC, nlsfIndices[s] | 0, cdfSlice);
    }
}

export function SKP_Silk_encode_pulses(psRC: any, sigtype: number, QuantOffsetType: number, q: Int8Array, frame_length: number): void {
    encodePulses(psRC, sigtype, QuantOffsetType, q, frame_length);
}

export function encode_parameters(
    psEncC: EncoderState,
    psEncCtrlC: EncoderControl,
    psRC: any, // Range coder state
    q: Int8Array
): void {
    let i, k, typeOffset;
    let ltpScaleIx = -1;
    const frameNo = (psEncC.frameCounter | 0) + 1;

    // Encode sampling rate
    if (psEncC.nFramesInPayloadBuf === 0) {
        for (i = 0; i < 3; i++) {
            if (SKP_Silk_SamplingRates_table[i] === psEncC.fs_kHz) {
                break;
            }
        }
        rangeEncode(psRC, i, SKP_Silk_SamplingRates_CDF);
    }

    // Encode signal type and quantizer offset
    typeOffset = 2 * psEncCtrlC.sigtype + psEncCtrlC.QuantOffsetType;
    if (psEncC.nFramesInPayloadBuf === 0) {
        rangeEncode(psRC, typeOffset, SKP_Silk_type_offset_CDF);
    } else {
        rangeEncode(psRC, typeOffset, SKP_Silk_type_offset_joint_CDF[psEncC.typeOffsetPrev]);
    }
    psEncC.typeOffsetPrev = typeOffset;

    // Encode gains
    if (psEncC.nFramesInPayloadBuf === 0) {
        rangeEncode(psRC, psEncCtrlC.GainsIndices[0], SKP_Silk_gain_CDF[psEncCtrlC.sigtype]);
    } else {
        rangeEncode(psRC, psEncCtrlC.GainsIndices[0], SKP_Silk_delta_gain_CDF);
    }

    for (i = 1; i < D.NB_SUBFR; i++) {
        rangeEncode(psRC, psEncCtrlC.GainsIndices[i], SKP_Silk_delta_gain_CDF);
    }

    // Encode NLSF stage indices using the selected encoder codebook.
    const psNLSF_CB = psEncC.sCmn?.psNLSF_CB?.[psEncCtrlC.sigtype] as NLSFCB | undefined;
    if (psNLSF_CB) {
        encodeNLSFIndices(psRC, psNLSF_CB, psEncCtrlC.NLSFIndices);
    }

    // Encode interpolation factor.
    rangeEncode(psRC, psEncCtrlC.NLSFInterpCoef_Q2, SKP_Silk_NLSF_interpolation_factor_CDF);

    if (psEncCtrlC.sigtype === D.SIG_TYPE_VOICED) {
        // Encode pitch lags
        if (psEncC.fs_kHz === 8) {
            rangeEncode(psRC, psEncCtrlC.lagIndex, SKP_Silk_pitch_lag_NB_CDF);
        } else if (psEncC.fs_kHz === 12) {
            rangeEncode(psRC, psEncCtrlC.lagIndex, SKP_Silk_pitch_lag_MB_CDF);
        } else if (psEncC.fs_kHz === 16) {
            rangeEncode(psRC, psEncCtrlC.lagIndex, SKP_Silk_pitch_lag_WB_CDF);
        } else {
            rangeEncode(psRC, psEncCtrlC.lagIndex, SKP_Silk_pitch_lag_SWB_CDF);
        }

        // Contour index
        if (psEncC.fs_kHz === 8) {
            rangeEncode(psRC, psEncCtrlC.contourIndex, SKP_Silk_pitch_contour_NB_CDF);
        } else {
            rangeEncode(psRC, psEncCtrlC.contourIndex, SKP_Silk_pitch_contour_CDF);
        }

        // Encode LTP gains
        rangeEncode(psRC, psEncCtrlC.PERIndex, SKP_Silk_LTP_per_index_CDF);

        for (k = 0; k < D.NB_SUBFR; k++) {
            rangeEncode(psRC, psEncCtrlC.LTPIndex[k], SKP_Silk_LTP_gain_CDF_ptrs[psEncCtrlC.PERIndex]);
        }

        // Encode LTP scaling
        ltpScaleIx = (psEncCtrlC.LTP_scaleIndex | 0);
        rangeEncode(psRC, ltpScaleIx, SKP_Silk_LTPscale_CDF);
    }

    // Encode seed
    rangeEncode(psRC, psEncCtrlC.Seed, SKP_Silk_Seed_CDF);

    // Encode quantization indices of excitation
    encodePulses(psRC, psEncCtrlC.sigtype, psEncCtrlC.QuantOffsetType, q, psEncC.frame_length, frameNo);

    // Encode VAD flag
    rangeEncode(psRC, psEncC.vadFlag, SKP_Silk_vadflag_CDF);
}
