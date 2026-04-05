import { EncoderState, EncoderControl } from './structs';
import * as D from './defines';
import { LP_variable_cutoff } from './lp_variable_cutoff';
import { VAD_GetSA_Q8 } from './vad';
import { HP_variable_cutoff_FIX } from './hp_variable_cutoff';
import { find_pitch_lags_FIX } from './find_pitch_lags_FIX';
import { SKP_Silk_noise_shape_analysis_FIX as noise_shape_analysis_FIX } from './noise_shape_analysis_FIX';
import { prefilter_FIX } from './prefilter_FIX';
import { find_pred_coefs_FIX } from './find_pred_coefs_FIX';
import { process_gains_FIX } from './process_gains_FIX';
import { NSQ, NSQ_del_dec } from './NSQ_del_dec';
import { encode_parameters } from './encode_parameters';
import { rangeEncInit, rangeEncode, rangeCoderGetLength, rangeEncWrapUp } from './range_coder';
import { SKP_DIV32 as DIV32, SKP_LIMIT_int as LIMIT_int, SKP_FIX_CONST } from './macros';
import { SKP_Silk_FrameTermination_CDF } from './tables/tables_other';
import { gainsDequant } from './gain_quant';

const LBRR_IDX_MASK = D.MAX_LBRR_DELAY - 1;

function copyNSQState(dst: any, src: any): void {
    if (!dst || !src) return;
    if (src.xq && dst.xq) dst.xq.set(src.xq);
    if (src.sLTP_shp_Q10 && dst.sLTP_shp_Q10) dst.sLTP_shp_Q10.set(src.sLTP_shp_Q10);
    if (src.sLPC_Q14 && dst.sLPC_Q14) dst.sLPC_Q14.set(src.sLPC_Q14);
    if (src.sAR2_Q14 && dst.sAR2_Q14) dst.sAR2_Q14.set(src.sAR2_Q14);
    dst.sLF_AR_shp_Q12 = src.sLF_AR_shp_Q12 | 0;
    dst.lagPrev = src.lagPrev | 0;
    dst.sLTP_buf_idx = src.sLTP_buf_idx | 0;
    dst.sLTP_shp_buf_idx = src.sLTP_shp_buf_idx | 0;
    dst.rand_seed = src.rand_seed | 0;
    dst.prev_inv_gain_Q16 = src.prev_inv_gain_Q16 | 0;
    dst.rewhite_flag = src.rewhite_flag | 0;
}

function LBRR_ctrl(psEnc: EncoderState, sEncCtrl: EncoderControl): void {
    if (psEnc.LBRR_enabled) {
        let usage = D.SKP_SILK_NO_LBRR;
        if (
            psEnc.speech_activity_Q8 > SKP_FIX_CONST(0.5, 8) &&
            (psEnc.sCmn.PacketLoss_perc | 0) > D.LBRR_LOSS_THRES
        ) {
            usage = D.SKP_SILK_ADD_LBRR_TO_PLUS1;
        }
        sEncCtrl.LBRR_usage = usage;
    } else {
        sEncCtrl.LBRR_usage = D.SKP_SILK_NO_LBRR;
    }
}

function LBRR_encode(
    psEnc: EncoderState,
    sEncCtrl: EncoderControl,
    xfw: Int16Array
): { payload: Uint8Array; nBytes: number } {
    const payload = new Uint8Array(D.MAX_ARITHM_BYTES);
    let nBytesOut = 0;

    LBRR_ctrl(psEnc, sEncCtrl);
    if (!psEnc.LBRR_enabled) {
        return { payload, nBytes: 0 };
    }

    const tempGainsIndices = new Int32Array(sEncCtrl.GainsIndices);
    const tempGainsQ16 = new Int32Array(sEncCtrl.Gains_Q16);
    const typeOffsetPrev = psEnc.typeOffsetPrev | 0;
    const ltpScaleIndex = sEncCtrl.LTP_scaleIndex | 0;

    let rateOnlyParameters = 0;
    if (psEnc.fs_kHz === 8) rateOnlyParameters = 13500;
    else if (psEnc.fs_kHz === 12) rateOnlyParameters = 15500;
    else if (psEnc.fs_kHz === 16) rateOnlyParameters = 17500;
    else rateOnlyParameters = 19500;

    if ((psEnc.Complexity | 0) > 0 && (psEnc.TargetRate_bps | 0) > rateOnlyParameters) {
        if ((psEnc.nFramesInPayloadBuf | 0) === 0) {
            copyNSQState(psEnc.sNSQ_LBRR, psEnc.sNSQ);
            (psEnc.sCmn as any).LBRRprevLastGainIndex = psEnc.sShape.LastGainIndex | 0;
            sEncCtrl.GainsIndices[0] = LIMIT_int(
                (sEncCtrl.GainsIndices[0] | 0) + (psEnc.LBRR_GainIncreases | 0),
                0,
                D.N_LEVELS_QGAIN - 1,
            );
        }

        const prev = {
            value: (((psEnc.sCmn as any).LBRRprevLastGainIndex ?? psEnc.sShape.LastGainIndex) | 0),
        };
        gainsDequant(
            sEncCtrl.Gains_Q16,
            sEncCtrl.GainsIndices,
            prev,
            (psEnc.nFramesInPayloadBuf | 0) > 0 ? 1 : 0,
        );
        (psEnc.sCmn as any).LBRRprevLastGainIndex = prev.value | 0;

        if ((psEnc.nStatesDelayedDecision | 0) > 1 || (psEnc.warping_Q16 | 0) > 0) {
            NSQ_del_dec(
                psEnc,
                sEncCtrl,
                psEnc.sRC,
                xfw,
                psEnc.q_LBRR,
                sEncCtrl.NLSFInterpCoef_Q2,
                sEncCtrl.PredCoef_Q12,
                sEncCtrl.LTPCoef_Q14,
                sEncCtrl.AR2_Q13,
                sEncCtrl.HarmShapeGain_Q14,
                sEncCtrl.Tilt_Q14,
                sEncCtrl.LF_shp_Q14,
                sEncCtrl.Gains_Q16,
                sEncCtrl.Lambda_Q10,
                sEncCtrl.LTP_scale_Q14,
                true,
            );
        } else {
            NSQ(
                psEnc,
                sEncCtrl,
                psEnc.sRC,
                xfw,
                psEnc.q_LBRR,
                sEncCtrl.NLSFInterpCoef_Q2,
                sEncCtrl.PredCoef_Q12,
                sEncCtrl.LTPCoef_Q14,
                sEncCtrl.AR2_Q13,
                sEncCtrl.HarmShapeGain_Q14,
                sEncCtrl.Tilt_Q14,
                sEncCtrl.LF_shp_Q14,
                sEncCtrl.Gains_Q16,
                sEncCtrl.Lambda_Q10,
                sEncCtrl.LTP_scale_Q14,
                true,
            );
        }
    } else {
        psEnc.q_LBRR.fill(0);
        sEncCtrl.LTP_scaleIndex = 0;
    }

    if ((psEnc.nFramesInPayloadBuf | 0) === 0) {
        rangeEncInit(psEnc.sRC_LBRR);
    }

    encode_parameters(psEnc, sEncCtrl, psEnc.sRC_LBRR, psEnc.q_LBRR);

    const nFramesInPayloadBuf = psEnc.sRC_LBRR.error
        ? 0
        : ((psEnc.nFramesInPayloadBuf | 0) + 1);

    if (nFramesInPayloadBuf * D.FRAME_LENGTH_MS >= (psEnc.PacketSize_ms | 0)) {
        rangeEncode(psEnc.sRC_LBRR, D.SKP_SILK_LAST_FRAME, SKP_Silk_FrameTermination_CDF);
        const lenRet = { val: 0 };
        rangeCoderGetLength(psEnc.sRC_LBRR, lenRet);
        if (lenRet.val <= D.MAX_ARITHM_BYTES) {
            rangeEncWrapUp(psEnc.sRC_LBRR);
            payload.set(psEnc.sRC_LBRR.buffer.subarray(0, lenRet.val), 0);
            nBytesOut = lenRet.val | 0;
        }
    } else {
        rangeEncode(psEnc.sRC_LBRR, D.SKP_SILK_MORE_FRAMES, SKP_Silk_FrameTermination_CDF);
        nBytesOut = 0;
    }

    sEncCtrl.GainsIndices.set(tempGainsIndices);
    sEncCtrl.Gains_Q16.set(tempGainsQ16);
    sEncCtrl.LTP_scaleIndex = ltpScaleIndex;
    psEnc.typeOffsetPrev = typeOffsetPrev;

    return { payload, nBytes: nBytesOut };
}

export function encodeFrame(
    psEnc: EncoderState,
    pCode: Uint8Array,
    pnBytesOut: { val: number },
    pIn: Int16Array
): number {
    const frameCounterStart = psEnc.frameCounter | 0;
    const sEncCtrl = new EncoderControl();
    let nBytes = 0;
    let ret = 0;

    let x_frame_idx = psEnc.frame_length; // psEnc.x_buf starts here
    let res_pitch = new Int16Array(2 * D.MAX_FRAME_LENGTH + /* LA_PITCH_MAX */ 120);
    let res_pitch_frame_idx = psEnc.frame_length;
    let xfw = new Int16Array(D.MAX_FRAME_LENGTH);
    let pIn_HP = new Int16Array(D.MAX_FRAME_LENGTH);

    // sEncCtrl.sCmn.Seed = psEnc.frameCounter & 3; // TODO: implement Seed randomly or from frameCounter

    // Voice Activity Detection
    let pSA_Q8_obj = { val: 0 };
    let pSNR_dB_Q7_obj = { val: 0 };
    let pTilt_Q15_obj = { val: 0 };
    ret = VAD_GetSA_Q8(
        psEnc.sVAD, 
        pSA_Q8_obj, 
        pSNR_dB_Q7_obj, 
        sEncCtrl.input_quality_bands_Q15, 
        pTilt_Q15_obj, 
        pIn, 
        psEnc.frame_length
    );
    psEnc.speech_activity_Q8 = pSA_Q8_obj.val;
    sEncCtrl.current_SNR_dB_Q7 = pSNR_dB_Q7_obj.val;
    sEncCtrl.input_tilt_Q15 = pTilt_Q15_obj.val;
    sEncCtrl.Seed = frameCounterStart & 3;
    psEnc.frameCounter = (frameCounterStart + 1) | 0;
    if (psEnc.sCmn) {
        psEnc.sCmn.frameCounter = psEnc.frameCounter | 0;
    }
    psEnc.sCmn.first_frame_after_reset = psEnc.first_frame_after_reset | 0;
    const frameNo = psEnc.frameCounter | 0;
    
    // High-pass filtering of the input signal
    HP_variable_cutoff_FIX(psEnc, sEncCtrl, pIn_HP, pIn);
    
    // Ensure smooth bandwidth transitions
    let la_shape_offset = x_frame_idx + D.LA_SHAPE_MS * psEnc.fs_kHz;
    LP_variable_cutoff(psEnc.sCmn.sLP, psEnc.x_buf, la_shape_offset, pIn_HP, 0, psEnc.frame_length);

    // Find pitch lags, initial LPC analysis
    find_pitch_lags_FIX(psEnc, sEncCtrl, res_pitch, psEnc.x_buf, x_frame_idx);

    // Noise shape analysis
    noise_shape_analysis_FIX(psEnc, sEncCtrl, res_pitch, res_pitch_frame_idx, psEnc.x_buf, x_frame_idx);

    // Prefiltering for noise shaper
    prefilter_FIX(psEnc, sEncCtrl, xfw, psEnc.x_buf, x_frame_idx);

    // Find linear prediction coefficients (LPC + LTP)
    find_pred_coefs_FIX(psEnc, sEncCtrl, res_pitch);

    // Process gains
    process_gains_FIX(psEnc, sEncCtrl);

    // Low Bitrate Redundancy (in-band FEC side stream)
    const lbrr = LBRR_encode(psEnc, sEncCtrl, xfw);

    // Noise shaping quantization (NSQ)
    if (psEnc.nStatesDelayedDecision > 1 || psEnc.warping_Q16 > 0) {
        NSQ_del_dec(psEnc, sEncCtrl, psEnc.sRC, xfw, psEnc.q, sEncCtrl.NLSFInterpCoef_Q2, sEncCtrl.PredCoef_Q12, sEncCtrl.LTPCoef_Q14, sEncCtrl.AR2_Q13, sEncCtrl.HarmShapeGain_Q14, sEncCtrl.Tilt_Q14, sEncCtrl.LF_shp_Q14, sEncCtrl.Gains_Q16, sEncCtrl.Lambda_Q10, sEncCtrl.LTP_scale_Q14);
    } else {
        NSQ(psEnc, sEncCtrl, psEnc.sRC, xfw, psEnc.q, sEncCtrl.NLSFInterpCoef_Q2, sEncCtrl.PredCoef_Q12, sEncCtrl.LTPCoef_Q14, sEncCtrl.AR2_Q13, sEncCtrl.HarmShapeGain_Q14, sEncCtrl.Tilt_Q14, sEncCtrl.LF_shp_Q14, sEncCtrl.Gains_Q16, sEncCtrl.Lambda_Q10, sEncCtrl.LTP_scale_Q14);
    }

    // Convert speech activity into VAD and DTX flags
    if (psEnc.speech_activity_Q8 < SKP_FIX_CONST(D.SPEECH_ACTIVITY_DTX_THRES, 8)) {
        psEnc.vadFlag = D.NO_VOICE_ACTIVITY;
        psEnc.noSpeechCounter++;
        if (psEnc.noSpeechCounter > D.NO_SPEECH_FRAMES_BEFORE_DTX) {
            psEnc.inDTX = 1;
        }
        if (psEnc.noSpeechCounter > D.MAX_CONSECUTIVE_DTX + D.NO_SPEECH_FRAMES_BEFORE_DTX) {
            psEnc.noSpeechCounter = D.NO_SPEECH_FRAMES_BEFORE_DTX;
            psEnc.inDTX = 0;
        }
    } else {
        psEnc.noSpeechCounter = 0;
        psEnc.inDTX = 0;
        psEnc.vadFlag = D.VOICE_ACTIVITY;
    }

    // Initialize range coder
    if (psEnc.nFramesInPayloadBuf === 0) {
        rangeEncInit(psEnc.sRC);
        psEnc.nBytesInPayloadBuf = 0;
    }

    // Encode Parameters
    encode_parameters(psEnc, sEncCtrl, psEnc.sRC, psEnc.q);

    // Update input buffer
    let moveSize = psEnc.frame_length + D.LA_SHAPE_MS * psEnc.fs_kHz;
    psEnc.x_buf.copyWithin(0, psEnc.frame_length, psEnc.frame_length + moveSize);

    psEnc.prev_sigtype = sEncCtrl.sigtype;
    psEnc.prevLag = sEncCtrl.pitchL[D.NB_SUBFR - 1];
    psEnc.first_frame_after_reset = 0;
    psEnc.sCmn.first_frame_after_reset = 0;

    if (psEnc.sRC.error) {
        psEnc.nFramesInPayloadBuf = 0;
    } else {
        psEnc.nFramesInPayloadBuf++;
    }

    // Finalize payload and copy to output
    let pkt_ms = psEnc.nFramesInPayloadBuf * D.FRAME_LENGTH_MS;
    if (pkt_ms >= psEnc.PacketSize_ms) {
        let frame_terminator = D.SKP_SILK_LAST_FRAME;
        let lbrrIdx = ((psEnc.oldest_LBRR_idx | 0) + 1) & LBRR_IDX_MASK;
        const lbrrBuf = psEnc.LBRR_buffer as Array<{ payload: Uint8Array; nBytes: number; usage: number }>;
        if ((lbrrBuf?.[lbrrIdx]?.usage | 0) === D.SKP_SILK_ADD_LBRR_TO_PLUS1) {
            frame_terminator = D.SKP_SILK_LBRR_VER1;
        }
        if ((lbrrBuf?.[psEnc.oldest_LBRR_idx | 0]?.usage | 0) === D.SKP_SILK_ADD_LBRR_TO_PLUS2) {
            frame_terminator = D.SKP_SILK_LBRR_VER2;
            lbrrIdx = psEnc.oldest_LBRR_idx | 0;
        }
        rangeEncode(psEnc.sRC, frame_terminator, SKP_Silk_FrameTermination_CDF);
        
        let len_ret = { val: 0 };
        rangeCoderGetLength(psEnc.sRC, len_ret);
        nBytes = len_ret.val;

        if (pnBytesOut.val >= nBytes) {
            rangeEncWrapUp(psEnc.sRC);
            for (let i = 0; i < nBytes; i++) {
                pCode[i] = psEnc.sRC.buffer[i];
            }
            if (
                frame_terminator > D.SKP_SILK_MORE_FRAMES &&
                (lbrrBuf?.[lbrrIdx]?.nBytes | 0) > 0 &&
                pnBytesOut.val >= nBytes + (lbrrBuf[lbrrIdx].nBytes | 0)
            ) {
                const extra = lbrrBuf[lbrrIdx].nBytes | 0;
                pCode.set(lbrrBuf[lbrrIdx].payload.subarray(0, extra), nBytes);
                nBytes += extra;
            }
            pnBytesOut.val = nBytes;
            if (lbrrBuf && lbrrBuf.length >= D.MAX_LBRR_DELAY) {
                const idx = psEnc.oldest_LBRR_idx | 0;
                lbrrBuf[idx].payload.set(lbrr.payload.subarray(0, lbrr.nBytes | 0), 0);
                lbrrBuf[idx].nBytes = lbrr.nBytes | 0;
                lbrrBuf[idx].usage = sEncCtrl.LBRR_usage | 0;
                psEnc.oldest_LBRR_idx = ((psEnc.oldest_LBRR_idx | 0) + 1) & LBRR_IDX_MASK;
            }
        } else {
            pnBytesOut.val = 0;
            nBytes = 0;
            ret = D.SKP_SILK_ENC_PAYLOAD_BUF_TOO_SHORT;
        }
        psEnc.nFramesInPayloadBuf = 0;
    } else {
        pnBytesOut.val = 0;
        let frame_terminator = D.SKP_SILK_MORE_FRAMES;
        rangeEncode(psEnc.sRC, frame_terminator, SKP_Silk_FrameTermination_CDF);
        let len_ret = { val: 0 };
        rangeCoderGetLength(psEnc.sRC, len_ret);
        nBytes = len_ret.val | 0;
    }

    if (psEnc.sRC.error) {
        ret = D.SKP_SILK_ENC_INTERNAL_ERROR;
    }
    
    // Simulate number of ms buffered in channel
    if (psEnc.TargetRate_bps > 0) {
        psEnc.BufferedInChannel_ms += DIV32(8 * 1000 * (nBytes - psEnc.nBytesInPayloadBuf), psEnc.TargetRate_bps);
        psEnc.BufferedInChannel_ms -= D.FRAME_LENGTH_MS;
        psEnc.BufferedInChannel_ms = LIMIT_int(psEnc.BufferedInChannel_ms, 0, 100);
    }
    psEnc.nBytesInPayloadBuf = nBytes;
    
    return ret;
}
